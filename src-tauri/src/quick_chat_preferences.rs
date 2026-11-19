use crate::{default_paths, lock, quick_chat, Shell, MAIN_WINDOW};
use autohand_squad_runtime::account_usage::parse_rfc3339_unix;
use autohand_squad_runtime::desktop_tray::menu::{window_label, EngineUsage, EngineWindow};
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
    pub quick_chat_appearance: String,
    /// A dot on the Squad menu-bar icon (and a VoiceOver announcement) while
    /// a question or approval waits. On by default (ADR-0249).
    pub menu_bar_attention_dot: bool,
    /// The main window's sidebar over native Liquid Glass where macOS has it
    /// (NSGlassEffectView, macOS 26+); Sidebar vibrancy otherwise. On by
    /// default (ADR-0258).
    pub sidebar_liquid_glass: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            quick_chat_enabled: true,
            quick_chat_menu_bar_mode: "single".into(),
            quick_chat_show_usage: true,
            quick_chat_appearance: "glass".into(),
            menu_bar_attention_dot: true,
            sidebar_liquid_glass: true,
        }
    }
}
pub(crate) fn read() -> Preferences {
    let Some(context) = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .ok()
        .flatten()
    else {
        return Preferences {
            quick_chat_enabled: false,
            quick_chat_show_usage: false,
            ..Preferences::default()
        };
    };
    if !context.can_write {
        return Preferences {
            quick_chat_enabled: false,
            quick_chat_show_usage: false,
            ..Preferences::default()
        };
    }
    std::fs::read(context.data_paths.root.join("settings.json"))
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
    /// Why there are no windows, when the bridge says.
    #[serde(default)]
    pub message: Option<String>,
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
/// A harness reading as menu headroom: percent *left*, absolute reset
/// instants, and the reason when the harness reported no windows.
pub(crate) fn engine_usage(harness: &HarnessUsage) -> EngineUsage {
    let name = match harness.id.as_str() {
        "claude" => "Claude Code".to_string(),
        "codex" => "Codex".to_string(),
        _ => clean_label(&harness.label),
    };
    let windows: Vec<EngineWindow> = harness
        .windows
        .iter()
        .take(8)
        .map(|window| EngineWindow {
            label: window_label(&clean_label(&window.label)),
            left: window
                .used_percent
                .filter(|value| value.is_finite() && (0.0..=100.0).contains(value))
                .map(|used| 100 - used.round() as u8),
            resets_at: window.resets_at.as_deref().and_then(parse_rfc3339_unix),
        })
        .collect();
    let error = windows.is_empty().then(|| {
        harness
            .message
            .as_deref()
            .map(clean_label)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| "usage is not reported".to_string())
    });
    EngineUsage {
        id: harness.id.clone(),
        heading: name.clone(),
        name,
        windows,
        error,
    }
}
pub(crate) fn fetch_usage(
    base: &str,
    context: &autohand_squad_runtime::ownership::OwnedContext,
) -> Vec<HarnessUsage> {
    if !context.can_write
        || !autohand_squad_runtime::ownership::still_current(&default_paths(), context)
    {
        return Vec::new();
    }
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
    let result = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .ok()
        .and_then(|client| {
            client
                .get(quick_chat::bridge_api_url(base, "/api/harnesses/usage?refresh=1").ok()?)
                .header("x-squad-context", &context.generation)
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
        .unwrap_or_default();
    if autohand_squad_runtime::ownership::still_current(&default_paths(), context) {
        result
    } else {
        Vec::new()
    }
}

fn available(member: &autohand_squad_runtime::desktop_tray::TrayMember) -> bool {
    let status = member.status.trim().to_ascii_lowercase();
    if matches!(
        status.as_str(),
        "offline"
            | "archived"
            | "disabled"
            | "paused"
            | "suspended"
            | "hold"
            | "break"
            | "on-break"
            | "unknown"
    ) {
        return false;
    }
    member.working
        || matches!(
            status.as_str(),
            "online" | "ready" | "idle" | "active" | "available" | "working" | "busy"
        )
}

pub(crate) fn visible_ids(model: &DesktopTrayModel, prefs: &Preferences) -> Vec<String> {
    if !prefs.quick_chat_enabled || prefs.quick_chat_menu_bar_mode != "active-agents" {
        return vec![];
    }
    model
        .members
        .iter()
        .filter(|member| available(member) && quick_chat::valid_member_id(&member.id))
        .map(|member| member.id.clone())
        .collect()
}

pub(crate) fn apply(
    app: &AppHandle,
    shell: &Arc<Shell>,
    model: &DesktopTrayModel,
    icons: &std::collections::HashMap<String, tauri::image::Image<'static>>,
    context: Option<&autohand_squad_runtime::ownership::OwnedContext>,
) {
    if !crate::native_scope_current(context) {
        return;
    }
    let prefs = read();
    if let Some(window) = app.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
        crate::quick_chat_appearance::apply(&window, shell, &prefs);
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        crate::main_window_material::apply(&window, shell, &prefs);
    }
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
        let wanted: HashSet<String> = visible_ids(model, &prefs).into_iter().collect();
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
        let missing: Vec<_> = visible_ids(model, &prefs)
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
                let context = context.cloned();
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
                        if !crate::native_scope_current(context.as_ref()) {
                            return;
                        }
                        if matches!(
                            event,
                            tauri::tray::TrayIconEvent::Click {
                                button: tauri::tray::MouseButton::Left,
                                button_state: tauri::tray::MouseButtonState::Up,
                                ..
                            }
                        ) {
                            toggle_member_quick_chat(tray.app_handle(), &events_shell, &member_id);
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

/// A click on a member's status item: open their Quick Chat under the icon,
/// or close it when it is already open for them.
#[cfg(target_os = "macos")]
fn toggle_member_quick_chat(app: &AppHandle, shell: &Arc<Shell>, member_id: &str) {
    if let Some(window) = app.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
        let same_member = window.url().ok().is_some_and(|url| {
            url.query_pairs()
                .any(|(key, value)| key == "member" && value == member_id)
        });
        if same_member && window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
    }
    *lock(&shell.popup_anchor) = Some(format!("member-tray:{member_id}"));
    if let Err(error) = quick_chat::open_quick_chat(app, shell, member_id) {
        eprintln!("quick chat: {error}");
    }
}

/// VoiceOver's press on a member's status item (ADR-0249): the same as a
/// click, for a member whose icon this account still shows.
#[cfg(target_os = "macos")]
pub(crate) fn open_member_quick_chat(app: &AppHandle, shell: &Arc<Shell>, member_id: &str) {
    let current = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .ok()
        .flatten();
    if !crate::native_scope_current(current.as_ref())
        || !read().quick_chat_enabled
        || !lock(&shell.member_trays).contains_key(member_id)
    {
        return;
    }
    toggle_member_quick_chat(app, shell, member_id);
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
    context_generation: String,
) -> Result<(), String> {
    let context = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .map_err(|error| error.to_string())?
        .ok_or("Select a verified Squad first.")?;
    if context.generation != context_generation {
        return Err("The selected Squad changed. Reopen Settings.".into());
    }
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
                Some(&context),
            )
        })
        .map_err(|error| error.to_string())?;
    } else {
        let handle = app.clone();
        let state = shell.inner().clone();
        app.run_on_main_thread(move || {
            if !crate::native_scope_current(Some(&context)) {
                return;
            }
            let prefs = read();
            if let Some(window) = handle.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
                crate::quick_chat_appearance::apply(&window, &state, &prefs);
            }
            if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                crate::main_window_material::apply(&window, &state, &prefs);
            }
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
    fn active_icons_include_available_idle_members() {
        let model = DesktopTrayModel {
            members: vec![TrayMember {
                id: "idle-eva".into(),
                name: "Eva".into(),
                label: "Eva · Online".into(),
                status: "online".into(),
                working: false,
                ..Default::default()
            }],
            ..Default::default()
        };
        let prefs = Preferences {
            quick_chat_menu_bar_mode: "active-agents".into(),
            ..Default::default()
        };
        assert_eq!(visible_ids(&model, &prefs), vec!["idle-eva"]);
    }
    #[test]
    fn unavailable_members_never_get_icons_even_with_a_running_session() {
        let statuses = [
            "online",
            "ready",
            "idle",
            "active",
            "available",
            "busy",
            "offline",
            "paused",
            "disabled",
            "archived",
            "hold",
            "suspended",
            "on-break",
            "unknown",
        ];
        let mut members: Vec<_> = statuses
            .iter()
            .enumerate()
            .map(|(i, status)| TrayMember {
                id: format!("member-{i}"),
                name: "Agent".into(),
                label: "Agent".into(),
                status: status.to_string(),
                working: i >= 5,
                ..Default::default()
            })
            .collect();
        members.push(TrayMember {
            id: "invalid/path".into(),
            name: "Agent".into(),
            label: "Agent".into(),
            status: "online".into(),
            working: true,
            ..Default::default()
        });
        let model = DesktopTrayModel {
            members,
            ..Default::default()
        };
        let prefs = Preferences {
            quick_chat_menu_bar_mode: "active-agents".into(),
            ..Default::default()
        };
        assert_eq!(
            visible_ids(&model, &prefs),
            (0..6).map(|i| format!("member-{i}")).collect::<Vec<_>>()
        );
    }

    #[test]
    fn active_icons_are_opt_in_and_follow_availability() {
        let model = DesktopTrayModel {
            members: (0..20)
                .map(|id| TrayMember {
                    id: format!("agent-{id}"),
                    name: "Agent".into(),
                    label: "Agent".into(),
                    status: "online".into(),
                    working: id != 0,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        assert!(visible_ids(&model, &Preferences::default()).is_empty());
        let prefs = Preferences {
            quick_chat_menu_bar_mode: "active-agents".into(),
            ..Default::default()
        };
        let ids = visible_ids(&model, &prefs);
        assert_eq!(ids.len(), 20);
        assert!(ids.contains(&"agent-0".into()));
        assert!(visible_ids(
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
    fn zero_usage_is_not_unknown_and_reads_as_all_left() {
        let item = HarnessUsage {
            id: "codex".into(),
            windows: vec![
                UsageWindow {
                    label: "Weekly".into(),
                    used_percent: Some(0.0),
                    resets_at: Some("2026-11-22T18:50:18.000Z".into()),
                },
                UsageWindow {
                    label: "Fable".into(),
                    used_percent: Some(88.4),
                    ..Default::default()
                },
                UsageWindow {
                    label: "Model".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let engine = engine_usage(&item);
        assert_eq!(engine.name, "Codex");
        assert_eq!(engine.windows[0].label, "This week");
        assert_eq!(engine.windows[0].left, Some(100));
        assert_eq!(
            engine.windows[0].resets_at,
            parse_rfc3339_unix("2026-11-22T18:50:18Z")
        );
        assert_eq!(engine.windows[1].left, Some(12));
        assert_eq!(engine.windows[2].left, None);
        assert!(engine.error.is_none());
        let silent = engine_usage(&HarnessUsage {
            id: "claude".into(),
            message: Some("Usage is unavailable.".into()),
            ..Default::default()
        });
        assert_eq!(silent.error.as_deref(), Some("Usage is unavailable."));
    }
}
