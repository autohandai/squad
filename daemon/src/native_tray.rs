use crate::config::ConfigOverrides;
use crate::state::StatePaths;
use crate::ui::{describe_tray, run_tray_action, TrayAction, TraySnapshot};
use anyhow::{Context, Result};
#[cfg(target_os = "macos")]
use objc2::{rc::Retained, runtime::AnyObject, AllocAnyThread, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName,
    NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionCredits, NSAboutPanelOptionVersion,
    NSApplication, NSImage,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{ns_string, NSAttributedString, NSData, NSDictionary, NSString};
use std::io::Cursor;
use std::time::{Duration, Instant};
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
#[cfg(target_os = "macos")]
use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
use tokio::runtime::Runtime;
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

const REFRESH_INTERVAL: Duration = Duration::from_secs(10);

enum UserEvent {
    Menu(MenuEvent),
}

#[derive(Clone)]
struct MenuHandles {
    status: MenuItem,
    version: MenuItem,
    account: MenuItem,
    plan: MenuItem,
    online_members: MenuItem,
    working_agents: MenuItem,
    queued_jobs: MenuItem,
    scheduled_jobs: MenuItem,
    start: MenuItem,
    stop: MenuItem,
    restart: MenuItem,
    update: MenuItem,
    logout: MenuItem,
    queue: MenuItem,
    launch_at_login: CheckMenuItem,
}

pub fn run_native_tray(paths: StatePaths, overrides: ConfigOverrides) -> Result<()> {
    let runtime = Runtime::new().context("create tray async runtime")?;
    let first_snapshot = runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))?;
    if first_snapshot.platform.browser_fallback {
        let output = runtime.block_on(run_tray_action(paths, overrides, TrayAction::OpenSquad))?;
        print!("{output}");
        return Ok(());
    }

    let mut builder = EventLoopBuilder::<UserEvent>::with_user_event();
    let mut event_loop = builder.build();
    configure_menu_bar_app(&mut event_loop);
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Menu(event));
    }));

    let (menu, handles) = build_menu(&first_snapshot)?;
    let mut tray_builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu.clone()))
        .with_tooltip("Autohand Squad")
        .with_icon(tray_icon()?)
        .with_icon_as_template(tray_icon_is_template());
    if !cfg!(target_os = "macos") {
        tray_builder = tray_builder.with_title("Autohand Squad");
    }
    let _tray = tray_builder.build().context("create native tray icon")?;

    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + REFRESH_INTERVAL);

        match event {
            Event::NewEvents(StartCause::Init)
            | Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                if let Ok(snapshot) =
                    runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))
                {
                    refresh_menu(&handles, &snapshot);
                }
            }
            Event::UserEvent(UserEvent::Menu(event)) => {
                let id = event.id.as_ref();
                if let Some(action) = action_for_menu_id(id) {
                    let result = if action == TrayAction::About {
                        show_about_panel().map(|()| String::new())
                    } else {
                        runtime.block_on(run_tray_action(paths.clone(), overrides.clone(), action))
                    };
                    match result {
                        Ok(output) if !output.trim().is_empty() => eprint!("{output}"),
                        Ok(_) => {}
                        Err(error) => eprintln!("Autohand Squad tray action failed: {error:#}"),
                    }
                    if action == TrayAction::Quit {
                        *control_flow = ControlFlow::Exit;
                        return;
                    }
                    if let Ok(snapshot) =
                        runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))
                    {
                        refresh_menu(&handles, &snapshot);
                    }
                }
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "macos")]
fn configure_menu_bar_app<T>(event_loop: &mut tao::event_loop::EventLoop<T>) {
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
    event_loop.set_dock_visibility(false);
    event_loop.set_activate_ignoring_other_apps(false);
}

#[cfg(not(target_os = "macos"))]
fn configure_menu_bar_app<T>(_event_loop: &mut tao::event_loop::EventLoop<T>) {}

fn build_menu(snapshot: &TraySnapshot) -> Result<(Menu, MenuHandles)> {
    let menu = Menu::new();
    let status = disabled_item(summary_line("Status", &snapshot.summary.status));
    let version = disabled_item(summary_line("Version", &snapshot.summary.version));
    let account = disabled_item(summary_line("Account", &snapshot.summary.logged_in_account));
    let plan = disabled_item(summary_line("Plan", &snapshot.summary.plan_state));
    let online_members = disabled_item(count_line(
        "Online members",
        snapshot.summary.online_members,
    ));
    let working_agents = disabled_item(count_line(
        "Working agents",
        snapshot.summary.working_agents,
    ));
    let queued_jobs = disabled_item(count_line("Queued jobs", snapshot.summary.queued_jobs));
    let scheduled_jobs = disabled_item(count_line(
        "Scheduled jobs",
        snapshot.summary.scheduled_jobs,
    ));

    let open = action_item("open", "Open Autohand Squad", true);
    let update = action_item("update", "Update Autohand Squad", snapshot.daemon_running);
    let login = action_item("login", "Login / Re-login", true);
    let logout = action_item("logout", "Logout", snapshot.daemon_running);
    let start = action_item("start", "Start Service", !snapshot.daemon_running);
    let stop = action_item("stop", "Stop Service", snapshot.daemon_running);
    let restart = action_item("restart", "Restart Service", snapshot.daemon_running);
    let queue = action_item("queue", "Open Queue", snapshot.daemon_running);
    let launch_at_login = CheckMenuItem::with_id(
        "launch-at-login",
        "Launch at Login",
        snapshot.daemon_running,
        launch_checked(snapshot),
        None,
    );
    let about = action_item("about", "About", true);
    let quit = action_item("quit", "Quit", true);

    menu.append_items(&[
        &status,
        &version,
        &account,
        &plan,
        &online_members,
        &working_agents,
        &queued_jobs,
        &scheduled_jobs,
        &PredefinedMenuItem::separator(),
        &open,
        &update,
        &login,
        &logout,
        &PredefinedMenuItem::separator(),
        &start,
        &stop,
        &restart,
        &queue,
        &launch_at_login,
        &PredefinedMenuItem::separator(),
        &about,
        &quit,
    ])
    .context("build tray menu")?;

    Ok((
        menu,
        MenuHandles {
            status,
            version,
            account,
            plan,
            online_members,
            working_agents,
            queued_jobs,
            scheduled_jobs,
            start,
            stop,
            restart,
            update,
            logout,
            queue,
            launch_at_login,
        },
    ))
}

fn refresh_menu(handles: &MenuHandles, snapshot: &TraySnapshot) {
    handles
        .status
        .set_text(summary_line("Status", &snapshot.summary.status));
    handles
        .version
        .set_text(summary_line("Version", &snapshot.summary.version));
    handles
        .account
        .set_text(summary_line("Account", &snapshot.summary.logged_in_account));
    handles
        .plan
        .set_text(summary_line("Plan", &snapshot.summary.plan_state));
    handles.online_members.set_text(count_line(
        "Online members",
        snapshot.summary.online_members,
    ));
    handles.working_agents.set_text(count_line(
        "Working agents",
        snapshot.summary.working_agents,
    ));
    handles
        .queued_jobs
        .set_text(count_line("Queued jobs", snapshot.summary.queued_jobs));
    handles.scheduled_jobs.set_text(count_line(
        "Scheduled jobs",
        snapshot.summary.scheduled_jobs,
    ));
    handles.start.set_enabled(!snapshot.daemon_running);
    handles.stop.set_enabled(snapshot.daemon_running);
    handles.restart.set_enabled(snapshot.daemon_running);
    handles.update.set_enabled(snapshot.daemon_running);
    handles.logout.set_enabled(snapshot.daemon_running);
    handles.queue.set_enabled(snapshot.daemon_running);
    handles.launch_at_login.set_enabled(snapshot.daemon_running);
    handles
        .launch_at_login
        .set_checked(launch_checked(snapshot));
}

fn action_for_menu_id(id: &str) -> Option<TrayAction> {
    match id {
        "open" => Some(TrayAction::OpenSquad),
        "update" => Some(TrayAction::UpdateSquad),
        "login" => Some(TrayAction::Login),
        "logout" => Some(TrayAction::Logout),
        "start" => Some(TrayAction::StartService),
        "stop" => Some(TrayAction::StopService),
        "restart" => Some(TrayAction::RestartService),
        "queue" => Some(TrayAction::OpenQueue),
        "launch-at-login" => Some(TrayAction::LaunchAtLogin),
        "about" => Some(TrayAction::About),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

fn action_item(id: &str, label: &str, enabled: bool) -> MenuItem {
    MenuItem::with_id(id, label, enabled, None)
}

fn disabled_item(label: String) -> MenuItem {
    MenuItem::new(label, false, None)
}

#[cfg(target_os = "macos")]
fn show_about_panel() -> Result<()> {
    let mtm = MainThreadMarker::new().context("show About panel on main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    let icon_data = NSData::with_bytes(include_bytes!("../../public/icon-512.png"));
    let icon = NSImage::initWithData(NSImage::alloc(), &icon_data)
        .context("create About panel app icon")?;
    let credits = NSAttributedString::from_nsstring(&NSString::from_str(&about_credits()));

    let keys = vec![
        unsafe { NSAboutPanelOptionApplicationName },
        unsafe { NSAboutPanelOptionApplicationVersion },
        unsafe { NSAboutPanelOptionVersion },
        ns_string!("Copyright"),
        unsafe { NSAboutPanelOptionApplicationIcon },
        unsafe { NSAboutPanelOptionCredits },
    ];
    let objects: Vec<Retained<AnyObject>> = vec![
        Retained::into_super(Retained::into_super(NSString::from_str("Autohand Squad"))),
        Retained::into_super(Retained::into_super(NSString::from_str(env!(
            "CARGO_PKG_VERSION"
        )))),
        Retained::into_super(Retained::into_super(NSString::from_str(
            "Autohand Code Squad",
        ))),
        Retained::into_super(Retained::into_super(NSString::from_str(about_copyright()))),
        Retained::into_super(Retained::into_super(icon)),
        Retained::into_super(Retained::into_super(credits)),
    ];
    let options = NSDictionary::from_retained_objects(&keys, &objects);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    unsafe {
        app.orderFrontStandardAboutPanelWithOptions(&options);
    }
    eprintln!("Autohand Squad About panel requested");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn show_about_panel() -> Result<()> {
    Ok(())
}

fn about_credits() -> String {
    format!(
        "Local-first desktop controller for Autohand Code Squad.\n\n{}\n\nhttps://autohand.ai/code/squad/",
        about_copyright()
    )
}

fn about_copyright() -> &'static str {
    "Copyright (c) 2026 Autohand AI LLC. All rights reserved."
}

fn launch_checked(snapshot: &TraySnapshot) -> bool {
    snapshot
        .menu
        .iter()
        .find(|item| item.id == "launch-at-login")
        .and_then(|item| item.checked)
        .unwrap_or(false)
}

fn summary_line(label: &str, value: &str) -> String {
    format!("{label}: {value}")
}

fn count_line(label: &str, value: usize) -> String {
    format!("{label}: {value}")
}

fn tray_icon() -> Result<Icon> {
    let icon = if tray_icon_is_template() {
        macos_template_tray_icon()?
    } else {
        product_tray_icon()?
    };
    Icon::from_rgba(icon.rgba, icon.width, icon.height).context("create tray icon image")
}

fn tray_icon_is_template() -> bool {
    cfg!(target_os = "macos")
}

struct DecodedIcon {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

fn product_tray_icon() -> Result<DecodedIcon> {
    let bytes = include_bytes!("../../public/icon-512.png");
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info().context("read tray icon PNG")?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buffer)
        .context("decode tray icon PNG")?;
    let bytes = &buffer[..info.buffer_size()];
    let (rgba, width, height) = match info.color_type {
        png::ColorType::Rgba => (bytes.to_vec(), info.width, info.height),
        png::ColorType::Rgb => (
            bytes
                .chunks_exact(3)
                .flat_map(|chunk| [chunk[0], chunk[1], chunk[2], 255])
                .collect(),
            info.width,
            info.height,
        ),
        png::ColorType::Grayscale => (
            bytes
                .iter()
                .flat_map(|value| [*value, *value, *value, 255])
                .collect(),
            info.width,
            info.height,
        ),
        png::ColorType::GrayscaleAlpha => (
            bytes
                .chunks_exact(2)
                .flat_map(|chunk| [chunk[0], chunk[0], chunk[0], chunk[1]])
                .collect(),
            info.width,
            info.height,
        ),
        png::ColorType::Indexed => {
            let size = fallback_tray_icon_size();
            (fallback_tray_icon_rgba(), size, size)
        }
    };
    Ok(DecodedIcon {
        rgba,
        width,
        height,
    })
}

fn macos_template_tray_icon() -> Result<DecodedIcon> {
    let source = product_tray_icon()?;
    let mut rgba = Vec::with_capacity(source.rgba.len());
    for pixel in source.rgba.chunks_exact(4) {
        let luma =
            ((pixel[0] as u32 * 299) + (pixel[1] as u32 * 587) + (pixel[2] as u32 * 114)) / 1000;
        let shape_alpha = if luma <= 12 {
            0
        } else {
            (((luma - 12) * 255) / 243).min(255) as u8
        };
        let alpha = ((shape_alpha as u16 * pixel[3] as u16) / 255) as u8;
        rgba.extend_from_slice(&[0, 0, 0, alpha]);
    }
    Ok(DecodedIcon {
        rgba,
        width: source.width,
        height: source.height,
    })
}

fn fallback_tray_icon_size() -> u32 {
    18
}

fn fallback_tray_icon_rgba() -> Vec<u8> {
    let size = fallback_tray_icon_size();
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let dx = x as i32 - 8;
            let dy = y as i32 - 8;
            let inside = dx * dx + dy * dy <= 64;
            let core = x >= 5 && x <= 12 && y >= 5 && y <= 12;
            if inside && core {
                rgba.extend_from_slice(&[33, 150, 243, 255]);
            } else if inside {
                rgba.extend_from_slice(&[12, 20, 32, 255]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    rgba
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_menu_ids_to_tray_actions() {
        assert_eq!(action_for_menu_id("open"), Some(TrayAction::OpenSquad));
        assert_eq!(
            action_for_menu_id("restart"),
            Some(TrayAction::RestartService)
        );
        assert_eq!(action_for_menu_id("quit"), Some(TrayAction::Quit));
        assert_eq!(action_for_menu_id("missing"), None);
    }

    #[test]
    fn macos_template_icon_uses_transparency_mask_not_opaque_square() {
        let icon = macos_template_tray_icon().unwrap();
        assert_eq!(icon.width, 512);
        assert_eq!(icon.height, 512);
        let alpha_values = icon.rgba.chunks_exact(4).map(|pixel| pixel[3]);
        assert!(alpha_values.clone().any(|alpha| alpha == 0));
        assert!(alpha_values.clone().any(|alpha| alpha > 240));
        assert!(icon
            .rgba
            .chunks_exact(4)
            .all(|pixel| pixel[0] == 0 && pixel[1] == 0 && pixel[2] == 0));
    }

    #[test]
    fn about_copy_contains_product_legal_and_squad_link() {
        let credits = about_credits();
        assert!(credits.contains("Autohand Code Squad"));
        assert!(credits.contains("Autohand AI LLC"));
        assert!(credits.contains("https://autohand.ai/code/squad/"));
    }
}
