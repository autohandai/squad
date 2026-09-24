//! Model for the desktop app's tray menu: account, plan usage, squad status,
//! members, and which actions apply. The Tauri shell maps this to native menu
//! items; everything here is plain data so it can be unit-tested and reused by
//! any other controller.

use crate::account_usage::{fetch_account_usage_blocking, now_unix, usage_line, AccountUsage};
use crate::cli::{fetch_status_blocking, stack_daemon_config, web_port_for};
use crate::config::{read_autohand_user_auth, resolve_config, ConfigOverrides, SquadConfig};
use crate::daemon::StatusResponse;
use crate::live_status::{read_live_status_snapshot, LiveStatusMember};
use crate::state::StatePaths;
use anyhow::Result;

/// The signed-in account, resolved the way the bridge resolves it: the Squad
/// session first, then the Autohand CLI session the user may have signed in
/// with directly.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AccountSession {
    pub token: Option<String>,
    pub email: Option<String>,
    pub name: Option<String>,
}

impl AccountSession {
    pub fn signed_in(&self) -> bool {
        self.token
            .as_deref()
            .is_some_and(|token| !token.trim().is_empty())
    }
}

pub fn account_session(config: &SquadConfig) -> AccountSession {
    let squad_token = config
        .api_auth_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string);
    let user = read_autohand_user_auth();
    AccountSession {
        email: config
            .account_email
            .clone()
            .filter(|email| !email.trim().is_empty())
            .or_else(|| user.email.clone()),
        name: user.name.clone(),
        token: squad_token.or(user.token),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMember {
    pub id: String,
    pub name: String,
    pub label: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DesktopTrayModel {
    pub signed_in: bool,
    /// "Signed in as …" or "Not signed in".
    pub account_label: String,
    /// Plan name, e.g. "Autohand Code Max"; None when usage is unknown.
    pub plan_label: Option<String>,
    /// One line per metered window (see `account_usage::usage_line`).
    pub usage_lines: Vec<String>,
    /// Why usage is missing, shown as one quiet line.
    pub usage_note: Option<String>,
    pub daemon_running: bool,
    pub launch_at_login: bool,
    /// "3 online · 1 working · 2 queued" while the squad is running.
    pub squad_line: Option<String>,
    pub members: Vec<TrayMember>,
}

/// Fetch fresh usage for the signed-in account, if there is one.
pub fn refresh_account_usage(config: &SquadConfig) -> Result<Option<AccountUsage>> {
    let session = account_session(config);
    let Some(token) = session.token.as_deref().filter(|_| session.signed_in()) else {
        return Ok(None);
    };
    fetch_account_usage_blocking(&config.api_base_url, token).map(Some)
}

/// Build the tray model from the local squad state and a cached usage
/// snapshot (fetched separately, on its own cadence).
pub fn load_desktop_tray_model(
    paths: &StatePaths,
    overrides: &ConfigOverrides,
    usage: Option<&AccountUsage>,
    usage_error: Option<&str>,
) -> DesktopTrayModel {
    let config = match resolve_config(paths, overrides.clone()) {
        Ok(config) => config,
        Err(_) => SquadConfig::defaults(),
    };
    // The resolved config addresses the web app; the daemon listens on its
    // own port, derived the same way `squad status` derives it.
    let daemon_config = stack_daemon_config(&config, Some(web_port_for(&config)));
    let status = fetch_status_blocking(&daemon_config).ok();
    let live = if status.is_none() {
        read_live_status_snapshot(paths)
    } else {
        None
    };
    let session = account_session(&config);
    build_model(
        &config,
        &session,
        status.as_ref(),
        live.as_ref().map(|snapshot| snapshot.members.as_slice()),
        usage,
        usage_error,
        now_unix(),
    )
}

pub fn build_model(
    config: &SquadConfig,
    session: &AccountSession,
    status: Option<&StatusResponse>,
    live_members: Option<&[LiveStatusMember]>,
    usage: Option<&AccountUsage>,
    usage_error: Option<&str>,
    now: u64,
) -> DesktopTrayModel {
    let daemon_email = status
        .and_then(|status| status.account.email.clone())
        .filter(|email| !email.trim().is_empty());
    let signed_in = session.signed_in() || daemon_email.is_some();
    let email = daemon_email.or_else(|| session.email.clone());
    let account_label = match (&signed_in, email) {
        (true, Some(email)) => format!("Signed in as {email}"),
        (true, None) => "Signed in".to_string(),
        (false, _) => "Not signed in".to_string(),
    };

    let (plan_label, usage_lines, usage_note) = match (signed_in, usage) {
        (false, _) => (None, Vec::new(), None),
        (true, Some(usage)) => {
            let lines = usage
                .windows()
                .into_iter()
                .map(|(label, window)| usage_line(label, window, now))
                .collect::<Vec<_>>();
            let note = if lines.is_empty() {
                Some("No metered usage windows on this plan".to_string())
            } else {
                None
            };
            (Some(usage.display_name.clone()), lines, note)
        }
        (true, None) => (
            None,
            Vec::new(),
            Some(match usage_error {
                Some(error) => format!("Usage unavailable: {}", first_line(error)),
                None => "Loading usage…".to_string(),
            }),
        ),
    };

    let daemon_running = status.is_some();
    let launch_at_login = status
        .map(|status| status.launch_at_login_policy.as_str())
        .unwrap_or(config.launch_at_login_policy.as_str())
        == "forced";
    let squad_line = status.map(|status| {
        format!(
            "{} online · {} working · {} queued",
            status.online_members, status.working_agents, status.queued_jobs
        )
    });
    let members = status
        .map(|status| status.members.as_slice())
        .or(live_members)
        .unwrap_or(&[])
        .iter()
        .filter(|member| !member.id.trim().is_empty() && !member.name.trim().is_empty())
        .map(|member| TrayMember {
            id: member.id.clone(),
            name: member.name.clone(),
            label: member_label(member),
        })
        .collect();

    DesktopTrayModel {
        signed_in,
        account_label,
        plan_label,
        usage_lines,
        usage_note,
        daemon_running,
        launch_at_login,
        squad_line,
        members,
    }
}

fn member_label(member: &LiveStatusMember) -> String {
    let state = if member.working {
        "working"
    } else {
        match member.status.trim() {
            "" => "idle",
            other => other,
        }
    };
    match member
        .role
        .as_deref()
        .map(str::trim)
        .filter(|role| !role.is_empty())
    {
        Some(role) => format!("{} · {role} · {state}", member.name),
        None => format!("{} · {state}", member.name),
    }
}

fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.len() > 72 {
        format!(
            "{}…",
            &line[..line
                .char_indices()
                .nth(72)
                .map(|(index, _)| index)
                .unwrap_or(line.len())]
        )
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account_usage::UsageWindow;

    fn usage() -> AccountUsage {
        AccountUsage {
            tier: "max".to_string(),
            display_name: "Autohand Code Max".to_string(),
            access_state: "ready".to_string(),
            window5h: UsageWindow {
                used: 22,
                remaining: Some(978),
                limit: Some(1000),
                reset_at: Some("2026-09-22T02:00:17Z".to_string()),
            },
            week: UsageWindow {
                used: 443,
                remaining: Some(9557),
                limit: Some(10000),
                reset_at: Some("2026-09-26T20:46:24Z".to_string()),
            },
            ..Default::default()
        }
    }

    #[test]
    fn cli_session_counts_as_signed_in_without_a_daemon() {
        let config = SquadConfig::defaults();
        let session = AccountSession {
            token: Some("tok".to_string()),
            email: Some("me@example.com".to_string()),
            name: None,
        };
        let now = crate::account_usage::parse_rfc3339_unix("2026-09-21T21:08:00Z").unwrap();
        let model = build_model(&config, &session, None, None, Some(&usage()), None, now);
        assert!(model.signed_in);
        assert_eq!(model.account_label, "Signed in as me@example.com");
        assert_eq!(model.plan_label.as_deref(), Some("Autohand Code Max"));
        assert_eq!(model.usage_lines.len(), 2);
        assert!(model.usage_lines[0].starts_with("5 h "));
        assert!(model.usage_lines[1].contains("resets in 4d 23h"));
        assert!(!model.daemon_running);
        assert!(model.squad_line.is_none());
    }

    #[test]
    fn signed_out_hides_usage_and_reports_state() {
        let config = SquadConfig::defaults();
        let model = build_model(
            &config,
            &AccountSession::default(),
            None,
            None,
            None,
            Some("boom"),
            0,
        );
        assert!(!model.signed_in);
        assert_eq!(model.account_label, "Not signed in");
        assert!(model.plan_label.is_none());
        assert!(model.usage_note.is_none());
    }

    #[test]
    fn usage_errors_become_one_quiet_line() {
        let config = SquadConfig::defaults();
        let session = AccountSession {
            token: Some("tok".to_string()),
            email: None,
            name: None,
        };
        let model = build_model(
            &config,
            &session,
            None,
            None,
            None,
            Some("HTTP 503\nmore"),
            0,
        );
        assert_eq!(model.account_label, "Signed in");
        assert_eq!(
            model.usage_note.as_deref(),
            Some("Usage unavailable: HTTP 503")
        );
    }

    #[test]
    fn members_come_from_live_status_when_the_daemon_is_down() {
        let config = SquadConfig::defaults();
        let members = vec![LiveStatusMember {
            id: "asq_1".to_string(),
            name: "Eva".to_string(),
            role: Some("Frontend".to_string()),
            status: "online".to_string(),
            working: true,
            queued_jobs: 0,
            scheduled_jobs: 0,
            last_activity_at: None,
        }];
        let model = build_model(
            &config,
            &AccountSession::default(),
            None,
            Some(&members),
            None,
            None,
            0,
        );
        assert_eq!(model.members.len(), 1);
        assert_eq!(model.members[0].label, "Eva · Frontend · working");
    }
}
