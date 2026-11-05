use crate::{default_paths, lock, quick_chat, Shell, MAIN_WINDOW};
use autohand_squad_runtime::account_usage::{now_unix, time_until, usage_gauge};
use autohand_squad_runtime::desktop_tray::DesktopTrayModel;
use serde::Deserialize;
#[cfg(target_os = "macos")]
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Preferences {
    pub quick_chat_enabled: bool,
    pub quick_chat_menu_bar_mode: String,
    pub quick_chat_show_usage: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            quick_chat_enabled: true,
            quick_chat_menu_bar_mode: "single".into(),
            quick_chat_show_usage: true,
        }
    }
}
pub(crate) fn read() -> Preferences {
    std::fs::read(default_paths().root.join("settings.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HarnessUsage {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub windows: Vec<UsageWindow>,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    pub label: String,
    pub used_percent: Option<f64>,
    pub resets_at: Option<String>,
}
fn clean_label(text: &str) -> String {
    text.chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect()
}
pub(crate) fn usage_lines(harness: &HarnessUsage) -> Vec<String> {
    if harness.windows.is_empty() {
        return vec!["Usage unavailable for this connection".into()];
    }
    harness
        .windows
        .iter()
        .take(8)
        .map(|window| {
            let percent = window
                .used_percent
                .filter(|value| value.is_finite() && (0.0..=100.0).contains(value));
            let mut line = match percent {
                Some(value) => format!(
                    "{}  {}  {}% used",
                    clean_label(&window.label),
                    usage_gauge(value.round() as u8, 8),
                    value
                ),
                None => format!("{} · Not reported", clean_label(&window.label)),
            };
            if let Some(reset) = window
                .resets_at
                .as_deref()
                .and_then(|at| time_until(at, now_unix()))
            {
                line.push_str(&format!(" · resets in {reset}"));
            }
            line
        })
        .collect()
}
pub(crate) fn fetch_usage(base: &str) -> Vec<HarnessUsage> {
    #[derive(Deserialize)]
    struct Response {
        success: bool,
        data: Data,
    }
    #[derive(Deserialize)]
    struct Data {
        #[serde(default)]
        harnesses: Vec<HarnessUsage>,
    }
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .ok()
        .and_then(|client| {
            client
                .get(format!(
                    "{}/api/harnesses/usage?refresh=1",
                    base.trim_end_matches('/')
                ))
                .send()
                .ok()
        })
        .and_then(|response| response.error_for_status().ok())
        .and_then(|response| response.json::<Response>().ok())
        .filter(|value| value.success)
        .map(|value| {
            value
                .data
                .harnesses
                .into_iter()
                .filter(|item| matches!(item.id.as_str(), "claude" | "codex"))
                .take(2)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn working_ids(model: &DesktopTrayModel, prefs: &Preferences) -> Vec<String> {
    if !prefs.quick_chat_enabled || prefs.quick_chat_menu_bar_mode != "active-agents" {
        return vec![];
    }
    model
        .members
        .iter()
        .filter(|member| member.working && quick_chat::valid_member_id(&member.id))
        .map(|member| member.id.clone())
        .collect()
}

pub(crate) fn apply(
    app: &AppHandle,
    shell: &Arc<Shell>,
    model: &DesktopTrayModel,
    icons: &std::collections::HashMap<String, tauri::image::Image<'static>>,
) {
    let prefs = read();
    let main = lock(&shell.tray).clone();
    if cfg!(target_os = "macos") {
        if let Some(tray) = main {
            let _ = tray.set_show_menu_on_left_click(!prefs.quick_chat_enabled);
        }
    }
    // Menu::get searches immediate children. Quick Chat belongs to Window.
    if let Some(menu) = app.menu() {
        for entry in menu.items().unwrap_or_default() {
            if let tauri::menu::MenuItemKind::Submenu(submenu) = entry {
                if let Some(tauri::menu::MenuItemKind::MenuItem(item)) =
                    submenu.get("menu:quick-chat")
                {
                    let _ = item.set_enabled(prefs.quick_chat_enabled);
                    break;
                }
            }
        }
    }
    if !prefs.quick_chat_enabled {
        if let Some(window) = app.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
            let _ = window.hide();
        }
    }
    #[cfg(target_os = "macos")]
    {
        let wanted: HashSet<String> = working_ids(model, &prefs).into_iter().collect();
        let stale: Vec<String> = lock(&shell.member_trays)
            .keys()
            .filter(|id| !wanted.contains(*id))
            .cloned()
            .collect();
        for member in stale {
            drop(app.remove_tray_by_id(&format!("member-tray:{member}")));
            lock(&shell.member_trays).remove(&member);
            lock(&shell.member_portraits).remove(&member);
        }
        let missing: Vec<_> = working_ids(model, &prefs)
            .into_iter()
            .filter(|id| !lock(&shell.member_trays).contains_key(id))
            .collect();
        if !missing.is_empty() {
            for id in missing {
                let member = model.members.iter().find(|member| member.id == id);
                let tooltip = member
                    .map(|member| member.label.clone())
                    .unwrap_or_else(|| id.clone());
                let member_id = id.clone();
                let events_shell = shell.clone();
                let tray = tauri::tray::TrayIconBuilder::with_id(format!("member-tray:{id}"))
                    .icon(
                        icons
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(quick_chat::placeholder_icon),
                    )
                    .icon_as_template(false)
                    .tooltip(tooltip)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(move |tray, event| {
                        if matches!(
                            event,
                            tauri::tray::TrayIconEvent::Click {
                                button: tauri::tray::MouseButton::Left,
                                button_state: tauri::tray::MouseButtonState::Up,
                                ..
                            }
                        ) {
                            if let Some(window) = tray
                                .app_handle()
                                .get_webview_window(quick_chat::QUICK_CHAT_WINDOW)
                            {
                                let same_member = window.url().ok().is_some_and(|url| {
                                    url.query_pairs()
                                        .any(|(key, value)| key == "member" && value == member_id)
                                });
                                if same_member && window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                    return;
                                }
                            }
                            *lock(&events_shell.popup_anchor) =
                                Some(format!("member-tray:{member_id}"));
                            if let Err(error) = quick_chat::open_quick_chat(
                                tray.app_handle(),
                                &events_shell,
                                &member_id,
                            ) {
                                eprintln!("quick chat: {error}");
                            }
                        }
                    })
                    .build(app);
                match tray {
                    Ok(tray) => {
                        lock(&shell.member_trays).insert(id, tray);
                    }
                    Err(error) => eprintln!("agent menu bar icon: {error}"),
                }
            }
        }
        let handles: Vec<_> = lock(&shell.member_trays)
            .iter()
            .map(|(id, tray)| (id.clone(), tray.clone()))
            .collect();
        for (id, tray) in handles {
            if let Some(icon) = icons.get(&id) {
                use std::hash::{Hash, Hasher};
                let mut hash = std::collections::hash_map::DefaultHasher::new();
                (icon.width(), icon.height(), icon.rgba()).hash(&mut hash);
                let stamp = hash.finish();
                let changed = lock(&shell.member_portraits).get(&id).copied() != Some(stamp);
                if changed && tray.set_icon(Some(icon.clone())).is_ok() {
                    lock(&shell.member_portraits).insert(id.clone(), stamp);
                }
            }

            if let Some(member) = model.members.iter().find(|member| member.id == id) {
                let _ = tray.set_tooltip(Some(member.label.clone()));
            }
        }
    }
}

pub(crate) fn authorized(
    label: &str,
    url: &tauri::Url,
    base: &tauri::Url,
    resetting: bool,
) -> bool {
    label == MAIN_WINDOW
        && !resetting
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin() == base.origin()
}
#[tauri::command]
pub(crate) async fn squad_refresh_quick_chat(
    app: AppHandle,
    window: WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
) -> Result<(), String> {
    let base = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    if !authorized(
        window.label(),
        &window.url().map_err(|error| error.to_string())?,
        &base.parse().map_err(|_| "Invalid bridge URL")?,
        lock(&shell.reset).blocks_quit(),
    ) {
        return Err("Quick Chat settings must be changed from Squad’s main window.".into());
    }
    // Apply disable immediately; slow provider requests run independently.
    let prefs = read();
    if !prefs.quick_chat_enabled || prefs.quick_chat_menu_bar_mode != "active-agents" {
        let handle = app.clone();
        let state = shell.inner().clone();
        app.run_on_main_thread(move || {
            apply(
                &handle,
                &state,
                &DesktopTrayModel::default(),
                &std::collections::HashMap::new(),
            )
        })
        .map_err(|error| error.to_string())?;
    }
    crate::refresh_tray(app, shell.inner().clone(), true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use autohand_squad_runtime::desktop_tray::TrayMember;
    #[test]
    fn active_icons_are_opt_in_and_only_working() {
        let model = DesktopTrayModel {
            members: (0..20)
                .map(|id| TrayMember {
                    id: format!("agent-{id}"),
                    name: "Agent".into(),
                    label: "Agent".into(),
                    working: id != 0,
                })
                .collect(),
            ..Default::default()
        };
        assert!(working_ids(&model, &Preferences::default()).is_empty());
        let prefs = Preferences {
            quick_chat_menu_bar_mode: "active-agents".into(),
            ..Default::default()
        };
        let ids = working_ids(&model, &prefs);
        assert_eq!(ids.len(), 19);
        assert!(!ids.contains(&"agent-0".into()));
        assert!(working_ids(
            &model,
            &Preferences {
                quick_chat_enabled: false,
                ..prefs
            }
        )
        .is_empty());
    }
    #[test]
    fn native_settings_require_the_real_main_window_and_same_origin() {
        let base: tauri::Url = "http://127.0.0.1:19821".parse().unwrap();
        assert!(authorized("main", &base, &base, false));
        assert!(!authorized("quick-chat", &base, &base, false));
        assert!(!authorized("main", &base, &base, true));
        assert!(!authorized(
            "main",
            &"https://example.com".parse().unwrap(),
            &base,
            false
        ));
    }
    #[test]
    fn zero_usage_is_not_unknown() {
        let item = HarnessUsage {
            windows: vec![
                UsageWindow {
                    label: "Weekly".into(),
                    used_percent: Some(0.0),
                    ..Default::default()
                },
                UsageWindow {
                    label: "Model".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let lines = usage_lines(&item);
        assert!(lines[0].contains("0% used"));
        assert!(lines[1].contains("Not reported"));
    }
}
