use crate::{lock, Shell};
use std::sync::Arc;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub(crate) const QUICK_CHAT_WINDOW: &str = "quick-chat";
const POPUP_WIDTH: f64 = 380.0;
const POPUP_HEIGHT: f64 = 520.0;

/// Physical coordinates throughout: the tray and monitor APIs return pixels,
/// and only the popup's point size and inset need the monitor's scale factor.
fn popup_position(
    work_area: (f64, f64, f64, f64),
    anchor: Option<(f64, f64, f64, f64)>,
    scale: f64,
) -> (f64, f64) {
    let (left, top, width, height) = work_area;
    let inset = 8.0 * scale;
    let popup_width = POPUP_WIDTH * scale;
    let popup_height = POPUP_HEIGHT * scale;
    let (x, y) = match anchor {
        Some((x, y, width, height)) => (x + width / 2.0 - popup_width / 2.0, y + height + inset),
        None => (left + width - popup_width - inset, top + inset),
    };
    (
        x.clamp(
            left + inset,
            (left + width - popup_width - inset).max(left + inset),
        ),
        y.clamp(
            top + inset,
            (top + height - popup_height - inset).max(top + inset),
        ),
    )
}

#[cfg(target_os = "macos")]
fn show_popup(app: &AppHandle, shell: &Shell, window: &tauri::WebviewWindow) -> Result<(), String> {
    // Clone before querying the OS; never hold our tray mutex while waiting on
    // a main-loop operation. Its current rectangle follows moved menu bars.
    let tray = lock(&shell.tray).clone();
    let rect = tray.and_then(|tray| tray.rect().ok().flatten());
    let anchor = rect.map(|rect| {
        let position = rect.position.to_physical::<f64>(1.0);
        let size = rect.size.to_physical::<f64>(1.0);
        (position.x, position.y, size.width, size.height)
    });
    let monitor = anchor
        .and_then(|(x, y, width, height)| {
            app.monitor_from_point(x + width / 2.0, y + height / 2.0)
                .ok()
                .flatten()
        })
        .or_else(|| {
            app.get_webview_window(crate::MAIN_WINDOW)
                .and_then(|main| main.current_monitor().ok().flatten())
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let (x, y) = popup_position(
            (
                area.position.x as f64,
                area.position.y as f64,
                area.size.width as f64,
                area.size.height as f64,
            ),
            anchor,
            monitor.scale_factor(),
        );
        window
            .set_position(tauri::PhysicalPosition::new(
                x.round() as i32,
                y.round() as i32,
            ))
            .map_err(|error| error.to_string())?;
    }
    reveal_popup(window)
}

// The popover stays mounted while hidden, and an always-on-top panel does not
// reliably deliver focus or visibility events to its page. Ask it to re-read
// the shared skin and theme every time it is shown.
fn reveal_popup(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    let _ = window.eval("window.dispatchEvent(new Event('squad:popup-shown'))");
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn show_popup(
    _app: &AppHandle,
    _shell: &Shell,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    reveal_popup(window)
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != QUICK_CHAT_WINDOW {
        return;
    }
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        tauri::WindowEvent::Focused(false) => {
            // Selecting another member from the tray briefly moves focus to
            // the menu. Give that action time to restore focus before hiding.
            let window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                if window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(false) {
                    let _ = window.hide();
                }
            });
        }
        _ => {}
    }
}

/// Prefer a teammate accepting work. A squad entirely on break still lets a
/// person explicitly choose a conversation to resume that member.
fn first_chat_member<'a>(
    members: &'a [serde_json::Value],
    breaks: &serde_json::Value,
) -> Option<&'a str> {
    let valid = |member: &&serde_json::Value| {
        member
            .get("id")
            .and_then(|id| id.as_str())
            .is_some_and(valid_member_id)
            && !matches!(
                member.get("status").and_then(|status| status.as_str()),
                Some("archived" | "disabled")
            )
    };
    let available = |member: &&serde_json::Value| {
        let id = member.get("id").and_then(|id| id.as_str()).unwrap_or("");
        let paused = match breaks
            .get(id)
            .and_then(|record| record.get("onBreak"))
            .and_then(|value| value.as_bool())
        {
            Some(on_break) => on_break,
            None => matches!(
                member.get("status").and_then(|status| status.as_str()),
                Some("paused" | "break" | "on-break")
            ),
        };
        valid(member) && !paused
    };
    members
        .iter()
        .find(available)
        .or_else(|| members.iter().find(valid))?
        .get("id")?
        .as_str()
}

#[cfg(target_os = "macos")]
pub(crate) fn open_quick_chat_picker(app: &AppHandle, shell: Arc<Shell>) {
    if let Some(window) = app.get_webview_window(QUICK_CHAT_WINDOW) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else if let Err(error) = show_popup(app, &shell, &window) {
            eprintln!("quick chat failed: {error}");
        }
        return;
    }
    let app = app.clone();
    // Reading the roster must not block the native menu while the bridge is
    // unavailable. Queue webview creation back onto the native main loop.
    std::thread::spawn(move || {
        use std::io::Read;
        let Some(bridge) = lock(&shell.app_url).clone() else {
            return;
        };
        let Ok(client) = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
        else {
            return;
        };
        let read = |path: &str| -> Option<serde_json::Value> {
            let response = client
                .get(format!("{}{path}", bridge.trim_end_matches('/')))
                .send()
                .ok()?;
            let mut bytes = Vec::new();
            response
                .take(2 * 1024 * 1024)
                .read_to_end(&mut bytes)
                .ok()?;
            serde_json::from_slice::<serde_json::Value>(&bytes).ok()
        };
        let Some(snapshot) = read("/api/status/snapshot") else {
            return;
        };
        let Some(members) = snapshot
            .pointer("/data/members")
            .and_then(|members| members.as_array())
        else {
            return;
        };
        let breaks = read("/api/members/breaks")
            .and_then(|payload| payload.get("data").cloned())
            .unwrap_or_default();
        let Some(member) = first_chat_member(members, &breaks).map(str::to_owned) else {
            return;
        };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = open_quick_chat(&handle, &shell, &member) {
                eprintln!("quick chat failed: {error}");
            }
        });
    });
}

/// IDs are opaque local roster identifiers, never routes, scripts or filenames.
pub(crate) fn valid_member_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

pub(crate) fn quick_chat_url(bridge: &str, member: &str) -> Result<Url, String> {
    if !valid_member_id(member) {
        return Err("Invalid Squad member.".into());
    }
    let mut url = Url::parse(bridge).map_err(|error| error.to_string())?;
    url.set_path("/quick-chat");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("member", member);
    Ok(url)
}

fn main_route(url: &Url) -> Option<String> {
    if url.fragment().is_some() || url.as_str().len() > 1024 {
        return None;
    }
    let path = url.path();
    let profile = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
    let allowed = matches!(
        path,
        "/" | "/squad" | "/work" | "/inbox" | "/mission-control" | "/settings" | "/channels"
    ) || (path == "/conversations/new"
        && url
            .query_pairs()
            .any(|(key, value)| key == "member" && valid_member_id(&value)))
        || path.strip_prefix("/channels/").is_some_and(valid_member_id)
        || (profile.len() == 3
            && profile[0] == "squad-members"
            && valid_member_id(profile[1])
            && matches!(
                profile[2],
                "home"
                    | "projects"
                    | "automations"
                    | "tasks"
                    | "memory"
                    | "history"
                    | "model"
                    | "harness"
                    | "skill"
                    | "connector"
                    | "im"
                    | "permission"
            ));
    allowed.then(|| match url.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.into(),
    })
}

pub(crate) fn open_quick_chat(
    app: &AppHandle,
    shell: &Arc<Shell>,
    member: &str,
) -> Result<(), String> {
    let bridge = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    let target = quick_chat_url(&bridge, member)?;
    if let Some(window) = app.get_webview_window(QUICK_CHAT_WINDOW) {
        // Navigate only when selecting another member. Reselecting the current
        // member preserves drafts and the live stream in this compact window.
        if window.url().ok().as_ref() != Some(&target) {
            let path = format!("{}?{}", target.path(), target.query().unwrap_or(""));
            let script = format!(
                "history.pushState({{}}, '', {}); window.dispatchEvent(new PopStateEvent('popstate'));",
                serde_json::to_string(&path).map_err(|error| error.to_string())?
            );
            window.eval(script).map_err(|error| error.to_string())?;
        }
        return show_popup(app, shell, &window);
    }
    let origin = target.origin();
    let navigation_app = app.clone();
    let navigation_shell = shell.clone();
    let window = WebviewWindowBuilder::new(app, QUICK_CHAT_WINDOW, WebviewUrl::External(target))
        .title("Quick chat — Autohand Squad")
        .disable_drag_drop_handler()
        .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .user_agent(&format!(
            "AutohandSquadQuickChat/{} (macos)",
            env!("CARGO_PKG_VERSION")
        ))
        .on_navigation(move |url| {
            if !url.username().is_empty() || url.password().is_some() {
                return false;
            }
            if origin != url.origin() {
                if matches!(url.scheme(), "https" | "http") {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                }
                return false;
            }
            if url.path() == "/quick-chat" {
                return true;
            }
            if url.path() == "/quick-chat-dismiss" && url.query().is_none() {
                if let Some(window) = navigation_app.get_webview_window(QUICK_CHAT_WINDOW) {
                    let _ = window.hide();
                }
                return false;
            }
            if let Some(route) = main_route(url) {
                let app = navigation_app.clone();
                let shell = navigation_shell.clone();
                let _ = navigation_app
                    .run_on_main_thread(move || crate::navigate_app(&app, &shell, &route));
            }
            false
        })
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "https" | "http")
                && url.username().is_empty()
                && url.password().is_none()
            {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| error.to_string())?;
    show_popup(app, shell, &window)
}

/// Local generic-person silhouette, including the same round background as a
/// portrait. Missing, unreadable, or unsafe avatars never become blank rows.
pub(crate) fn placeholder_icon() -> tauri::image::Image<'static> {
    let mut rgba = Vec::with_capacity(22 * 22 * 4);
    for y in 0..22 {
        for x in 0..22 {
            let x = x as f64 + 0.5;
            let y = y as f64 + 0.5;
            let circle = (x - 11.0).powi(2) + (y - 11.0).powi(2) <= 121.0;
            let head = (x - 11.0).powi(2) + (y - 7.5).powi(2) <= 10.0;
            let shoulders =
                ((x - 11.0) / 7.0).powi(2) + ((y - 19.0) / 7.0).powi(2) <= 1.0 && y >= 13.0;
            rgba.extend_from_slice(if !circle {
                &[0, 0, 0, 0]
            } else if head || shoulders {
                &[235, 235, 235, 255]
            } else {
                &[105, 105, 105, 255]
            });
        }
    }
    tauri::image::Image::new_owned(rgba, 22, 22)
}

#[cfg(target_os = "macos")]
pub(crate) fn member_icons(
    app: &AppHandle,
    shell: &Shell,
) -> std::collections::HashMap<String, tauri::image::Image<'static>> {
    use base64::Engine;
    use std::io::{Cursor, Read};
    let mut icons = std::collections::HashMap::new();
    let Some(bridge) = lock(&shell.app_url).clone() else {
        return icons;
    };
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    else {
        return icons;
    };
    let Ok(response) = client
        .get(format!(
            "{}/api/status/snapshot",
            bridge.trim_end_matches('/')
        ))
        .send()
    else {
        return icons;
    };
    let mut bytes = Vec::new();
    if response
        .take(8 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return icons;
    }
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return icons;
    };
    let Some(members) = payload
        .get("data")
        .and_then(|value| value.get("members"))
        .and_then(|value| value.as_array())
    else {
        return icons;
    };
    let Ok(resources) = app.path().resource_dir() else {
        return icons;
    };
    let avatar_root = resources.join("runtime/dist/avatars");
    for member in members.iter().take(100) {
        let (Some(id), Some(avatar)) = (
            member.get("id").and_then(|value| value.as_str()),
            member.get("avatar").and_then(|value| value.as_str()),
        ) else {
            continue;
        };
        if !valid_member_id(id) {
            continue;
        }
        let data = if let Some(relative) = avatar.strip_prefix("/avatars/") {
            let path = std::path::Path::new(relative);
            if path
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                continue;
            }
            let Ok(data) = std::fs::read(avatar_root.join(path)) else {
                continue;
            };
            data
        } else if let Some((kind, encoded)) = avatar.split_once(",") {
            if !matches!(
                kind,
                "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
            ) || encoded.len() > 3 * 1024 * 1024
            {
                continue;
            }
            let Ok(data) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
                continue;
            };
            data
        } else {
            continue;
        };
        if data.len() > 2 * 1024 * 1024 {
            continue;
        }
        let Ok(mut decoder) = image::ImageReader::new(Cursor::new(data)).with_guessed_format()
        else {
            continue;
        };
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(2048);
        limits.max_image_height = Some(2048);
        limits.max_alloc = Some(32 * 1024 * 1024);
        decoder.limits(limits);
        let Ok(image) = decoder.decode() else {
            continue;
        };
        let mut rgba = image
            .resize_exact(22, 22, image::imageops::FilterType::Triangle)
            .to_rgba8();
        // A small round avatar, retaining the same member portrait as the app.
        for (x, y, pixel) in rgba.enumerate_pixels_mut() {
            if ((x as f32 + 0.5) - 11.0).powi(2) + ((y as f32 + 0.5) - 11.0).powi(2) > 121.0 {
                pixel[3] = 0;
            }
        }
        icons.insert(
            id.to_owned(),
            tauri::image::Image::new_owned(rgba.into_raw(), 22, 22),
        );
    }
    icons
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_tracks_tray_on_retina_and_negative_origin_displays() {
        assert_eq!(
            popup_position(
                (0.0, 48.0, 2880.0, 1752.0),
                Some((2500.0, 0.0, 44.0, 48.0)),
                2.0
            ),
            (2104.0, 64.0)
        );
        assert_eq!(
            popup_position(
                (-1920.0, 24.0, 1920.0, 1056.0),
                Some((-1900.0, 0.0, 22.0, 24.0)),
                1.0
            ),
            (-1912.0, 32.0)
        );
        assert_eq!(
            popup_position((0.0, 24.0, 1440.0, 876.0), None, 1.0),
            (1052.0, 32.0)
        );
    }

    #[test]
    fn missing_portrait_has_a_visible_person_and_transparent_corners() {
        let icon = placeholder_icon();
        assert_eq!((icon.width(), icon.height()), (22, 22));
        let rgba = icon.rgba();
        let pixel = |x: usize, y: usize| &rgba[(y * 22 + x) * 4..(y * 22 + x + 1) * 4];
        assert_eq!(pixel(0, 0), &[0, 0, 0, 0]);
        assert_eq!(pixel(11, 7), &[235, 235, 235, 255]);
        assert_eq!(pixel(11, 17), &[235, 235, 235, 255]);
        assert_eq!(pixel(4, 7), &[105, 105, 105, 255]);
    }

    #[test]
    fn keyboard_entry_skips_breaks_invalid_ids_and_archived_members() {
        let members = serde_json::json!([
            {"id":"../unsafe","status":"online"},
            {"id":"archived","status":"archived"},
            {"id":"eva","status":"paused"},
            {"id":"noah","status":"online"},
            {"id":"iris","status":"online"}
        ]);
        assert_eq!(
            first_chat_member(members.as_array().unwrap(), &serde_json::json!({})),
            Some("noah")
        );
        assert_eq!(
            first_chat_member(
                members.as_array().unwrap(),
                &serde_json::json!({"noah":{"onBreak":true}})
            ),
            Some("iris")
        );
        assert_eq!(
            first_chat_member(
                members.as_array().unwrap(),
                &serde_json::json!({"eva":{"onBreak":false}})
            ),
            Some("eva")
        );
        assert_eq!(first_chat_member(&[], &serde_json::json!({})), None);
    }
    #[test]
    fn quick_chat_targets_are_fixed_and_member_ids_cannot_change_routes() {
        let url = quick_chat_url("http://127.0.0.1:19821/squad#old", "asq-noah_1").unwrap();
        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:19821/quick-chat?member=asq-noah_1"
        );
        for member in ["", "../x", "x&member=other", "x/route", "a<script>", "x\n"] {
            assert!(quick_chat_url("http://127.0.0.1:19821", member).is_err());
        }
    }

    #[test]
    fn compact_chat_links_route_only_known_main_surfaces() {
        for route in [
            "/squad-members/noah/home",
            "/work?view=needs-you",
            "/conversations/new?member=noah",
            "/settings",
            "/channels/general",
        ] {
            assert_eq!(
                main_route(&Url::parse(&format!("http://127.0.0.1:19821{route}")).unwrap()),
                Some(route.into())
            );
        }
        for route in [
            "/api/shell",
            "/squad-members/noah/run-command",
            "/squad-members/../home",
            "/work#script",
        ] {
            assert!(
                main_route(&Url::parse(&format!("http://127.0.0.1:19821{route}")).unwrap())
                    .is_none()
            );
        }
    }
}
