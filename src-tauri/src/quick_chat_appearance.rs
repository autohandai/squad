use crate::{lock, quick_chat_preferences::Preferences, Shell};
use std::sync::Arc;
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Material {
    LiquidGlass,
    Vibrancy,
    Solid,
}

impl Material {
    fn name(self) -> &'static str {
        match self {
            Self::LiquidGlass => "liquid-glass",
            Self::Vibrancy => "vibrancy",
            Self::Solid => "solid",
        }
    }
}

fn publish(window: &WebviewWindow, material: Material) {
    let _ = window.eval(format!(
        "document.documentElement.dataset.quickChatMaterial = '{}';",
        material.name()
    ));
}

#[cfg(target_os = "macos")]
pub(crate) fn apply(window: &WebviewWindow, shell: &Arc<Shell>, prefs: &Preferences) {
    use objc2::{rc::Retained, runtime::AnyClass};
    use objc2_app_kit::{NSGlassEffectView, NSView};
    use objc2_foundation::NSObjectProtocol;

    // All callers dispatch here through the AppKit loop. Enforce that contract
    // so with_webview completes inline before publishing through Webview::eval.
    if objc2::MainThreadMarker::new().is_none() {
        eprintln!("quick chat material must be applied on the AppKit thread");
        return;
    }

    // Class lookup is safe on pre-26 macOS; don't construct the newer class there.
    let glass_available = AnyClass::get(c"NSGlassEffectView").is_some();
    let desired = if prefs.quick_chat_appearance == "solid" {
        Material::Solid
    } else if glass_available {
        Material::LiquidGlass
    } else {
        Material::Vibrancy
    };
    if *lock(&shell.quick_chat_material) == Some(desired) {
        publish(window, desired);
        return;
    }
    let target = window.clone();
    let state = shell.clone();
    // Tauri runs this callback on the AppKit thread. The WKWebView stays the
    // same object, preserving drafts, history, focus handlers and live streams.
    if let Err(error) = window.with_webview(move |platform| {
        // SAFETY: PlatformWebview::inner is the live WKWebView (an NSView).
        // Retain it while the material helper reparents it inside native glass.
        let Some(content) = (unsafe { Retained::retain(platform.inner().cast::<NSView>()) }) else {
            return;
        };
        let _ = window_vibrancy::clear_liquid_glass(&target);
        let _ = window_vibrancy::clear_vibrancy(&target);
        let actual = if desired == Material::Solid {
            Material::Solid
        } else if desired == Material::LiquidGlass
            && window_vibrancy::apply_liquid_glass(
                &target,
                window_vibrancy::LiquidGlassOptions::default()
                    .radius(12.0)
                    .content_view(&content),
            )
            .is_ok()
        {
            // The helper preserves the Tao container and owns restoration.
            // AppKit requires contentView, not an arbitrary glass subview, to
            // guarantee that its legibility/adaptation treatment is applied.
            // SAFETY: The retained content and its parent are inspected on
            // AppKit's thread, with no intervening hierarchy mutation.
            if let (Some(parent), Some(class)) = (
                unsafe { content.superview() },
                AnyClass::get(c"NSGlassEffectView"),
            ) {
                if parent.isKindOfClass(class) {
                    // SAFETY: isKindOfClass verified the exact superclass.
                    let glass = unsafe { &*Retained::as_ptr(&parent).cast::<NSGlassEffectView>() };
                    glass.setContentView(Some(&content));
                }
            }
            Material::LiquidGlass
        } else {
            if let Err(error) = window_vibrancy::apply_vibrancy(
                &target,
                window_vibrancy::NSVisualEffectMaterial::Popover,
                Some(window_vibrancy::NSVisualEffectState::Active),
                Some(12.0),
            ) {
                eprintln!("quick chat material: {error}");
                return;
            }
            Material::Vibrancy
        };
        *lock(&state.quick_chat_material) = Some(actual);
    }) {
        eprintln!("quick chat material: {error}");
        return;
    }
    // with_webview holds Wry's webview-ID mutex until its callback returns.
    // eval takes that same mutex; re-entering it inside the callback deadlocks.
    let actual = *lock(&shell.quick_chat_material);
    if let Some(actual) = actual {
        publish(window, actual);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn apply(window: &WebviewWindow, shell: &Arc<Shell>, _prefs: &Preferences) {
    *lock(&shell.quick_chat_material) = Some(Material::Solid);
    publish(window, Material::Solid);
}
