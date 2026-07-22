use crate::config::ConfigOverrides;
use crate::state::{
    now_string, read_tray_record, remove_tray_record, write_tray_record, StatePaths, TrayRecord,
};
use crate::ui::{describe_tray, run_tray_action, run_tray_open_path, TrayAction, TraySnapshot};
use anyhow::{Context, Result};
use std::io::Cursor;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
#[cfg(target_os = "macos")]
use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
use tokio::runtime::Runtime;
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tray_icon::{Icon, TrayIconBuilder};

const REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const MACOS_TRAY_ICON_VISIBLE_FILL: f32 = 0.86;

enum UserEvent {
    Menu(MenuEvent),
}

pub fn run_native_tray(paths: StatePaths, overrides: ConfigOverrides) -> Result<()> {
    let runtime = Runtime::new().context("create tray async runtime")?;
    let first_snapshot = runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))?;
    if first_snapshot.platform.browser_fallback {
        let output = runtime.block_on(run_tray_action(paths, overrides, TrayAction::OpenSquad))?;
        print!("{output}");
        return Ok(());
    }
    if existing_native_tray_pid(&paths).is_some() {
        let output = runtime.block_on(run_tray_action(paths, overrides, TrayAction::OpenSquad))?;
        print!("{output}");
        return Ok(());
    }
    record_current_tray(&paths, &first_snapshot)?;

    let mut builder = EventLoopBuilder::<UserEvent>::with_user_event();
    let mut event_loop = builder.build();
    configure_menu_bar_app(&mut event_loop);
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Menu(event));
    }));

    let menu = build_menu(&first_snapshot)?;
    let mut auth_action = auth_action_for_snapshot(&first_snapshot);
    let mut tray_builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu.clone()))
        .with_tooltip("Autohand Squad")
        .with_icon(tray_icon()?)
        .with_icon_as_template(tray_icon_is_template());
    if !cfg!(target_os = "macos") {
        tray_builder = tray_builder.with_title("Autohand Squad");
    }
    let tray = tray_builder.build().context("create native tray icon")?;

    event_loop.run(move |event, _target, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + REFRESH_INTERVAL);

        match event {
            Event::NewEvents(StartCause::Init)
            | Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                if let Ok(snapshot) =
                    runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))
                {
                    auth_action = auth_action_for_snapshot(&snapshot);
                    if let Ok(menu) = build_menu(&snapshot) {
                        tray.set_menu(Some(Box::new(menu)));
                    }
                }
            }
            Event::UserEvent(UserEvent::Menu(event)) => {
                let id = event.id.as_ref();
                if let Some(path) = dynamic_path_for_menu_id(id) {
                    let result = runtime.block_on(run_tray_open_path(
                        paths.clone(),
                        overrides.clone(),
                        &path,
                    ));
                    match result {
                        Ok(output) if !output.trim().is_empty() => eprint!("{output}"),
                        Ok(_) => {}
                        Err(error) => eprintln!("Autohand Squad tray action failed: {error:#}"),
                    }
                    if let Ok(snapshot) =
                        runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))
                    {
                        auth_action = auth_action_for_snapshot(&snapshot);
                        if let Ok(menu) = build_menu(&snapshot) {
                            tray.set_menu(Some(Box::new(menu)));
                        }
                    }
                } else if let Some(action) = action_for_menu_id(id, auth_action) {
                    let result = if action == TrayAction::RestartService {
                        match confirm_restart_service(&runtime, paths.clone(), overrides.clone()) {
                            Ok(true) => runtime.block_on(run_tray_action(
                                paths.clone(),
                                overrides.clone(),
                                action,
                            )),
                            Ok(false) => Ok(String::new()),
                            Err(error) => Err(error),
                        }
                    } else {
                        runtime.block_on(run_tray_action(paths.clone(), overrides.clone(), action))
                    };
                    match result {
                        Ok(output) if !output.trim().is_empty() => eprint!("{output}"),
                        Ok(_) => {}
                        Err(error) => eprintln!("Autohand Squad tray action failed: {error:#}"),
                    }
                    if action == TrayAction::Quit {
                        let _ = remove_tray_record(&paths);
                        *control_flow = ControlFlow::Exit;
                        return;
                    }
                    if let Ok(snapshot) =
                        runtime.block_on(describe_tray(paths.clone(), overrides.clone(), None))
                    {
                        auth_action = auth_action_for_snapshot(&snapshot);
                        if let Ok(menu) = build_menu(&snapshot) {
                            tray.set_menu(Some(Box::new(menu)));
                        }
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

fn existing_native_tray_pid(paths: &StatePaths) -> Option<u32> {
    let current_pid = std::process::id();
    if let Ok(Some(record)) = read_tray_record(paths) {
        if record.pid != current_pid && process_is_running(record.pid) {
            return Some(record.pid);
        }
    }

    native_tray_pids()
        .into_iter()
        .find(|pid| *pid != current_pid)
}

fn record_current_tray(paths: &StatePaths, snapshot: &TraySnapshot) -> Result<()> {
    let (host, daemon_port) = url_host_port(&snapshot.summary.local_api_url)
        .unwrap_or_else(|| ("127.0.0.1".to_string(), 19821));
    write_tray_record(
        paths,
        &TrayRecord {
            pid: std::process::id(),
            host,
            daemon_port,
            open_url: snapshot.summary.open_url.clone(),
            started_at: now_string(),
        },
    )
}

fn native_tray_pids() -> Vec<u32> {
    #[cfg(target_family = "unix")]
    {
        Command::new("ps")
            .args(["-axo", "pid=,command="])
            .output()
            .ok()
            .map(|output| native_tray_pids_from_ps_output(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default()
    }

    #[cfg(not(target_family = "unix"))]
    {
        Vec::new()
    }
}

fn native_tray_pids_from_ps_output(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(parse_ps_pid_and_command)
        .filter(|(_, command)| is_native_tray_command(command))
        .map(|(pid, _)| pid)
        .collect()
}

fn parse_ps_pid_and_command(line: &str) -> Option<(u32, &str)> {
    let trimmed = line.trim_start();
    let split_at = trimmed.find(char::is_whitespace)?;
    let pid = trimmed[..split_at].parse::<u32>().ok()?;
    Some((pid, trimmed[split_at..].trim_start()))
}

fn is_native_tray_command(command: &str) -> bool {
    let command = command.replace("\\012", "\n");
    let launches_tray_binary = command.starts_with("autohand-squad-tray")
        || command.starts_with("autohand-squad-ui")
        || command.contains("/autohand-squad-tray")
        || command.contains("/autohand-squad-ui")
        || command.contains("\\autohand-squad-tray")
        || command.contains("\\autohand-squad-ui");
    launches_tray_binary && !command.contains("--action") && !command.contains("--describe")
}

fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(target_family = "unix")]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        false
    }
}

fn url_host_port(url: &str) -> Option<(String, u16)> {
    let after_scheme = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let authority = after_scheme.split('/').next().unwrap_or(after_scheme);
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = format!("[{}]", &rest[..end]);
        let port = rest[end + 1..].strip_prefix(':')?;
        (host, port.to_string())
    } else {
        let (host, port) = authority.rsplit_once(':')?;
        (host.to_string(), port.to_string())
    };
    Some((host, port.parse::<u16>().ok()?))
}

fn build_menu(snapshot: &TraySnapshot) -> Result<Menu> {
    let menu = Menu::new();
    let open = action_item("open", "Open Autohand Squad", true);
    let update = action_item("update", "Update Autohand Squad", snapshot.daemon_running);
    let auth = action_item("auth", auth_label(snapshot), auth_enabled(snapshot));
    let start = action_item("start", "Start Service", !snapshot.daemon_running);
    let stop = action_item("stop", "Stop Service", snapshot.daemon_running);
    let restart = action_item("restart", "Restart Service", snapshot.daemon_running);
    let queue = action_item("queue", "Open Queue", snapshot.daemon_running);
    let members = members_submenu(snapshot)?;
    let workflows = workflows_submenu(snapshot)?;
    let jobs = jobs_submenu(snapshot)?;
    let launch_at_login = CheckMenuItem::with_id(
        "launch-at-login",
        "Launch at Login",
        snapshot.daemon_running,
        launch_checked(snapshot),
        None,
    );
    let report_bug = action_item("report-bug", "Report Bug", true);
    let give_feedback = action_item("give-feedback", "Give Feedback", true);
    let settings = action_item("settings", "Settings", true);
    let about = action_item("about", "About", true);
    let quit = action_item("quit", "Quit", true);

    menu.append_items(&[
        &open,
        &update,
        &auth,
        &PredefinedMenuItem::separator(),
        &start,
        &stop,
        &restart,
        &queue,
        &members,
        &workflows,
        &jobs,
        &launch_at_login,
        &PredefinedMenuItem::separator(),
        &report_bug,
        &give_feedback,
        &settings,
        &about,
        &quit,
    ])
    .context("build tray menu")?;

    Ok(menu)
}

fn members_submenu(snapshot: &TraySnapshot) -> Result<Submenu> {
    let submenu = Submenu::with_id("members", "Online Members", snapshot.daemon_running);
    let members = snapshot
        .summary
        .members
        .iter()
        .filter(|member| member.status != "offline" && member.status != "disabled")
        .collect::<Vec<_>>();

    if members.is_empty() {
        let item = disabled_item("No online members reported".to_string());
        submenu.append(&item)?;
        return Ok(submenu);
    }

    for member in members.iter().take(12) {
        let suffix = if member.working {
            "working"
        } else {
            member.status.as_str()
        };
        let role = member.role.as_deref().unwrap_or("");
        let label = if role.is_empty() {
            format!("{} - {suffix}", short_label(&member.name, 34))
        } else {
            format!(
                "{} - {} - {suffix}",
                short_label(&member.name, 26),
                short_label(role, 18)
            )
        };
        let item = action_item(
            &format!("member:{}", path_segment(&member.id)),
            &label,
            snapshot.daemon_running,
        );
        submenu.append(&item)?;
    }

    if members.len() > 12 {
        let item = disabled_item(format!(
            "{} more members in Autohand Squad",
            members.len() - 12
        ));
        submenu.append(&item)?;
    }

    Ok(submenu)
}

fn workflows_submenu(snapshot: &TraySnapshot) -> Result<Submenu> {
    let submenu = Submenu::with_id("workflows", "Workflows", snapshot.daemon_running);
    let workflows = snapshot.summary.automations.iter().collect::<Vec<_>>();

    if workflows.is_empty() {
        let item = disabled_item("No workflows reported".to_string());
        submenu.append(&item)?;
        return Ok(submenu);
    }

    for workflow in workflows.iter().take(12) {
        let agent = workflow.agent_name.as_deref().unwrap_or("member");
        let label = format!(
            "{} - {}",
            short_label(&workflow.name, 30),
            short_label(agent, 20)
        );
        let item = action_item(
            &format!(
                "automation:{}:{}",
                path_segment(workflow.agent_id.as_deref().unwrap_or("")),
                path_segment(&workflow.id)
            ),
            &label,
            snapshot.daemon_running,
        );
        submenu.append(&item)?;
    }

    if workflows.len() > 12 {
        let item = disabled_item(format!(
            "{} more workflows in Autohand Squad",
            workflows.len() - 12
        ));
        submenu.append(&item)?;
    }

    Ok(submenu)
}

fn jobs_submenu(snapshot: &TraySnapshot) -> Result<Submenu> {
    let submenu = Submenu::with_id("jobs", "Jobs", snapshot.daemon_running);
    let jobs = snapshot.summary.jobs.iter().collect::<Vec<_>>();

    if jobs.is_empty() {
        let fallback = snapshot
            .summary
            .queued_jobs
            .saturating_add(snapshot.summary.scheduled_jobs);
        let label = if fallback == 0 {
            "No queued jobs reported".to_string()
        } else {
            format!("{fallback} queued or scheduled jobs")
        };
        let item = disabled_item(label);
        submenu.append(&item)?;
        return Ok(submenu);
    }

    for job in jobs.iter().take(12) {
        let agent = job.agent_name.as_deref().unwrap_or("unassigned");
        let label = format!(
            "{} - {} - {}",
            short_label(&job.title, 28),
            short_label(agent, 18),
            short_label(&job.status, 12)
        );
        let item = action_item(
            &format!("job:{}", path_segment(&job.id)),
            &label,
            snapshot.daemon_running,
        );
        submenu.append(&item)?;
    }

    if jobs.len() > 12 {
        let item = disabled_item(format!("{} more jobs in Mission Control", jobs.len() - 12));
        submenu.append(&item)?;
    }

    Ok(submenu)
}

fn action_for_menu_id(id: &str, auth_action: TrayAction) -> Option<TrayAction> {
    match id {
        "open" => Some(TrayAction::OpenSquad),
        "update" => Some(TrayAction::UpdateSquad),
        "auth" => Some(auth_action),
        "login" => Some(TrayAction::Login),
        "logout" => Some(TrayAction::Logout),
        "start" => Some(TrayAction::StartService),
        "stop" => Some(TrayAction::StopService),
        "restart" => Some(TrayAction::RestartService),
        "queue" => Some(TrayAction::OpenQueue),
        "launch-at-login" => Some(TrayAction::LaunchAtLogin),
        "report-bug" => Some(TrayAction::ReportBug),
        "give-feedback" => Some(TrayAction::GiveFeedback),
        "settings" => Some(TrayAction::Settings),
        "about" => Some(TrayAction::About),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

fn dynamic_path_for_menu_id(id: &str) -> Option<String> {
    if let Some(member_id) = id.strip_prefix("member:") {
        if member_id.is_empty() {
            return None;
        }
        return Some(format!("squad-members/{member_id}/home"));
    }

    if let Some(rest) = id.strip_prefix("automation:") {
        let (member_id, automation_id) = rest.split_once(':')?;
        if member_id.is_empty() || automation_id.is_empty() {
            return Some("mission-control".to_string());
        }
        return Some(format!(
            "squad-members/{member_id}/triggers/{automation_id}"
        ));
    }

    if id.strip_prefix("job:").is_some() {
        return Some("mission-control".to_string());
    }

    None
}

fn auth_action_for_snapshot(snapshot: &TraySnapshot) -> TrayAction {
    if snapshot.menu.iter().any(|item| item.id == "logout") {
        TrayAction::Logout
    } else {
        TrayAction::Login
    }
}

fn auth_label(snapshot: &TraySnapshot) -> &'static str {
    match auth_action_for_snapshot(snapshot) {
        TrayAction::Logout => "Logout",
        _ => "Login",
    }
}

fn auth_enabled(snapshot: &TraySnapshot) -> bool {
    match auth_action_for_snapshot(snapshot) {
        TrayAction::Logout => snapshot.daemon_running,
        _ => true,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RestartWorkWarning {
    running_sessions: usize,
    running_trigger_work: usize,
    working_agents: usize,
    queued_jobs: usize,
    scheduled_jobs: usize,
}

impl RestartWorkWarning {
    fn from_snapshot(snapshot: &TraySnapshot) -> Option<Self> {
        let summary = &snapshot.summary;
        let warning = Self {
            running_sessions: summary.running_sessions,
            running_trigger_work: summary.running_trigger_work,
            working_agents: summary.working_agents,
            queued_jobs: summary.queued_jobs,
            scheduled_jobs: summary.scheduled_jobs,
        };
        warning.has_work().then_some(warning)
    }

    fn has_work(&self) -> bool {
        self.running_sessions > 0
            || self.running_trigger_work > 0
            || self.working_agents > 0
            || self.queued_jobs > 0
            || self.scheduled_jobs > 0
    }

    fn title(&self) -> &'static str {
        "Restart service while work is running?"
    }

    fn message(&self) -> String {
        let mut lines = vec![
            "Restarting now may interrupt active sessions or trigger tasks.".to_string(),
            String::new(),
            format!("Running sessions: {}", self.running_sessions),
            format!("Running trigger work: {}", self.running_trigger_work),
        ];
        if self.working_agents > 0 {
            lines.push(format!("Agents working: {}", self.working_agents));
        }
        if self.queued_jobs > 0 {
            lines.push(format!("Queued jobs: {}", self.queued_jobs));
        }
        if self.scheduled_jobs > 0 {
            lines.push(format!("Scheduled trigger work: {}", self.scheduled_jobs));
        }
        lines.join("\n")
    }
}

fn confirm_restart_service(
    runtime: &Runtime,
    paths: StatePaths,
    overrides: ConfigOverrides,
) -> Result<bool> {
    let snapshot = runtime.block_on(describe_tray(paths, overrides, None))?;
    let Some(warning) = RestartWorkWarning::from_snapshot(&snapshot) else {
        return Ok(true);
    };

    confirm_restart_with_active_work(&warning)
}

#[cfg(target_os = "macos")]
fn confirm_restart_with_active_work(warning: &RestartWorkWarning) -> Result<bool> {
    let script = format!(
        "display alert {} message {} as warning buttons {{\"Cancel\", \"Restart Service\"}} default button \"Restart Service\" cancel button \"Cancel\"",
        apple_script_string_expr(warning.title()),
        apple_script_string_expr(&warning.message())
    );
    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .context("show restart warning")?;
    Ok(output.status.success())
}

#[cfg(target_os = "windows")]
fn confirm_restart_with_active_work(warning: &RestartWorkWarning) -> Result<bool> {
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
$result = [System.Windows.Forms.MessageBox]::Show(
  {message},
  {title},
  [System.Windows.Forms.MessageBoxButtons]::OKCancel,
  [System.Windows.Forms.MessageBoxIcon]::Warning
)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {{ exit 0 }}
exit 1
"#,
        title = powershell_single_quoted(warning.title()),
        message = powershell_single_quoted(&warning.message())
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .context("show restart warning")?;
    Ok(output.status.success())
}

#[cfg(target_os = "linux")]
fn confirm_restart_with_active_work(warning: &RestartWorkWarning) -> Result<bool> {
    for mut command in linux_restart_warning_commands(warning) {
        match command.output() {
            Ok(output) => return Ok(output.status.success()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error).context("show restart warning"),
        }
    }
    Ok(true)
}

#[cfg(target_os = "linux")]
fn linux_restart_warning_commands(warning: &RestartWorkWarning) -> Vec<Command> {
    let message = warning.message();
    let mut zenity = Command::new("zenity");
    zenity.args([
        "--question",
        "--title",
        warning.title(),
        "--text",
        &message,
        "--ok-label",
        "Restart Service",
        "--cancel-label",
        "Cancel",
        "--width",
        "420",
    ]);

    let mut kdialog = Command::new("kdialog");
    kdialog.args([
        "--title",
        warning.title(),
        "--warningcontinuecancel",
        &message,
    ]);

    vec![zenity, kdialog]
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn confirm_restart_with_active_work(_warning: &RestartWorkWarning) -> Result<bool> {
    Ok(true)
}

#[cfg(target_os = "macos")]
fn apple_script_string_expr(value: &str) -> String {
    value
        .split('\n')
        .map(apple_script_quoted_string)
        .collect::<Vec<_>>()
        .join(" & return & ")
}

#[cfg(target_os = "macos")]
fn apple_script_quoted_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "windows")]
fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn action_item(id: &str, label: &str, enabled: bool) -> MenuItem {
    MenuItem::with_id(id, label, enabled, None)
}

fn disabled_item(label: String) -> MenuItem {
    MenuItem::new(label, false, None)
}

fn short_label(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    format!("{}...", value.chars().take(keep).collect::<String>())
}

fn path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn launch_checked(snapshot: &TraySnapshot) -> bool {
    snapshot
        .menu
        .iter()
        .find(|item| item.id == "launch-at-login")
        .and_then(|item| item.checked)
        .unwrap_or(false)
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

#[derive(Clone, Copy)]
struct AlphaBounds {
    min_x: u32,
    min_y: u32,
    max_x: u32,
    max_y: u32,
}

impl AlphaBounds {
    fn width(self) -> u32 {
        self.max_x - self.min_x + 1
    }

    fn height(self) -> u32 {
        self.max_y - self.min_y + 1
    }
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
    Ok(normalize_template_icon_fill(DecodedIcon {
        rgba,
        width: source.width,
        height: source.height,
    }))
}

fn normalize_template_icon_fill(icon: DecodedIcon) -> DecodedIcon {
    let Some(bounds) = visible_alpha_bounds(&icon.rgba, icon.width, icon.height, 8) else {
        return icon;
    };
    let target_span = ((icon.width.min(icon.height) as f32) * MACOS_TRAY_ICON_VISIBLE_FILL)
        .round()
        .max(1.0) as u32;
    let source_span = bounds.width().max(bounds.height());
    if source_span >= target_span {
        return icon;
    }

    let scale = (target_span as f32 / bounds.width() as f32)
        .min(target_span as f32 / bounds.height() as f32);
    let target_width = ((bounds.width() as f32 * scale).round() as u32).clamp(1, icon.width);
    let target_height = ((bounds.height() as f32 * scale).round() as u32).clamp(1, icon.height);
    let left = (icon.width - target_width) / 2;
    let top = (icon.height - target_height) / 2;
    let mut rgba = vec![0; icon.rgba.len()];

    for target_y in 0..target_height {
        for target_x in 0..target_width {
            let source_x = bounds.min_x as f32
                + ((target_x as f32 + 0.5) * bounds.width() as f32 / target_width as f32)
                - 0.5;
            let source_y = bounds.min_y as f32
                + ((target_y as f32 + 0.5) * bounds.height() as f32 / target_height as f32)
                - 0.5;
            let alpha = sample_alpha(&icon.rgba, icon.width, icon.height, source_x, source_y);
            let index = (((top + target_y) * icon.width + (left + target_x)) * 4) as usize;
            rgba[index..index + 4].copy_from_slice(&[0, 0, 0, alpha]);
        }
    }

    DecodedIcon {
        rgba,
        width: icon.width,
        height: icon.height,
    }
}

fn visible_alpha_bounds(
    rgba: &[u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> Option<AlphaBounds> {
    let mut bounds: Option<AlphaBounds> = None;
    for y in 0..height {
        for x in 0..width {
            let alpha = rgba[((y * width + x) * 4 + 3) as usize];
            if alpha <= threshold {
                continue;
            }
            bounds = Some(match bounds {
                Some(current) => AlphaBounds {
                    min_x: current.min_x.min(x),
                    min_y: current.min_y.min(y),
                    max_x: current.max_x.max(x),
                    max_y: current.max_y.max(y),
                },
                None => AlphaBounds {
                    min_x: x,
                    min_y: y,
                    max_x: x,
                    max_y: y,
                },
            });
        }
    }
    bounds
}

fn sample_alpha(rgba: &[u8], width: u32, height: u32, x: f32, y: f32) -> u8 {
    let x = x.clamp(0.0, (width - 1) as f32);
    let y = y.clamp(0.0, (height - 1) as f32);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let x_weight = x - x0 as f32;
    let y_weight = y - y0 as f32;
    let alpha_at = |px: u32, py: u32| rgba[((py * width + px) * 4 + 3) as usize] as f32;
    let top = alpha_at(x0, y0) * (1.0 - x_weight) + alpha_at(x1, y0) * x_weight;
    let bottom = alpha_at(x0, y1) * (1.0 - x_weight) + alpha_at(x1, y1) * x_weight;
    (top * (1.0 - y_weight) + bottom * y_weight).round() as u8
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
        assert_eq!(
            action_for_menu_id("open", TrayAction::Login),
            Some(TrayAction::OpenSquad)
        );
        assert_eq!(
            action_for_menu_id("restart", TrayAction::Login),
            Some(TrayAction::RestartService)
        );
        assert_eq!(
            action_for_menu_id("auth", TrayAction::Login),
            Some(TrayAction::Login)
        );
        assert_eq!(
            action_for_menu_id("auth", TrayAction::Logout),
            Some(TrayAction::Logout)
        );
        assert_eq!(
            action_for_menu_id("settings", TrayAction::Login),
            Some(TrayAction::Settings)
        );
        assert_eq!(
            action_for_menu_id("report-bug", TrayAction::Login),
            Some(TrayAction::ReportBug)
        );
        assert_eq!(
            action_for_menu_id("give-feedback", TrayAction::Login),
            Some(TrayAction::GiveFeedback)
        );
        assert_eq!(
            action_for_menu_id("quit", TrayAction::Login),
            Some(TrayAction::Quit)
        );
        assert_eq!(action_for_menu_id("missing", TrayAction::Login), None);
    }

    #[test]
    fn maps_dynamic_menu_ids_to_deep_links() {
        assert_eq!(
            dynamic_path_for_menu_id("member:asq_1"),
            Some("squad-members/asq_1/home".to_string())
        );
        assert_eq!(
            dynamic_path_for_menu_id("automation:asq_1:auto_2"),
            Some("squad-members/asq_1/triggers/auto_2".to_string())
        );
        assert_eq!(
            dynamic_path_for_menu_id("job:run_1"),
            Some("mission-control".to_string())
        );
        assert_eq!(dynamic_path_for_menu_id("members"), None);
    }

    #[test]
    fn parses_native_tray_pids_from_process_list() {
        let output = "\
 111 /Users/me/.autohand/squad/bin/autohand-squad-tray --port 19822
 222 /Users/me/.autohand/squad/bin/autohand-squad-tray --action restart
 333 /Users/me/.autohand/squad/bin/autohand-squad-tray --describe
 444 /Users/me/.autohand/squad/bin/autohand-squad-ui
 555 /Users/me/.autohand/squad/bin/autohand-squad-daemon --port 19822
 666 cargo run --bin autohand-squad-tray
";
        assert_eq!(native_tray_pids_from_ps_output(output), vec![111, 444]);
    }

    #[test]
    fn parses_host_and_port_from_local_api_url() {
        assert_eq!(
            url_host_port("http://127.0.0.1:19822"),
            Some(("127.0.0.1".to_string(), 19822))
        );
        assert_eq!(
            url_host_port("http://[::1]:19822/status"),
            Some(("[::1]".to_string(), 19822))
        );
        assert_eq!(url_host_port("http://127.0.0.1"), None);
    }

    #[test]
    fn restart_warning_message_includes_active_work_counts() {
        let warning = RestartWorkWarning {
            running_sessions: 0,
            running_trigger_work: 1,
            working_agents: 2,
            queued_jobs: 3,
            scheduled_jobs: 4,
        };
        let message = warning.message();

        assert!(warning.has_work());
        assert!(message.contains("Running sessions: 0"));
        assert!(message.contains("Running trigger work: 1"));
        assert!(message.contains("Agents working: 2"));
        assert!(message.contains("Queued jobs: 3"));
        assert!(message.contains("Scheduled trigger work: 4"));
    }

    #[test]
    fn restart_warning_is_skipped_when_service_is_idle() {
        let warning = RestartWorkWarning {
            running_sessions: 0,
            running_trigger_work: 0,
            working_agents: 0,
            queued_jobs: 0,
            scheduled_jobs: 0,
        };

        assert!(!warning.has_work());
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
    fn macos_template_icon_fills_menu_bar_canvas() {
        let icon = macos_template_tray_icon().unwrap();
        let bounds = visible_alpha_bounds(&icon.rgba, icon.width, icon.height, 8).unwrap();

        assert!(bounds.width() >= 430);
        assert!(bounds.height() >= 410);
        assert!(bounds.width() < icon.width);
        assert!(bounds.height() < icon.height);
    }
}
