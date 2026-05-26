use crate::cli::{local_json_request, run_squad_command_with_paths, SquadCli, SquadCommand};
use crate::config::{resolve_config, ConfigOverrides, PartialSquadConfig, SquadConfig};
use crate::daemon::{LifecycleResponse, StatusResponse, UpdateSnapshot};
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
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
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
        TrayAction::Login => {
            let url = join_url(&resolved_open_url(&paths, &config), "login?source=squad-tray");
            open_url(&url)?;
            Ok(format!("Opened {url}\n"))
        }
        TrayAction::Logout => {
            let response =
                local_json_request::<LifecycleResponse>(&config, "POST", "/auth/logout", Some(""))?;
            Ok(format!("{}\n", response.message))
        }
        TrayAction::StartService => {
            let output =
                run_squad_command_with_paths(squad_args(SquadCommand::Start, &overrides), paths)
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
            let output =
                run_squad_command_with_paths(squad_args(SquadCommand::Restart, &overrides), paths)
                    .await?;
            Ok(output.stdout + &output.stderr)
        }
        TrayAction::OpenQueue => {
            let url = join_url(&resolved_open_url(&paths, &config), "queue");
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
        TrayAction::About => {
            Ok(format!(
                "Autohand Squad\nVersion: {}\nCopyright (c) 2026 Autohand AI LLC. All rights reserved.\nhttps://autohand.ai/code/squad/\n",
                status
                    .as_ref()
                    .map(|status| status.version.as_str())
                    .unwrap_or(env!("CARGO_PKG_VERSION"))
            ))
        }
        TrayAction::Quit => Ok("Autohand Squad tray quitting; daemon stays running.\n".to_string()),
    }
}

pub fn build_tray_snapshot(
    config: &SquadConfig,
    status: Option<&StatusResponse>,
    platform: PlatformController,
) -> TraySnapshot {
    let daemon_running = status.is_some();
    let summary = TraySummary {
        status: if daemon_running { "running" } else { "offline" }.to_string(),
        version: status
            .map(|status| status.version.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        logged_in_account: status
            .and_then(|status| status.account.email.clone())
            .or_else(|| config.account_email.clone())
            .unwrap_or_else(|| "not logged in".to_string()),
        plan_state: status
            .map(|status| status.account.plan_state.clone())
            .unwrap_or_else(|| config.plan_state.clone()),
        online_members: status.map(|status| status.online_members).unwrap_or(0),
        working_agents: status.map(|status| status.working_agents).unwrap_or(0),
        queued_jobs: status.map(|status| status.queued_jobs).unwrap_or(0),
        scheduled_jobs: status.map(|status| status.scheduled_jobs).unwrap_or(0),
        local_api_url: config.base_url(),
        open_url: config.open_url.clone(),
    };

    let menu = vec![
        item("open", "Open Autohand Squad", true, None),
        item("update", "Update Autohand Squad", daemon_running, None),
        item("login", "Login / Re-login", true, None),
        item("logout", "Logout", daemon_running, None),
        item("start", "Start Service", !daemon_running, None),
        item("stop", "Stop Service", daemon_running, None),
        item("restart", "Restart Service", daemon_running, None),
        item("queue", "Open Queue", daemon_running, None),
        item(
            "launch-at-login",
            "Launch at Login",
            daemon_running,
            Some(config.launch_at_login_policy == "forced"),
        ),
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
            };
        }
    }

    TrayRuntime {
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
        TrayAction::About => "about",
        TrayAction::Quit => "quit",
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
            account: AccountState {
                email: Some("ops@example.com".to_string()),
                plan_state: "enterprise".to_string(),
            },
            online_members: 4,
            working_agents: 2,
            queued_jobs: 3,
            scheduled_jobs: 1,
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
    fn menu_snapshot_contains_required_actions_on_each_os() {
        let config = SquadConfig {
            account_email: Some("ops@example.com".to_string()),
            plan_state: "enterprise".to_string(),
            launch_at_login_policy: "forced".to_string(),
            ..SquadConfig::defaults()
        };
        for os in ["macos", "windows", "linux"] {
            let snapshot =
                build_tray_snapshot(&config, Some(&status()), platform_controller_for(os, true));
            let labels = snapshot
                .menu
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>();

            for required in [
                "Open Autohand Squad",
                "Update Autohand Squad",
                "Login / Re-login",
                "Logout",
                "Start Service",
                "Stop Service",
                "Restart Service",
                "Open Queue",
                "Launch at Login",
                "About",
                "Quit",
            ] {
                assert!(labels.contains(&required), "{os} menu missing {required}");
            }
            assert_eq!(snapshot.summary.online_members, 4);
            assert_eq!(snapshot.summary.working_agents, 2);
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
        assert_eq!(snapshot.summary.status, "offline");
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
}
