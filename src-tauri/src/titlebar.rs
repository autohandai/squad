//! macOS titlebar double-click follows the person's native window preference.
use crate::{computer_use_grant, Shell};
use std::sync::Arc;
use tauri::{AppHandle, WebviewWindow};

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq)]
enum Action {
    Fill,
    Zoom,
    Minimize,
    None,
}

#[cfg(any(target_os = "macos", test))]
fn action(preference: Option<&str>, legacy_minimize: bool) -> Action {
    match preference.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => match value.to_ascii_lowercase().as_str() {
            "fill" => Action::Fill,
            "maximize" | "zoom" => Action::Zoom,
            "minimize" => Action::Minimize,
            // An unknown future choice must not silently maximize a window.
            _ => Action::None,
        },
        None if legacy_minimize => Action::Minimize,
        None => Action::Zoom,
    }
}

#[tauri::command]
pub(crate) async fn squad_titlebar_double_click(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
) -> Result<(), String> {
    computer_use_grant::request_bridge(&window, &shell, None)
        .map_err(|_| "Change the window from Squad's main local window.".to_owned())?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = sender.send(macos::apply(&window));
        })
        .map_err(|_| "The native window action could not be scheduled.".to_owned())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|_| "The native window is no longer available.".to_owned())?
        })
        .await
        .map_err(|_| "The native window action did not finish.".to_owned())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("This window preference is available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{action, Action};
    use objc2::{rc::Retained, MainThreadMarker};
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSRect, NSString, NSUserDefaults};
    use std::cell::RefCell;
    use tauri::WebviewWindow;

    struct FillSnapshot {
        before: NSRect,
        filled: NSRect,
    }
    thread_local! {
        // One main window, accessed only on AppKit's main thread. A resize or
        // move invalidates this restore point rather than restoring stale bounds.
        static FILL: RefCell<Option<FillSnapshot>> = const { RefCell::new(None) };
    }
    fn same_frame(left: NSRect, right: NSRect) -> bool {
        (left.origin.x - right.origin.x).abs() < 1.0
            && (left.origin.y - right.origin.y).abs() < 1.0
            && (left.size.width - right.size.width).abs() < 1.0
            && (left.size.height - right.size.height).abs() < 1.0
    }
    pub(super) fn apply(window: &WebviewWindow) -> Result<(), String> {
        MainThreadMarker::new().ok_or("Window actions require AppKit's main thread.")?;
        let pointer = window
            .ns_window()
            .map_err(|_| "The native window is no longer available.")?;
        // SAFETY: Tauri returned this live NSWindow. Retain it for this main-
        // thread operation; no AppKit pointer crosses an asynchronous boundary.
        let native = unsafe { Retained::retain(pointer.cast::<NSWindow>()) }
            .ok_or("The native window is no longer available.")?;
        let defaults = NSUserDefaults::standardUserDefaults();
        let preference = defaults.stringForKey(&NSString::from_str("AppleActionOnDoubleClick"));
        let legacy = defaults.boolForKey(&NSString::from_str("AppleMiniaturizeOnDoubleClick"));
        match action(
            preference
                .as_ref()
                .map(|value| value.to_string())
                .as_deref(),
            legacy,
        ) {
            Action::None => {}
            Action::Minimize => native.performMiniaturize(None),
            Action::Zoom => {
                FILL.with(|saved| *saved.borrow_mut() = None);
                native.performZoom(None);
            }
            Action::Fill => {
                let screen = native.screen().ok_or("The window has no current screen.")?;
                let frame = native.frame();
                let visible = screen.visibleFrame();
                let target = FILL.with(|saved| {
                    let mut saved = saved.borrow_mut();
                    if let Some(previous) = saved.take().filter(|previous| {
                        same_frame(frame, previous.filled) && same_frame(visible, previous.filled)
                    }) {
                        previous.before
                    } else {
                        *saved = Some(FillSnapshot {
                            before: frame,
                            filled: visible,
                        });
                        visible
                    }
                });
                // AppKit can synchronously deliver resize callbacks; release
                // the restore-state borrow before entering it.
                native.setFrame_display(target, true);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_preference_overrides_the_legacy_flag() {
        for (value, expected) in [
            ("Fill", Action::Fill),
            ("Maximize", Action::Zoom),
            ("Zoom", Action::Zoom),
            ("Minimize", Action::Minimize),
            ("None", Action::None),
            ("No Action", Action::None),
        ] {
            assert_eq!(action(Some(value), true), expected);
        }
    }
    #[test]
    fn absent_preference_preserves_legacy_minimize_and_default_zoom() {
        assert_eq!(action(None, true), Action::Minimize);
        assert_eq!(action(None, false), Action::Zoom);
        assert_eq!(action(Some(" "), true), Action::Minimize);
        assert_eq!(action(Some("unknown future action"), false), Action::None);
    }
}
