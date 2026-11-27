/**
 * Куда главному окну можно ходить и когда страница получает токен.
 * Вход: абсолютный URL перехода и токен из 64 шестнадцатеричных символов.
 * Выход: остаться в окне, отдать http(s) системному браузеру или отклонить.
 * Токен в скрипт попадает только внутрь проверки origin, на чужой странице свойство не создаётся.
 */

use url::Url;

const APP_ORIGIN: &str = "http://tauri.localhost";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavEffect {
    Allow,
    OpenExternal,
    Block,
}

pub fn navigation_effect(url: &Url) -> NavEffect {
    if is_app_page(url) {
        return NavEffect::Allow;
    }
    if url.scheme() == "http" || url.scheme() == "https" {
        return NavEffect::OpenExternal;
    }
    NavEffect::Block
}

/// true — окно переходит само. false — переход отменён.
/// Внешний http(s) перед отменой отдаётся в `open_external` (системный браузер).
pub fn allow_navigation(url: &Url, open_external: impl FnOnce(&str)) -> bool {
    match navigation_effect(url) {
        NavEffect::Allow => true,
        NavEffect::OpenExternal => {
            open_external(url.as_str());
            false
        }
        NavEffect::Block => false,
    }
}

fn is_app_page(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn session_script(token: &str) -> Result<String, ()> {
    if token.len() != 64 || !token.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
        return Err(());
    }
    Ok(format!(
        r#"if(location.origin==="{APP_ORIGIN}"){{Object.defineProperty(window,"__TINYBOTS_SESSION__",{{value:"{token}",enumerable:false,configurable:true,writable:false}})}}"#
    ))
}

#[cfg(test)]
mod tests {
    use super::{allow_navigation, session_script, NavEffect};
    use std::process::Command;
    use url::Url;

    fn decide(raw: &str) -> (bool, Option<String>) {
        let url = Url::parse(raw).unwrap();
        let mut opened = None;
        let allow = allow_navigation(&url, |value| opened = Some(value.to_string()));
        (allow, opened)
    }

    #[test]
    fn app_origin_stays_in_the_window() {
        for raw in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "http://tauri.localhost/index.html?demo=1#chat",
        ] {
            let (allow, opened) = decide(raw);
            assert!(allow, "{raw}");
            assert!(opened.is_none(), "{raw}");
        }
    }

    #[test]
    fn external_http_is_blocked_and_handed_to_the_browser() {
        for raw in [
            "https://github.com/example/repo/pull/15",
            "http://evil.example/path",
            "http://tauri.localhost.evil.com/",
            "https://tauri.localhost/",
            "http://tauri.localhost:8787/",
            "http://user@tauri.localhost/",
            "http://127.0.0.1:8787/",
        ] {
            let (allow, opened) = decide(raw);
            assert!(!allow, "{raw}");
            assert_eq!(opened.as_deref(), Some(raw), "{raw}");
        }
    }

    #[test]
    fn other_schemes_are_blocked_and_not_opened() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "mailto:a@b.c",
        ] {
            let (allow, opened) = decide(raw);
            assert!(!allow, "{raw}");
            assert!(opened.is_none(), "{raw}");
        }
    }

    #[test]
    fn effect_names_match_the_browser_handoff() {
        let external = Url::parse("https://github.com/example/repo/pull/15").unwrap();
        assert_eq!(super::navigation_effect(&external), NavEffect::OpenExternal);
        let blocked = Url::parse("file:///tmp/x").unwrap();
        assert_eq!(super::navigation_effect(&blocked), NavEffect::Block);
    }

    #[test]
    fn token_is_not_issued_on_a_foreign_origin() {
        let token = "cd".repeat(32);
        let script = session_script(&token).unwrap();
        assert!(script.starts_with("if(location.origin===\"http://tauri.localhost\"){"));
        assert!(script.contains(&format!("value:\"{token}\"")));
        assert!(!script.contains('\n'));
        let probe = r#"
          const script = process.env.TINYBOTS_SCRIPT;
          const token = process.env.TINYBOTS_TOKEN;
          const cases = [
            ['http://tauri.localhost', true],
            ['https://github.com', false],
            ['http://tauri.localhost.evil.com', false],
            ['https://tauri.localhost', false],
            ['http://tauri.localhost:8787', false],
            ['http://127.0.0.1:8787', false],
            ['http://evil.example', false],
          ];
          for (const [origin, should] of cases) {
            globalThis.window = {};
            globalThis.location = { origin };
            eval(script);
            const has = Object.prototype.hasOwnProperty.call(globalThis.window, '__TINYBOTS_SESSION__');
            if (has !== should) {
              console.error('origin', origin, 'has', has);
              process.exit(1);
            }
            if (should && globalThis.window.__TINYBOTS_SESSION__ !== token) process.exit(2);
            if (!should && JSON.stringify(globalThis.window).includes(token)) process.exit(3);
          }
        "#;
        let output = Command::new("node")
            .arg("-e")
            .arg(probe)
            .env("TINYBOTS_SCRIPT", &script)
            .env("TINYBOTS_TOKEN", &token)
            .output()
            .expect("node");
        assert!(
            output.status.success(),
            "stdout {}\nstderr {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn page_has_no_opener_permission_and_rust_still_opens_http() {
        let text = include_str!("../../src-tauri/capabilities/default.json");
        let value: serde_json::Value = serde_json::from_str(text).unwrap();
        let permissions = value["permissions"].as_array().unwrap();
        assert_eq!(permissions.len(), 1);
        assert_eq!(permissions[0], "core:default");
        assert!(!text.contains("opener"));
        assert!(!text.contains("http://**"));
        assert!(!text.contains("https://**"));
        let window = include_str!("../../src-tauri/src/lib.rs");
        assert!(window.contains("tauri_plugin_opener::open_url"));
        assert!(window.contains(".on_navigation(|url| tinybots_nav::allow_navigation(url, open_external))"));
        let url = Url::parse("https://github.com/example/repo/pull/15").unwrap();
        let mut opened = None;
        assert!(!allow_navigation(&url, |value| opened = Some(value.to_string())));
        assert_eq!(opened.as_deref(), Some("https://github.com/example/repo/pull/15"));
    }
}
