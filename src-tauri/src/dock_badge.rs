//! One authoritative writer for the application Dock badge: the main Squad
//! webview, reporting the same attention count as Needs you.
use crate::{lock, Shell, MAIN_WINDOW};
use std::sync::Arc;
use tauri::{Url, WebviewWindow};

const MAX_ATTENTION_COUNT: u32 = 9_999;

fn validate_request(label: &str, caller: &Url, bridge: &Url, count: u32) -> Result<(), String> {
    if label != MAIN_WINDOW {
        return Err("The Needs you badge is managed by Squad's main window.".into());
    }
    if caller.origin() != bridge.origin()
        || !caller.username().is_empty()
        || caller.password().is_some()
    {
        return Err("The badge request is not from the local Squad app.".into());
    }
    if count > MAX_ATTENTION_COUNT {
        return Err("The Needs you count exceeds the supported badge range.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn squad_set_attention_badge(
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    count: u32,
) -> Result<serde_json::Value, String> {
    let bridge = lock(&shell.app_url)
        .as_deref()
        .and_then(|value| Url::parse(value).ok())
        .ok_or("Squad is still starting.")?;
    let caller = window.url().map_err(|error| error.to_string())?;
    validate_request(window.label(), &caller, &bridge, count)?;
    #[cfg(target_os = "macos")]
    {
        // Tauri dispatches to the application NSDockTile on the native loop.
        // None removes the badge; reading an update never clears a decision.
        window
            .set_badge_count((count != 0).then_some(i64::from(count)))
            .map_err(|error| error.to_string())?;
        Ok(serde_json::json!({"supported":true,"count":count}))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({"supported":false}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_main_on_exact_active_bridge_origin_can_write_badge() {
        let bridge = Url::parse("http://127.0.0.1:19821").unwrap();
        let main = Url::parse("http://127.0.0.1:19821/work?view=needs-you").unwrap();
        assert!(validate_request("main", &main, &bridge, 8).is_ok());
        for label in ["quick-chat", "about", "settings", ""] {
            assert!(validate_request(label, &main, &bridge, 8).is_err());
        }
        for url in [
            "http://127.0.0.1:19822/work",
            "http://localhost:19821/work",
            "https://127.0.0.1:19821/work",
            "https://example.com/work",
            "http://user@127.0.0.1:19821/work",
            "http://user:password@127.0.0.1:19821/work",
        ] {
            assert!(validate_request("main", &Url::parse(url).unwrap(), &bridge, 8).is_err());
        }
    }

    #[test]
    fn badge_accepts_clear_and_bounded_count() {
        let bridge = Url::parse("http://127.0.0.1:19821").unwrap();
        for count in [0, 1, 8, MAX_ATTENTION_COUNT] {
            assert!(validate_request("main", &bridge, &bridge, count).is_ok());
        }
        for count in [MAX_ATTENTION_COUNT + 1, u32::MAX] {
            assert!(validate_request("main", &bridge, &bridge, count).is_err());
        }
    }
}
