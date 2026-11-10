//! One authoritative writer for the application Dock badge: the main Squad
//! webview, reporting the same attention count as Needs you.
use crate::{lock, Shell, MAIN_WINDOW};
use std::sync::Arc;
use tauri::{AppHandle, Url, WebviewWindow};

const MAX_ATTENTION_COUNT: u32 = 9_999;

#[cfg(target_os = "macos")]
static BADGE_SCOPE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(target_os = "macos")]
fn apply_count(count: u32) -> Result<(), String> {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;
    let marker = objc2::MainThreadMarker::new()
        .ok_or("The Dock badge must update on the native main thread.")?;
    let label = (count > 0).then(|| NSString::from_str(&count.to_string()));
    NSApplication::sharedApplication(marker)
        .dockTile()
        .setBadgeLabel(label.as_deref());
    Ok(())
}

pub(crate) fn initialize() {
    #[cfg(target_os = "macos")]
    {
        let _ = apply_count(0);
        *crate::lock(&BADGE_SCOPE) = None;
    }
}

pub(crate) fn invalidate_scope() {
    #[cfg(target_os = "macos")]
    {
        let generation =
            autohand_squad_runtime::ownership::read_active_context(&crate::default_paths())
                .ok()
                .flatten()
                .map(|context| context.generation);
        let mut applied = crate::lock(&BADGE_SCOPE);
        if generation.is_none() || *applied != generation {
            let _ = apply_count(0);
            *applied = None;
        }
    }
}

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
pub(crate) async fn squad_set_attention_badge(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
    count: u32,
    context_generation: String,
) -> Result<serde_json::Value, String> {
    let owned = crate::require_native_context(&context_generation, false)?;
    let bridge = lock(&shell.app_url)
        .as_deref()
        .and_then(|value| Url::parse(value).ok())
        .ok_or("Squad is still starting.")?;
    let caller = window.url().map_err(|error| error.to_string())?;
    validate_request(window.label(), &caller, &bridge, count)?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = crate::require_current_native_context(&owned)
                .and_then(|_| apply_count(count))
                .map(|_| {
                    *crate::lock(&BADGE_SCOPE) = Some(owned.generation);
                    serde_json::json!({"supported":true,"count":count})
                });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|_| "The native badge update was cancelled.".to_owned())?
        })
        .await
        .map_err(|error| error.to_string())?
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
