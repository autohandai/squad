//! Model for the desktop app's tray menu: account, plan usage, squad status,
//! members, and which actions apply. The Tauri shell enriches it with what
//! only the bridge knows (engines, needs-you items) and turns it into rows
//! with `menu::plan_menu`; everything here is plain data so it can be
//! unit-tested and reused by any other controller.

pub mod menu;

use crate::account_usage::{fetch_account_usage_blocking, parse_rfc3339_unix, AccountUsage};
use crate::cli::{local_json_request_for_context, stack_daemon_config, web_port_for};
use crate::config::{read_autohand_user_auth, resolve_config, ConfigOverrides, SquadConfig};
use crate::daemon::StatusResponse;
use crate::live_status::{read_fresh_live_status_snapshot, LiveStatusMember};
use crate::ownership::{read_active_context, still_current};
use crate::state::StatePaths;
use anyhow::Result;

/// The signed-in account, resolved the way the bridge resolves it: the Squad
/// shared Autohand CLI credential. Old Squad email/token fields are labels,
/// never a fallback identity after the shared credential changes.
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

pub fn account_session(_config: &SquadConfig) -> AccountSession {
    let user = read_autohand_user_auth();
    AccountSession {
        email: user.email,
        name: user.name.clone(),
        token: user.token,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrayMember {
    pub id: String,
    pub name: String,
    /// "Eva · Frontend · working": the tooltip of a member's own status item.
    pub label: String,
    pub status: String,
    pub working: bool,
    /// Title of the job the member is running now, when the squad reports one.
    pub task: Option<String>,
    pub queued: usize,
    /// Unix seconds of the member's last activity, for ordering rows.
    pub last_activity: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DesktopTrayModel {
    /// False for the placeholder model shown before the first read (and while
    /// an account switch is verified): the menu then says "connecting…".
    pub loaded: bool,
    pub signed_in: bool,
    pub email: Option<String>,
    /// The Autohand Code plan and its metered windows, once fetched.
    pub usage: Option<AccountUsage>,
    /// Why the plan usage could not be fetched (first line only).
    pub usage_error: Option<String>,
    pub daemon_running: bool,
    /// Unix seconds the daemon started, for "Running since …".
    pub running_since: Option<u64>,
    pub launch_at_login: bool,
    pub members: Vec<TrayMember>,
}

/// Fetch fresh usage for the signed-in account, if there is one.
pub fn refresh_account_usage(
    paths: &StatePaths,
    config: &SquadConfig,
) -> Result<Option<AccountUsage>> {
    let Some(context) = read_active_context(paths)? else {
        return Ok(None);
    };
    let session = account_session(config);
    let Some(token) = session.token.as_deref().filter(|_| session.signed_in()) else {
        return Ok(None);
    };
    use sha2::{Digest, Sha256};
    let fingerprint: String = Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let origin = reqwest::Url::parse(&config.api_base_url)?;
    let issuer = reqwest::Url::parse(&context.owner.issuer)?;
    if fingerprint != context.credential_fingerprint
        || origin.origin() != issuer.origin()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || !still_current(paths, &context)
    {
        return Ok(None);
    }
    let usage = fetch_account_usage_blocking(&config.api_base_url, token)?;
    Ok(still_current(paths, &context).then_some(usage))
}

/// Build the tray model from the local squad state and a cached usage
/// snapshot (fetched separately, on its own cadence).
pub fn load_desktop_tray_model(
    paths: &StatePaths,
    overrides: &ConfigOverrides,
    usage: Option<&AccountUsage>,
    usage_error: Option<&str>,
    usage_generation: Option<&str>,
) -> DesktopTrayModel {
    let config = match resolve_config(paths, overrides.clone()) {
        Ok(config) => config,
        Err(_) => SquadConfig::defaults(),
    };
    // The resolved config addresses the web app; the daemon listens on its
    // own port, derived the same way `squad status` derives it.
    let daemon_config = stack_daemon_config(&config, Some(web_port_for(&config)));
    let context = read_active_context(paths).ok().flatten();
    let status = context
        .as_ref()
        .and_then(|context| {
            local_json_request_for_context::<StatusResponse>(
                &daemon_config,
                context,
                "GET",
                "/status",
                None,
            )
            .ok()
        })
        .filter(|status| {
            context.as_ref().is_some_and(|context| {
                status
                    .ownership
                    .as_ref()
                    .is_some_and(|scope| scope.matches(context))
            })
        });
    let mut live = if status.is_none() {
        context
            .as_ref()
            .and_then(|context| read_fresh_live_status_snapshot(&context.data_paths))
    } else {
        None
    };
    let mut session = context
        .as_ref()
        .map(|_| account_session(&config))
        .unwrap_or_default();
    if let Some(context) = context.as_ref() {
        session.email = (!context.actor.email.is_empty()).then(|| context.actor.email.clone());
        if !context.can_write {
            if let Some(snapshot) = live.as_mut() {
                snapshot.active_work = 0;
                snapshot.online_members = 0;
                snapshot.working_agents = 0;
                snapshot.queue_depth = 0;
                snapshot.queued_jobs = 0;
                snapshot.scheduled_jobs = 0;
                snapshot.jobs.clear();
                snapshot.automations.clear();
                for member in &mut snapshot.members {
                    member.working = false;
                    member.status = "offline".to_string();
                    member.queued_jobs = 0;
                    member.scheduled_jobs = 0;
                }
            }
        }
    }
    let matching_usage = context
        .as_ref()
        .is_some_and(|context| usage_generation == Some(context.generation.as_str()));
    let model = build_model(
        &config,
        &session,
        status.as_ref(),
        live.as_ref().map(|snapshot| snapshot.members.as_slice()),
        usage.filter(|_| matching_usage),
        usage_error.filter(|_| matching_usage),
    );
    if context
        .as_ref()
        .is_some_and(|context| !still_current(paths, context))
    {
        return build_model(&config, &AccountSession::default(), None, None, None, None);
    }
    model
}

pub fn build_model(
    config: &SquadConfig,
    session: &AccountSession,
    status: Option<&StatusResponse>,
    live_members: Option<&[LiveStatusMember]>,
    usage: Option<&AccountUsage>,
    usage_error: Option<&str>,
) -> DesktopTrayModel {
    let daemon_email = status
        .and_then(|status| status.account.email.clone())
        .filter(|email| !email.trim().is_empty());
    let signed_in = session.signed_in() || daemon_email.is_some();
    let email = daemon_email.or_else(|| session.email.clone());
    let (usage, usage_error) = if signed_in {
        (
            usage.cloned(),
            usage
                .is_none()
                .then(|| usage_error.map(first_line))
                .flatten(),
        )
    } else {
        (None, None)
    };

    let daemon_running = status.is_some();
    let running_since = status
        .and_then(|status| status.daemon.as_ref())
        .and_then(|daemon| parse_rfc3339_unix(&daemon.started_at));
    let launch_at_login = status
        .map(|status| status.launch_at_login_policy.as_str())
        .unwrap_or(config.launch_at_login_policy.as_str())
        == "forced";
    let jobs = status.map(|status| status.jobs.as_slice()).unwrap_or(&[]);
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
            status: member.status.clone(),
            working: member.working,
            task: member
                .working
                .then(|| {
                    jobs.iter()
                        .filter(|job| job.agent_id.as_deref() == Some(member.id.as_str()))
                        .filter(|job| {
                            matches!(
                                job.status.as_str(),
                                "running" | "launching" | "in-progress" | "in_progress" | "working"
                            )
                        })
                        .map(|job| job.title.trim().to_string())
                        .find(|title| !title.is_empty())
                })
                .flatten(),
            queued: member.queued_jobs,
            last_activity: member
                .last_activity_at
                .as_deref()
                .and_then(parse_rfc3339_unix),
        })
        .collect();

    DesktopTrayModel {
        loaded: true,
        signed_in,
        email,
        usage,
        usage_error,
        daemon_running,
        running_since,
        launch_at_login,
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

pub(crate) fn first_line(text: &str) -> String {
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
        let model = build_model(&config, &session, None, None, Some(&usage()), None);
        assert!(model.loaded);
        assert!(model.signed_in);
        assert_eq!(model.email.as_deref(), Some("me@example.com"));
        assert_eq!(
            model
                .usage
                .as_ref()
                .map(|usage| usage.display_name.as_str()),
            Some("Autohand Code Max")
        );
        assert!(!model.daemon_running);
        assert!(model.running_since.is_none());
    }

    #[test]
    fn signed_out_hides_usage_and_its_error() {
        let config = SquadConfig::defaults();
        let model = build_model(
            &config,
            &AccountSession::default(),
            None,
            None,
            Some(&usage()),
            Some("boom"),
        );
        assert!(!model.signed_in);
        assert!(model.usage.is_none());
        assert!(model.usage_error.is_none());
    }

    #[test]
    fn usage_errors_keep_only_their_first_line() {
        let config = SquadConfig::defaults();
        let session = AccountSession {
            token: Some("tok".to_string()),
            email: None,
            name: None,
        };
        let model = build_model(&config, &session, None, None, None, Some("HTTP 503\nmore"));
        assert_eq!(model.usage_error.as_deref(), Some("HTTP 503"));
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
            queued_jobs: 2,
            scheduled_jobs: 0,
            last_activity_at: Some("2026-09-21T21:08:00Z".to_string()),
        }];
        let model = build_model(
            &config,
            &AccountSession::default(),
            None,
            Some(&members),
            None,
            None,
        );
        assert_eq!(model.members.len(), 1);
        assert_eq!(model.members[0].label, "Eva · Frontend · working");
        assert_eq!(model.members[0].queued, 2);
        assert_eq!(model.members[0].task, None, "no daemon, no jobs");
        assert_eq!(
            model.members[0].last_activity,
            parse_rfc3339_unix("2026-09-21T21:08:00Z")
        );
    }
}
