// Autohand Squad desktop shell (Tauri 2).
//
// The window is a system webview pointed at the local bridge, so the web app,
// the bridge, warm sessions, harnesses, and sign-in flows are exactly the ones
// used in the browser. This binary owns what a browser tab cannot: a native
// window, single-instance relaunch, the tray, and the boot sequence
// (preflight, daemon, bridge, health handshake, native recovery dialog),
// all reused from the runtime crate.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use autohand_squad_runtime::account_usage::AccountUsage;
use autohand_squad_runtime::cli::DESKTOP_SHELL_ENV;
use autohand_squad_runtime::config::{resolve_config, PartialSquadConfig};
use autohand_squad_runtime::desktop_tray::{
    load_desktop_tray_model, refresh_account_usage, DesktopTrayModel,
};
use autohand_squad_runtime::gui_bootstrap::{run_desktop_bootstrap_with, BootstrapOutcome};
use autohand_squad_runtime::ui::{
    default_paths, feedback_route_for_paths, run_tray_action, TrayAction,
};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
mod info_windows;
use info_windows::{info_navigation_handler, open_info_window, InfoPage};
mod computer_use_grant;
mod computer_use_setup;
mod dock_badge;
mod native_notifications;
mod quick_chat;
mod update_swap;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tokio::runtime::Runtime;

const MAIN_WINDOW: &str = "main";
/// Squad status (members, daemon) is re-read on this cadence; account usage
/// every `USAGE_REFRESH_TICKS` of them, or on demand from the tray.
const TRAY_REFRESH: Duration = Duration::from_secs(60);
const USAGE_REFRESH_TICKS: u32 = 5;

#[derive(Default)]
struct UsageCache {
    snapshot: Option<AccountUsage>,
    error: Option<String>,
}

struct Shell {
    /// URL of the local bridge once the bootstrap succeeded.
    app_url: Mutex<Option<String>>,
    runtime: Runtime,
    tray: Mutex<Option<TrayIcon<Wry>>>,
    usage: Mutex<UsageCache>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn main() {
    if update_swap::run_from_args() {
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            computer_use_setup::squad_setup_computer_use,
            computer_use_grant::squad_confirm_computer_use,
            computer_use_grant::squad_revoke_computer_use,
            dock_badge::squad_set_attention_badge,
            native_notifications::squad_notification_permission,
            native_notifications::squad_notification_test,
            native_notifications::squad_notification_settings,
            squad_quit_for_update
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            computer_use_grant::prepare_bridge_secret()?;
            point_runtime_at_bundle(app.handle());
            let shell = Arc::new(Shell {
                app_url: Mutex::new(None),
                runtime: Runtime::new()?,
                tray: Mutex::new(None),
                usage: Mutex::new(UsageCache::default()),
            });
            app.manage(shell.clone());
            #[cfg(target_os = "macos")]
            native_notifications::install(app.handle(), shell.clone());

            // The web app detects this user agent and switches to the desktop
            // treatment: transparent chrome behind the sidebar, drag regions,
            // and a top inset for the traffic lights on macOS.
            let user_agent = format!(
                "AutohandSquadDesktop/{} ({}; {})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Autohand Squad")
                    // Composers upload browser File objects. Tauri's native
                    // handler consumes OS file drops before HTML5 receives them.
                    .disable_drag_drop_handler()
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(960.0, 640.0)
                    .user_agent(&user_agent)
                    .on_navigation(info_navigation_handler(app.handle(), shell.clone(), false))
                    .center();
            #[cfg(target_os = "macos")]
            {
                // Overlay = full-size content view: the page extends under the
                // title bar, so the vibrancy layer (not the window behind the
                // app) shows through the transparent sidebar strip.
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .transparent(true);
            }
            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };
                let _ = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    None,
                );
            }
            #[cfg(target_os = "windows")]
            {
                let _ = window_vibrancy::apply_mica(&window, None);
            }

            build_tray(app.handle(), shell.clone())?;
            app.set_menu(build_app_menu(app.handle())?)?;

            // Boot on a worker thread: the window shows the loading page while
            // preflight, daemon, and bridge come up; on success the window
            // navigates to the bridge, on Quit from the failure dialog the app
            // exits. Nothing is opened in an external browser.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let paths = default_paths();
                let overrides = PartialSquadConfig::default();
                match run_desktop_bootstrap_with(&shell.runtime, &paths, &overrides, false) {
                    Ok(BootstrapOutcome::Ready { url }) => {
                        computer_use_grant::clear_bridge_secret_env();
                        *lock(&shell.app_url) = Some(url.clone());
                        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                            if let Ok(target) = url.parse() {
                                let _ = window.navigate(target);
                            }
                            // Bootstrap fills the existing main window. It
                            // must not reopen a window the person already hid
                            // or steal focus from their menu-bar conversation.
                            let quick_visible = handle
                                .get_webview_window(quick_chat::QUICK_CHAT_WINDOW)
                                .is_some_and(|quick| quick.is_visible().unwrap_or(false));
                            if window.is_visible().unwrap_or(false) && !quick_visible {
                                let _ = window.set_focus();
                            }
                        }
                        start_tray_refresh(handle, shell);
                    }
                    Ok(BootstrapOutcome::Quit) => handle.exit(0),
                    Err(error) => {
                        eprintln!("bootstrap failed: {error:#}");
                        handle.exit(1);
                    }
                }
            });

            let _ = window;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(action) = id.strip_prefix("menu:") {
                dispatch_menu_action(app, action);
            }
        })
        .on_window_event(|window, event| {
            quick_chat::handle_window_event(window, event);
            // Closing the window keeps the squad running in the tray, like a
            // chat app; Quit in the tray stops the services.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW {
                    api.prevent_close();
                    // Closing keeps the bridge alive, but a pending sign-in
                    // must not trap the person when this window is reopened.
                    if let Some(webview) = window.app_handle().get_webview_window(MAIN_WINDOW) {
                        if let Err(error) =
                            webview.eval("window.dispatchEvent(new Event('squad:sign-in-reset'))")
                        {
                            eprintln!("sign-in reset failed: {error}");
                        }
                    }
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Autohand Squad");
}

/// The bundle carries the bridge under Resources/runtime and the Node runtime,
/// daemon, analytics, and `squad` next to this executable (Tauri sidecars).
/// The runtime crate already honours these variables, so pointing them at the
/// bundle keeps a source checkout and the installed app on one code path.
fn point_runtime_at_bundle(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    std::env::set_var("AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS", "macos");
    if let Ok(resource_dir) = app.path().resource_dir() {
        let server = resource_dir.join("runtime").join("server.mjs");
        if server.exists() && std::env::var_os("AUTOHAND_SQUAD_WEB_SERVER").is_none() {
            std::env::set_var("AUTOHAND_SQUAD_WEB_SERVER", &server);
        }
    }
    // This process is the desktop controller: the runtime skips the legacy
    // tray binary and records this pid as the running controller.
    if let Ok(exe) = std::env::current_exe() {
        // This running shell is authoritative even if the launch environment
        // inherited an obsolete development shell path.
        std::env::set_var(DESKTOP_SHELL_ENV, &exe);
        #[cfg(target_os = "macos")]
        if let Some(bundle) = exe.parent().and_then(Path::parent).and_then(Path::parent) {
            std::env::set_var("AUTOHAND_SQUAD_DESKTOP_APP", bundle);
            std::env::set_var("AUTOHAND_SQUAD_DESKTOP_PID", std::process::id().to_string());
        }
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        for (variable, name) in [
            ("AUTOHAND_SQUAD_NODE", sidecar_name("node")),
            (
                "AUTOHAND_SQUAD_DAEMON",
                sidecar_name("autohand-squad-daemon"),
            ),
            (
                "AUTOHAND_SQUAD_ANALYTICS",
                sidecar_name("autohand-squad-analytics"),
            ),
            ("AUTOHAND_SQUAD_CLI", sidecar_name("squad")),
        ] {
            let candidate: PathBuf = exe_dir.join(name);
            if candidate.exists() && std::env::var_os(variable).is_none() {
                std::env::set_var(variable, &candidate);
            }
        }
    }
}

/// Only close after the local bridge has verified and armed a replacement.
/// The detached helper waits for this process before touching the bundle.
#[tauri::command]
async fn squad_quit_for_update(
    app: AppHandle,
    window: tauri::WebviewWindow,
    shell: tauri::State<'_, Arc<Shell>>,
) -> Result<(), String> {
    let base = lock(&shell.app_url)
        .clone()
        .ok_or("Squad is still starting.")?;
    let origin = window.url().map_err(|e| e.to_string())?.origin();
    let expected = reqwest::Url::parse(&base)
        .map_err(|e| e.to_string())?
        .origin();
    if window.label() != MAIN_WINDOW || origin != expected {
        return Err("Updates can only restart Squad from its main window.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let response: serde_json::Value = client
        .get(format!(
            "{}/api/updates/progress",
            base.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if response["data"]["phase"] != "installing"
        || response["data"]["installMode"] != "restart"
        || response["data"]["nativePid"].as_u64() != Some(u64::from(std::process::id()))
    {
        return Err("No verified update is ready to install. Squad was left open.".into());
    }
    app.exit(0);
    Ok(())
}

fn sidecar_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Native menu bar. Every item is a `menu:<action>` id that the web app maps
/// to its own navigation (src/lib/desktop-menu.js), so the menu never needs to
/// know routes. Edit and Window are the predefined items the webview needs for
/// clipboard, undo, and window shortcuts to work.
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, format!("menu:{id}"), label, true, accelerator)
    };

    let new_agent = item("new-agent", "Agent…", Some("CmdOrCtrl+N"))?;
    let new_channel = item("new-channel", "Channel…", Some("CmdOrCtrl+Shift+N"))?;
    let new_menu = Submenu::with_items(app, "New", true, &[&new_agent, &new_channel])?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_menu,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let inbox = item("inbox", "Needs you", Some("CmdOrCtrl+1"))?;
    let agents = item("agents", "Agents", Some("CmdOrCtrl+2"))?;
    let channels = item("channels", "Channels", Some("CmdOrCtrl+3"))?;
    // ⌘K and ⌘B are handled by the page itself (they work in the browser
    // too); giving the menu the same accelerators would risk firing twice.
    let search = item("search", "Search Everything…", None)?;
    let toggle_sidebar = item("toggle-sidebar", "Toggle Sidebar", None)?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &inbox,
            &agents,
            &channels,
            &PredefinedMenuItem::separator(app)?,
            &search,
            &toggle_sidebar,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let maximize = PredefinedMenuItem::maximize(app, Some("Zoom"))?;
    let window_separator = PredefinedMenuItem::separator(app)?;
    let close = PredefinedMenuItem::close_window(app, None)?;
    let mut window_items: Vec<&dyn IsMenuItem<Wry>> =
        vec![&minimize, &maximize, &window_separator, &close];
    #[cfg(target_os = "macos")]
    let quick_chat = item("quick-chat", "Quick chat…", Some("CmdOrCtrl+Shift+K"))?;
    #[cfg(target_os = "macos")]
    let quick_chat_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    window_items.extend([&quick_chat_separator as &dyn IsMenuItem<Wry>, &quick_chat]);
    let window_menu = Submenu::with_items(app, "Window", true, &window_items)?;

    let mut items: Vec<&dyn IsMenuItem<Wry>> = Vec::new();
    let about = item("about", "About Autohand Squad", None)?;
    let check_upgrades = item("check-upgrades", "Check for upgrades…", None)?;
    let settings = item("settings", "Settings…", Some("CmdOrCtrl+,"))?;
    #[cfg(target_os = "macos")]
    let app_menu = {
        Submenu::with_items(
            app,
            "Autohand Squad",
            true,
            &[
                &about,
                &PredefinedMenuItem::separator(app)?,
                &settings,
                &check_upgrades,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("Quit"))?,
            ],
        )?
    };
    #[cfg(target_os = "macos")]
    items.push(&app_menu);
    items.push(&file_menu);
    items.push(&edit_menu);
    items.push(&view_menu);
    items.push(&window_menu);
    #[cfg(not(target_os = "macos"))]
    let help_menu = Submenu::with_items(app, "Help", true, &[&about, &settings, &check_upgrades])?;
    #[cfg(not(target_os = "macos"))]
    items.push(&help_menu);
    Menu::with_items(app, &items)
}

/// Menu selections reach the page as one DOM event; the web app routes them.
fn dispatch_menu_action(app: &AppHandle, action: &str) {
    #[cfg(target_os = "macos")]
    if action == "quick-chat" {
        let shell = app.state::<Arc<Shell>>().inner().clone();
        quick_chat::open_quick_chat_picker(app, shell);
        return;
    }
    if action == "about" {
        let shell = app.state::<Arc<Shell>>();
        if let Err(error) = open_info_window(app, &shell, InfoPage::About) {
            eprintln!("about window failed: {error}");
        }
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
        let script = format!(
            "window.dispatchEvent(new CustomEvent('autohand-squad:menu', {{ detail: {{ action: {} }} }}))",
            serde_json::to_string(action).unwrap_or_else(|_| "\"\"".to_string())
        );
        let _ = window.eval(&script);
    }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn build_tray(app: &AppHandle, shell: Arc<Shell>) -> tauri::Result<()> {
    let starting = DesktopTrayModel {
        account_label: "Starting…".to_string(),
        ..Default::default()
    };
    let menu = tray_menu(app, &starting)?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Autohand Squad")
        .show_menu_on_left_click(true);
    // macOS menu bar extras are monochrome template images that the system
    // recolours for light and dark menu bars and Retina scales; elsewhere the
    // coloured app icon is the convention.
    #[cfg(target_os = "macos")]
    {
        let quick_shell = shell.clone();
        builder = builder
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
                    quick_chat::open_quick_chat_picker(tray.app_handle(), quick_shell.clone());
                }
            });
        match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png")) {
            Ok(template) => {
                builder = builder.icon(template).icon_as_template(true);
            }
            Err(error) => eprintln!("tray template icon unavailable: {error}"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let events_shell = shell.clone();
    let tray = builder
        .on_menu_event(move |handle, event| {
            handle_tray_event(handle, events_shell.clone(), event.id().as_ref());
        })
        .build(app)?;
    *lock(&shell.tray) = Some(tray);
    Ok(())
}

/// The tray menu: account and plan usage at a glance (quiet, disabled lines),
/// then the actions. Rebuilt from a fresh model on every refresh.
fn tray_menu(app: &AppHandle, model: &DesktopTrayModel) -> tauri::Result<Menu<Wry>> {
    let info = |id: &str, label: &str| MenuItem::with_id(app, id, label, false, None::<&str>);
    let action = |id: &str, label: &str, enabled: bool| {
        MenuItem::with_id(app, id, label, enabled, None::<&str>)
    };
    let mut owned: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

    owned.push(Box::new(info("account", &model.account_label)?));
    if let Some(plan) = &model.plan_label {
        owned.push(Box::new(info("plan", plan)?));
    }
    for (index, line) in model.usage_lines.iter().enumerate() {
        owned.push(Box::new(info(&format!("usage-{index}"), line)?));
    }
    if let Some(note) = &model.usage_note {
        owned.push(Box::new(info("usage-note", note)?));
    }
    if let Some(squad) = &model.squad_line {
        owned.push(Box::new(info("squad", squad)?));
    }
    owned.push(Box::new(PredefinedMenuItem::separator(app)?));

    owned.push(Box::new(action("open", "Open Autohand Squad", true)?));
    owned.push(Box::new(action("mission-control", "Needs you", true)?));
    if !model.members.is_empty() {
        #[cfg(target_os = "macos")]
        let icons = quick_chat::member_icons(app, app.state::<Arc<Shell>>().inner());
        let members = model
            .members
            .iter()
            .map(|member| {
                #[cfg(target_os = "macos")]
                {
                    tauri::menu::IconMenuItem::with_id(
                        app,
                        format!("member:{}", member.id),
                        &member.label,
                        true,
                        Some(
                            icons
                                .get(&member.id)
                                .cloned()
                                .unwrap_or_else(quick_chat::placeholder_icon),
                        ),
                        None::<&str>,
                    )
                }
                #[cfg(not(target_os = "macos"))]
                {
                    action(&format!("member:{}", member.id), &member.label, true)
                }
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let refs: Vec<&dyn IsMenuItem<Wry>> = members
            .iter()
            .map(|item| item as &dyn IsMenuItem<Wry>)
            .collect();
        owned.push(Box::new(Submenu::with_items(app, "Members", true, &refs)?));
    }
    owned.push(Box::new(action(
        "refresh",
        "Refresh usage",
        model.signed_in,
    )?));
    owned.push(Box::new(PredefinedMenuItem::separator(app)?));

    if model.signed_in {
        owned.push(Box::new(action("logout", "Sign out", true)?));
    } else {
        owned.push(Box::new(action("login", "Sign in…", true)?));
    }
    owned.push(Box::new(action("update", "Check for upgrades…", true)?));
    owned.push(Box::new(CheckMenuItem::with_id(
        app,
        "launch-at-login",
        "Launch at Login",
        model.daemon_running,
        model.launch_at_login,
        None::<&str>,
    )?));
    owned.push(Box::new(PredefinedMenuItem::separator(app)?));

    owned.push(Box::new(action(
        "start",
        "Start services",
        !model.daemon_running,
    )?));
    owned.push(Box::new(action(
        "stop",
        "Stop services",
        model.daemon_running,
    )?));
    owned.push(Box::new(action(
        "restart",
        "Restart services",
        model.daemon_running,
    )?));
    owned.push(Box::new(action("logs", "Open logs folder", true)?));
    owned.push(Box::new(action("settings", "Settings…", true)?));
    owned.push(Box::new(action("report-bug", "Report a bug", true)?));
    owned.push(Box::new(action("give-feedback", "Give feedback", true)?));
    owned.push(Box::new(action("about", "About", true)?));
    owned.push(Box::new(PredefinedMenuItem::separator(app)?));
    owned.push(Box::new(action("quit", "Quit", true)?));

    let refs: Vec<&dyn IsMenuItem<Wry>> = owned.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn handle_tray_event(handle: &AppHandle, shell: Arc<Shell>, id: &str) {
    let paths = default_paths();
    match id {
        "open" => focus_main_window(handle),
        "mission-control" => navigate_app(handle, &shell, "/work"),
        "settings" => navigate_app(handle, &shell, "/settings"),
        "report-bug" => navigate_app(handle, &shell, &feedback_route_for_paths(&paths, "bug")),
        "give-feedback" => navigate_app(
            handle,
            &shell,
            &feedback_route_for_paths(&paths, "feedback"),
        ),
        "about" => {
            if let Err(error) = open_info_window(handle, &shell, InfoPage::About) {
                eprintln!("about window failed: {error}");
            }
        }
        "update" => dispatch_menu_action(handle, "check-upgrades"),
        "logs" => {
            let _ = tauri_plugin_opener::open_path(
                paths.root.to_string_lossy().to_string(),
                None::<&str>,
            );
        }
        "refresh" => refresh_tray(handle.clone(), shell, true),
        "login" | "logout" | "start" | "stop" | "restart" | "launch-at-login" => {
            let action = match id {
                "login" => TrayAction::Login,
                "logout" => TrayAction::Logout,
                "start" => TrayAction::StartService,
                "stop" => TrayAction::StopService,
                "restart" => TrayAction::RestartService,
                _ => TrayAction::LaunchAtLogin,
            };
            let id = id.to_string();
            let handle = handle.clone();
            std::thread::spawn(move || {
                let overrides = PartialSquadConfig::default();
                match shell
                    .runtime
                    .block_on(run_tray_action(paths, overrides, action))
                {
                    Ok(output) => println!("{output}"),
                    Err(error) => eprintln!("{id} failed: {error:#}"),
                }
                match id.as_str() {
                    // The sign-in gate and account footer re-check on reload.
                    "login" | "logout" => {
                        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                            let _ = window.eval("window.location.reload()");
                        }
                    }
                    _ => {}
                }
                refresh_tray(handle, shell, matches!(id.as_str(), "login" | "logout"));
            });
        }
        "quit" => {
            let handle = handle.clone();
            std::thread::spawn(move || {
                let overrides = PartialSquadConfig::default();
                let _ = shell.runtime.block_on(run_tray_action(
                    paths,
                    overrides,
                    TrayAction::StopService,
                ));
                handle.exit(0);
            });
        }
        other => {
            if let Some(member_id) = other.strip_prefix("member:") {
                #[cfg(target_os = "macos")]
                {
                    if let Err(error) = quick_chat::open_quick_chat(handle, &shell, member_id) {
                        eprintln!("quick chat failed: {error}");
                    }
                    return;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let encoded: String = member_id
                        .bytes()
                        .map(|byte| match byte {
                            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                                (byte as char).to_string()
                            }
                            _ => format!("%{byte:02X}"),
                        })
                        .collect();
                    navigate_app(
                        handle,
                        &shell,
                        &format!("/conversations/new?member={encoded}"),
                    );
                }
            }
        }
    }
}

/// Route the single-page app to `path` (client-side, no reload) and focus it.
fn navigate_app(handle: &AppHandle, shell: &Shell, path: &str) {
    let Some(window) = handle.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if lock(&shell.app_url).is_some() {
        let script = format!(
            "history.pushState({{}}, '', {}); window.dispatchEvent(new PopStateEvent('popstate'));",
            serde_json::to_string(path).unwrap_or_else(|_| "\"/\"".to_string())
        );
        let _ = window.eval(&script);
    }
    focus_main_window(handle);
}

fn start_tray_refresh(handle: AppHandle, shell: Arc<Shell>) {
    refresh_tray(handle.clone(), shell.clone(), true);
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(TRAY_REFRESH);
            tick = tick.wrapping_add(1);
            refresh_tray(
                handle.clone(),
                shell.clone(),
                tick % USAGE_REFRESH_TICKS == 0,
            );
        }
    });
}

/// Rebuild the tray menu from fresh squad status and (optionally) fresh
/// account usage. Runs off the main thread; the menu swap is dispatched.
fn refresh_tray(handle: AppHandle, shell: Arc<Shell>, refresh_usage: bool) {
    std::thread::spawn(move || {
        let paths = default_paths();
        let overrides = PartialSquadConfig::default();
        if refresh_usage {
            let result = resolve_config(&paths, overrides.clone())
                .map(|config| refresh_account_usage(&config));
            let mut cache = lock(&shell.usage);
            match result {
                Ok(Ok(Some(snapshot))) => {
                    cache.snapshot = Some(snapshot);
                    cache.error = None;
                }
                Ok(Ok(None)) => {
                    cache.snapshot = None;
                    cache.error = None;
                }
                Ok(Err(error)) | Err(error) => {
                    cache.error = Some(format!("{error:#}"));
                }
            }
        }
        let (usage, error) = {
            let cache = lock(&shell.usage);
            (cache.snapshot.clone(), cache.error.clone())
        };
        let model = load_desktop_tray_model(&paths, &overrides, usage.as_ref(), error.as_deref());
        match tray_menu(&handle, &model) {
            Ok(menu) => {
                if let Some(tray) = lock(&shell.tray).as_ref() {
                    if let Err(error) = tray.set_menu(Some(menu)) {
                        eprintln!("tray menu update failed: {error}");
                    }
                }
            }
            Err(error) => eprintln!("tray menu build failed: {error}"),
        }
    });
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
