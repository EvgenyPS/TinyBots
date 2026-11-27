/**
 * Запуск sidecar без ожидания на главном потоке.
 * Вход: путь к exe, рабочий каталог, токен одной строкой в stdin.
 * Выход: живой процесс или текст ошибки без токена.
 * На Windows дочернему процессу отдаются только три конца pipe.
 * Иначе он наследует дескрипторы WebView2 и создание окна зависает.
 */

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tinybots_log::LaunchLog;

const PORT: u16 = 8787;

pub struct OwnedProc {
    pid: u32,
    body: Mutex<ProcBody>,
}

enum ProcBody {
    #[cfg(windows)]
    Win {
        handle: std::os::windows::io::OwnedHandle,
        exit: Option<i32>,
    },
    #[cfg(not(windows))]
    Unix {
        child: std::process::Child,
        exit: Option<i32>,
    },
}

impl OwnedProc {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn try_wait(&self) -> Option<i32> {
        let mut body = self.body.lock().ok()?;
        if let Some(code) = body.exit_code() {
            return Some(code);
        }
        body.poll()
    }

    pub fn kill(&self) {
        if let Ok(mut body) = self.body.lock() {
            body.kill();
        }
    }
}

impl ProcBody {
    fn exit_code(&self) -> Option<i32> {
        match self {
            #[cfg(windows)]
            ProcBody::Win { exit, .. } => *exit,
            #[cfg(not(windows))]
            ProcBody::Unix { exit, .. } => *exit,
        }
    }

    fn poll(&mut self) -> Option<i32> {
        #[cfg(windows)]
        {
            let ProcBody::Win { handle, exit } = self;
            if exit.is_some() {
                return *exit;
            }
            unsafe {
                use std::os::windows::io::AsRawHandle;
                use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
                use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
                let raw = handle.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
                let waited = WaitForSingleObject(raw, 0);
                if waited == WAIT_TIMEOUT {
                    return None;
                }
                if waited != WAIT_OBJECT_0 {
                    return None;
                }
                let mut code = 0u32;
                if GetExitCodeProcess(raw, &mut code) == 0 {
                    *exit = Some(-1);
                } else {
                    *exit = Some(code as i32);
                }
            }
            return *exit;
        }
        #[cfg(not(windows))]
        {
            let ProcBody::Unix { child, exit } = self;
            if exit.is_some() {
                return *exit;
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    *exit = Some(status.code().unwrap_or(-1));
                    *exit
                }
                _ => None,
            }
        }
    }

    fn kill(&mut self) {
        #[cfg(windows)]
        unsafe {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
            use windows_sys::Win32::System::Threading::{
                GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
            };
            let ProcBody::Win { handle, exit } = self;
            let raw = handle.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
            let _ = TerminateProcess(raw, 1);
            let _ = WaitForSingleObject(raw, 3_000);
            if exit.is_none() {
                let mut code = 0u32;
                if GetExitCodeProcess(raw, &mut code) != 0 && WaitForSingleObject(raw, 0) == WAIT_OBJECT_0 {
                    *exit = Some(code as i32);
                }
            }
        }
        #[cfg(not(windows))]
        {
            let ProcBody::Unix { child, exit } = self;
            let _ = child.kill();
            if let Ok(status) = child.wait() {
                *exit = Some(status.code().unwrap_or(-1));
            }
        }
    }
}

pub fn program_path() -> Option<PathBuf> {
    let triple = sidecar_name();
    // NSIS кладёт externalBin рядом с окном уже без суффикса target triple.
    let plain = format!("tinybots-server{}", std::env::consts::EXE_SUFFIX);
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    for name in [&triple, &plain] {
        let beside = dir.join(name);
        if beside.is_file() {
            return Some(beside);
        }
    }
    let mut cursor = dir;
    for _ in 0..8 {
        for name in [&triple, &plain] {
            let in_binaries = cursor.join("binaries").join(name);
            if in_binaries.is_file() {
                return Some(in_binaries);
            }
            let nested = cursor.join("src-tauri").join("binaries").join(name);
            if nested.is_file() {
                return Some(nested);
            }
        }
        cursor = cursor.parent()?.to_path_buf();
    }
    None
}

pub fn sibling_names() -> String {
    let Ok(exe) = std::env::current_exe() else {
        return String::new();
    };
    let Some(dir) = exe.parent() else {
        return String::new();
    };
    let mut names = Vec::new();
    if let Ok(read) = std::fs::read_dir(dir) {
        for item in read.flatten() {
            names.push(item.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    names.join(", ")
}

pub fn sidecar_cwd() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let mut cursor = exe.parent().map(|path| path.to_path_buf());
        for _ in 0..8 {
            if let Some(dir) = cursor {
                if dir.join("demo").join("bots.json").is_file() && dir.join("package.json").is_file() {
                    return dir;
                }
                cursor = dir.parent().map(|path| path.to_path_buf());
            }
        }
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("TinyBots");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn sidecar_name() -> String {
    let triple = env!("TAURI_ENV_TARGET_TRIPLE");
    format!("tinybots-server-{triple}{}", std::env::consts::EXE_SUFFIX)
}

pub fn command_line(path: &Path) -> String {
    format!("\"{}\" --session-stdin", path.to_string_lossy().replace('"', ""))
}

pub fn port_free() -> bool {
    match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    }
}

pub fn read_status(token: Option<&str>) -> Option<u16> {
    let address = "127.0.0.1:8787".parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(400)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(800))).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(800))).ok()?;
    let mut request = String::from("GET /api/bots HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n");
    if let Some(value) = token {
        request.push_str("X-Tinybots-Session: ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                if buf.len() + size > 16_384 {
                    break;
                }
                buf.extend_from_slice(&chunk[..size]);
                if buf.windows(4).any(|item| item == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&buf);
    if token.is_some_and(|value| !value.is_empty() && text.contains(value)) {
        return None;
    }
    text.split_whitespace().nth(1)?.parse().ok()
}

/// true только если в таблице слушателей чужой pid. Нет строки — не считаем чужим.
#[cfg(windows)]
pub fn other_process_owns_port(our_pid: u32) -> bool {
    let Ok(output) = Command::new("netstat").args(["-ano", "-p", "tcp"]).output() else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    match listening_pid(&text, PORT) {
        Some(pid) => pid != our_pid,
        None => false,
    }
}

#[cfg(not(windows))]
pub fn other_process_owns_port(_our_pid: u32) -> bool {
    false
}

pub fn listening_pid(text: &str, port: u16) -> Option<u32> {
    let needle = format!("127.0.0.1:{port}");
    for line in text.lines() {
        if !line.to_ascii_uppercase().contains("LISTENING") {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        if !fields.iter().any(|field| *field == needle) {
            continue;
        }
        return fields.last()?.parse().ok();
    }
    None
}

pub fn start(
    program: &Path,
    cwd: &Path,
    token: &str,
    log: Arc<Mutex<LaunchLog>>,
    stop: &AtomicBool,
    abandon: &AtomicBool,
    ready: Arc<AtomicBool>,
) -> Result<Arc<OwnedProc>, String> {
    let proc = start_os(program, cwd, token, log, stop, abandon, ready)?;
    if stop.load(Ordering::SeqCst) || abandon.load(Ordering::SeqCst) {
        proc.kill();
        return Err("запуск sidecar прерван".into());
    }
    Ok(proc)
}

fn pump(mut file: impl Read, log: Arc<Mutex<LaunchLog>>, stream: &'static str, ready: Arc<AtomicBool>) {
    let mut watch = tinybots_log::ReadyWatch::new();
    let mut buf = [0u8; 4096];
    loop {
        match file.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(size) => {
                let text = String::from_utf8_lossy(&buf[..size]);
                if stream == "stdout" && watch.push(&text) {
                    ready.store(true, Ordering::SeqCst);
                }
                if let Ok(mut guard) = log.lock() {
                    guard.push_stdio(stream, &text);
                }
            }
        }
    }
}

fn write_token(mut input: impl Write + Send + 'static, token: String) {
    std::thread::spawn(move || {
        let line = format!("{token}\n");
        let _ = input.write_all(line.as_bytes());
        let _ = input.flush();
    });
}

#[cfg(windows)]
fn start_os(
    program: &Path,
    cwd: &Path,
    token: &str,
    log: Arc<Mutex<LaunchLog>>,
    _stop: &AtomicBool,
    _abandon: &AtomicBool,
    ready: Arc<AtomicBool>,
) -> Result<Arc<OwnedProc>, String> {
    // stop/abandon проверяет вызывающий start() после возврата: так процесс не остаётся сиротой.
    let _ = (_stop, _abandon);
    unsafe { spawn_restricted(program, cwd, token, log, ready) }
}

#[cfg(windows)]
unsafe fn spawn_restricted(
    program: &Path,
    cwd: &Path,
    token: &str,
    log: Arc<Mutex<LaunchLog>>,
    ready: Arc<AtomicBool>,
) -> Result<Arc<OwnedProc>, String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
        UpdateProcThreadAttribute, CREATE_NO_WINDOW, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    struct Raw(HANDLE);
    impl Drop for Raw {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CloseHandle(self.0); }
            }
        }
    }
    impl Raw {
        fn take(&mut self) -> HANDLE {
            let handle = self.0;
            self.0 = std::ptr::null_mut();
            handle
        }
    }

    struct Ends {
        read: Raw,
        write: Raw,
    }

    fn win_err(prefix: &str) -> String {
        let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        format!("{prefix} (код Win32 {code})")
    }

    unsafe fn make_pipe() -> Result<Ends, String> {
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        if CreatePipe(&mut read, &mut write, &sa, 0) == 0 {
            return Err(win_err("Не удалось создать канал sidecar"));
        }
        Ok(Ends {
            read: Raw(read),
            write: Raw(write),
        })
    }

    fn inherit(handle: HANDLE, on: bool) -> Result<(), String> {
        let flags = if on { HANDLE_FLAG_INHERIT } else { 0 };
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, flags) } == 0 {
            return Err(win_err("Не удалось ограничить наследование дескрипторов"));
        }
        Ok(())
    }

    fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
        text.encode_wide().chain(std::iter::once(0)).collect()
    }

    let mut stdin = make_pipe()?;
    let mut stdout = make_pipe()?;
    let mut stderr = make_pipe()?;
    // Концы родителя не наследуются: иначе sidecar держит запись в свой stdin и не видит конец строки.
    inherit(stdin.write.0, false)?;
    inherit(stdout.read.0, false)?;
    inherit(stderr.read.0, false)?;
    inherit(stdin.read.0, true)?;
    inherit(stdout.write.0, true)?;
    inherit(stderr.write.0, true)?;

    let handed = [stdin.read.0, stdout.write.0, stderr.write.0];
    let mut bytes = 0usize;
    InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut bytes);
    if bytes == 0 {
        return Err(win_err("Не удалось подготовить список дескрипторов"));
    }
    let layout = std::alloc::Layout::from_size_align(bytes, 16).map_err(|_| "Не удалось подготовить список дескрипторов".to_string())?;
    let list = std::alloc::alloc_zeroed(layout);
    if list.is_null() {
        return Err("Не удалось подготовить список дескрипторов".into());
    }
    struct List {
        ptr: *mut u8,
        layout: std::alloc::Layout,
        ready: bool,
    }
    impl Drop for List {
        fn drop(&mut self) {
            unsafe {
                if self.ready {
                    DeleteProcThreadAttributeList(self.ptr as _);
                }
                std::alloc::dealloc(self.ptr, self.layout);
            }
        }
    }
    let mut list = List {
        ptr: list,
        layout,
        ready: false,
    };
    if InitializeProcThreadAttributeList(list.ptr as _, 1, 0, &mut bytes) == 0 {
        return Err(win_err("Не удалось подготовить список дескрипторов"));
    }
    list.ready = true;
    if UpdateProcThreadAttribute(
        list.ptr as _,
        0,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
        handed.as_ptr() as *const _,
        std::mem::size_of_val(&handed),
        std::ptr::null_mut(),
        std::ptr::null(),
    ) == 0
    {
        return Err(win_err("Не удалось ограничить наследование дескрипторов"));
    }

    let mut info: STARTUPINFOEXW = std::mem::zeroed();
    info.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    info.StartupInfo.hStdInput = stdin.read.0;
    info.StartupInfo.hStdOutput = stdout.write.0;
    info.StartupInfo.hStdError = stderr.write.0;
    info.lpAttributeList = list.ptr as _;

    let application = wide(program.as_os_str());
    let mut cmdline = wide(std::ffi::OsStr::new(&command_line(program)));
    let directory = wide(cwd.as_os_str());
    let mut process: PROCESS_INFORMATION = std::mem::zeroed();
    let created = CreateProcessW(
        application.as_ptr(),
        cmdline.as_mut_ptr(),
        std::ptr::null(),
        std::ptr::null(),
        1,
        CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
        std::ptr::null(),
        directory.as_ptr(),
        &info.StartupInfo,
        &mut process,
    );
    if created == 0 {
        return Err(win_err("Не удалось запустить sidecar"));
    }
    CloseHandle(process.hThread);

    // Родитель закрывает детские концы, иначе stdin не получит EOF, а stdout забьёт буфер.
    let parent_in = stdin.write.take();
    let parent_out = stdout.read.take();
    let parent_err = stderr.read.take();
    drop(stdin);
    drop(stdout);
    drop(stderr);
    drop(list);

    let input = std::fs::File::from(OwnedHandle::from_raw_handle(parent_in as _));
    let output = std::fs::File::from(OwnedHandle::from_raw_handle(parent_out as _));
    let errors = std::fs::File::from(OwnedHandle::from_raw_handle(parent_err as _));
    let log_out = Arc::clone(&log);
    let log_err = Arc::clone(&log);
    let ready_out = Arc::clone(&ready);
    let ready_err = Arc::clone(&ready);
    std::thread::spawn(move || pump(output, log_out, "stdout", ready_out));
    std::thread::spawn(move || pump(errors, log_err, "stderr", ready_err));
    write_token(input, token.to_string());

    let handle = OwnedHandle::from_raw_handle(process.hProcess as _);
    Ok(Arc::new(OwnedProc {
        pid: process.dwProcessId,
        body: Mutex::new(ProcBody::Win { handle, exit: None }),
    }))
}

#[cfg(not(windows))]
fn start_os(
    program: &Path,
    cwd: &Path,
    token: &str,
    log: Arc<Mutex<LaunchLog>>,
    _stop: &AtomicBool,
    _abandon: &AtomicBool,
    ready: Arc<AtomicBool>,
) -> Result<Arc<OwnedProc>, String> {
    use std::process::Stdio;
    let mut child = Command::new(program)
        .arg("--session-stdin")
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Не удалось запустить sidecar".to_string())?;
    let pid = child.id();
    let input = child.stdin.take().ok_or_else(|| "Не удалось запустить sidecar".to_string())?;
    let output = child.stdout.take().ok_or_else(|| "Не удалось запустить sidecar".to_string())?;
    let errors = child.stderr.take().ok_or_else(|| "Не удалось запустить sidecar".to_string())?;
    let log_out = Arc::clone(&log);
    let log_err = Arc::clone(&log);
    let ready_out = Arc::clone(&ready);
    let ready_err = Arc::clone(&ready);
    std::thread::spawn(move || pump(output, log_out, "stdout", ready_out));
    std::thread::spawn(move || pump(errors, log_err, "stderr", ready_err));
    write_token(input, token.to_string());
    Ok(Arc::new(OwnedProc {
        pid,
        body: Mutex::new(ProcBody::Unix { child, exit: None }),
    }))
}

#[cfg(test)]
mod tests {
    use super::command_line;
    use std::path::Path;

    #[test]
    fn command_line_has_session_flag_and_no_token() {
        let line = command_line(Path::new(r"C:\Program Files\tinybots-server.exe"));
        assert_eq!(line, "\"C:\\Program Files\\tinybots-server.exe\" --session-stdin");
        assert!(!line.to_ascii_lowercase().contains("token"));
    }
}
