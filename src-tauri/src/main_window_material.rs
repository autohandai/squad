//! The main window's material behind the sidebar (ADR-0258).
//!
//! The main window is transparent with a full-size content view; the page
//! keeps the main column opaque and lets the material through the sidebar on
//! the default skin (styles.css, `data-shell="desktop"`). On a Mac that has
//! native Liquid Glass (`NSGlassEffectView`, macOS 26 and later, which
//! includes 27.2.1 "Golden Gate") and with Settings › Appearance ›
//! "Liquid Glass sidebar" on (the default), that material is Liquid Glass;
//! otherwise it is the Sidebar vibrancy every earlier build used. The page is
//! told which, so it can style for it and offer the setting only where it
//! means something.
use crate::{lock, quick_chat_appearance::Material, quick_chat_preferences::Preferences, Shell};
use std::sync::Arc;
use tauri::WebviewWindow;

fn script(material: Material, glass_available: bool) -> String {
    format!(
        "document.documentElement.dataset.windowMaterial = '{}'; document.documentElement.dataset.liquidGlassAvailable = '{}';",
        material.name(),
        glass_available
    )
}
fn publish(window: &WebviewWindow, material: Material, glass_available: bool) {
    let _ = window.eval(script(material, glass_available));
}

/// Every page load in the main window (the loading page, then the bridge)
/// starts without the attribute; tell it again (ADR-0258).
pub(crate) fn republish(webview: &WebviewWindow, shell: &Arc<Shell>) {
    #[cfg(target_os = "macos")]
    let glass_available = objc2::runtime::AnyClass::get(c"NSGlassEffectView").is_some();
    #[cfg(not(target_os = "macos"))]
    let glass_available = false;
    if let Some(material) = *lock(&shell.main_window_material) {
        let _ = webview.eval(script(material, glass_available));
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn apply(window: &WebviewWindow, shell: &Arc<Shell>, prefs: &Preferences) {
    use objc2::{rc::Retained, runtime::AnyClass};
    use objc2_app_kit::{NSGlassEffectView, NSView};
    use objc2_foundation::NSObjectProtocol;

    if objc2::MainThreadMarker::new().is_none() {
        eprintln!("main window material must be applied on the AppKit thread");
        return;
    }
    let glass_available = AnyClass::get(c"NSGlassEffectView").is_some();
    let desired = if glass_available && prefs.sidebar_liquid_glass {
        Material::LiquidGlass
    } else {
        Material::Vibrancy
    };
    if *lock(&shell.main_window_material) == Some(desired) {
        publish(window, desired, glass_available);
        return;
    }
    let target = window.clone();
    let state = shell.clone();
    if let Err(error) = window.with_webview(move |platform| {
        // SAFETY: PlatformWebview::inner is the live WKWebView (an NSView),
        // retained while the helper reparents it inside native glass.
        let Some(content) = (unsafe { Retained::retain(platform.inner().cast::<NSView>()) }) else {
            return;
        };
        let _ = window_vibrancy::clear_liquid_glass(&target);
        let _ = window_vibrancy::clear_vibrancy(&target);
        let actual = if desired == Material::LiquidGlass
            && window_vibrancy::apply_liquid_glass(
                &target,
                window_vibrancy::LiquidGlassOptions::default().content_view(&content),
            )
            .is_ok()
        {
            // As in Quick Chat: AppKit applies its legibility treatment only
            // to the glass view's contentView, so make the page that view.
            // SAFETY: inspected on AppKit's thread with no mutation between.
            if let (Some(parent), Some(class)) = (
                unsafe { content.superview() },
                AnyClass::get(c"NSGlassEffectView"),
            ) {
                if parent.isKindOfClass(class) {
                    // SAFETY: isKindOfClass verified the class.
                    let glass = unsafe { &*Retained::as_ptr(&parent).cast::<NSGlassEffectView>() };
                    glass.setContentView(Some(&content));
                }
            }
            Material::LiquidGlass
        } else {
            if let Err(error) = window_vibrancy::apply_vibrancy(
                &target,
                window_vibrancy::NSVisualEffectMaterial::Sidebar,
                Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
                None,
            ) {
                eprintln!("main window material: {error}");
                return;
            }
            Material::Vibrancy
        };
        *lock(&state.main_window_material) = Some(actual);
    }) {
        eprintln!("main window material: {error}");
        return;
    }
    let actual = (*lock(&shell.main_window_material)).unwrap_or(Material::Vibrancy);
    publish(window, actual, glass_available);
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn apply(_window: &WebviewWindow, _shell: &Arc<Shell>, _prefs: &Preferences) {}
