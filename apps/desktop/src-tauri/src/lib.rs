/**
 * Окно TinyBots. Сразу показывает загрузку, sidecar поднимает в фоне.
 * Токен сессии живёт в памяти: в argv не кладётся, на диск не пишется, в журнал не попадает.
 * В страницу он попадает только при origin http://tauri.localhost.
 * Внешний http(s) открывается в системном браузере, само окно туда не переходит.
 * Если порт уже занят, окно показывает ошибку и к чужому процессу не ходит.
 * Ожидание sidecar не держит главный поток: иначе WebView2 не создаётся, пока процесс не ответит.
 */

mod spawn;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const BUSY: &str = "Порт 8787 занят другим процессом";
const FAILED: &str = "Сервер не стартовал";
const WAIT_LIMIT: Duration = Duration::from_secs(15);

struct Sidecar {
    child: Mutex<Option<Arc<spawn::OwnedProc>>>,
    #[cfg(windows)]
    job: Mutex<Option<job::KillOnClose>>,
    stop: Arc<AtomicBool>,
}

struct BootNote {
    text: Mutex<Option<(String, String)>>,
}

enum LaunchEnd {
    Ready,
    Busy,
    Failed(String),
    Stopped,
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
    // Свободная функция плагина, не команда окна. У страницы нет opener:allow-open-url.
    let _ = tauri_plugin_opener::open_url(url, None::<&str>);
}

fn js_string(value: &str) -> String {
    let mut out = String::from('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '<' | '>' | '&' => out.push_str(&format!("\\u{:04x}", ch as u32)),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn failure_js(reason: &str, log_path: &str) -> String {
    format!(
        "(()=>{{const put=(id,value)=>{{let n=document.getElementById(id);if(!n){{n=document.createElement('p');n.id=id;document.body.appendChild(n);}}n.textContent=value;}};put('reason',{reason});put('log',{log});}})()",
        reason = js_string(reason),
        log = js_string(log_path),
    )
}

fn open_window(app: &tauri::AppHandle, page: &str, script: Option<&str>, width: f64, height: f64) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
        .title("TinyBots")
        .inner_size(width, height)
        .on_navigation(|url| tinybots_nav::allow_navigation(url, open_external))
        .on_new_window(|url, _features| {
            if tinybots_nav::navigation_effect(&url) == tinybots_nav::NavEffect::OpenExternal {
                open_external(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .on_page_load(|window, payload| {
            use tauri::webview::PageLoadEvent;
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if !payload.url().path().ends_with("server-failed.html") {
                return;
            }
            let Some(note) = window.try_state::<BootNote>() else {
                return;
            };
            let stored = note.text.lock().ok().and_then(|guard| guard.clone());
            drop(note);
            if let Some((reason, log_path)) = stored {
                let _ = window.eval(failure_js(&reason, &log_path));
            }
        });
    if let Some(script) = script {
        builder = builder.initialization_script(script);
    }
    builder.build()?;
    Ok(())
}

fn app_page(name: &str) -> Option<tauri::Url> {
    tauri::Url::parse(&format!("http://tauri.localhost/{name}")).ok()
}

fn stop_sidecar(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<Sidecar>() else {
        return;
    };
    state.stop.store(true, Ordering::SeqCst);
    let child = state.child.lock().ok().and_then(|mut slot| slot.take());
    #[cfg(windows)]
    let job = state.job.lock().ok().and_then(|mut slot| slot.take());
    drop(state);
    if let Some(child) = child {
        child.kill();
    }
    #[cfg(windows)]
    drop(job);
}

fn note_failure(app: &tauri::AppHandle, token: &str, reason: &str, log_path: &str) {
    let Some(note) = app.try_state::<BootNote>() else {
        return;
    };
    if let Ok(mut guard) = note.text.lock() {
        *guard = Some((tinybots_log::redact(reason, token), log_path.to_string()));
    };
}

fn navigate(app: &tauri::AppHandle, page: &str) {
    let target = app_page(page);
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if app.try_state::<Sidecar>().is_some_and(|state| state.stop.load(Ordering::SeqCst)) {
            return;
        }
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if let Some(url) = target {
            let _ = window.navigate(url);
        }
    });
}

fn show_result(app: &tauri::AppHandle, token: &str, end: LaunchEnd, log_path: &str) {
    if matches!(end, LaunchEnd::Stopped) {
        return;
    }
    let page = match &end {
        LaunchEnd::Ready => "index.html",
        LaunchEnd::Busy => "port-busy.html",
        LaunchEnd::Failed(reason) => {
            note_failure(app, token, reason, log_path);
            "server-failed.html"
        }
        LaunchEnd::Stopped => return,
    };
    navigate(app, page);
}

fn log_line(log: &Mutex<tinybots_log::LaunchLog>, text: &str) {
    if let Ok(mut guard) = log.lock() {
        guard.line(text);
    }
}

fn log_ready(log: &Mutex<tinybots_log::LaunchLog>, kind: &str, started: Instant) {
    let ms = started.elapsed().as_millis();
    log_line(log, &format!("готовность: {kind} {ms} мс"));
}

fn run_sidecar(
    app: &tauri::AppHandle,
    token: &str,
    stop: &Arc<AtomicBool>,
    log: &Arc<Mutex<tinybots_log::LaunchLog>>,
    log_path: &str,
) -> LaunchEnd {
    let Some(program) = spawn::program_path() else {
        log_line(log, "sidecar не найден рядом с окном");
        log_line(log, &format!("рядом: {}", spawn::sibling_names()));
        return LaunchEnd::Failed("Sidecar не найден рядом с окном".into());
    };
    log_line(log, &format!("sidecar: {}", program.display()));
    let cwd = spawn::sidecar_cwd();
    log_line(log, &format!("cwd: {}", cwd.display()));

    let abandon = Arc::new(AtomicBool::new(false));
    let ready = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel();
    let token_bg = token.to_string();
    let log_bg = Arc::clone(log);
    let stop_bg = Arc::clone(stop);
    let abandon_bg = Arc::clone(&abandon);
    let ready_bg = Arc::clone(&ready);
    let program_bg = program.clone();
    let cwd_bg = cwd.clone();
    std::thread::spawn(move || {
        let result = spawn::start(
            &program_bg,
            &cwd_bg,
            &token_bg,
            log_bg,
            &stop_bg,
            &abandon_bg,
            ready_bg,
        );
        let _ = tx.send(result);
    });

    let started = Instant::now();
    let proc = loop {
        if stop.load(Ordering::SeqCst) {
            abandon.store(true, Ordering::SeqCst);
            if let Ok(Ok(proc)) = rx.try_recv() {
                proc.kill();
            }
            log_line(log, "остановлено закрытием окна");
            return LaunchEnd::Stopped;
        }
        if started.elapsed() >= WAIT_LIMIT {
            abandon.store(true, Ordering::SeqCst);
            if let Ok(Ok(proc)) = rx.try_recv() {
                proc.kill();
            }
            log_line(log, "таймаут 15 с");
            return LaunchEnd::Failed("Сервер не ответил за 15 с".into());
        }
        match rx.try_recv() {
            Ok(Ok(proc)) => break proc,
            Ok(Err(message)) => {
                log_line(log, &message);
                if stop.load(Ordering::SeqCst) {
                    return LaunchEnd::Stopped;
                }
                return LaunchEnd::Failed(message);
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => std::thread::sleep(Duration::from_millis(50)),
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                log_line(log, "поток запуска оборвался");
                return LaunchEnd::Failed(FAILED.into());
            }
        }
    };

    log_line(log, &format!("процесс запущен pid={}", proc.pid()));
    if let Some(state) = app.try_state::<Sidecar>() {
        if let Ok(mut slot) = state.child.lock() {
            *slot = Some(Arc::clone(&proc));
        }
        #[cfg(windows)]
        if let Ok(mut slot) = state.job.lock() {
            *slot = job::assign(proc.pid());
        }
    }

    let mut noted_timeout = false;
    loop {
        if stop.load(Ordering::SeqCst) {
            proc.kill();
            log_line(log, "остановлено закрытием окна");
            return LaunchEnd::Stopped;
        }
        if let Some(code) = proc.try_wait() {
            let _ = std::thread::sleep(Duration::from_millis(150));
            log_line(log, &format!("код выхода {code}"));
            if !spawn::port_free() {
                log_line(log, "порт занят чужим процессом");
                return LaunchEnd::Busy;
            }
            return LaunchEnd::Failed(format!("Sidecar завершился с кодом {code}"));
        }
        // Строка stdout — наш процесс уже слушает. 200 от /api/bots не требуется:
        // в установленной папке файла демо нет, и с токеном приходит 500.
        if ready.load(Ordering::SeqCst) {
            log_ready(log, "stdout", started);
            return LaunchEnd::Ready;
        }
        let with_token = spawn::read_status(Some(token));
        let without = spawn::read_status(None);
        if tinybots_log::health_accepted(with_token, without) && !spawn::other_process_owns_port(proc.pid()) {
            log_ready(log, "health", started);
            return LaunchEnd::Ready;
        }
        if without == Some(200) {
            proc.kill();
            log_line(log, "порт занят чужим процессом");
            return LaunchEnd::Busy;
        }
        if !noted_timeout && started.elapsed() >= WAIT_LIMIT {
            noted_timeout = true;
            log_line(log, "таймаут 15 с");
            note_failure(app, token, "Сервер не ответил за 15 с", log_path);
            navigate(app, "server-failed.html");
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn supervise(app: tauri::AppHandle, token: String, stop: Arc<AtomicBool>) {
    let log = Arc::new(Mutex::new(tinybots_log::LaunchLog::open(&token)));
    let log_path = log
        .lock()
        .ok()
        .map(|guard| guard.path().display().to_string())
        .unwrap_or_else(|| tinybots_log::log_dir().join("launch.log").display().to_string());
    log_line(&log, "старт");
    let end = run_sidecar(&app, &token, &stop, &log, &log_path);
    if let Ok(mut guard) = log.lock() {
        guard.finish();
    }
    if matches!(end, LaunchEnd::Failed(_) | LaunchEnd::Busy) {
        if let Some(state) = app.try_state::<Sidecar>() {
            if let Some(child) = state.child.lock().ok().and_then(|mut slot| slot.take()) {
                child.kill();
            }
            #[cfg(windows)]
            {
                let _job = state.job.lock().ok().and_then(|mut slot| slot.take());
            }
        }
    }
    show_result(&app, &token, end, &log_path);
}

fn boot(app: &tauri::AppHandle) -> tauri::Result<()> {
    if !spawn::port_free() {
        open_window(app, "port-busy.html", None, 720.0, 420.0)?;
        let mut log = tinybots_log::LaunchLog::open("");
        log.line("порт 8787 занят до старта sidecar");
        return Ok(());
    }
    let token = random_token();
    let script = tinybots_nav::session_script(&token).expect("токен 64 hex");
    let stop = Arc::new(AtomicBool::new(false));
    app.manage(Sidecar {
        child: Mutex::new(None),
        #[cfg(windows)]
        job: Mutex::new(None),
        stop: Arc::clone(&stop),
    });
    app.manage(BootNote {
        text: Mutex::new(None),
    });
    let background = app.clone();
    std::thread::spawn(move || supervise(background, token, stop));
    if let Err(error) = open_window(app, "loading.html", Some(&script), 1440.0, 900.0) {
        if let Some(state) = app.try_state::<Sidecar>() {
            state.stop.store(true, Ordering::SeqCst);
        }
        return Err(error);
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
            boot(app.handle())?;
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
    use super::spawn::listening_pid;

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
