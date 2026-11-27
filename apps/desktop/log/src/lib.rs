/**
 * Журнал запуска окна.
 * Вход: каталог, секрет (токен сессии) и куски stdout/stderr sidecar.
 * Выход: файл в каталоге, без секрета. Размер ограничен, предыдущий файл — один.
 * Секрет вырезается даже если пришёл двумя кусками: хвост короче секрета не пишется, пока не придёт продолжение.
 */

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const PLACEHOLDER: &str = "[secret]";

/// Строка, которую sidecar печатает после успешного listen.
pub const READY_LINE: &str = "TinyBots: http://127.0.0.1:8787";

/// Запрос на 8787, пока нет строки готовности нашего процесса.
/// Токена в нём нет: чужой слушатель не должен его получить.
/// После строки оболочка порт больше не опрашивает.
pub fn request_before_ready_line(token: &str) -> &'static str {
    let _ = token;
    "GET /api/bots HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n\r\n"
}

/// Сервер принял сессию: без токена 401, с токеном не отказ.
/// Оболочка это для готовности не использует: токен на порт до строки не уходит.
pub fn health_accepted(with_token: Option<u16>, without: Option<u16>) -> bool {
    let Some(status) = with_token else {
        return false;
    };
    if status == 401 || status == 403 {
        return false;
    }
    without == Some(401)
}

pub fn line_ready(text: &str) -> bool {
    text.split(['\n', '\r']).any(|line| line.trim() == READY_LINE)
}

/// Ловит строку готовности, даже если она пришла двумя кусками.
#[derive(Debug, Default)]
pub struct ReadyWatch {
    pending: String,
    seen: bool,
}

impl ReadyWatch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn seen(&self) -> bool {
        self.seen
    }

    pub fn push(&mut self, chunk: &str) -> bool {
        if self.seen {
            return true;
        }
        self.pending.push_str(chunk);
        if line_ready(&self.pending) {
            self.seen = true;
            return true;
        }
        let keep = READY_LINE.len() + 1;
        if self.pending.len() > keep {
            let split = floor_char(&self.pending, self.pending.len() - keep);
            self.pending.drain(..split);
        }
        false
    }
}

pub fn log_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("app.tinybots.desktop").join("logs")
}

pub fn redact(text: &str, secret: &str) -> String {
    if secret.len() < 32 {
        return text.to_string();
    }
    text.replace(secret, PLACEHOLDER)
}

/// Копит хвост, чтобы секрет на границе двух кусков не попал в файл целиком.
struct Tail {
    secret: String,
    pending: String,
}

fn floor_char(text: &str, mut index: usize) -> usize {
    if index > text.len() {
        return text.len();
    }
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// Сколько последних байт могут быть началом секрета и ещё не должны уехать в файл.
fn held_prefix(text: &str, secret: &str) -> usize {
    let max = secret.len().saturating_sub(1).min(text.len());
    for len in (1..=max).rev() {
        let start = text.len() - len;
        if text.is_char_boundary(start) && secret.starts_with(&text[start..]) {
            return len;
        }
    }
    0
}

impl Tail {
    fn new(secret: &str) -> Self {
        Self {
            secret: secret.to_string(),
            pending: String::new(),
        }
    }

    fn push(&mut self, chunk: &str) -> String {
        if self.secret.len() < 32 {
            return chunk.to_string();
        }
        self.pending.push_str(chunk);
        let mut out = String::new();
        self.drain_matches(&mut out);
        let keep = held_prefix(&self.pending, &self.secret);
        let split = floor_char(&self.pending, self.pending.len().saturating_sub(keep));
        out.push_str(&self.pending[..split]);
        self.pending.drain(..split);
        out
    }

    fn finish(&mut self) -> String {
        let mut out = String::new();
        if self.secret.len() >= 32 {
            self.drain_matches(&mut out);
        }
        out.push_str(&self.pending);
        self.pending.clear();
        out
    }

    fn drain_matches(&mut self, out: &mut String) {
        while let Some(index) = self.pending.find(&self.secret) {
            out.push_str(&self.pending[..index]);
            out.push_str(PLACEHOLDER);
            self.pending.replace_range(..index + self.secret.len(), "");
        }
    }
}

pub struct LaunchLog {
    path: PathBuf,
    secret: String,
    out: Tail,
    err: Tail,
    max_bytes: u64,
}

impl LaunchLog {
    pub fn open(secret: &str) -> Self {
        Self::create(&log_dir(), secret, 256 * 1024)
    }

    pub fn create(dir: &Path, secret: &str, max_bytes: u64) -> Self {
        let _ = fs::create_dir_all(dir);
        Self {
            path: dir.join("launch.log"),
            secret: secret.to_string(),
            out: Tail::new(secret),
            err: Tail::new(secret),
            max_bytes: max_bytes.max(64),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn line(&mut self, text: &str) {
        let clean = redact(text, &self.secret);
        self.write_raw(&format!("{clean}\n"));
    }

    pub fn push_stdio(&mut self, stream: &str, chunk: &str) {
        let tail = if stream == "stdout" { &mut self.out } else { &mut self.err };
        let clean = tail.push(chunk);
        if !clean.is_empty() {
            self.write_raw(&format!("{stream}: {clean}"));
        }
    }

    pub fn finish(&mut self) {
        let out = self.out.finish();
        let err = self.err.finish();
        if !out.is_empty() {
            self.write_raw(&format!("stdout: {out}"));
        }
        if !err.is_empty() {
            self.write_raw(&format!("stderr: {err}"));
        }
    }

    fn write_raw(&mut self, text: &str) {
        let bytes = text.as_bytes();
        let slice = if bytes.len() as u64 > self.max_bytes {
            &bytes[..self.max_bytes as usize]
        } else {
            bytes
        };
        self.rotate_if_needed(slice.len() as u64);
        let fresh = fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0) == 0;
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            // BOM, чтобы блокнот Windows открыл журнал как UTF-8.
            if fresh {
                let _ = file.write_all(&[0xEF, 0xBB, 0xBF]);
            }
            let _ = file.write_all(slice);
        }
    }

    fn rotate_if_needed(&self, incoming: u64) {
        let len = fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0);
        if len == 0 || len.saturating_add(incoming) <= self.max_bytes {
            return;
        }
        let previous = self.path.with_file_name("launch.log.1");
        let _ = fs::remove_file(&previous);
        let _ = fs::rename(&self.path, &previous);
    }
}

impl Drop for LaunchLog {
    fn drop(&mut self) {
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tinybots-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn journal_drops_the_session_token_even_when_split() {
        let secret = "ab".repeat(32);
        let dir = scratch("token");
        let mut log = LaunchLog::create(&dir, &secret, 4096);
        log.line(&format!("sidecar: C:\\\\TinyBots\\\\server.exe token={secret}"));
        log.push_stdio("stdout", &format!("до {secret} после"));
        log.push_stdio("stderr", &secret[..30]);
        log.push_stdio("stderr", &secret[30..]);
        log.finish();
        let body = fs::read_to_string(log.path()).unwrap();
        assert!(!body.contains(&secret), "{body}");
        assert!(body.contains(PLACEHOLDER), "{body}");
        assert!(body.contains("sidecar:"), "{body}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn journal_rotates_and_stays_under_the_limit() {
        let secret = "cd".repeat(32);
        let dir = scratch("rotate");
        let mut log = LaunchLog::create(&dir, &secret, 80);
        log.line(&format!("aaaa {secret}"));
        log.line(&"b".repeat(70));
        log.finish();
        let current = fs::read(log.path()).unwrap();
        let previous = fs::read(dir.join("launch.log.1")).unwrap();
        assert!(current.len() as u64 <= 80, "{}", current.len());
        assert!(previous.len() as u64 <= 80, "{}", previous.len());
        let both = format!("{}{}", String::from_utf8_lossy(&current), String::from_utf8_lossy(&previous));
        assert!(!both.contains(&secret), "{both}");
        assert!(both.contains(PLACEHOLDER));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ready_line_is_exact_and_survives_a_split() {
        assert!(line_ready("TinyBots: http://127.0.0.1:8787\n"));
        assert!(line_ready("шум\r\nTinyBots: http://127.0.0.1:8787\r\n"));
        assert!(!line_ready("TinyBots: http://127.0.0.1:87870\n"));
        assert!(!line_ready("TinyBots: http://127.0.0.1:80\n"));
        assert!(!line_ready("TinyBots: http://localhost:8787\n"));
        let mut watch = ReadyWatch::new();
        let line = READY_LINE;
        assert!(!watch.push(&line[..20]));
        assert!(watch.push(&line[20..]));
        assert!(watch.seen());
        assert!(health_accepted(Some(500), Some(401)));
        assert!(health_accepted(Some(200), Some(401)));
        assert!(!health_accepted(Some(401), Some(401)));
        assert!(!health_accepted(Some(200), Some(200)));
        assert!(!health_accepted(None, Some(401)));
    }

    #[test]
    fn token_is_not_sent_before_the_ready_line() {
        let token = "ab".repeat(32);
        let request = request_before_ready_line(&token);
        assert!(!line_ready(""));
        assert!(!request.contains(&token), "{request}");
        assert!(!request.to_ascii_lowercase().contains("x-tinybots-session"), "{request}");
        assert!(!request.to_ascii_lowercase().contains("authorization"), "{request}");
        assert!(request.contains("GET /api/bots"));
        assert!(request.contains("Host: 127.0.0.1:8787"));
    }
}
