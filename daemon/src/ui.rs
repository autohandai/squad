use crate::auth::run_browser_device_login;
use crate::cli::{
    local_json_request, run_squad_command_with_paths, run_squad_service_command_with_paths,
    SquadCli, SquadCommand,
};
use crate::config::{
    resolve_config, write_autohand_auth_config, write_user_auth_config, ConfigOverrides,
    PartialSquadConfig, SquadConfig,
};
use crate::daemon::{LifecycleResponse, LoginRequest, StatusResponse, UpdateSnapshot};
use crate::live_status::{
    read_fresh_live_status_snapshot, LiveStatusAutomation, LiveStatusJob, LiveStatusMember,
    LiveStatusSnapshot,
};
use crate::state::{default_state_paths, read_daemon_record, read_tray_record, StatePaths};
use crate::telemetry::ui_event;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformController {
    pub os: String,
    pub integration: String,
    pub browser_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TraySummary {
    pub status: String,
    pub version: String,
    pub logged_in_account: String,
    pub plan_state: String,
    pub online_members: usize,
    pub working_agents: usize,
    pub running_sessions: usize,
    pub running_trigger_work: usize,
    pub progress: String,
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
    #[serde(default)]
    pub members: Vec<LiveStatusMember>,
    #[serde(default)]
    pub jobs: Vec<LiveStatusJob>,
    #[serde(default)]
    pub automations: Vec<LiveStatusAutomation>,
    pub local_api_url: String,
    pub open_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MenuItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub checked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TraySnapshot {
    pub binary: String,
    pub platform: PlatformController,
    pub daemon_running: bool,
    pub summary: TraySummary,
    pub menu: Vec<MenuItem>,
}

struct TrayRuntime {
    config: SquadConfig,
    status: Option<StatusResponse>,
    live_status: Option<LiveStatusSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    OpenSquad,
    UpdateSquad,
    Login,
    Logout,
    StartService,
    StopService,
    RestartService,
    OpenQueue,
    LaunchAtLogin,
    ReportBug,
    GiveFeedback,
    Settings,
    About,
    Quit,
}

impl TrayAction {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "open" | "open-squad" => Ok(Self::OpenSquad),
            "update" | "update-squad" => Ok(Self::UpdateSquad),
            "login" | "relogin" => Ok(Self::Login),
            "logout" => Ok(Self::Logout),
            "start" | "start-service" => Ok(Self::StartService),
            "stop" | "stop-service" => Ok(Self::StopService),
            "restart" | "restart-service" => Ok(Self::RestartService),
            "queue" | "open-queue" => Ok(Self::OpenQueue),
            "launch-at-login" => Ok(Self::LaunchAtLogin),
            "report-bug" | "bug" => Ok(Self::ReportBug),
            "give-feedback" | "feedback" => Ok(Self::GiveFeedback),
            "settings" | "open-settings" => Ok(Self::Settings),
            "about" => Ok(Self::About),
            "quit" => Ok(Self::Quit),
            other => Err(anyhow!("unknown tray action: {other}")),
        }
    }
}

pub async fn describe_tray(
    paths: StatePaths,
    overrides: ConfigOverrides,
    platform_override: Option<String>,
) -> Result<TraySnapshot> {
    let config = resolve_config(&paths, overrides)?;
    let runtime = tray_runtime(&paths, config);
    let os = platform_override.unwrap_or_else(current_os);
    Ok(build_tray_snapshot(
        &runtime.config,
        runtime.status.as_ref(),
        runtime.live_status.as_ref(),
        platform_controller_for(&os, linux_status_notifier_available()),
    ))
}

pub async fn run_tray_action(
    paths: StatePaths,
    overrides: ConfigOverrides,
    action: TrayAction,
) -> Result<String> {
    let config = resolve_config(&paths, overrides.clone())?;
    let runtime = tray_runtime(&paths, config);
    let config = runtime.config;
    let status = runtime.status;
    if let Some(status) = &status {
        let _ = local_json_request::<LifecycleResponse>(
            &config,
            "POST",
            "/telemetry",
            Some(&serde_json::to_string(&ui_event(
                format!("tray.{}", action_label(action)),
                Some(&status.device_id),
                None,
            ))?),
        );
    }

    match action {
        TrayAction::OpenSquad => {
            let url = resolved_open_url(&paths, &config);
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::UpdateSquad => {
            let update =
                local_json_request::<UpdateSnapshot>(&config, "POST", "/updates/check", Some(""))?;
            Ok(format!(
                "Update checked: current {}, latest {}, available {}\n",
                update.current_version,
                update
                    .latest_allowed_version
                    .unwrap_or_else(|| "unknown".to_string()),
                update.update_available
            ))
        }
        TrayAction::Login => run_tray_login(paths, overrides).await,
        TrayAction::Logout => {
            write_autohand_auth_config(None, None)?;
            write_user_auth_config(&paths, None, None)?;
            let message = match local_json_request::<LifecycleResponse>(
                &config,
                "POST",
                "/auth/logout",
                Some(""),
            ) {
                Ok(response) => response.message,
                Err(error) => {
                    format!("saved logout; local daemon state will refresh on restart ({error})")
                }
            };
            Ok(format!("{message}\n"))
        }
        TrayAction::StartService => {
            let output = run_squad_service_command_with_paths(
                squad_args(SquadCommand::Start, &overrides),
                paths,
            )
            .await?;
            Ok(output.stdout + &output.stderr)
        }
        TrayAction::StopService => {
            let output =
                run_squad_command_with_paths(squad_args(SquadCommand::Stop, &overrides), paths)
                    .await?;
            Ok(output.stdout + &output.stderr)
        }
        TrayAction::RestartService => {
            let output = run_squad_service_command_with_paths(
                squad_args(SquadCommand::Restart, &overrides),
                paths,
            )
            .await?;
            Ok(output.stdout + &output.stderr)
        }
        TrayAction::OpenQueue => {
            let url = join_url(&resolved_open_url(&paths, &config), "mission-control");
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::LaunchAtLogin => {
            let response = local_json_request::<LifecycleResponse>(
                &config,
                "POST",
                "/launch-at-login/toggle",
                Some(""),
            )?;
            Ok(format!("{}\n", response.message))
        }
        TrayAction::ReportBug => {
            let url = join_url(
                &resolved_open_url(&paths, &config),
                &feedback_route_for_paths(&paths, "bug"),
            );
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::GiveFeedback => {
            let url = join_url(
                &resolved_open_url(&paths, &config),
                &feedback_route_for_paths(&paths, "feedback"),
            );
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::Settings => {
            let url = join_url(&resolved_open_url(&paths, &config), "settings");
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::About => {
            let url = join_url(
                &resolved_open_url(&paths, &config),
                &about_route_for_paths(&paths),
            );
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::Quit => {
            let output =
                run_squad_command_with_paths(squad_args(SquadCommand::Stop, &overrides), paths)
                    .await?;
            Ok(format!(
                "{}Autohand Squad quit; local Squad services, member CLI processes, and leftover runtime processes stopped.\n",
                output.stdout + &output.stderr
            ))
        }
    }
}

pub async fn run_tray_login(paths: StatePaths, overrides: ConfigOverrides) -> Result<String> {
    let config = resolve_config(&paths, overrides)?;

    let login = run_browser_device_login(&config, "squad").await?;
    write_autohand_auth_config(Some(&login.token), Some(&login.email))?;
    write_user_auth_config(&paths, Some(&login.token), Some(&login.email))?;

    let body = serde_json::to_string(&LoginRequest {
        email: login.email.clone(),
    })?;
    let local_message = match local_json_request::<LifecycleResponse>(
        &config,
        "POST",
        "/auth/login",
        Some(&body),
    ) {
        Ok(response) => response.message,
        Err(error) => format!("saved login; local daemon state will refresh on restart ({error})"),
    };
    let app_url = resolved_open_url(&paths, &config);
    open_url(&app_url)?;
    Ok(format!("{local_message}. Opened {app_url}\n"))
}

pub async fn run_tray_open_path(
    paths: StatePaths,
    overrides: ConfigOverrides,
    path: &str,
) -> Result<String> {
    let config = resolve_config(&paths, overrides)?;
    let url = join_url(&resolved_open_url(&paths, &config), path);
    open_url(&url)?;
    Ok(format!("Opened {url}\n"))
}

pub fn build_tray_snapshot(
    config: &SquadConfig,
    status: Option<&StatusResponse>,
    live_status: Option<&LiveStatusSnapshot>,
    platform: PlatformController,
) -> TraySnapshot {
    let daemon_running = status.is_some();
    let live_status = status.is_none().then_some(live_status).flatten();
    let web_console_online = live_status.is_some_and(live_status_has_signal);
    let account_email = resolved_account_email(config, status);
    let logged_in = account_email.is_some();
    let running_trigger_work = status
        .map(|status| status.active_trigger_work)
        .or_else(|| live_status.map(|status| status.active_work))
        .unwrap_or(0);
    let running_sessions = status
        .map(|status| {
            status.running_sessions.max(
                status
                    .active_runs
                    .saturating_sub(status.active_trigger_work),
            )
        })
        .unwrap_or(0);
    let summary = TraySummary {
        status: if daemon_running {
            "running"
        } else if web_console_online {
            "online"
        } else {
            "offline"
        }
        .to_string(),
        version: status
            .map(|status| status.version.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        logged_in_account: account_email.unwrap_or_else(|| "not logged in".to_string()),
        plan_state: status
            .map(|status| status.account.plan_state.clone())
            .unwrap_or_else(|| config.plan_state.clone()),
        online_members: status
            .map(|status| status.online_members)
            .or_else(|| live_status.map(|status| status.online_members))
            .unwrap_or(0),
        working_agents: status
            .map(|status| status.working_agents)
            .or_else(|| live_status.map(|status| status.working_agents))
            .unwrap_or(0),
        running_sessions,
        running_trigger_work,
        progress: status
            .map(|status| progress_summary(status.active_runs, status.queued_jobs))
            .or_else(|| {
                live_status.map(|status| progress_summary(status.active_work, status.queued_jobs))
            })
            .unwrap_or_else(|| "no live work".to_string()),
        queued_jobs: status
            .map(|status| status.queued_jobs)
            .or_else(|| live_status.map(|status| status.queued_jobs))
            .unwrap_or(0),
        scheduled_jobs: status
            .map(|status| status.scheduled_jobs)
            .or_else(|| live_status.map(|status| status.scheduled_jobs))
            .unwrap_or(0),
        members: status
            .map(|status| status.members.clone())
            .or_else(|| live_status.map(|status| status.members.clone()))
            .unwrap_or_default(),
        jobs: status
            .map(|status| status.jobs.clone())
            .or_else(|| live_status.map(|status| status.jobs.clone()))
            .unwrap_or_default(),
        automations: status
            .map(|status| status.automations.clone())
            .or_else(|| live_status.map(|status| status.automations.clone()))
            .unwrap_or_default(),
        local_api_url: config.base_url(),
        open_url: config.open_url.clone(),
    };

    let menu = vec![
        item("open", "Open Autohand Squad", true, None),
        item("update", "Update Autohand Squad", daemon_running, None),
        auth_item(logged_in, daemon_running),
        item("start", "Start Service", !daemon_running, None),
        item("stop", "Stop Service", daemon_running, None),
        item("restart", "Restart Service", daemon_running, None),
        item("queue", "Open Queue", daemon_running, None),
        item("members", "Online Members", daemon_running, None),
        item("workflows", "Workflows", daemon_running, None),
        item("jobs", "Jobs", daemon_running, None),
        item(
            "launch-at-login",
            "Launch at Login",
            daemon_running,
            Some(config.launch_at_login_policy == "forced"),
        ),
        item("report-bug", "Report Bug", true, None),
        item("give-feedback", "Give Feedback", true, None),
        item("settings", "Settings", true, None),
        item("about", "About", true, None),
        item("quit", "Quit", true, None),
    ];

    TraySnapshot {
        binary: "autohand-squad-tray".to_string(),
        platform,
        daemon_running,
        summary,
        menu,
    }
}

pub fn platform_controller_for(os: &str, linux_status_notifier: bool) -> PlatformController {
    match os {
        "macos" | "darwin" => PlatformController {
            os: "macos".to_string(),
            integration: "menu-bar".to_string(),
            browser_fallback: false,
        },
        "windows" | "win32" => PlatformController {
            os: "windows".to_string(),
            integration: "system-tray".to_string(),
            browser_fallback: false,
        },
        "linux" if linux_status_notifier => PlatformController {
            os: "linux".to_string(),
            integration: "appindicator-statusnotifier".to_string(),
            browser_fallback: false,
        },
        "linux" => PlatformController {
            os: "linux".to_string(),
            integration: "browser-fallback".to_string(),
            browser_fallback: true,
        },
        other => PlatformController {
            os: other.to_string(),
            integration: "browser-fallback".to_string(),
            browser_fallback: true,
        },
    }
}

pub fn default_paths() -> StatePaths {
    default_state_paths()
}

fn squad_args(command: SquadCommand, overrides: &PartialSquadConfig) -> SquadCli {
    SquadCli {
        host: overrides.host.clone(),
        port: overrides.port,
        fixed_port: overrides.fixed_port,
        open_url: overrides.open_url.clone(),
        hosted_ui_url: overrides.hosted_ui_url.clone(),
        proxy_url: overrides.proxy_url.clone(),
        api_gateway_url: overrides.api_gateway_url.clone(),
        api_base_url: overrides.api_base_url.clone(),
        api_auth_token: overrides.api_auth_token.clone(),
        company_secret: overrides.company_secret.clone(),
        update_channel: overrides.update_channel.clone(),
        launch_at_login_policy: overrides.launch_at_login_policy.clone(),
        telemetry_policy: overrides.telemetry_policy.clone(),
        account_email: overrides.account_email.clone(),
        plan_state: overrides.plan_state.clone(),
        command: Some(command),
    }
}

fn tray_runtime(paths: &StatePaths, config: SquadConfig) -> TrayRuntime {
    if let Ok(status) = local_json_request::<StatusResponse>(&config, "GET", "/status", None) {
        return TrayRuntime {
            config,
            status: Some(status),
            live_status: None,
        };
    }

    if let Ok(Some(record)) = read_daemon_record(paths) {
        let mut recorded_config = config.clone();
        recorded_config.host = record.host;
        recorded_config.port = record.port;
        if let Ok(status) =
            local_json_request::<StatusResponse>(&recorded_config, "GET", "/status", None)
        {
            return TrayRuntime {
                config: recorded_config,
                status: Some(status),
                live_status: None,
            };
        }
    }

    TrayRuntime {
        live_status: read_fresh_live_status_snapshot(paths),
        config,
        status: None,
    }
}

fn resolved_open_url(paths: &StatePaths, config: &SquadConfig) -> String {
    read_tray_record(paths)
        .ok()
        .flatten()
        .map(|record| record.open_url)
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| config.open_url.clone())
}

fn item(id: &str, label: &str, enabled: bool, checked: Option<bool>) -> MenuItem {
    MenuItem {
        id: id.to_string(),
        label: label.to_string(),
        enabled,
        checked,
    }
}

fn auth_item(logged_in: bool, daemon_running: bool) -> MenuItem {
    if logged_in {
        item("logout", "Logout", daemon_running, None)
    } else {
        item("login", "Login", true, None)
    }
}

fn progress_summary(active_runs: usize, queued_jobs: usize) -> String {
    if active_runs == 0 && queued_jobs == 0 {
        return "no live work".to_string();
    }
    format!("{active_runs} active, {queued_jobs} queued")
}

fn live_status_has_signal(status: &LiveStatusSnapshot) -> bool {
    status.online_members > 0
        || status.working_agents > 0
        || status.active_work > 0
        || status.queued_jobs > 0
        || status.scheduled_jobs > 0
        || !status.members.is_empty()
        || !status.jobs.is_empty()
        || !status.automations.is_empty()
}

fn resolved_account_email(config: &SquadConfig, status: Option<&StatusResponse>) -> Option<String> {
    let email = match status {
        Some(status) => status.account.email.as_deref(),
        None => config.account_email.as_deref(),
    };
    email.and_then(|email| {
        let trimmed = email.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn action_label(action: TrayAction) -> &'static str {
    match action {
        TrayAction::OpenSquad => "open",
        TrayAction::UpdateSquad => "update",
        TrayAction::Login => "login",
        TrayAction::Logout => "logout",
        TrayAction::StartService => "start",
        TrayAction::StopService => "stop",
        TrayAction::RestartService => "restart",
        TrayAction::OpenQueue => "queue",
        TrayAction::LaunchAtLogin => "launch_at_login",
        TrayAction::ReportBug => "report_bug",
        TrayAction::GiveFeedback => "give_feedback",
        TrayAction::Settings => "settings",
        TrayAction::About => "about",
        TrayAction::Quit => "quit",
    }
}

fn feedback_route_for_paths(paths: &StatePaths, kind: &str) -> String {
    route_with_modal_query(paths, &[("feedback", kind)])
}

fn about_route_for_paths(paths: &StatePaths) -> String {
    route_with_modal_query(paths, &[("about", "squad")])
}

fn route_with_modal_query(paths: &StatePaths, pairs: &[(&str, &str)]) -> String {
    let route = read_fresh_live_status_snapshot(paths)
        .and_then(|status| status.current_route)
        .and_then(|route| clean_current_route(&route))
        .unwrap_or_else(|| "/mission-control".to_string());
    let mut route = strip_modal_query(&route);
    let separator = if route.contains('?') { '&' } else { '?' };
    let suffix = pairs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    route.push(separator);
    route.push_str(&suffix);
    route
}

fn clean_current_route(route: &str) -> Option<String> {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let after_scheme = trimmed
            .strip_prefix("http://")
            .or_else(|| trimmed.strip_prefix("https://"))?;
        let path_start = after_scheme.find('/').unwrap_or(after_scheme.len());
        let path = &after_scheme[path_start..];
        return clean_current_route(path);
    }
    if trimmed.starts_with('/') {
        Some(trimmed.to_string())
    } else {
        Some(format!("/{trimmed}"))
    }
}

fn strip_modal_query(route: &str) -> String {
    let (path, query) = route.split_once('?').unwrap_or((route, ""));
    if query.is_empty() {
        return path.to_string();
    }
    let kept = query
        .split('&')
        .filter(|part| {
            let key = part.split('=').next().unwrap_or("");
            key != "feedback" && key != "about"
        })
        .collect::<Vec<_>>();
    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn current_os() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else {
        "linux".to_string()
    }
}

fn linux_status_notifier_available() -> bool {
    std::env::var("AUTOHAND_SQUAD_LINUX_STATUS_NOTIFIER")
        .map(|value| {
            matches!(
                value.as_str(),
                "1" | "true" | "appindicator" | "statusnotifier"
            )
        })
        .unwrap_or(true)
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    command.spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::AccountState;
    use crate::state::{write_tray_record, TrayRecord};

    fn status() -> StatusResponse {
        StatusResponse {
            success: true,
            service: "autohand-squad-daemon".to_string(),
            version: "1.2.3".to_string(),
            url: "http://127.0.0.1:19821".to_string(),
            state_dir: "/tmp/squad".to_string(),
            device_id: "device-1".to_string(),
            accepting_work: true,
            queue_depth: 5,
            active_runs: 2,
            running_sessions: 2,
            active_trigger_work: 0,
            account: AccountState {
                email: Some("ops@example.com".to_string()),
                plan_state: "enterprise".to_string(),
            },
            online_members: 4,
            working_agents: 2,
            queued_jobs: 3,
            scheduled_jobs: 1,
            channels: 0,
            channel_threads: 0,
            members: Vec::new(),
            jobs: Vec::new(),
            automations: Vec::new(),
            launch_at_login_policy: "forced".to_string(),
            telemetry_policy: "local-buffered".to_string(),
            last_device_registration_at: None,
            last_ping_at: None,
            last_feature_flag_check_at: None,
            last_telemetry_flush_at: None,
            last_sync_at: None,
            last_update_check_at: None,
            daemon: None,
        }
    }

    #[test]
    fn settings_action_parses_common_ids() {
        assert_eq!(TrayAction::parse("settings").unwrap(), TrayAction::Settings);
        assert_eq!(
            TrayAction::parse("open-settings").unwrap(),
            TrayAction::Settings
        );
        assert_eq!(
            TrayAction::parse("report-bug").unwrap(),
            TrayAction::ReportBug
        );
        assert_eq!(
            TrayAction::parse("give-feedback").unwrap(),
            TrayAction::GiveFeedback
        );
    }

    #[test]
    fn menu_snapshot_contains_required_actions_on_each_os() {
        let config = SquadConfig {
            account_email: Some("ops@example.com".to_string()),
            plan_state: "enterprise".to_string(),
            launch_at_login_policy: "forced".to_string(),
            ..SquadConfig::defaults()
        };
        for os in ["macos", "windows", "linux"] {
            let snapshot = build_tray_snapshot(
                &config,
                Some(&status()),
                None,
                platform_controller_for(os, true),
            );
            let labels = snapshot
                .menu
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>();

            for required in [
                "Open Autohand Squad",
                "Update Autohand Squad",
                "Logout",
                "Start Service",
                "Stop Service",
                "Restart Service",
                "Open Queue",
                "Launch at Login",
                "Report Bug",
                "Give Feedback",
                "Settings",
                "About",
                "Quit",
            ] {
                assert!(labels.contains(&required), "{os} menu missing {required}");
            }
            assert!(
                !labels.contains(&"Login"),
                "{os} menu should not show Login for signed-in accounts"
            );
            let settings_position = labels
                .iter()
                .position(|label| *label == "Settings")
                .unwrap();
            let bug_position = labels
                .iter()
                .position(|label| *label == "Report Bug")
                .unwrap();
            let feedback_position = labels
                .iter()
                .position(|label| *label == "Give Feedback")
                .unwrap();
            let about_position = labels.iter().position(|label| *label == "About").unwrap();
            assert!(
                bug_position < settings_position && feedback_position < settings_position,
                "{os} menu should show feedback actions above Settings"
            );
            assert!(
                settings_position < about_position,
                "{os} menu should show Settings before About"
            );
            assert_eq!(snapshot.summary.online_members, 4);
            assert_eq!(snapshot.summary.working_agents, 2);
            assert_eq!(snapshot.summary.running_sessions, 2);
            assert_eq!(snapshot.summary.running_trigger_work, 0);
            assert_eq!(snapshot.summary.progress, "2 active, 3 queued");
            assert_eq!(snapshot.summary.queued_jobs, 3);
            assert_eq!(snapshot.summary.scheduled_jobs, 1);
        }
    }

    #[test]
    fn linux_uses_browser_fallback_without_status_notifier() {
        let controller = platform_controller_for("linux", false);
        assert_eq!(controller.integration, "browser-fallback");
        assert!(controller.browser_fallback);
    }

    #[test]
    fn offline_menu_keeps_start_enabled_and_service_actions_disabled() {
        let snapshot = build_tray_snapshot(
            &SquadConfig::defaults(),
            None,
            None,
            platform_controller_for("macos", true),
        );
        let enabled = |id: &str| {
            snapshot
                .menu
                .iter()
                .find(|item| item.id == id)
                .unwrap()
                .enabled
        };
        assert!(enabled("start"));
        assert!(!enabled("stop"));
        assert!(!enabled("restart"));
        assert!(enabled("login"));
        assert_eq!(snapshot.summary.status, "offline");
    }

    #[test]
    fn web_console_status_keeps_tray_summary_online_without_daemon() {
        let live_status = LiveStatusSnapshot {
            online_members: 5,
            working_agents: 2,
            active_work: 2,
            queued_jobs: 1,
            scheduled_jobs: 1,
            ..LiveStatusSnapshot::default()
        };
        let snapshot = build_tray_snapshot(
            &SquadConfig::defaults(),
            None,
            Some(&live_status),
            platform_controller_for("macos", true),
        );
        let enabled = |id: &str| {
            snapshot
                .menu
                .iter()
                .find(|item| item.id == id)
                .unwrap()
                .enabled
        };

        assert_eq!(snapshot.summary.status, "online");
        assert_eq!(snapshot.summary.online_members, 5);
        assert_eq!(snapshot.summary.working_agents, 2);
        assert_eq!(snapshot.summary.running_trigger_work, 2);
        assert_eq!(snapshot.summary.progress, "2 active, 1 queued");
        assert!(enabled("start"));
        assert!(!enabled("restart"));
    }

    #[test]
    fn menu_snapshot_shows_login_only_for_signed_out_accounts() {
        let mut signed_out_status = status();
        signed_out_status.account.email = None;
        let signed_out = build_tray_snapshot(
            &SquadConfig::defaults(),
            Some(&signed_out_status),
            None,
            platform_controller_for("macos", true),
        );
        let signed_out_labels = signed_out
            .menu
            .iter()
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>();
        assert!(signed_out_labels.contains(&"Login"));
        assert!(!signed_out_labels.contains(&"Logout"));
        assert_eq!(signed_out.summary.logged_in_account, "not logged in");

        let signed_in = build_tray_snapshot(
            &SquadConfig {
                account_email: Some("ops@example.com".to_string()),
                ..SquadConfig::defaults()
            },
            None,
            None,
            platform_controller_for("macos", true),
        );
        let signed_in_labels = signed_in
            .menu
            .iter()
            .map(|item| item.label.as_str())
            .collect::<Vec<_>>();
        assert!(signed_in_labels.contains(&"Logout"));
        assert!(!signed_in_labels.contains(&"Login"));
        assert_eq!(signed_in.summary.logged_in_account, "ops@example.com");
    }

    #[test]
    fn tray_open_url_prefers_saved_web_url_over_daemon_port() {
        let root = std::env::temp_dir().join(format!(
            "autohand-squad-tray-open-url-{}",
            crate::state::now_string().replace(':', "-")
        ));
        let paths = StatePaths::from_root(root.clone());
        let config = SquadConfig {
            port: 19822,
            open_url: "http://127.0.0.1:19822".to_string(),
            ..SquadConfig::defaults()
        };
        write_tray_record(
            &paths,
            &TrayRecord {
                pid: 1,
                host: "127.0.0.1".to_string(),
                daemon_port: 19822,
                open_url: "http://127.0.0.1:19821".to_string(),
                started_at: "test".to_string(),
            },
        )
        .unwrap();

        assert_eq!(resolved_open_url(&paths, &config), "http://127.0.0.1:19821");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn modal_routes_use_fresh_current_route_and_strip_existing_modal_params() {
        let root = std::env::temp_dir().join(format!(
            "autohand-squad-feedback-route-{}",
            crate::state::now_string().replace(':', "-")
        ));
        let paths = StatePaths::from_root(root.clone());
        paths.ensure().unwrap();
        std::fs::write(
            &paths.web_status_json,
            r#"{"source":"web-console","updatedAt":"test","currentRoute":"/squad-members/asq_1/home?tab=work&feedback=bug","onlineMembers":1}"#,
        )
        .unwrap();

        assert_eq!(
            feedback_route_for_paths(&paths, "feedback"),
            "/squad-members/asq_1/home?tab=work&feedback=feedback"
        );
        assert_eq!(
            about_route_for_paths(&paths),
            "/squad-members/asq_1/home?tab=work&about=squad"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
