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
mod artifact_preview;
mod info_windows;
use info_windows::{info_navigation_handler, open_info_window, InfoPage};
mod computer_use_grant;
mod computer_use_setup;
mod dock_badge;
mod native_notifications;
#[cfg(all(test, target_os = "macos"))]
mod ownership_test_support;
mod quick_chat;
mod quick_chat_appearance;
mod quick_chat_preferences;
mod system_reset;
mod update_swap;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tokio::runtime::Runtime;

const MAIN_WINDOW: &str = "main";
/// Squad status (members, daemon) is re-read on this cadence; account usage
/// every `USAGE_REFRESH_TICKS` of them, or on demand from the tray.
const TRAY_REFRESH: Duration = Duration::from_secs(5);
const USAGE_REFRESH_TICKS: u32 = 60;

#[derive(Default)]
struct UsageCache {
    generation: Option<String>,
    snapshot: Option<AccountUsage>,
    error: Option<String>,
}

struct Shell {
    /// URL of the local bridge once the bootstrap succeeded.
    app_url: Mutex<Option<String>>,
    runtime: Runtime,
    tray: Mutex<Option<TrayIcon<Wry>>>,
    member_trays: Mutex<std::collections::HashMap<String, TrayIcon<Wry>>>,
    popup_anchor: Mutex<Option<String>>,
    member_portraits: Mutex<std::collections::HashMap<String, u64>>,
    quick_chat_material: Mutex<Option<quick_chat_appearance::Material>>,
    harness_usage: Mutex<Vec<quick_chat_preferences::HarnessUsage>>,
    usage_refreshing: std::sync::atomic::AtomicBool,
    usage_refresh_requested: std::sync::atomic::AtomicBool,
    tray_refreshing: std::sync::atomic::AtomicBool,
    usage: Mutex<UsageCache>,
    ownership_generation: Mutex<Option<String>>,
    reset: Mutex<system_reset::ResetGuard>,
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
            squad_quit_for_update,
            quick_chat_preferences::squad_refresh_quick_chat,
            system_reset::squad_set_system_reset_stage,
            artifact_preview::squad_open_artifact_in_browser
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            dock_badge::initialize();
            computer_use_grant::prepare_bridge_secret()?;
            point_runtime_at_bundle(app.handle());
            let shell = Arc::new(Shell {
                app_url: Mutex::new(None),
                runtime: Runtime::new()?,
                tray: Mutex::new(None),
                member_trays: Mutex::new(std::collections::HashMap::new()),
                popup_anchor: Mutex::new(None),
                member_portraits: Mutex::new(std::collections::HashMap::new()),
                quick_chat_material: Mutex::new(None),
                harness_usage: Mutex::new(Vec::new()),
                usage_refreshing: std::sync::atomic::AtomicBool::new(false),
                usage_refresh_requested: std::sync::atomic::AtomicBool::new(false),
                tray_refreshing: std::sync::atomic::AtomicBool::new(false),
                usage: Mutex::new(UsageCache::default()),
                ownership_generation: Mutex::new(None),
                reset: Mutex::new(system_reset::ResetGuard::default()),
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
                    .on_navigation({
                        let navigation =
                            info_navigation_handler(app.handle(), shell.clone(), false);
                        let shell = shell.clone();
                        move |url| !lock(&shell.reset).blocks_quit() && navigation(url)
                    })
                    .on_new_window({
                        let handle = app.handle().clone();
                        move |url, _features| {
                            artifact_preview::open_external_window(&handle, &url);
                            tauri::webview::NewWindowResponse::Deny
                        }
                    })
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
            if system_reset::blocked(app) {
                focus_main_window(app);
                return;
            }
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
                    if system_reset::blocked(window.app_handle()) {
                        return;
                    }
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
        .build(tauri::generate_context!())
        .expect("error while building Autohand Squad")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if system_reset::blocked(app) {
                    api.prevent_exit();
                    focus_main_window(app);
                }
            }
        });
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
    context_generation: String,
) -> Result<(), String> {
    let owned = require_native_context(&context_generation, true)?;
    if system_reset::blocked(&app) {
        return Err("Finish the reset before installing an update.".into());
    }
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
        .header("x-squad-context", &owned.generation)
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
    require_current_native_context(&owned)?;
    let handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = require_current_native_context(&owned);
        let closing = result.is_ok();
        let _ = sender.send(result);
        if closing {
            handle.exit(0);
        }
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "The update restart was cancelled.".to_owned())?
    })
    .await
    .map_err(|error| error.to_string())?
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
                &item("hide", "Hide Autohand Squad", Some("CmdOrCtrl+H"))?,
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
    if system_reset::blocked(app) {
        focus_main_window(app);
        return;
    }
    #[cfg(target_os = "macos")]
    if action == "hide" {
        let _ = app.hide();
        return;
    }
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
    let menu = tray_menu(app, &starting, &std::collections::HashMap::new(), None)?;
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
fn tray_menu(
    app: &AppHandle,
    model: &DesktopTrayModel,
    icons: &std::collections::HashMap<String, tauri::image::Image<'static>>,
    generation: Option<&str>,
) -> tauri::Result<Menu<Wry>> {
    let info = |id: &str, label: &str| MenuItem::with_id(app, id, label, false, None::<&str>);
    let action = |id: &str, label: &str, enabled: bool| {
        MenuItem::with_id(app, id, label, enabled, None::<&str>)
    };
    let mut owned: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

    owned.push(Box::new(info("account", &model.account_label)?));
    if let Some(plan) = &model.plan_label {
        owned.push(Box::new(info("plan", plan)?));
    }
    let preferences = quick_chat_preferences::read();
    for (index, line) in model
        .usage_lines
        .iter()
        .filter(|_| preferences.quick_chat_show_usage)
        .enumerate()
    {
        owned.push(Box::new(info(&format!("usage-{index}"), line)?));
    }
    if let Some(note) = model
        .usage_note
        .as_ref()
        .filter(|_| preferences.quick_chat_show_usage)
    {
        owned.push(Box::new(info("usage-note", note)?));
    }
    if preferences.quick_chat_show_usage {
        let harness_usage = lock(&app.state::<Arc<Shell>>().harness_usage).clone();
        for harness in &harness_usage {
            owned.push(Box::new(PredefinedMenuItem::separator(app)?));
            owned.push(Box::new(info(
                &format!("harness-{}", harness.id),
                &harness.label,
            )?));
            for (index, line) in quick_chat_preferences::usage_lines(harness)
                .iter()
                .enumerate()
            {
                owned.push(Box::new(info(
                    &format!("harness-{}-{index}", harness.id),
                    line,
                )?));
            }
        }
    }
    if let Some(squad) = &model.squad_line {
        owned.push(Box::new(info("squad", squad)?));
    }
    owned.push(Box::new(PredefinedMenuItem::separator(app)?));

    owned.push(Box::new(action("open", "Open Autohand Squad", true)?));
    owned.push(Box::new(action("mission-control", "Needs you", true)?));
    if !model.members.is_empty() {
        let members = model
            .members
            .iter()
            .map(|member| {
                #[cfg(target_os = "macos")]
                {
                    tauri::menu::IconMenuItem::with_id(
                        app,
                        format!("member:{}:{}", generation.unwrap_or("locked"), member.id),
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
                    action(
                        &format!("member:{}:{}", generation.unwrap_or("locked"), member.id),
                        &member.label,
                        true,
                    )
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
        preferences.quick_chat_show_usage,
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
    if system_reset::blocked(handle) {
        focus_main_window(handle);
        return;
    }
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
            if let Some((generation, member_id)) = other
                .strip_prefix("member:")
                .and_then(|value| value.split_once(':'))
            {
                if autohand_squad_runtime::ownership::read_active_context(&default_paths())
                    .ok()
                    .flatten()
                    .is_none_or(|context| context.generation != generation)
                {
                    return;
                }
                #[cfg(target_os = "macos")]
                {
                    *lock(&shell.popup_anchor) = None;
                    if quick_chat_preferences::read().quick_chat_enabled {
                        if let Err(error) = quick_chat::open_quick_chat(handle, &shell, member_id) {
                            eprintln!("quick chat failed: {error}");
                        }
                    } else if quick_chat::valid_member_id(member_id) {
                        navigate_app(
                            handle,
                            &shell,
                            &format!("/conversations/new?member={member_id}"),
                        );
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
    if system_reset::blocked(handle) {
        focus_main_window(handle);
        return;
    }
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

fn clear_private_native_ui(app: &AppHandle, shell: &Arc<Shell>) {
    system_reset::invalidate(shell);
    computer_use_grant::clear_stale_dialog();
    native_notifications::invalidate_scope();
    dock_badge::invalidate_scope();
    let ids: Vec<String> = lock(&shell.member_trays).keys().cloned().collect();
    for id in ids {
        drop(app.remove_tray_by_id(&format!("member-tray:{id}")));
    }
    lock(&shell.member_trays).clear();
    lock(&shell.member_portraits).clear();
    *lock(&shell.popup_anchor) = None;
    if let Some(window) = app.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
        let _ = window.destroy();
    }
    if let Ok(menu) = tray_menu(
        app,
        &DesktopTrayModel {
            account_label: "Verifying account…".into(),
            ..Default::default()
        },
        &std::collections::HashMap::new(),
        None,
    ) {
        if let Some(tray) = lock(&shell.tray).clone() {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn start_tray_refresh(handle: AppHandle, shell: Arc<Shell>) {
    refresh_tray(handle.clone(), shell.clone(), true);
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        let mut observed = autohand_squad_runtime::ownership::read_active_context(&default_paths())
            .ok()
            .flatten()
            .map(|context| context.generation);
        let refresh_ticks = (TRAY_REFRESH.as_millis() / 250).max(1) as u32;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            tick = tick.wrapping_add(1);
            let context = autohand_squad_runtime::ownership::read_active_context(&default_paths())
                .ok()
                .flatten();
            let generation = context.as_ref().map(|context| context.generation.clone());
            let changed = generation != observed;
            if changed {
                observed = generation;
                *lock(&shell.usage) = UsageCache::default();
                lock(&shell.harness_usage).clear();
                let app = handle.clone();
                let state = shell.clone();
                let _ = handle.run_on_main_thread(move || {
                    if !native_scope_current(context.as_ref()) {
                        return;
                    }
                    clear_private_native_ui(&app, &state);
                });
            }
            if changed || tick % refresh_ticks == 0 {
                refresh_tray(
                    handle.clone(),
                    shell.clone(),
                    changed || tick % (refresh_ticks * USAGE_REFRESH_TICKS) == 0,
                );
            }
        }
    });
}

/// Rebuild the tray menu from fresh squad status and (optionally) fresh
/// account usage. Runs off the main thread; the menu swap is dispatched.
fn native_scope_current(context: Option<&autohand_squad_runtime::ownership::OwnedContext>) -> bool {
    match context {
        Some(context) => {
            autohand_squad_runtime::ownership::still_current(&default_paths(), context)
        }
        None => autohand_squad_runtime::ownership::read_active_context(&default_paths())
            .ok()
            .flatten()
            .is_none(),
    }
}

fn require_native_context(
    generation: &str,
    write: bool,
) -> Result<autohand_squad_runtime::ownership::OwnedContext, String> {
    let context = autohand_squad_runtime::ownership::read_active_context(&default_paths())
        .map_err(|_| "Squad's account could not be verified.")?
        .ok_or("Select a verified Squad first.")?;
    if context.generation != generation || (write && !context.can_write) {
        return Err(
            "The selected Squad changed or cannot perform this action. Reopen it and try again."
                .into(),
        );
    }
    Ok(context)
}

fn require_current_native_context(
    context: &autohand_squad_runtime::ownership::OwnedContext,
) -> Result<(), String> {
    if native_scope_current(Some(context)) {
        Ok(())
    } else {
        Err("The selected Squad changed. Reopen it and try again.".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod ownership_command_tests {
    #[test]
    fn captured_native_context_cannot_rebind_to_the_next_account() {
        let fixture = crate::ownership_test_support::Fixture::new();
        let alice = fixture.select("alice", "1234abcd-1234-4abc-8def-0123456789ab");
        assert!(crate::require_current_native_context(&alice).is_ok());
        let bob = fixture.select("bob", "2234abcd-1234-4abc-8def-0123456789ab");
        assert!(crate::require_current_native_context(&alice).is_err());
        assert!(crate::require_native_context(&alice.generation, true).is_err());
        assert_eq!(
            crate::require_native_context(&bob.generation, true)
                .unwrap()
                .actor
                .id,
            "bob"
        );
    }
}

fn refresh_tray(handle: AppHandle, shell: Arc<Shell>, refresh_usage: bool) {
    if refresh_usage {
        shell
            .usage_refresh_requested
            .store(true, std::sync::atomic::Ordering::Release);
    }
    if shell
        .tray_refreshing
        .swap(true, std::sync::atomic::Ordering::AcqRel)
    {
        return;
    }
    std::thread::spawn(move || {
        let paths = default_paths();
        let overrides = PartialSquadConfig::default();
        let owned = autohand_squad_runtime::ownership::read_active_context(&paths)
            .ok()
            .flatten();
        let generation = owned.as_ref().map(|context| context.generation.clone());
        let changed = {
            let mut previous = lock(&shell.ownership_generation);
            let changed = *previous != generation;
            *previous = generation.clone();
            changed
        };
        if changed {
            *lock(&shell.usage) = UsageCache::default();
            lock(&shell.harness_usage).clear();
            lock(&shell.member_portraits).clear();
            *lock(&shell.popup_anchor) = None;
            let clear_handle = handle.clone();
            let clear_shell = shell.clone();
            let captured = owned.clone();
            let _ = handle.run_on_main_thread(move || {
                if !native_scope_current(captured.as_ref()) {
                    return;
                }
                clear_private_native_ui(&clear_handle, &clear_shell);
                if let Some(window) = clear_handle.get_webview_window(quick_chat::QUICK_CHAT_WINDOW)
                {
                    let _ = window.destroy();
                }
            });
        }

        if shell
            .usage_refresh_requested
            .load(std::sync::atomic::Ordering::Acquire)
            && !shell
                .usage_refreshing
                .swap(true, std::sync::atomic::Ordering::AcqRel)
        {
            shell
                .usage_refresh_requested
                .store(false, std::sync::atomic::Ordering::Release);
            let usage_shell = shell.clone();
            let usage_handle = handle.clone();
            std::thread::spawn(move || {
                let paths = default_paths();
                let overrides = PartialSquadConfig::default();

                let owned = autohand_squad_runtime::ownership::read_active_context(&paths)
                    .ok()
                    .flatten();
                let result = resolve_config(&paths, overrides.clone())
                    .map(|config| refresh_account_usage(&paths, &config));
                let mut cache = lock(&usage_shell.usage);
                let current = owned.as_ref().is_some_and(|context| {
                    autohand_squad_runtime::ownership::still_current(&paths, context)
                });
                if current
                    && cache.generation.as_deref()
                        != owned.as_ref().map(|context| context.generation.as_str())
                {
                    *cache = UsageCache::default();
                }
                if current {
                    cache.generation = owned.as_ref().map(|context| context.generation.clone());
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
                            cache.snapshot = None;
                            cache.error = Some(format!("{error:#}"));
                        }
                    }
                }

                drop(cache);
                if quick_chat_preferences::read().quick_chat_show_usage {
                    let base = lock(&usage_shell.app_url).clone();
                    if let (Some(base), Some(context)) = (base, owned.as_ref()) {
                        let windows = quick_chat_preferences::fetch_usage(&base, context);
                        if native_scope_current(Some(context)) {
                            *lock(&usage_shell.harness_usage) = windows;
                        }
                    }
                } else {
                    lock(&usage_shell.harness_usage).clear();
                }
                usage_shell
                    .usage_refreshing
                    .store(false, std::sync::atomic::Ordering::Release);
                refresh_tray(usage_handle, usage_shell, false);
            });
        }
        let (usage, error, usage_generation) = {
            let cache = lock(&shell.usage);
            (
                cache.snapshot.clone(),
                cache.error.clone(),
                cache.generation.clone(),
            )
        };
        let model = load_desktop_tray_model(
            &paths,
            &overrides,
            usage.as_ref(),
            error.as_deref(),
            usage_generation.as_deref(),
        );
        #[cfg(target_os = "macos")]
        let icons = if !quick_chat_preferences::visible_ids(&model, &quick_chat_preferences::read())
            .is_empty()
        {
            owned
                .as_ref()
                .map(|context| quick_chat::member_icons(&handle, &shell, context))
                .unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        };
        #[cfg(not(target_os = "macos"))]
        let icons = std::collections::HashMap::new();
        let apply_handle = handle.clone();
        let apply_shell = shell.clone();
        let _ = handle.run_on_main_thread(move || {
            if !native_scope_current(owned.as_ref()) {
                return;
            }
            quick_chat_preferences::apply(
                &apply_handle,
                &apply_shell,
                &model,
                &icons,
                owned.as_ref(),
            );
            match tray_menu(&apply_handle, &model, &icons, generation.as_deref()) {
                Ok(menu) => {
                    if let Some(tray) = lock(&apply_shell.tray).clone() {
                        if let Err(error) = tray.set_menu(Some(menu)) {
                            eprintln!("tray menu update failed: {error}");
                        }
                    }
                }
                Err(error) => eprintln!("tray menu build failed: {error}"),
            }
        });
        shell
            .tray_refreshing
            .store(false, std::sync::atomic::Ordering::Release);
    });
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
