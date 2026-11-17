//! What the menu-bar menu needs from the local bridge beyond the daemon's
//! status: what waits on the person, who is on a break, which engines each
//! member runs on (and whether a fallback answers now), and whether a paired
//! phone can reach this computer (ADR-0236).
//!
//! Every read is a GET to an endpoint the web app or Quick Chat already uses,
//! sent with the ownership context header like `quick_chat::open_quick_chat_picker`
//! and `quick_chat_preferences::fetch_usage`, so no new server work is needed.
//! A failed read leaves that part empty; the menu's words then fall back to
//! what the daemon knows.

use crate::quick_chat::{bridge_api_url, valid_member_id};
use autohand_squad_runtime::desktop_tray::menu::{MemberEngines, NeedsKind, NeedsYouItem};
use autohand_squad_runtime::ownership::OwnedContext;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

/// Engines change when a person edits a member or a limit trips; a minute is
/// fresh enough for the menu and keeps per-member reads off the 5 s tick.
const ENGINES_TTL: Duration = Duration::from_secs(60);
const MAX_MEMBERS: usize = 40;

#[derive(Default)]
pub(crate) struct TrayExtras {
    pub generation: Option<String>,
    pub needs: Vec<NeedsYouItem>,
    pub on_break: HashSet<String>,
    pub phone: Option<String>,
    pub engines: HashMap<String, MemberEngines>,
    pub engines_known: bool,
    engines_at: Option<Instant>,
    engines_for: Vec<String>,
}

fn client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()
}

fn get(
    client: &reqwest::blocking::Client,
    base: &str,
    context: &OwnedContext,
    path: &str,
) -> Option<Value> {
    use std::io::Read;
    let response = client
        .get(bridge_api_url(base, path).ok()?)
        .header("x-squad-context", &context.generation)
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    let mut bytes = Vec::new();
    response.take(1024 * 1024).read_to_end(&mut bytes).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    (value.get("success").and_then(Value::as_bool) == Some(true))
        .then(|| value.get("data").cloned())
        .flatten()
}

/// The new needs-you list. A read that failed keeps what the last read saw
/// of its kind: one slow answer from the bridge would otherwise take the row
/// and the attention dot away for five seconds and bring them back, a blink
/// with nothing behind it (ADR-0248). A read that succeeds, even empty, wins.
fn merge_needs(
    previous: &[NeedsYouItem],
    questions: Option<Vec<NeedsYouItem>>,
    approvals: Option<Vec<NeedsYouItem>>,
) -> Vec<NeedsYouItem> {
    let kept = |kind: NeedsKind| -> Vec<NeedsYouItem> {
        previous.iter().filter(|item| item.kind == kind).cloned().collect()
    };
    let mut needs = questions.unwrap_or_else(|| kept(NeedsKind::Question));
    needs.extend(approvals.unwrap_or_else(|| kept(NeedsKind::Approval)));
    needs
}

/// Refresh `extras` in place. Needs-you, breaks and the phone are read every
/// call; engines once a minute or when the roster changes.
pub(crate) fn refresh(extras: &mut TrayExtras, base: &str, context: &OwnedContext, members: &[String]) {
    if extras.generation.as_deref() != Some(context.generation.as_str()) {
        *extras = TrayExtras {
            generation: Some(context.generation.clone()),
            ..Default::default()
        };
    }
    let Some(client) = client() else {
        return;
    };
    let questions = get(&client, base, context, "/api/chat/questions")
        .map(|data| needs_items(&data, NeedsKind::Question));
    let approvals = get(&client, base, context, "/api/chat/permissions")
        .map(|data| needs_items(&data, NeedsKind::Approval));
    extras.needs = merge_needs(&extras.needs, questions, approvals);
    extras.on_break = get(&client, base, context, "/api/members/breaks")
        .map(|data| breaks(&data))
        .unwrap_or_default();
    extras.phone = get(&client, base, context, "/api/mobile/status").and_then(|data| phone_line(&data));

    let roster: Vec<String> = members
        .iter()
        .filter(|id| valid_member_id(id))
        .take(MAX_MEMBERS)
        .cloned()
        .collect();
    let stale = extras
        .engines_at
        .is_none_or(|at| at.elapsed() >= ENGINES_TTL)
        || extras.engines_for != roster;
    if stale {
        let now_ms = autohand_squad_runtime::account_usage::now_unix() * 1000;
        let mut engines = HashMap::new();
        let mut any = false;
        for id in &roster {
            let Some(profile) = get(&client, base, context, &format!("/api/control-plane/members/{id}"))
            else {
                continue;
            };
            any = true;
            let health = get(&client, base, context, &format!("/api/members/{id}/model-routing"))
                .and_then(|data| data.get("health").cloned())
                .unwrap_or(Value::Null);
            engines.insert(id.clone(), member_engines(&profile, &health, now_ms));
        }
        extras.engines = engines;
        extras.engines_known = any;
        extras.engines_at = Some(Instant::now());
        extras.engines_for = roster;
    }
}

fn needs_items(data: &Value, kind: NeedsKind) -> Vec<NeedsYouItem> {
    data.get("pending")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(20)
                .filter_map(|item| {
                    let member_id = item.get("agentId")?.as_str()?.to_string();
                    let subject = match kind {
                        NeedsKind::Question => item.get("question")?.as_str()?.to_string(),
                        NeedsKind::Approval => item
                            .get("description")
                            .and_then(Value::as_str)
                            .filter(|text| !text.trim().is_empty())
                            .or_else(|| item.get("tool").and_then(Value::as_str))?
                            .to_string(),
                    };
                    Some(NeedsYouItem {
                        member_id,
                        kind,
                        subject,
                        at: item
                            .get("createdAt")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn breaks(data: &Value) -> HashSet<String> {
    data.as_object()
        .map(|records| {
            records
                .iter()
                .filter(|(_, record)| record.get("onBreak").and_then(Value::as_bool) == Some(true))
                .map(|(id, _)| id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// `iPhone reachable on Wi‑Fi`, `… via relay`, `… on Wi‑Fi and via relay`,
/// or `… not reachable`; None when no phone is paired. The bridge reports
/// whether each route is up, which is what lets a phone reach this computer.
fn phone_line(data: &Value) -> Option<String> {
    let devices = data.get("devices")?.as_array()?;
    let newest = devices
        .iter()
        .max_by_key(|device| device.get("pairedAt").and_then(Value::as_str).unwrap_or(""))?;
    let name = newest
        .get("name")
        .and_then(Value::as_str)
        .map(|name| autohand_squad_runtime::desktop_tray::menu::cut(name, 24))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Phone".to_string());
    let who = if devices.len() > 1 {
        format!("{} phones", devices.len())
    } else {
        name
    };
    let connected = |kind: &str| {
        data.get("routes")
            .and_then(Value::as_array)
            .is_some_and(|routes| {
                routes.iter().any(|route| {
                    route.get("kind").and_then(Value::as_str) == Some(kind)
                        && route.get("connected").and_then(Value::as_bool) == Some(true)
                })
            })
    };
    let how = match (connected("local"), connected("relay") || connected("tunnel")) {
        (true, true) => "reachable on Wi\u{2011}Fi and via relay",
        (true, false) => "reachable on Wi\u{2011}Fi",
        (false, true) => "reachable via relay",
        (false, false) => "not reachable",
    };
    Some(format!("{who} {how}"))
}

/// The fallback router's key for a route (src/lib/model-routing.js `routeKey`).
fn route_parts(route: &Value) -> (String, String, String) {
    let harness = route.get("harness").unwrap_or(route);
    let text = |value: Option<&Value>| value.and_then(Value::as_str).unwrap_or("").to_string();
    (
        text(harness.get("id")),
        text(route.get("provider")),
        text(harness.get("model")),
    )
}

/// Primary, fallbacks, and which engine answers now, the way the chat header
/// reads it (`engineInUse`): a route is cooling down while its saved health
/// has `blockedUntil` in the future; the first fallback that is not answers.
fn member_engines(profile: &Value, health: &Value, now_ms: u64) -> MemberEngines {
    let primary = route_parts(profile.get("harness").unwrap_or(&Value::Null));
    let primary = (if primary.0.is_empty() { "autohand".to_string() } else { primary.0 }, primary.1, primary.2);
    let fallbacks: Vec<(String, String, String)> = profile
        .pointer("/modelRouting/fallbacks")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(route_parts).filter(|route| !route.0.is_empty()).collect())
        .unwrap_or_default();
    let blocked = |route: &(String, String, String)| -> Option<(u64, String)> {
        health.as_object()?.iter().find_map(|(key, entry)| {
            let parts: Vec<String> = serde_json::from_str(key).ok()?;
            let until = entry.get("blockedUntil").and_then(Value::as_f64)? as u64;
            (parts.len() == 4
                && parts[0] == route.0
                && parts[2] == route.1
                && parts[3] == route.2
                && until > now_ms)
                .then(|| {
                    (
                        until / 1000,
                        entry
                            .get("reason")
                            .and_then(Value::as_str)
                            .unwrap_or("runtime")
                            .to_string(),
                    )
                })
        })
    };
    let cooling = blocked(&primary);
    let fallback_in_use = cooling.as_ref().and_then(|_| {
        fallbacks
            .iter()
            .find(|route| blocked(route).is_none())
            .map(|route| route.0.clone())
    });
    MemberEngines {
        primary: primary.0.clone(),
        fallbacks: fallbacks.iter().map(|route| route.0.clone()).collect(),
        fallback_in_use,
        primary_back_at: cooling.as_ref().map(|(at, _)| *at),
        primary_reason: cooling.map(|(_, reason)| reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_failed_read_keeps_the_last_items_of_its_kind() {
        let item = |member: &str, kind| NeedsYouItem {
            member_id: member.into(),
            kind,
            subject: "s".into(),
            at: "2026-11-17T00:00:00Z".into(),
        };
        let before = vec![item("eva", NeedsKind::Question), item("noah", NeedsKind::Approval)];
        // Questions timed out, approvals answered with nothing: Eva's
        // question stays, Noah's approval was handled.
        let after = merge_needs(&before, None, Some(Vec::new()));
        assert_eq!(after, vec![item("eva", NeedsKind::Question)]);
        // Both answered: the bridge is the truth.
        assert!(merge_needs(&before, Some(Vec::new()), Some(Vec::new())).is_empty());
        // Neither answered: nothing changes.
        assert_eq!(merge_needs(&before, None, None), before);
    }

    #[test]
    fn engines_follow_the_router_health() {
        // Shapes read from the owner's bridge on 2026-11-17.
        let profile = json!({
            "harness": {"id": "autohand", "executablePath": "", "model": ""},
            "modelRouting": {"fallbacks": [
                {"harness": {"id": "claude", "model": "opus"}},
                {"harness": {"id": "autohand", "model": "moa"}, "provider": "autohandai"}
            ]}
        });
        let health = json!({"[\"autohand\",\"\",\"\",\"\"]": {"blockedUntil": 2_000_000_000_000u64, "reason": "quota"}});
        let engines = member_engines(&profile, &health, 1_900_000_000_000);
        assert_eq!(engines.primary, "autohand");
        assert_eq!(engines.fallbacks, vec!["claude", "autohand"]);
        assert_eq!(engines.fallback_in_use.as_deref(), Some("claude"));
        assert_eq!(engines.primary_back_at, Some(2_000_000_000));
        assert_eq!(engines.primary_reason.as_deref(), Some("quota"));
        let expired = member_engines(&profile, &health, 2_100_000_000_000);
        assert_eq!(expired.fallback_in_use, None);
        assert_eq!(expired.primary_reason, None);
    }

    #[test]
    fn needs_breaks_and_phone_read_the_bridge_shapes() {
        let questions = json!({"pending": [{"requestId": "q1", "agentId": "eva", "question": "Ship it?", "createdAt": "2026-11-17T01:00:00Z"}]});
        let approvals = json!({"pending": [{"requestId": "p1", "agentId": "noah", "tool": "git push", "description": "", "createdAt": "2026-11-17T01:01:00Z"}]});
        assert_eq!(needs_items(&questions, NeedsKind::Question)[0].subject, "Ship it?");
        assert_eq!(needs_items(&approvals, NeedsKind::Approval)[0].subject, "git push");
        let records = json!({"eva": {"onBreak": true}, "noah": {"onBreak": false}});
        assert_eq!(breaks(&records), ["eva".to_string()].into_iter().collect());
        let mobile = json!({
            "devices": [{"name": "iPhone", "pairedAt": "2026-11-15T21:23:05Z"}],
            "routes": [{"kind": "local", "connected": true}, {"kind": "relay", "connected": true}]
        });
        assert_eq!(phone_line(&mobile).as_deref(), Some("iPhone reachable on Wi\u{2011}Fi and via relay"));
        assert_eq!(phone_line(&json!({"devices": []})), None);
    }
}
