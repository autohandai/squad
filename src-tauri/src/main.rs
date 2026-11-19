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
mod deep_link;
mod info_windows;
mod text_exports;
mod titlebar;
use info_windows::{info_navigation_handler, open_info_window, InfoPage};
mod computer_use_grant;
mod computer_use_setup;
mod dock_badge;
#[cfg(target_os = "macos")]
mod menu_bar_access;
mod native_notifications;
#[cfg(all(test, target_os = "macos"))]
mod ownership_test_support;
mod quick_chat;
mod main_window_material;
mod quick_chat_appearance;
mod quick_chat_preferences;
mod system_reset;
mod tray_art;
mod tray_bridge;
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
    main_window_material: Mutex<Option<quick_chat_appearance::Material>>,
    /// Claude Code and Codex readings; None until the first read finishes.
    harness_usage: Mutex<Option<Vec<quick_chat_preferences::HarnessUsage>>>,
    /// Needs-you items, breaks, engines and the phone, read from the bridge.
    tray_extras: Mutex<tray_bridge::TrayExtras>,
    portrait_cache: Mutex<quick_chat::PortraitCache>,
    /// When usage was last fetched, so a right-click refresh stays cheap.
    usage_fetched_at: Mutex<Option<std::time::Instant>>,
    usage_refreshing: std::sync::atomic::AtomicBool,
    usage_refresh_requested: std::sync::atomic::AtomicBool,
    tray_refreshing: std::sync::atomic::AtomicBool,
    usage: Mutex<UsageCache>,
    ownership_generation: Mutex<Option<String>>,
    reset: Mutex<system_reset::ResetGuard>,
    /// A `squad://` link that arrived before the bridge was ready (ADR-0246).
    pending_link_route: Mutex<Option<String>>,
    /// What the menu bar last showed and announced about needs-you (ADR-0249).
    attention: Mutex<Attention>,
}

/// Needs-you as the menu bar last showed it, so the dot is only redrawn when
/// it changes and VoiceOver only hears about items it has not heard about.
#[derive(Default)]
struct Attention {
    generation: Option<String>,
    /// Keys of the items present at the last bridge read; None until the
    /// first read for this account, so what already waited at launch is not
    /// announced as new.
    seen: Option<std::collections::HashSet<String>>,
    /// Whether the Squad icon now carries the dot; None before the first set.
    dot: Option<bool>,
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
            artifact_preview::squad_open_artifact_in_browser,
            text_exports::squad_save_text_export,
            titlebar::squad_titlebar_double_click
        ])
        // With its deep-link feature, single-instance hands a second launch's
        // `squad://` argument (Windows, Linux) to the deep-link plugin below.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(route) = deep_link::route_from_args(&args) {
                open_marketplace_route(app, route);
            }
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
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
                main_window_material: Mutex::new(None),
                harness_usage: Mutex::new(None),
                tray_extras: Mutex::new(tray_bridge::TrayExtras::default()),
                portrait_cache: Mutex::new(std::collections::HashMap::new()),
                usage_fetched_at: Mutex::new(None),
                usage_refreshing: std::sync::atomic::AtomicBool::new(false),
                usage_refresh_requested: std::sync::atomic::AtomicBool::new(false),
                tray_refreshing: std::sync::atomic::AtomicBool::new(false),
                usage: Mutex::new(UsageCache::default()),
                ownership_generation: Mutex::new(None),
                reset: Mutex::new(system_reset::ResetGuard::default()),
                pending_link_route: Mutex::new(None),
                attention: Mutex::new(Attention::default()),
            });
            app.manage(shell.clone());
            install_deep_links(app);
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
                    .on_page_load({
                        let shell = shell.clone();
                        move |webview, payload| {
                            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                                main_window_material::republish(&webview, &shell);
                            }
                        }
                    })
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
                    .initialization_script(include_str!("titlebar.js"))
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .transparent(true);
            }
            let window = builder.build()?;
            #[cfg(target_os = "macos")]
            {
                // Liquid Glass behind the sidebar where macOS has it, Sidebar
                // vibrancy otherwise (ADR-0258). Settings can switch it later.
                main_window_material::apply(&window, &shell, &quick_chat_preferences::read());
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
                        // Opened by a squad:// link: the first page is that
                        // agent in the Marketplace dialog (ADR-0246).
                        let first = lock(&shell.pending_link_route)
                            .take()
                            .and_then(|route| deep_link::cold_start_url(&url, &route))
                            .unwrap_or_else(|| url.clone());
                        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                            if let Ok(target) = first.parse() {
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

    let inbox = item("inbox", "Inbox", Some("CmdOrCtrl+1"))?;
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
    let starting = DesktopTrayModel::default();
    let (menu, facts) = tray_menu(app, &starting, &std::collections::HashMap::new(), None)?;
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
                } else if matches!(
                    event,
                    tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Right,
                        button_state: tauri::tray::MouseButtonState::Down,
                        ..
                    }
                ) {
                    // Opening the menu starts a refresh so the next opening is
                    // current; usage itself at most once a minute (ADR-0236).
                    let stale = lock(&quick_shell.usage_fetched_at)
                        .is_none_or(|at| at.elapsed() >= Duration::from_secs(60));
                    refresh_tray(tray.app_handle().clone(), quick_shell.clone(), stale);
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
    *lock(&shell.tray) = Some(tray.clone());
    #[cfg(target_os = "macos")]
    {
        // The builder set the plain template.
        lock(&shell.attention).dot = Some(false);
        let press_app = app.clone();
        let press_shell = shell.clone();
        menu_bar_access::on_member_press(move |member_id| {
            quick_chat_preferences::open_member_quick_chat(&press_app, &press_shell, member_id);
        });
    }
    menu_bar_shown(&shell, &tray, &facts);
    Ok(())
}

/// What the rest of the menu bar takes from the same plan as the menu.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
struct TrayFacts {
    rows: Vec<autohand_squad_runtime::desktop_tray::menu::Row>,
    status: autohand_squad_runtime::desktop_tray::menu::StatusSpeech,
    /// Member id → what their own status item says (Agent avatars).
    members: std::collections::HashMap<String, autohand_squad_runtime::desktop_tray::menu::StatusSpeech>,
    /// Members with a question or approval waiting, when the dot is on.
    waiting: std::collections::HashSet<String>,
    /// The Squad icon should carry the attention dot.
    dot: bool,
    /// What VoiceOver should hear, if something new needs the person.
    announcement: Option<String>,
}

/// After a menu is set on the Squad status item: images, VoiceOver words for
/// every row and both kinds of status item, the attention dot, and the
/// announcement. Main thread.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn menu_bar_shown(shell: &Arc<Shell>, tray: &TrayIcon<Wry>, facts: &TrayFacts) {
    #[cfg(target_os = "macos")]
    {
        tray_art::keep_menu_images_visible(tray);
        let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
            return;
        };
        // The tray crate wants an owned, sendable closure; it runs it here,
        // on the main thread.
        let (rows, status) = (facts.rows.clone(), facts.status.clone());
        let _ = tray.with_inner_tray_icon(move |inner| {
            let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
                return;
            };
            if let Some(item) = inner.ns_status_item() {
                if let Some(menu) = item.menu(mtm) {
                    menu_bar_access::describe_menu(&menu, &rows);
                }
                menu_bar_access::describe_status_item(&item, &status, mtm);
            }
        });
        let redraw = {
            let mut attention = lock(&shell.attention);
            let redraw = attention.dot != Some(facts.dot);
            attention.dot = Some(facts.dot);
            redraw
        };
        if redraw {
            // Swapped in one main-thread turn, so the bar never draws the
            // icon between the two calls; only on change, so no flicker.
            if let Some(icon) = tray_art::squad_status_icon(facts.dot) {
                let _ = tray.set_icon(Some(icon));
                let _ = tray.set_icon_as_template(true);
            }
        }
        let members: Vec<(String, TrayIcon<Wry>)> = lock(&shell.member_trays)
            .iter()
            .map(|(id, tray)| (id.clone(), tray.clone()))
            .collect();
        for (id, member_tray) in &members {
            let (id, speech) = (id.clone(), facts.members.get(id).cloned());
            let _ = member_tray.with_inner_tray_icon(move |inner| {
                let Some(mtm) = objc2_foundation::MainThreadMarker::new() else {
                    return;
                };
                if let Some(item) = inner.ns_status_item() {
                    if let Some(speech) = &speech {
                        menu_bar_access::describe_status_item(&item, speech, mtm);
                    }
                    menu_bar_access::make_pressable(&item, &id, mtm);
                }
            });
        }
        menu_bar_access::retain_pressable(|id| members.iter().any(|(member, _)| member == id));
        if let Some(text) = &facts.announcement {
            if menu_bar_access::voiceover_running() {
                menu_bar_access::announce(text, mtm);
            }
        }
    }
}

/// The menu-bar menu (docs/design/menu-bar-menu.md, ADR-0236): the squad
/// first, what waits on the person, then headroom, then the footer. The rows
/// come from `desktop_tray::menu::plan_menu`; this maps them to native items
/// and, on macOS, draws their images. Rebuilt from a fresh model on every
/// refresh.
fn tray_menu(
    app: &AppHandle,
    model: &DesktopTrayModel,
    portraits: &std::collections::HashMap<String, Arc<Vec<u8>>>,
    generation: Option<&str>,
) -> tauri::Result<(Menu<Wry>, TrayFacts)> {
    use autohand_squad_runtime::desktop_tray::menu::{self, MenuInputs, QuickChat};
    let shell = app.state::<Arc<Shell>>().inner().clone();
    let preferences = quick_chat_preferences::read();
    let harnesses: Option<Vec<menu::EngineUsage>> = lock(&shell.harness_usage).as_ref().map(|list| {
        list.iter()
            .map(quick_chat_preferences::engine_usage)
            .collect()
    });
    let (needs, on_break, engines, engines_known, phone, read) = {
        let extras = lock(&shell.tray_extras);
        if generation.is_some() && extras.generation.as_deref() == generation {
            (
                extras.needs.clone(),
                extras.on_break.clone(),
                extras.engines.clone(),
                extras.engines_known,
                extras.phone.clone(),
                true,
            )
        } else {
            Default::default()
        }
    };
    #[cfg(target_os = "macos")]
    let (look, hour12) = (tray_art::system_look(), tray_art::system_hour12());
    #[cfg(not(target_os = "macos"))]
    let (look, hour12) = (tray_art::Look::default(), true);
    let inputs = MenuInputs {
        model,
        engines: &engines,
        engines_known,
        needs: &needs,
        on_break: &on_break,
        show_usage: preferences.quick_chat_show_usage,
        harnesses: harnesses.as_deref(),
        phone,
        quick_chat: if !cfg!(target_os = "macos") {
            QuickChat::Absent
        } else if preferences.quick_chat_enabled {
            QuickChat::Enabled
        } else {
            QuickChat::Disabled
        },
        generation: generation.unwrap_or("locked"),
        clock: menu::Clock::system(hour12),
    };
    let rows = menu::plan_menu(&inputs);
    let items = rows
        .iter()
        .map(|row| tray_item(app, row, portraits, look))
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    let native = Menu::with_items(app, &refs)?;

    // Attention (ADR-0249): the dot and the announcement follow exactly the
    // items the needs-you row shows, and only while the setting is on.
    let signal = preferences.menu_bar_attention_dot && menu::attention_count(&inputs) > 0;
    let announcement = {
        let mut attention = lock(&shell.attention);
        if attention.generation.as_deref() != generation {
            attention.generation = generation.map(str::to_string);
            attention.seen = None;
        }
        let announcement = match (&attention.seen, read && signal) {
            (Some(seen), true) => menu::announcement(seen, &inputs),
            _ => None,
        };
        if read {
            attention.seen = Some(needs.iter().map(menu::needs_key).collect());
        }
        announcement
    };
    let facts = TrayFacts {
        status: menu::status_item_speech(&inputs, &rows),
        members: model
            .members
            .iter()
            .filter_map(|member| {
                menu::member_item_speech(&inputs, &member.id).map(|speech| (member.id.clone(), speech))
            })
            .collect(),
        waiting: if signal {
            needs.iter().map(|item| item.member_id.clone()).collect()
        } else {
            Default::default()
        },
        dot: signal,
        announcement,
        rows,
    };
    Ok((native, facts))
}

/// One planned row as a native item. Images are drawn on macOS only; Windows
/// and Linux show the same words without them.
fn tray_item(
    app: &AppHandle,
    row: &autohand_squad_runtime::desktop_tray::menu::Row,
    portraits: &std::collections::HashMap<String, Arc<Vec<u8>>>,
    look: tray_art::Look,
) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
    use autohand_squad_runtime::desktop_tray::menu::{Art, RowKind};
    #[cfg(target_os = "macos")]
    let image = row.art.as_ref().map(|art| match art {
        Art::Comb(cells) => tray_art::comb(cells, look),
        Art::Headroom(left) => tray_art::headroom_mark(*left, look),
        Art::Avatar { member_id, badge } => tray_art::member_avatar(
            portraits.get(member_id).map(|pixels| pixels.as_slice()),
            *badge,
            look,
        ),
        Art::NeedsYou => tray_art::needs_you_mark(),
    });
    #[cfg(not(target_os = "macos"))]
    let image: Option<tauri::image::Image<'static>> = {
        let _ = (portraits, look, &row.art as &Option<Art>);
        None
    };
    // muda reads `&` as a mnemonic marker and drops it, so "R&D" showed as
    // "RD". Doubled, it comes back as one `&`, and the native title equals
    // the row's words, which `menu_bar_access::describe_menu` relies on.
    let text = &muda_text(&row.text);
    Ok(match &row.kind {
        RowKind::Separator => Box::new(PredefinedMenuItem::separator(app)?),
        RowKind::Check(checked) => Box::new(CheckMenuItem::with_id(
            app,
            &row.id,
            text,
            row.enabled,
            *checked,
            row.shortcut,
        )?),
        RowKind::Submenu(children) => {
            let items = children
                .iter()
                .map(|child| tray_item(app, child, portraits, look))
                .collect::<tauri::Result<Vec<_>>>()?;
            let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
            let submenu = Submenu::with_id_and_items(app, &row.id, text, row.enabled, &refs)?;
            if image.is_some() {
                submenu.set_icon(image)?;
            }
            Box::new(submenu)
        }
        RowKind::Item => match image {
            Some(image) => Box::new(tauri::menu::IconMenuItem::with_id(
                app,
                &row.id,
                text,
                row.enabled,
                Some(image),
                row.shortcut,
            )?),
            None => Box::new(MenuItem::with_id(
                app,
                &row.id,
                text,
                row.enabled,
                row.shortcut,
            )?),
        },
    })
}

/// Words for muda: every `&` doubled so its mnemonic stripping keeps them.
fn muda_text(text: &str) -> String {
    text.replace('&', "&&")
}

#[cfg(test)]
mod muda_text_tests {
    /// muda 0.19.3 `strip_mnemonic`, copied: what the native title becomes.
    fn strip_mnemonic(text: &str) -> String {
        text.replace("&&", "[~~]").replace('&', "").replace("[~~]", "&")
    }

    #[test]
    fn ampersands_survive_mnemonic_stripping() {
        for text in ["R&D · Ready", "Q&&A", "Plain", "&lead"] {
            assert_eq!(strip_mnemonic(&super::muda_text(text)), text);
        }
    }
}

/// The plan page; `autohand.ai/pricing` redirects here (HTTP 301 → 200,
/// checked 2026-11-17). Squad has no in-app plan page.
const PLAN_URL: &str = "https://autohand.ai/code/pricing/";

fn handle_tray_event(handle: &AppHandle, shell: Arc<Shell>, id: &str) {
    if system_reset::blocked(handle) {
        focus_main_window(handle);
        return;
    }
    let paths = default_paths();
    match id {
        "open" => focus_main_window(handle),
        "needs-you" => navigate_app(handle, &shell, "/work"),
        "settings" => navigate_app(handle, &shell, "/settings"),
        "usage-settings" => navigate_app(handle, &shell, "/settings/quick-chat"),
        window if window.starts_with("usage-window:") => {
            navigate_app(handle, &shell, "/settings/quick-chat")
        }
        "add-member" => {
            focus_main_window(handle);
            dispatch_menu_action(handle, "new-agent");
        }
        "quick-chat" => {
            #[cfg(target_os = "macos")]
            quick_chat::open_quick_chat_picker(handle, shell);
        }
        "upgrade-plan" | "manage-plan" => {
            let _ = tauri_plugin_opener::open_url(PLAN_URL, None::<&str>);
        }
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
            // `member:<generation>:<id>` opens Quick Chat with that member;
            // `needs:<generation>:<id>` opens the member's chat in the main
            // window, where the question or approval waits.
            let (needs, rest) = match other.strip_prefix("needs:") {
                Some(rest) => (true, rest),
                None => match other.strip_prefix("member:") {
                    Some(rest) => (false, rest),
                    None => return,
                },
            };
            let Some((generation, member_id)) = rest.split_once(':') else {
                return;
            };
            if autohand_squad_runtime::ownership::read_active_context(&default_paths())
                .ok()
                .flatten()
                .is_none_or(|context| context.generation != generation)
                || !quick_chat::valid_member_id(member_id)
            {
                return;
            }
            let chat_route = format!("/conversations/new?member={member_id}");
            if needs {
                navigate_app(handle, &shell, &chat_route);
                return;
            }
            #[cfg(target_os = "macos")]
            {
                *lock(&shell.popup_anchor) = None;
                if quick_chat_preferences::read().quick_chat_enabled {
                    if let Err(error) = quick_chat::open_quick_chat(handle, &shell, member_id) {
                        eprintln!("quick chat failed: {error}");
                    }
                } else {
                    navigate_app(handle, &shell, &chat_route);
                }
            }
            #[cfg(not(target_os = "macos"))]
            navigate_app(handle, &shell, &chat_route);
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
    lock(&shell.portrait_cache).clear();
    *lock(&shell.tray_extras) = tray_bridge::TrayExtras::default();
    *lock(&shell.popup_anchor) = None;
    if let Some(window) = app.get_webview_window(quick_chat::QUICK_CHAT_WINDOW) {
        let _ = window.destroy();
    }
    // Not loaded: the menu says "connecting…" while the account is verified.
    if let Ok((menu, facts)) = tray_menu(
        app,
        &DesktopTrayModel::default(),
        &std::collections::HashMap::new(),
        None,
    ) {
        if let Some(tray) = lock(&shell.tray).clone() {
            let _ = tray.set_menu(Some(menu));
            menu_bar_shown(shell, &tray, &facts);
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
                *lock(&shell.harness_usage) = None;
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
            *lock(&shell.harness_usage) = None;
            *lock(&shell.tray_extras) = tray_bridge::TrayExtras::default();
            lock(&shell.portrait_cache).clear();
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
                            *lock(&usage_shell.harness_usage) = Some(windows);
                        }
                    }
                } else {
                    *lock(&usage_shell.harness_usage) = None;
                }
                *lock(&usage_shell.usage_fetched_at) = Some(std::time::Instant::now());
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
        // What only the bridge knows: needs-you items, breaks, engines, phone.
        if let (Some(base), Some(context)) = (lock(&shell.app_url).clone(), owned.as_ref()) {
            if model.daemon_running {
                let roster: Vec<String> =
                    model.members.iter().map(|member| member.id.clone()).collect();
                let mut extras = std::mem::take(&mut *lock(&shell.tray_extras));
                tray_bridge::refresh(&mut extras, &base, context, &roster);
                if native_scope_current(Some(context)) {
                    *lock(&shell.tray_extras) = extras;
                }
            }
        }
        // Portraits for menu rows and, in Agent avatars mode, status items.
        #[cfg(target_os = "macos")]
        let quick_chat::MemberPortraits {
            icons,
            menu: portraits,
        } = match owned.as_ref() {
            Some(context) => quick_chat::member_icons(&handle, &shell, context),
            None => quick_chat::MemberPortraits {
                icons: std::collections::HashMap::new(),
                menu: std::collections::HashMap::new(),
            },
        };
        #[cfg(not(target_os = "macos"))]
        let (icons, portraits) = (
            std::collections::HashMap::new(),
            std::collections::HashMap::new(),
        );
        let apply_handle = handle.clone();
        let apply_shell = shell.clone();
        let _ = handle.run_on_main_thread(move || {
            if !native_scope_current(owned.as_ref()) {
                return;
            }
            match tray_menu(&apply_handle, &model, &portraits, generation.as_deref()) {
                Ok((menu, facts)) => {
                    // In Agent avatars mode the member who is waiting carries
                    // the dot on their own icon too.
                    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
                    let mut icons = icons;
                    #[cfg(target_os = "macos")]
                    for id in &facts.waiting {
                        if let Some(icon) = icons.get_mut(id) {
                            let (width, height) = (icon.width(), icon.height());
                            *icon = tauri::image::Image::new_owned(
                                tray_art::with_attention_dot(icon.rgba(), width, height, tray_art::YOU),
                                width,
                                height,
                            );
                        }
                    }
                    quick_chat_preferences::apply(
                        &apply_handle,
                        &apply_shell,
                        &model,
                        &icons,
                        owned.as_ref(),
                    );
                    if let Some(tray) = lock(&apply_shell.tray).clone() {
                        if let Err(error) = tray.set_menu(Some(menu)) {
                            eprintln!("tray menu update failed: {error}");
                        }
                        menu_bar_shown(&apply_shell, &tray, &facts);
                    }
                }
                Err(error) => {
                    eprintln!("tray menu build failed: {error}");
                    quick_chat_preferences::apply(
                        &apply_handle,
                        &apply_shell,
                        &model,
                        &icons,
                        owned.as_ref(),
                    );
                }
            }
        });
        shell
            .tray_refreshing
            .store(false, std::sync::atomic::Ordering::Release);
    });
}

/// `squad://` links (ADR-0246). The bundle registers the scheme on macOS
/// (Info.plist), Windows (NSIS) and Linux (.desktop); an AppImage or a
/// development build registers it at runtime. Only links that parse as a
/// marketplace agent are acted on, and they only open the agent.
fn install_deep_links(app: &mut tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;
    #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
    if let Err(error) = app.deep_link().register_all() {
        eprintln!("squad:// links could not be registered: {error}");
    }
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        if let Some(route) = deep_link::route_from_args(event.urls().iter().map(|url| url.as_str())) {
            open_marketplace_route(&handle, route);
        }
    });
    // A link that launched the app before the handler existed.
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        if let Some(route) = deep_link::route_from_args(urls.iter().map(|url| url.as_str())) {
            open_marketplace_route(app.handle(), route);
        }
    }
}

/// Route the app to an agent, or keep the route for the first page when the
/// bridge is still starting.
fn open_marketplace_route(handle: &AppHandle, route: String) {
    let shell = handle.state::<Arc<Shell>>().inner().clone();
    if lock(&shell.app_url).is_some() {
        navigate_app(handle, &shell, &route);
    } else {
        *lock(&shell.pending_link_route) = Some(route);
        focus_main_window(handle);
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
