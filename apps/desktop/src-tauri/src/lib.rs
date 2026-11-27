/**
 * Окно TinyBots. Поднимает sidecar на 127.0.0.1:8787 и гасит его вместе с окном.
 * Токен сессии живёт в памяти: в argv не кладётся, на диск не пишется, в журнал не попадает.
 * В страницу он попадает только при origin http://tauri.localhost.
 * Внешний http(s) открывается в системном браузере, само окно туда не переходит.
 * Если порт уже занят, окно показывает ошибку и к чужому процессу не ходит.
 */

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const PORT: u16 = 8787;
const BUSY: &str = "Порт 8787 занят другим процессом";
const FAILED: &str = "Сервер не стартовал";

struct Sidecar {
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: Mutex<Option<job::KillOnClose>>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("CSPRNG");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xf) as usize] as char);
    }
    out
}

fn open_external(url: &str) {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return;
    };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return;
    }
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
}

fn port_free() -> bool {
    match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    }
}

fn sidecar_name() -> String {
    let triple = env!("TAURI_ENV_TARGET_TRIPLE");
    format!("tinybots-server-{triple}{}", std::env::consts::EXE_SUFFIX)
}

fn sidecar_path() -> Option<PathBuf> {
    let name = sidecar_name();
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let beside = dir.join(&name);
    if beside.is_file() {
        return Some(beside);
    }
    let mut cursor = dir;
    for _ in 0..8 {
        let in_binaries = cursor.join("binaries").join(&name);
        if in_binaries.is_file() {
            return Some(in_binaries);
        }
        let nested = cursor.join("src-tauri").join("binaries").join(&name);
        if nested.is_file() {
            return Some(nested);
        }
        cursor = cursor.parent()?.to_path_buf();
    }
    None
}

fn sidecar_cwd() -> PathBuf {
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

fn spawn_sidecar(token: &str) -> Result<Child, String> {
    let program = sidecar_path().ok_or_else(|| FAILED.to_string())?;
    let mut command = Command::new(program);
    command
        .arg("--session-stdin")
        .current_dir(sidecar_cwd())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| FAILED.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let line = format!("{token}\n");
        if stdin.write_all(line.as_bytes()).is_err() {
            let _ = child.kill();
            return Err(FAILED.to_string());
        }
    }
    Ok(child)
}

fn read_status(token: Option<&str>) -> Option<u16> {
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

/// true только если в таблице слушателей чужой pid. Нет строки — не считаем чужим:
/// ответ 200 с нашим токеном и 401 без него уже отличает свой процесс.
#[cfg(windows)]
fn other_process_owns_port(our_pid: u32) -> bool {
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
fn other_process_owns_port(_our_pid: u32) -> bool {
    false
}

fn listening_pid(text: &str, port: u16) -> Option<u32> {
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

fn wait_until_ours(child: &mut Child, token: &str) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        if child.try_wait().ok().flatten().is_some() {
            return Err(BUSY.to_string());
        }
        let with_token = read_status(Some(token));
        let without = read_status(None);
        if with_token == Some(200) && without == Some(401) {
            if other_process_owns_port(child.id()) {
                return Err(BUSY.to_string());
            }
            return Ok(());
        }
        if without == Some(200) {
            return Err(BUSY.to_string());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(FAILED.to_string())
}

fn stop_sidecar(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<Sidecar>() else {
        return;
    };
    let child = state.child.lock().ok().and_then(|mut slot| slot.take());
    #[cfg(windows)]
    let job = state.job.lock().ok().and_then(|mut slot| slot.take());
    drop(state);
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(windows)]
    drop(job);
}

fn show_page<R: tauri::Runtime>(app: &tauri::AppHandle<R>, page: &str) {
    let _ = WebviewWindowBuilder::new(app, "error", WebviewUrl::App(page.into()))
        .title("TinyBots")
        .inner_size(720.0, 420.0)
        .build();
}

fn boot(app: &tauri::AppHandle) -> Result<(), String> {
    if !port_free() {
        show_page(app, "port-busy.html");
        return Err(BUSY.to_string());
    }
    let token = random_token();
    let script = tinybots_nav::session_script(&token).map_err(|_| FAILED.to_string())?;
    let mut child = spawn_sidecar(&token)?;
    if let Err(message) = wait_until_ours(&mut child, &token) {
        let _ = child.kill();
        let _ = child.wait();
        let page = if message == BUSY { "port-busy.html" } else { "server-failed.html" };
        show_page(app, page);
        return Err(message);
    }
    #[cfg(windows)]
    let job = job::assign(child.id());
    app.manage(Sidecar {
        child: Mutex::new(Some(child)),
        #[cfg(windows)]
        job: Mutex::new(job),
    });
    let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("TinyBots")
        .inner_size(1440.0, 900.0)
        .initialization_script(&script)
        .on_navigation(|url| tinybots_nav::allow_navigation(url, open_external))
        .on_new_window(|url, _features| {
            if tinybots_nav::navigation_effect(&url) == tinybots_nav::NavEffect::OpenExternal {
                open_external(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .build();
    if built.is_err() {
        stop_sidecar(app);
        show_page(app, "server-failed.html");
        return Err(FAILED.to_string());
    }
    Ok(())
}

#[cfg(windows)]
mod job {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Владеет HANDLE. Указатель сам по себе не Send, а состояние окна должно
    /// переезжать между потоками Tauri, поэтому храним адрес как число.
    pub struct KillOnClose(isize);

    // SAFETY: дескриптор принадлежит только этой структуре и закрывается в Drop.
    unsafe impl Send for KillOnClose {}

    pub fn assign(pid: u32) -> Option<KillOnClose> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if configured == 0 {
                CloseHandle(job);
                return None;
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return None;
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return None;
            }
            Some(KillOnClose(job as isize))
        }
    }

    impl Drop for KillOnClose {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0 as HANDLE);
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let _ = boot(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("окно")
        .run(|app, event| match event {
            RunEvent::Exit => stop_sidecar(app),
            RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            } => stop_sidecar(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::listening_pid;

    #[test]
    fn netstat_only_exact_loopback() {
        let text = "\
TCP    0.0.0.0:8787           0.0.0.0:0              LISTENING       11
TCP    127.0.0.1:8787         0.0.0.0:0              LISTENING       42
TCP    127.0.0.1:87870        0.0.0.0:0              LISTENING       99
TCP    127.0.0.1:80           0.0.0.0:0              LISTENING       7
";
        assert_eq!(listening_pid(text, 8787), Some(42));
    }

}
