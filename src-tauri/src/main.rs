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

use autohand_squad_runtime::config::PartialSquadConfig;
use autohand_squad_runtime::gui_bootstrap::{run_desktop_bootstrap_with, BootstrapOutcome};
use autohand_squad_runtime::ui::{default_paths, run_tray_action, TrayAction};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::runtime::Runtime;

const MAIN_WINDOW: &str = "main";

struct Shell {
    /// URL of the local bridge once the bootstrap succeeded.
    app_url: Mutex<Option<String>>,
    runtime: Runtime,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            point_runtime_at_bundle(app.handle());
            let shell = Arc::new(Shell {
                app_url: Mutex::new(None),
                runtime: Runtime::new()?,
            });
            app.manage(shell.clone());

            let window =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Autohand Squad")
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(960.0, 640.0)
                    .center()
                    .build()?;

            build_tray(app.handle(), shell.clone())?;

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
                        *shell
                            .app_url
                            .lock()
                            .unwrap_or_else(|poison| poison.into_inner()) = Some(url.clone());
                        if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                            if let Ok(target) = url.parse() {
                                let _ = window.navigate(target);
                            }
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
        .on_window_event(|window, event| {
            // Closing the window keeps the squad running in the tray, like a
            // chat app; Quit in the tray stops the services.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW {
                    api.prevent_close();
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
    if let Ok(resource_dir) = app.path().resource_dir() {
        let server = resource_dir.join("runtime").join("server.mjs");
        if server.exists() && std::env::var_os("AUTOHAND_SQUAD_WEB_SERVER").is_none() {
            std::env::set_var("AUTOHAND_SQUAD_WEB_SERVER", &server);
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

fn sidecar_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn build_tray(app: &AppHandle, shell: Arc<Shell>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Autohand Squad", true, None::<&str>)?;
    let login = MenuItem::with_id(app, "login", "Sign in…", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Open logs folder", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop services", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Autohand Squad", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &login,
            &logs,
            &PredefinedMenuItem::separator(app)?,
            &stop,
            &quit,
        ],
    )?;
    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Autohand Squad")
        .show_menu_on_left_click(true);
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder
        .on_menu_event(move |handle, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "open" => focus_main_window(handle),
                "logs" => {
                    let paths = default_paths();
                    let _ = tauri_plugin_opener::open_path(
                        paths.root.to_string_lossy().to_string(),
                        None::<&str>,
                    );
                }
                "login" | "stop" => {
                    let shell = shell.clone();
                    let handle = handle.clone();
                    std::thread::spawn(move || {
                        let action = if id == "login" {
                            TrayAction::Login
                        } else {
                            TrayAction::StopService
                        };
                        let paths = default_paths();
                        let overrides = PartialSquadConfig::default();
                        match shell
                            .runtime
                            .block_on(run_tray_action(paths, overrides, action))
                        {
                            Ok(output) => println!("{output}"),
                            Err(error) => eprintln!("{id} failed: {error:#}"),
                        }
                        if id == "login" {
                            // The bridge picks the new account up on its next poll;
                            // reload so the sign-in gate re-checks immediately.
                            if let Some(window) = handle.get_webview_window(MAIN_WINDOW) {
                                let _ = window.eval("window.location.reload()");
                            }
                        }
                    });
                }
                "quit" => {
                    let shell = shell.clone();
                    let handle = handle.clone();
                    std::thread::spawn(move || {
                        let paths = default_paths();
                        let overrides = PartialSquadConfig::default();
                        let _ = shell.runtime.block_on(run_tray_action(
                            paths,
                            overrides,
                            TrayAction::StopService,
                        ));
                        handle.exit(0);
                    });
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
