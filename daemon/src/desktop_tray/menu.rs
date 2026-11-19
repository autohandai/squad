//! The menu-bar menu as data: the squad first, what waits on the person
//! second, and engine limits only as the thing that might stop a member
//! (docs/design/menu-bar-menu.md, ADR-0236).
//!
//! `plan_menu` turns the tray model plus what the shell read from the bridge
//! into rows. Each row carries its words, an optional drawing (`Art`), and an
//! id the shell maps to an action. The words carry every state on their own,
//! so platforms that draw no images (Windows, Linux) show the same rows as
//! text, and VoiceOver reads the same sentence a sighted person sees.

use super::{DesktopTrayModel, TrayMember};
use crate::account_usage::{time_until, AccountUsage};
use std::collections::{HashMap, HashSet};

/// At most this many member rows at the top level; the rest are in
/// "All members ▸".
pub const TOP_MEMBERS: usize = 5;
/// Comb slots; with more members the seventh becomes the overflow mark.
pub const COMB_SLOTS: usize = 7;
const NEEDS_YOU_LIMIT: usize = 8;
const SUBJECT_CHARS: usize = 40;
const TASK_CHARS: usize = 32;
/// What VoiceOver may read of a question or task the row cuts short.
const SPOKEN_CHARS: usize = 160;

/// What a member is doing, as the menu groups it. Online and idle are both
/// Ready: in the menu both mean "can take work now".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Presence {
    NeedsYou,
    Working,
    Ready,
    Paused,
    Offline,
}

/// One hexagon of the comb, in member-row order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cell {
    NeedsYou,
    Working,
    Ready,
    Paused,
    Offline,
    Unknown,
    Overflow,
}

/// The small mark cut into the corner of a member's portrait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Badge {
    NeedsYou,
    Working,
    /// Working through a fallback engine: the working disc with a notch.
    Fallback,
    Ready,
    Paused,
    Offline,
}

/// The drawing beside a row. The shell draws these on macOS only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Art {
    Comb(Vec<Cell>),
    /// The headroom mark: percent *left*, or None when unknown or loading.
    Headroom(Option<u8>),
    Avatar {
        member_id: String,
        badge: Badge,
    },
    NeedsYou,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowKind {
    Item,
    Check(bool),
    Separator,
    Submenu(Vec<Row>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    pub text: String,
    pub art: Option<Art>,
    pub enabled: bool,
    /// Accelerator in muda's syntax, e.g. `CmdOrCtrl+Shift+K`.
    pub shortcut: Option<&'static str>,
    pub kind: RowKind,
    /// What VoiceOver reads when it differs from the words on screen beyond
    /// punctuation: the whole question or task a row cuts short, or the
    /// number a mark shows. None reads `spoken(text)`.
    pub speech: Option<String>,
    /// What choosing the row does, read by VoiceOver after a pause (AXHelp).
    pub help: Option<String>,
}

impl Row {
    fn item(id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            art: None,
            enabled: true,
            shortcut: None,
            kind: RowKind::Item,
            speech: None,
            help: None,
        }
    }
    fn label(id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            enabled: false,
            ..Self::item(id, text)
        }
    }
    fn separator() -> Self {
        Self {
            kind: RowKind::Separator,
            ..Self::item("", "")
        }
    }
    fn submenu(id: impl Into<String>, text: impl Into<String>, rows: Vec<Row>) -> Self {
        Self {
            kind: RowKind::Submenu(rows),
            ..Self::item(id, text)
        }
    }
    fn art(mut self, art: Art) -> Self {
        self.art = Some(art);
        self
    }
    fn shortcut(mut self, shortcut: &'static str) -> Self {
        self.shortcut = Some(shortcut);
        self
    }
    fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
    fn speech(mut self, speech: Option<String>) -> Self {
        self.speech = speech.filter(|speech| *speech != spoken(&self.text));
        self
    }
    fn help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }
    /// The row's accessibility title: the words on screen, read as a
    /// sentence, unless the row says more to VoiceOver than it shows.
    pub fn spoken_title(&self) -> String {
        self.speech.clone().unwrap_or_else(|| spoken(&self.text))
    }
}

/// Which engines a member runs on, from the bridge's saved profile and the
/// fallback router's health (`GET /api/control-plane/members/:id`,
/// `GET /api/members/:id/model-routing`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemberEngines {
    /// Metered engine id of the primary: `autohand`, `claude`, `codex`, or
    /// another id that has no limits Squad can read.
    pub primary: String,
    pub fallbacks: Vec<String>,
    /// While the primary is cooling down: the fallback that answers instead.
    pub fallback_in_use: Option<String>,
    /// Unix seconds the router retries the primary.
    pub primary_back_at: Option<u64>,
    /// Why the primary is cooling down (`quota`, `sign-in`, …).
    pub primary_reason: Option<String>,
}

impl MemberEngines {
    fn primary_blocked(&self) -> bool {
        self.primary_reason.is_some()
    }
    /// The primary is cooling down and no fallback can answer.
    fn stopped(&self) -> bool {
        self.primary_blocked() && self.fallback_in_use.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NeedsKind {
    Question,
    Approval,
}

/// Something a member is waiting on the person for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeedsYouItem {
    pub member_id: String,
    pub kind: NeedsKind,
    pub subject: String,
    /// RFC 3339; newest first.
    pub at: String,
}

/// One engine's metered windows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EngineUsage {
    /// `autohand`, `claude` or `codex`.
    pub id: String,
    /// The engine in a sentence: "Autohand Code", "Claude Code", "Codex".
    pub name: String,
    /// The submenu heading: the plan name for Autohand, else the engine name.
    pub heading: String,
    pub windows: Vec<EngineWindow>,
    /// Short reason the engine could not be read, if it could not.
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineWindow {
    /// "5-hour window", "Today", "This week", "This month", or the engine's own label.
    pub label: String,
    /// Percent left (100 − used); None when the window reports no ceiling.
    pub left: Option<u8>,
    pub resets_at: Option<u64>,
}

/// The local clock the shell reads once per build. `utc_offset` None means
/// local time is unknown (Windows); resets are then relative ("in 5d 8h").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Clock {
    pub now: u64,
    pub utc_offset: Option<i64>,
    pub hour12: bool,
}

impl Clock {
    /// The system clock, with the offset from the C library on Unix.
    pub fn system(hour12: bool) -> Self {
        let now = crate::account_usage::now_unix();
        Self {
            now,
            utc_offset: local_utc_offset(now),
            hour12,
        }
    }
}

#[cfg(unix)]
fn local_utc_offset(now: u64) -> Option<i64> {
    let time = libc::time_t::try_from(now).ok()?;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::localtime_r(&time, &mut tm) };
    (!result.is_null()).then_some(tm.tm_gmtoff as i64)
}

#[cfg(not(unix))]
fn local_utc_offset(_now: u64) -> Option<i64> {
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuickChat {
    /// No Quick Chat on this platform.
    Absent,
    Enabled,
    Disabled,
}

/// Everything besides the tray model that decides the rows.
#[derive(Debug, Clone)]
pub struct MenuInputs<'a> {
    pub model: &'a DesktopTrayModel,
    /// Member id → engines. Empty with `engines_known` false when the bridge
    /// could not be read: every engine then counts as in use.
    pub engines: &'a HashMap<String, MemberEngines>,
    pub engines_known: bool,
    pub needs: &'a [NeedsYouItem],
    /// Members on a break (`GET /api/members/breaks`).
    pub on_break: &'a HashSet<String>,
    /// Settings › Quick Chat › harness usage. False removes the headroom row.
    pub show_usage: bool,
    /// Claude Code and Codex windows; None until the first read finished.
    pub harnesses: Option<&'a [EngineUsage]>,
    /// "iPhone reachable via relay", when a phone is paired.
    pub phone: Option<String>,
    pub quick_chat: QuickChat,
    /// Ownership generation, so a stale row cannot act on the next account.
    pub generation: &'a str,
    pub clock: Clock,
}

/// A member as the menu shows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberRow {
    pub id: String,
    pub name: String,
    pub presence: Presence,
    pub cell: Cell,
    pub badge: Badge,
    pub text: String,
    /// The text with nothing cut, when `text` shortens a task title.
    pub speech: Option<String>,
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

pub fn plan_menu(inputs: &MenuInputs<'_>) -> Vec<Row> {
    let model = inputs.model;
    let members = member_rows(inputs);
    let mut rows = Vec::new();

    // 1. Squad header, with the comb.
    let (header, comb) = if !model.loaded {
        ("Squad · connecting…".to_string(), vec![Cell::Unknown])
    } else if !model.signed_in {
        ("Squad · signed out".to_string(), vec![Cell::Unknown])
    } else if !model.daemon_running {
        let cells = if members.is_empty() {
            vec![Cell::Offline]
        } else {
            comb_cells(&members.iter().map(|_| Cell::Offline).collect::<Vec<_>>())
        };
        ("Squad is stopped".to_string(), cells)
    } else if members.is_empty() {
        ("Squad · no members yet".to_string(), vec![Cell::Unknown])
    } else {
        (
            header_text(&members),
            comb_cells(&members.iter().map(|member| member.cell).collect::<Vec<_>>()),
        )
    };
    rows.push(
        Row::item("open", header)
            .art(Art::Comb(comb))
            .shortcut("CmdOrCtrl+O")
            .help("Opens the Squad window."),
    );

    let squad_visible = model.loaded && model.signed_in && model.daemon_running;
    if model.loaded && model.signed_in && !model.daemon_running {
        rows.push(Row::item("start", "Start services").help("Starts your squad again."));
    }
    if squad_visible {
        // 2. Needs you.
        rows.extend(needs_you_rows(inputs, &members));
        // 3–8. Members.
        if members.is_empty() {
            rows.push(Row::item("add-member", "Add a member…"));
        }
        for member in members.iter().take(TOP_MEMBERS) {
            rows.push(member_row(inputs, member));
        }
        if members.len() > TOP_MEMBERS {
            let mut all: Vec<Row> = members
                .iter()
                .map(|member| member_row(inputs, member))
                .collect();
            all.push(Row::separator());
            all.push(Row::item("add-member", "Add a member…"));
            rows.push(Row::submenu(
                "all-members",
                format!("All members ({})", members.len()),
                all,
            ));
        }
    }
    // 9. Headroom.
    if model.loaded && (squad_visible || !model.daemon_running && model.signed_in) {
        if !model.daemon_running {
            // Stopped: the only useful thing is to start; headroom waits.
        } else if let Some(row) = headroom_row(inputs, &members) {
            rows.push(row);
        }
    } else if model.loaded && !model.signed_in && inputs.show_usage {
        rows.push(Row::item("login", "Sign in to see headroom"));
    }

    rows.push(Row::separator());
    match inputs.quick_chat {
        QuickChat::Absent => {}
        state => rows.push(
            Row::item("quick-chat", "Quick chat")
                .shortcut("CmdOrCtrl+Shift+K")
                .enabled(state == QuickChat::Enabled)
                .help("Opens Quick Chat with the member you last talked to."),
        ),
    }
    rows.push(Row::item("settings", "Settings…").shortcut("CmdOrCtrl+,"));
    if !model.loaded {
        // Exactly one account row, even before the account is known.
        rows.push(Row::submenu(
            "account",
            "Account",
            vec![Row::label("account-email", "Checking account…")],
        ));
    } else if model.signed_in {
        rows.push(Row::submenu("account", "Account", account_rows(model)));
    } else {
        rows.push(Row::item("login", "Sign in…"));
    }
    rows.push(Row::submenu("services", "Services", services_rows(inputs)));
    rows.push(Row::submenu(
        "help",
        "Help",
        vec![
            Row::item("update", "Check for updates…"),
            Row::item("report-bug", "Report a bug…"),
            Row::item("give-feedback", "Give feedback…"),
            Row::separator(),
            Row::item("about", "About Autohand Squad"),
        ],
    ));
    rows.push(Row::separator());
    rows.push(Row::item("quit", "Quit Autohand Squad").shortcut("CmdOrCtrl+Q"));
    rows
}

fn header_text(members: &[MemberRow]) -> String {
    let working = members
        .iter()
        .filter(|member| matches!(member.presence, Presence::Working | Presence::NeedsYou))
        .count();
    let ready = members
        .iter()
        .filter(|member| member.presence == Presence::Ready)
        .count();
    match (working, ready) {
        (0, 0) => "Squad · no one available".to_string(),
        (0, ready) => format!("Squad · {ready} ready"),
        (working, 0) => format!("Squad · {working} working"),
        (working, ready) => format!("Squad · {working} working, {ready} ready"),
    }
}

/// Up to seven cells; more members than that leave six and the overflow mark.
pub fn comb_cells(cells: &[Cell]) -> Vec<Cell> {
    if cells.len() <= COMB_SLOTS {
        return cells.to_vec();
    }
    let mut shown = cells[..COMB_SLOTS - 1].to_vec();
    shown.push(Cell::Overflow);
    shown
}

fn member_row(inputs: &MenuInputs<'_>, member: &MemberRow) -> Row {
    let help = if inputs.quick_chat == QuickChat::Enabled {
        format!("Opens Quick Chat with {}.", member.name)
    } else {
        format!("Opens a chat with {} in Squad.", member.name)
    };
    Row::item(
        format!("member:{}:{}", inputs.generation, member.id),
        format!("{} · {}", member.name, member.text),
    )
    .art(Art::Avatar {
        member_id: member.id.clone(),
        badge: member.badge,
    })
    .speech(
        member
            .speech
            .as_ref()
            .map(|speech| spoken(&format!("{} · {speech}", member.name))),
    )
    .help(help)
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

fn base_presence(member: &TrayMember, on_break: bool) -> Option<Presence> {
    let status = member.status.trim().to_ascii_lowercase();
    if matches!(status.as_str(), "archived" | "disabled" | "removed") {
        return None;
    }
    if on_break
        || matches!(
            status.as_str(),
            "paused" | "break" | "on-break" | "hold" | "suspended"
        )
    {
        return Some(Presence::Paused);
    }
    if member.working || matches!(status.as_str(), "working" | "busy") {
        return Some(Presence::Working);
    }
    if matches!(
        status.as_str(),
        "" | "online" | "idle" | "ready" | "active" | "available"
    ) {
        return Some(Presence::Ready);
    }
    Some(Presence::Offline)
}

/// Members in menu order: needs you, working, ready, paused, offline; most
/// recent activity first inside a group. The comb uses the same order.
pub fn member_rows(inputs: &MenuInputs<'_>) -> Vec<MemberRow> {
    let waiting: HashSet<&str> = inputs
        .needs
        .iter()
        .map(|item| item.member_id.as_str())
        .collect();
    let mut rows: Vec<(MemberRow, Option<u64>, usize)> = Vec::new();
    for (index, member) in inputs.model.members.iter().enumerate() {
        let Some(base) = base_presence(member, inputs.on_break.contains(&member.id)) else {
            continue;
        };
        let engines = inputs.engines.get(&member.id);
        let needs = waiting.contains(member.id.as_str());
        let row = if needs {
            MemberRow {
                id: member.id.clone(),
                name: member.name.clone(),
                presence: Presence::NeedsYou,
                cell: Cell::NeedsYou,
                badge: Badge::NeedsYou,
                text: "Waiting for you".to_string(),
                speech: None,
            }
        } else {
            describe_member(member, base, engines, inputs)
        };
        rows.push((row, member.last_activity, index));
    }
    rows.sort_by(|a, b| {
        a.0.presence
            .cmp(&b.0.presence)
            .then(b.1.cmp(&a.1))
            .then(a.2.cmp(&b.2))
    });
    rows.into_iter().map(|(row, _, _)| row).collect()
}

fn describe_member(
    member: &TrayMember,
    base: Presence,
    engines: Option<&MemberEngines>,
    inputs: &MenuInputs<'_>,
) -> MemberRow {
    let row = |presence, cell, badge, text: String| MemberRow {
        id: member.id.clone(),
        name: member.name.clone(),
        presence,
        cell,
        badge,
        text,
        speech: None,
    };
    let active = matches!(base, Presence::Working | Presence::Ready);
    if let Some(engines) = engines.filter(|engines| active && engines.stopped()) {
        // The primary is out and nothing can answer: drawn paused-style.
        let engine = engine_name(&engines.primary);
        let why = match engines.primary_reason.as_deref() {
            Some("quota") => "limit reached".to_string(),
            Some(reason) => reason_phrase(reason).to_string(),
            None => "unavailable".to_string(),
        };
        return row(
            Presence::Paused,
            Cell::Paused,
            Badge::Paused,
            format!("Stopped: {engine} {why}"),
        );
    }
    match base {
        Presence::Working => {
            if let Some((engines, fallback)) = engines.and_then(|engines| {
                engines
                    .fallback_in_use
                    .as_deref()
                    .map(|fallback| (engines, fallback))
            }) {
                let primary = engine_name(&engines.primary);
                let fallback = engine_name(fallback);
                let back = engine_back_at(inputs, &engines.primary).or(engines.primary_back_at);
                let text = match back {
                    Some(at) => format!(
                        "On {fallback} until {primary} resets {}",
                        when(at, &inputs.clock)
                    ),
                    None => format!(
                        "On {fallback} while {primary} {}",
                        reason_phrase(engines.primary_reason.as_deref().unwrap_or("quota"))
                    ),
                };
                return row(Presence::Working, Cell::Working, Badge::Fallback, text);
            }
            let queued = if member.queued > 0 {
                format!(" · {} more queued", member.queued)
            } else {
                String::new()
            };
            let (text, speech) = match &member.task {
                Some(task) => (
                    format!("Working on {}{queued}", cut(task, TASK_CHARS)),
                    Some(format!("Working on {}{queued}", cut(task, SPOKEN_CHARS))),
                ),
                None => (format!("Working{queued}"), None),
            };
            MemberRow {
                speech: speech.filter(|speech| *speech != text),
                ..row(Presence::Working, Cell::Working, Badge::Working, text)
            }
        }
        Presence::Ready => {
            let text = if member.queued > 0 {
                format!("Ready · {} queued", member.queued)
            } else {
                "Ready".to_string()
            };
            row(Presence::Ready, Cell::Ready, Badge::Ready, text)
        }
        Presence::Paused => row(
            Presence::Paused,
            Cell::Paused,
            Badge::Paused,
            "Paused".to_string(),
        ),
        Presence::Offline | Presence::NeedsYou => row(
            Presence::Offline,
            Cell::Offline,
            Badge::Offline,
            "Offline".to_string(),
        ),
    }
}

fn reason_phrase(reason: &str) -> &'static str {
    match reason {
        "quota" => "is out",
        "sign-in" => "needs sign-in",
        "overload" => "is overloaded",
        "startup" => "could not start",
        "timeout" => "did not respond",
        _ => "keeps failing",
    }
}

/// When an engine's exhausted window resets, if Squad can read its limits.
fn engine_back_at(inputs: &MenuInputs<'_>, engine: &str) -> Option<u64> {
    engine_usages(inputs)
        .into_iter()
        .find(|usage| usage.id == metered_engine(engine))
        .and_then(|usage| back_at(&usage))
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

fn needs_you_rows(inputs: &MenuInputs<'_>, members: &[MemberRow]) -> Vec<Row> {
    let mut items: Vec<&NeedsYouItem> = inputs.needs.iter().collect();
    items.sort_by(|a, b| b.at.cmp(&a.at));
    let name_of = |id: &str| {
        members
            .iter()
            .find(|member| member.id == id)
            .map(|member| member.name.clone())
            .or_else(|| {
                inputs
                    .model
                    .members
                    .iter()
                    .find(|member| member.id == id)
                    .map(|member| member.name.clone())
            })
            .unwrap_or_else(|| "A member".to_string())
    };
    let row = |item: &NeedsYouItem| {
        let name = name_of(&item.member_id);
        let help = match item.kind {
            NeedsKind::Question => format!("Opens {name}'s chat in Squad to answer."),
            NeedsKind::Approval => format!("Opens {name}'s chat in Squad to approve or decline."),
        };
        Row::item(
            format!("needs:{}:{}", inputs.generation, item.member_id),
            needs_sentence(&name, item, SUBJECT_CHARS),
        )
        .art(Art::Avatar {
            member_id: item.member_id.clone(),
            badge: Badge::NeedsYou,
        })
        .speech(Some(needs_sentence(&name, item, SPOKEN_CHARS)))
        .help(help)
    };
    match items.len() {
        0 => Vec::new(),
        1 => vec![row(items[0])],
        count => {
            let mut sub: Vec<Row> = items
                .iter()
                .take(NEEDS_YOU_LIMIT)
                .map(|item| row(item))
                .collect();
            sub.push(Row::separator());
            sub.push(
                Row::item("needs-you", "Open Needs you")
                    .shortcut("CmdOrCtrl+1")
                    .help("Opens everything waiting on you in Squad."),
            );
            vec![
                Row::submenu("needs-you-list", format!("{count} things need you"), sub)
                    .art(Art::NeedsYou),
            ]
        }
    }
}

/// "Eva is asking: …" or "Eva needs approval: …", the subject cut at `limit`.
fn needs_sentence(name: &str, item: &NeedsYouItem, limit: usize) -> String {
    match item.kind {
        NeedsKind::Question => format!("{name} is asking: {}", cut(&item.subject, limit)),
        NeedsKind::Approval => format!("{name} needs approval: {}", cut(&item.subject, limit)),
    }
}

// ---------------------------------------------------------------------------
// Headroom
// ---------------------------------------------------------------------------

/// `autohand-acp` and `acp:autohand` spend the Autohand plan; other ACP
/// engines have no limits Squad can read.
pub fn metered_engine(id: &str) -> &str {
    match id {
        "autohand" | "autohand-acp" | "acp:autohand" | "autohand-code" | "autohandai" => "autohand",
        "claude" => "claude",
        "codex" => "codex",
        other => other,
    }
}

pub fn engine_name(id: &str) -> String {
    match metered_engine(id) {
        "autohand" => "Autohand Code".to_string(),
        "claude" => "Claude Code".to_string(),
        "codex" => "Codex".to_string(),
        other => other
            .strip_prefix("acp:")
            .map(|name| {
                let mut chars = name.chars();
                chars
                    .next()
                    .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                    .unwrap_or_default()
            })
            .unwrap_or_else(|| other.to_string()),
    }
}

/// Menu wording for a window label from the console or a harness:
/// `5 h` → `5-hour window`, `Weekly` → `This week`, `Codex · Weekly` →
/// `Codex · this week`. Unknown labels stay as the engine wrote them.
pub fn window_label(raw: &str) -> String {
    let duration = |text: &str| -> Option<&'static str> {
        match text.trim().to_ascii_lowercase().as_str() {
            "5 h" | "5h" | "5-hour" | "session" => Some("5-hour window"),
            "24 h" | "daily" | "day" => Some("Today"),
            "week" | "weekly" => Some("This week"),
            "month" | "monthly" => Some("This month"),
            _ => None,
        }
    };
    if let Some(label) = duration(raw) {
        return label.to_string();
    }
    if let Some((prefix, last)) = raw.rsplit_once(" · ") {
        if let Some(label) = duration(last) {
            return format!("{} · {}", prefix.trim(), lowercase_first(label));
        }
    }
    raw.trim().to_string()
}

fn lowercase_first(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_lowercase().collect::<String>() + chars.as_str())
        .unwrap_or_default()
}

/// The Autohand plan as an engine. None when signed out.
pub fn autohand_usage(model: &DesktopTrayModel) -> Option<EngineUsage> {
    if !model.signed_in {
        return None;
    }
    let windows = |usage: &AccountUsage| {
        usage
            .windows()
            .into_iter()
            .map(|(label, window)| EngineWindow {
                label: window_label(label),
                left: window.percent_used().map(|used| 100 - used.min(100)),
                resets_at: window
                    .reset_at
                    .as_deref()
                    .and_then(crate::account_usage::parse_rfc3339_unix),
            })
            .collect::<Vec<_>>()
    };
    match (&model.usage, &model.usage_error) {
        (Some(usage), _) => Some(EngineUsage {
            id: "autohand".to_string(),
            name: "Autohand Code".to_string(),
            heading: usage.display_name.clone(),
            windows: windows(usage),
            error: None,
        }),
        (None, Some(error)) => Some(EngineUsage {
            id: "autohand".to_string(),
            name: "Autohand Code".to_string(),
            heading: "Autohand Code".to_string(),
            windows: Vec::new(),
            error: Some(error.clone()),
        }),
        (None, None) => None,
    }
}

fn engine_usages(inputs: &MenuInputs<'_>) -> Vec<EngineUsage> {
    let mut engines: Vec<EngineUsage> = autohand_usage(inputs.model).into_iter().collect();
    engines.extend(inputs.harnesses.unwrap_or(&[]).iter().cloned());
    engines
}

/// The latest reset among an engine's exhausted windows: it is back when all
/// of them are.
fn back_at(engine: &EngineUsage) -> Option<u64> {
    engine
        .windows
        .iter()
        .filter(|window| window.left == Some(0))
        .filter_map(|window| window.resets_at)
        .max()
}

fn is_out(engine: &EngineUsage) -> bool {
    engine.windows.iter().any(|window| window.left == Some(0))
}

struct Powers {
    /// Members whose primary is this engine (not offline).
    primary: Vec<String>,
    /// Members who keep it as a fallback.
    backup: Vec<String>,
    /// It powers someone who is working now.
    working: bool,
    /// Members answering through a fallback because this engine is out.
    on_fallback: Vec<(String, String)>,
}

fn powers(inputs: &MenuInputs<'_>, members: &[MemberRow], engine: &str) -> Powers {
    let mut result = Powers {
        primary: Vec::new(),
        backup: Vec::new(),
        working: false,
        on_fallback: Vec::new(),
    };
    for member in members
        .iter()
        .filter(|member| member.presence != Presence::Offline)
    {
        let Some(engines) = inputs.engines.get(&member.id) else {
            continue;
        };
        let primary = metered_engine(&engines.primary) == engine;
        let backup = !primary
            && engines
                .fallbacks
                .iter()
                .any(|fallback| metered_engine(fallback) == engine);
        let answering = match &engines.fallback_in_use {
            Some(fallback) => metered_engine(fallback) == engine,
            None => primary,
        };
        if primary {
            result.primary.push(member.name.clone());
            if let Some(fallback) = &engines.fallback_in_use {
                result
                    .on_fallback
                    .push((member.name.clone(), engine_name(fallback)));
            }
        } else if backup {
            result.backup.push(member.name.clone());
        }
        if answering && matches!(member.presence, Presence::Working | Presence::NeedsYou) {
            result.working = true;
        }
    }
    result
}

fn names(list: &[String]) -> String {
    match list.len() {
        0 => String::new(),
        1..=3 => list.join(", "),
        more => format!("{} +{}", list[..3].join(", "), more - 3),
    }
}

fn heading(engine: &EngineUsage, powers: &Powers, known: bool) -> String {
    if !known {
        return engine.heading.clone();
    }
    match (powers.primary.is_empty(), powers.backup.is_empty()) {
        (true, true) => format!("{} · not used by anyone", engine.heading),
        (false, true) => format!("{} · {}", engine.heading, names(&powers.primary)),
        (true, false) => format!("{} · backup for {}", engine.heading, names(&powers.backup)),
        (false, false) => format!(
            "{} · {} · backup for {}",
            engine.heading,
            names(&powers.primary),
            names(&powers.backup)
        ),
    }
}

fn sentence_window(label: &str) -> String {
    match label {
        "5-hour window" => "in the 5-hour window".to_string(),
        "Today" => "today".to_string(),
        "This week" => "this week".to_string(),
        "This month" => "this month".to_string(),
        other => format!("({})", lowercase_first(other)),
    }
}

/// The headroom row: one sentence about the limit that matters most, and the
/// submenu with every engine grouped by whom it powers.
fn headroom_row(inputs: &MenuInputs<'_>, members: &[MemberRow]) -> Option<Row> {
    if !inputs.show_usage {
        return None;
    }
    let refresh = Row::item("refresh", "Refresh now");
    let settings = Row::item("usage-settings", "Usage settings…");
    let model = inputs.model;
    let autohand_pending = model.signed_in && model.usage.is_none() && model.usage_error.is_none();
    if inputs.harnesses.is_none() && autohand_pending {
        return Some(
            Row::submenu("headroom", "Checking headroom…", vec![refresh]).art(Art::Headroom(None)),
        );
    }
    let engines = engine_usages(inputs);
    let known = inputs.engines_known;
    let mut sections: Vec<(EngineUsage, Powers)> = engines
        .into_iter()
        .map(|engine| {
            let powers = powers(inputs, members, &engine.id);
            (engine, powers)
        })
        .collect();
    // Engines that power working members, then anyone, then nobody.
    sections.sort_by_key(|(_, powers)| {
        if powers.working {
            0
        } else if !powers.primary.is_empty() || !powers.backup.is_empty() {
            1
        } else {
            2
        }
    });
    let in_use =
        |powers: &Powers| !known || !powers.primary.is_empty() || !powers.backup.is_empty();

    let mut sub = Vec::new();
    for (engine, powers) in &sections {
        if !sub.is_empty() {
            sub.push(Row::separator());
        }
        sub.push(Row::label(
            format!("heading:{}", engine.id),
            heading(engine, powers, known),
        ));
        if let Some(error) = &engine.error {
            sub.push(Row::label(
                format!("error:{}", engine.id),
                format!(
                    "Couldn't reach {}: {}",
                    engine.name,
                    cut(error, SUBJECT_CHARS)
                ),
            ));
        }
        if engine.windows.is_empty() && engine.error.is_none() {
            sub.push(Row::label(
                format!("none:{}", engine.id),
                "No limits reported",
            ));
        }
        for (index, window) in engine.windows.iter().enumerate() {
            let mut text = match window.left {
                Some(left) => format!("{} · {left}% left", window.label),
                None => format!("{} · not reported", window.label),
            };
            if let Some(at) = window.resets_at {
                text.push_str(&format!(" · resets {}", when(at, &inputs.clock)));
            }
            sub.push(
                Row::item(format!("usage-window:{}:{index}", engine.id), text)
                    .art(Art::Headroom(window.left)),
            );
        }
        if engine.id == "autohand"
            && engine
                .windows
                .iter()
                .any(|window| window.left.is_some_and(|left| left <= 20))
        {
            sub.push(Row::item("upgrade-plan", "Upgrade plan…"));
        }
    }
    if !sub.is_empty() {
        sub.push(Row::separator());
    }
    sub.push(refresh);
    sub.push(settings);

    let considered: Vec<&(EngineUsage, Powers)> = sections
        .iter()
        .filter(|(_, powers)| in_use(powers))
        .collect();
    let any_windows = sections
        .iter()
        .any(|(engine, _)| !engine.windows.is_empty());
    if !any_windows {
        let failed = sections.iter().any(|(engine, _)| engine.error.is_some());
        let text = if failed {
            "Headroom unavailable"
        } else if sections.is_empty() && inputs.harnesses.is_none() {
            "Checking headroom…"
        } else {
            "No limits to show"
        };
        return Some(Row::submenu("headroom", text, sub).art(Art::Headroom(None)));
    }

    let out: Vec<&(EngineUsage, Powers)> = considered
        .iter()
        .copied()
        .filter(|(engine, _)| is_out(engine))
        .collect();
    let mut speech = None;
    let (text, mark) = match out.as_slice() {
        [] => {
            let tightest = considered
                .iter()
                .flat_map(|(engine, _)| {
                    engine
                        .windows
                        .iter()
                        .filter_map(move |window| window.left.map(|left| (engine, window, left)))
                })
                .min_by_key(|(_, window, left)| (*left, window.resets_at.unwrap_or(u64::MAX)));
            match tightest {
                None => ("Plenty of headroom".to_string(), Some(100)),
                Some((engine, window, left)) if left > 50 => {
                    // The mark shows roughly how much is left; say the number.
                    speech = Some(format!(
                        "Plenty of headroom, tightest is {} {left}% left {}",
                        engine.name,
                        sentence_window(&window.label)
                    ));
                    ("Plenty of headroom".to_string(), Some(left))
                }
                Some((engine, window, left)) if left > 20 => (
                    format!(
                        "Headroom · {} {left}% left {}",
                        engine.name,
                        sentence_window(&window.label)
                    ),
                    Some(left),
                ),
                Some((engine, window, left)) => (
                    match window.resets_at {
                        Some(at) => format!(
                            "{} low · {left}% left, resets {}",
                            engine.name,
                            when(at, &inputs.clock)
                        ),
                        None => format!("{} low · {left}% left", engine.name),
                    },
                    Some(left),
                ),
            }
        }
        [(engine, powers)] => {
            let until = back_at(engine)
                .map(|at| format!(" until {}", when(at, &inputs.clock)))
                .unwrap_or_default();
            let text = if engine.id != "autohand" && !powers.on_fallback.is_empty() {
                let fallbacks: HashSet<&str> = powers
                    .on_fallback
                    .iter()
                    .map(|(_, fallback)| fallback.as_str())
                    .collect();
                let who: Vec<String> = powers
                    .on_fallback
                    .iter()
                    .map(|(name, _)| name.clone())
                    .collect();
                let on = if fallbacks.len() == 1 {
                    format!("on {}", powers.on_fallback[0].1)
                } else {
                    "on fallbacks".to_string()
                };
                format!("{} out{until} · {} {on}", engine.name, names(&who))
            } else {
                format!("{} out{until}", engine.name)
            };
            (text, Some(0))
        }
        several => {
            let first = several
                .iter()
                .filter_map(|(engine, _)| back_at(engine))
                .min();
            (
                match first {
                    Some(at) => format!(
                        "{} engines out · first back {}",
                        several.len(),
                        when(at, &inputs.clock)
                    ),
                    None => format!("{} engines out", several.len()),
                },
                Some(0),
            )
        }
    };
    Some(
        Row::submenu("headroom", text, sub)
            .art(Art::Headroom(mark))
            .speech(speech),
    )
}

// ---------------------------------------------------------------------------
// Account and services
// ---------------------------------------------------------------------------

fn account_rows(model: &DesktopTrayModel) -> Vec<Row> {
    let mut rows = vec![Row::label(
        "account-email",
        match &model.email {
            Some(email) => format!("Signed in as {email}"),
            None => "Signed in".to_string(),
        },
    )];
    if let Some(usage) = &model.usage {
        rows.push(Row::label("account-plan", usage.display_name.clone()));
    }
    rows.push(Row::item("manage-plan", "Manage plan…"));
    rows.push(Row::item("logout", "Sign out"));
    rows
}

fn services_rows(inputs: &MenuInputs<'_>) -> Vec<Row> {
    let model = inputs.model;
    let status = if !model.loaded {
        "Starting…".to_string()
    } else if model.daemon_running {
        match model.running_since {
            Some(at) => format!("Running since {}", since(at, &inputs.clock)),
            None => "Running".to_string(),
        }
    } else {
        "Stopped".to_string()
    };
    let mut rows = vec![Row::label("services-status", status)];
    if let Some(phone) = inputs.phone.as_ref().filter(|_| model.daemon_running) {
        rows.push(Row::label("services-phone", phone.clone()));
    }
    if model.daemon_running {
        rows.push(Row::item("restart", "Restart services"));
        rows.push(Row::item("stop", "Stop services"));
    } else {
        rows.push(Row::item("start", "Start services").enabled(model.loaded));
    }
    rows.push(Row::separator());
    rows.push(Row {
        kind: RowKind::Check(model.launch_at_login),
        ..Row::item("launch-at-login", "Launch at login").enabled(model.daemon_running)
    });
    rows.push(Row::item("logs", "Open logs folder"));
    rows
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/// The first `limit` characters, with a trailing ellipsis when cut.
pub fn cut(text: &str, limit: usize) -> String {
    let text: String = text
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= limit {
        return text;
    }
    let mut kept: String = text.chars().take(limit).collect();
    kept = kept.trim_end().to_string();
    kept.push('…');
    kept
}

struct Civil {
    year: i64,
    month: u32,
    day: u32,
    weekday: u32,
    hour: u32,
    minute: u32,
    days: i64,
}

fn civil(unix: u64, offset: i64) -> Civil {
    let local = unix as i64 + offset;
    let days = local.div_euclid(86_400);
    let seconds = local.rem_euclid(86_400);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    Civil {
        year,
        month,
        day,
        // 1970-01-01 was a Thursday.
        weekday: (days + 4).rem_euclid(7) as u32,
        hour: (seconds / 3600) as u32,
        minute: ((seconds % 3600) / 60) as u32,
        days,
    }
}

const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn clock_time(civil: &Civil, hour12: bool) -> String {
    if hour12 {
        let hour = match civil.hour % 12 {
            0 => 12,
            hour => hour,
        };
        let half = if civil.hour < 12 { "am" } else { "pm" };
        format!("{hour}:{:02} {half}", civil.minute)
    } else {
        format!("{:02}:{:02}", civil.hour, civil.minute)
    }
}

/// An absolute reset time: `4:10 pm` within a day, `Fri 9:00 am` within six
/// days, `Dec 9` beyond. Absolute because the menu stays open while minutes
/// pass, and it says whether a reset lands tonight or in work hours.
pub fn when(at: u64, clock: &Clock) -> String {
    let Some(offset) = clock.utc_offset else {
        return time_until_text(at, clock.now);
    };
    let target = civil(at, offset);
    let ahead = at.saturating_sub(clock.now);
    if ahead < 86_400 {
        clock_time(&target, clock.hour12)
    } else if ahead < 6 * 86_400 {
        format!(
            "{} {}",
            WEEKDAYS[target.weekday as usize],
            clock_time(&target, clock.hour12)
        )
    } else {
        let now = civil(clock.now, offset);
        if target.year == now.year {
            format!("{} {}", MONTHS[target.month as usize - 1], target.day)
        } else {
            format!(
                "{} {}, {}",
                MONTHS[target.month as usize - 1],
                target.day,
                target.year
            )
        }
    }
}

/// A past moment, for "Running since …": the time today, the weekday this
/// week, the date before that.
pub fn since(at: u64, clock: &Clock) -> String {
    let Some(offset) = clock.utc_offset else {
        return time_until_text(clock.now, at).replace("in ", "") + " ago";
    };
    let then = civil(at, offset);
    let now = civil(clock.now, offset);
    if then.days == now.days {
        clock_time(&then, clock.hour12)
    } else if now.days - then.days < 6 {
        format!(
            "{} {}",
            WEEKDAYS[then.weekday as usize],
            clock_time(&then, clock.hour12)
        )
    } else {
        format!("{} {}", MONTHS[then.month as usize - 1], then.day)
    }
}

fn time_until_text(at: u64, now: u64) -> String {
    // `time_until` takes RFC 3339; build one from the instant.
    let civil = civil(at, 0);
    let stamp = format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:00Z",
        civil.year, civil.month, civil.day, civil.hour, civil.minute
    );
    match time_until(&stamp, now) {
        Some(text) if text == "now" => "now".to_string(),
        Some(text) => format!("in {text}"),
        None => "soon".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Accessibility: the status item, attention, announcements
// ---------------------------------------------------------------------------

/// A row's words as VoiceOver should read them. The visual separator ` · `
/// is spoken as a pause (a comma) instead of a punctuation name, whatever
/// the person's punctuation verbosity.
pub fn spoken(text: &str) -> String {
    text.replace(" · ", ", ")
}

/// What VoiceOver reads for a status item: its name (AXDescription), its
/// state (AXValue) and what pressing it does (AXHelp).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusSpeech {
    pub label: String,
    pub value: String,
    pub help: String,
}

fn squad_visible(model: &DesktopTrayModel) -> bool {
    model.loaded && model.signed_in && model.daemon_running
}

/// How many questions and approvals wait on the person, counted exactly as
/// the needs-you row counts them: none unless the squad is visible. The
/// attention dot and the announcement follow this number, so the dot never
/// shows without a row to open.
pub fn attention_count(inputs: &MenuInputs<'_>) -> usize {
    if squad_visible(inputs.model) {
        inputs.needs.len()
    } else {
        0
    }
}

fn things_need_you(count: usize) -> String {
    match count {
        1 => "1 thing needs you".to_string(),
        count => format!("{count} things need you"),
    }
}

/// The Squad status item. The name stays "Autohand Squad" and gains the
/// attention count, so the one thing worth acting on is in the part
/// VoiceOver always reads; the header sentence is the value.
/// `rows` is the planned menu; its first row is the header.
pub fn status_item_speech(inputs: &MenuInputs<'_>, rows: &[Row]) -> StatusSpeech {
    let count = attention_count(inputs);
    let label = if count == 0 {
        "Autohand Squad".to_string()
    } else {
        format!("Autohand Squad, {}", things_need_you(count))
    };
    let header = rows
        .first()
        .map(|row| row.text.as_str())
        .unwrap_or_default();
    let value = match header.strip_prefix("Squad · ") {
        Some(state) => spoken(state),
        None if header == "Squad is stopped" => "Stopped".to_string(),
        None => spoken(header),
    };
    StatusSpeech {
        label,
        value,
        help: "Opens the Squad menu: your squad, what needs you, and Quick chat.".to_string(),
    }
}

/// A member's own status item in Agent avatars mode: their name, what they
/// are doing in the menu's words, and that pressing opens Quick Chat.
pub fn member_item_speech(inputs: &MenuInputs<'_>, member_id: &str) -> Option<StatusSpeech> {
    let member = member_rows(inputs)
        .into_iter()
        .find(|member| member.id == member_id)?;
    Some(StatusSpeech {
        value: spoken(member.speech.as_deref().unwrap_or(&member.text)),
        help: format!("Opens Quick Chat with {}.", member.name),
        label: member.name,
    })
}

/// Identifies one waiting item across refreshes.
pub fn needs_key(item: &NeedsYouItem) -> String {
    let kind = match item.kind {
        NeedsKind::Question => "q",
        NeedsKind::Approval => "a",
    };
    format!("{kind}:{}:{}:{}", item.member_id, item.at, item.subject)
}

/// What VoiceOver announces when something new starts needing the person:
/// the item's own sentence when one arrived, a count when several did, and
/// nothing when nothing is new. `seen` holds the keys of items already
/// present at the previous refresh.
pub fn announcement(seen: &HashSet<String>, inputs: &MenuInputs<'_>) -> Option<String> {
    if attention_count(inputs) == 0 {
        return None;
    }
    let fresh: Vec<&NeedsYouItem> = inputs
        .needs
        .iter()
        .filter(|item| !seen.contains(&needs_key(item)))
        .collect();
    match fresh.as_slice() {
        [] => None,
        [item] => {
            let name = inputs
                .model
                .members
                .iter()
                .find(|member| member.id == item.member_id)
                .map(|member| member.name.as_str())
                .unwrap_or("A member");
            Some(format!(
                "Squad: {}",
                needs_sentence(name, item, SPOKEN_CHARS)
            ))
        }
        several => Some(format!("Squad: {}", things_need_you(several.len()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account_usage::{parse_rfc3339_unix, UsageWindow};

    // Tue 2026-11-17 14:00 in UTC+13 (Auckland summer) = 01:00Z.
    fn clock() -> Clock {
        Clock {
            now: parse_rfc3339_unix("2026-11-17T01:00:00Z").unwrap(),
            utc_offset: Some(13 * 3600),
            hour12: true,
        }
    }
    fn at(stamp: &str) -> u64 {
        parse_rfc3339_unix(stamp).unwrap()
    }

    fn member(id: &str, name: &str, status: &str, working: bool) -> TrayMember {
        TrayMember {
            id: id.into(),
            name: name.into(),
            label: name.into(),
            status: status.into(),
            working,
            task: None,
            queued: 0,
            last_activity: None,
        }
    }

    fn model(members: Vec<TrayMember>) -> DesktopTrayModel {
        DesktopTrayModel {
            loaded: true,
            signed_in: true,
            email: Some("me@example.com".into()),
            usage: Some(AccountUsage {
                tier: "free".into(),
                display_name: "Autohand Code Free".into(),
                month: UsageWindow {
                    used: 100,
                    limit: Some(100),
                    reset_at: Some("2026-12-09T00:00:00Z".into()),
                    ..Default::default()
                },
                window5h: UsageWindow {
                    used: 0,
                    limit: Some(10),
                    reset_at: Some("2026-11-17T03:12:00Z".into()),
                    ..Default::default()
                },
                ..Default::default()
            }),
            usage_error: None,
            daemon_running: true,
            running_since: Some(at("2026-11-16T20:12:00Z")),
            launch_at_login: true,
            members,
        }
    }

    fn engines(primary: &str, fallbacks: &[&str]) -> MemberEngines {
        MemberEngines {
            primary: primary.into(),
            fallbacks: fallbacks.iter().map(|id| id.to_string()).collect(),
            ..Default::default()
        }
    }

    fn harness(id: &str, name: &str, windows: Vec<(&str, Option<u8>, &str)>) -> EngineUsage {
        EngineUsage {
            id: id.into(),
            name: name.into(),
            heading: name.into(),
            windows: windows
                .into_iter()
                .map(|(label, left, reset)| EngineWindow {
                    label: label.into(),
                    left,
                    resets_at: Some(at(reset)),
                })
                .collect(),
            error: None,
        }
    }

    struct Fixture {
        model: DesktopTrayModel,
        engines: HashMap<String, MemberEngines>,
        needs: Vec<NeedsYouItem>,
        breaks: HashSet<String>,
        harnesses: Vec<EngineUsage>,
    }

    impl Fixture {
        fn typical() -> Self {
            let mut noah = member("noah", "Noah", "online", true);
            noah.task = Some("Checkout tests for the new payment flow".into());
            noah.last_activity = Some(at("2026-11-17T00:59:00Z"));
            let mut eva = member("eva", "Eva", "online", true);
            eva.last_activity = Some(at("2026-11-17T00:58:00Z"));
            let mut chief = member("chief", "Chief of Staff", "online", false);
            chief.last_activity = Some(at("2026-11-17T00:50:00Z"));
            let mia = member("mia", "Mia", "idle", false);
            let leo = member("leo", "Leo", "online", false);
            let mut members = vec![leo, mia, chief, eva, noah];
            for index in 0..4 {
                members.push(member(
                    &format!("m{index}"),
                    &format!("Extra {index}"),
                    "offline",
                    false,
                ));
            }
            let mut engines_map = HashMap::new();
            engines_map.insert("noah".into(), engines("claude", &["codex"]));
            engines_map.insert("eva".into(), engines("claude", &[]));
            engines_map.insert("chief".into(), engines("autohand", &["claude"]));
            engines_map.insert("mia".into(), engines("claude", &[]));
            engines_map.insert("leo".into(), engines("claude", &[]));
            let mut model = model(members);
            model.usage.as_mut().unwrap().month.used = 50;
            Self {
                model,
                engines: engines_map,
                needs: vec![NeedsYouItem {
                    member_id: "eva".into(),
                    kind: NeedsKind::Approval,
                    subject: "push to main".into(),
                    at: "2026-11-17T00:59:30Z".into(),
                }],
                breaks: ["leo".to_string()].into_iter().collect(),
                harnesses: vec![
                    harness(
                        "claude",
                        "Claude Code",
                        vec![("This week", Some(12), "2026-11-20T20:00:00Z")],
                    ),
                    harness(
                        "codex",
                        "Codex",
                        vec![("This week", Some(80), "2026-11-21T05:00:00Z")],
                    ),
                ],
            }
        }
        fn inputs(&self) -> MenuInputs<'_> {
            MenuInputs {
                model: &self.model,
                engines: &self.engines,
                engines_known: true,
                needs: &self.needs,
                on_break: &self.breaks,
                show_usage: true,
                harnesses: Some(&self.harnesses),
                phone: Some("iPhone reachable via relay".into()),
                quick_chat: QuickChat::Enabled,
                generation: "gen",
                clock: clock(),
            }
        }
    }

    fn texts(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .map(|row| match &row.kind {
                RowKind::Separator => "---".to_string(),
                RowKind::Submenu(_) => format!("{} ▸", row.text),
                RowKind::Check(true) => format!("✓ {}", row.text),
                _ => row.text.clone(),
            })
            .collect()
    }

    fn find<'a>(rows: &'a [Row], id: &str) -> &'a Row {
        rows.iter()
            .find(|row| row.id == id)
            .unwrap_or_else(|| panic!("no row {id}"))
    }
    fn sub(row: &Row) -> &[Row] {
        match &row.kind {
            RowKind::Submenu(rows) => rows,
            _ => panic!("{} is not a submenu", row.text),
        }
    }

    #[test]
    fn the_typical_menu_reads_people_first() {
        let fixture = Fixture::typical();
        let rows = plan_menu(&fixture.inputs());
        assert_eq!(
            texts(&rows),
            vec![
                "Squad · 2 working, 2 ready",
                "Eva needs approval: push to main",
                "Eva · Waiting for you",
                "Noah · Working on Checkout tests for the new payme…",
                "Chief of Staff · Ready",
                "Mia · Ready",
                "Leo · Paused",
                "All members (9) ▸",
                "Claude Code low · 12% left, resets Sat 9:00 am ▸",
                "---",
                "Quick chat",
                "Settings…",
                "Account ▸",
                "Services ▸",
                "Help ▸",
                "---",
                "Quit Autohand Squad",
            ]
        );
        assert_eq!(rows[0].shortcut, Some("CmdOrCtrl+O"));
        assert_eq!(
            rows[0].art,
            Some(Art::Comb(vec![
                Cell::NeedsYou,
                Cell::Working,
                Cell::Ready,
                Cell::Ready,
                Cell::Paused,
                Cell::Offline,
                Cell::Overflow,
            ]))
        );
        assert_eq!(rows[1].id, "needs:gen:eva");
        assert_eq!(rows[3].id, "member:gen:noah");
        assert_eq!(
            rows[3].art,
            Some(Art::Avatar {
                member_id: "noah".into(),
                badge: Badge::Working
            })
        );
        assert_eq!(find(&rows, "headroom").art, Some(Art::Headroom(Some(12))));
    }

    #[test]
    fn headroom_groups_engines_by_whom_they_power() {
        let fixture = Fixture::typical();
        let rows = plan_menu(&fixture.inputs());
        assert_eq!(
            texts(sub(find(&rows, "headroom"))),
            vec![
                "Claude Code · Eva, Noah, Mia +1 · backup for Chief of Staff",
                "This week · 12% left · resets Sat 9:00 am",
                "---",
                "Autohand Code Free · Chief of Staff",
                "5-hour window · 100% left · resets 4:12 pm",
                "This month · 50% left · resets Dec 9",
                "---",
                "Codex · backup for Noah",
                "This week · 80% left · resets Sat 6:00 pm",
                "---",
                "Refresh now",
                "Usage settings…",
            ]
        );
        let heading = &sub(find(&rows, "headroom"))[0];
        assert!(!heading.enabled, "headings are labels");
        assert!(
            sub(find(&rows, "headroom"))[1].enabled,
            "window rows keep full contrast"
        );
    }

    #[test]
    fn a_member_on_fallback_names_both_engines_and_the_headroom_row_names_them() {
        let mut fixture = Fixture::typical();
        fixture.needs.clear();
        fixture.harnesses[0].windows[0].left = Some(0);
        fixture.harnesses[0].windows[0].resets_at = Some(at("2026-11-17T03:10:00Z"));
        let noah = fixture.engines.get_mut("noah").unwrap();
        noah.fallback_in_use = Some("codex".into());
        noah.primary_reason = Some("quota".into());
        for id in ["eva", "mia", "leo"] {
            fixture.engines.get_mut(id).unwrap().primary_reason = Some("quota".into());
        }
        let rows = plan_menu(&fixture.inputs());
        let all = texts(&rows);
        assert!(
            all.contains(&"Noah · On Codex until Claude Code resets 4:10 pm".to_string()),
            "{all:?}"
        );
        assert!(
            all.contains(&"Mia · Stopped: Claude Code limit reached".to_string()),
            "{all:?}"
        );
        assert!(
            all.contains(&"Claude Code out until 4:10 pm · Noah on Codex ▸".to_string()),
            "{all:?}"
        );
        let noah_row = rows.iter().find(|row| row.id == "member:gen:noah").unwrap();
        assert_eq!(
            noah_row.art,
            Some(Art::Avatar {
                member_id: "noah".into(),
                badge: Badge::Fallback
            })
        );
        assert_eq!(find(&rows, "headroom").art, Some(Art::Headroom(Some(0))));
    }

    #[test]
    fn headroom_sentences_follow_the_spec_table() {
        let mut fixture = Fixture::typical();
        let row = |fixture: &Fixture| find(&plan_menu(&fixture.inputs()), "headroom").text.clone();
        fixture.harnesses[0].windows[0].left = Some(92);
        fixture.model.usage.as_mut().unwrap().month.used = 10;
        assert_eq!(row(&fixture), "Plenty of headroom");
        fixture.harnesses[1].windows[0].left = Some(34);
        assert_eq!(row(&fixture), "Headroom · Codex 34% left this week");
        fixture.harnesses[1].windows[0].left = Some(0);
        assert_eq!(row(&fixture), "Codex out until Sat 6:00 pm");
        fixture.model.usage.as_mut().unwrap().month.used = 100;
        assert_eq!(row(&fixture), "2 engines out · first back Sat 6:00 pm");
        fixture.harnesses[1].windows[0].left = Some(60);
        assert_eq!(row(&fixture), "Autohand Code out until Dec 9");
        // An engine nobody uses does not drive the row.
        fixture.engines.get_mut("chief").unwrap().primary = "claude".into();
        assert_eq!(row(&fixture), "Plenty of headroom");
        let rows = plan_menu(&fixture.inputs());
        assert!(texts(sub(find(&rows, "headroom")))
            .contains(&"Autohand Code Free · not used by anyone".to_string()));
        assert!(texts(sub(find(&rows, "headroom"))).contains(&"Upgrade plan…".to_string()));
    }

    #[test]
    fn loading_errors_and_usage_off() {
        let mut fixture = Fixture::typical();
        fixture.model.usage = None;
        let mut inputs = fixture.inputs();
        inputs.harnesses = None;
        let rows = plan_menu(&inputs);
        let headroom = find(&rows, "headroom");
        assert_eq!(headroom.text, "Checking headroom…");
        assert_eq!(headroom.art, Some(Art::Headroom(None)));
        assert_eq!(texts(sub(headroom)), vec!["Refresh now"]);

        fixture.model.usage_error = Some("HTTP 503".into());
        fixture.harnesses.clear();
        let rows = plan_menu(&fixture.inputs());
        let headroom = find(&rows, "headroom");
        assert_eq!(headroom.text, "Headroom unavailable");
        assert_eq!(
            sub(headroom)[1].text,
            "Couldn't reach Autohand Code: HTTP 503"
        );

        let mut inputs = fixture.inputs();
        inputs.show_usage = false;
        assert!(plan_menu(&inputs).iter().all(|row| row.id != "headroom"));
    }

    #[test]
    fn plural_needs_you_becomes_a_submenu() {
        let mut fixture = Fixture::typical();
        fixture.needs.push(NeedsYouItem {
            member_id: "noah".into(),
            kind: NeedsKind::Question,
            subject: "Should the retry budget cover webhooks from the staging environment too?"
                .into(),
            at: "2026-11-17T01:00:00Z".into(),
        });
        let rows = plan_menu(&fixture.inputs());
        let needs = &rows[1];
        assert_eq!(needs.text, "2 things need you");
        assert_eq!(needs.art, Some(Art::NeedsYou));
        assert_eq!(
            texts(sub(needs)),
            vec![
                "Noah is asking: Should the retry budget cover webhooks f…",
                "Eva needs approval: push to main",
                "---",
                "Open Needs you",
            ]
        );
        assert_eq!(sub(needs)[3].shortcut, Some("CmdOrCtrl+1"));
    }

    #[test]
    fn stopped_loading_signed_out_and_empty_states() {
        let mut fixture = Fixture::typical();
        fixture.model.daemon_running = false;
        let rows = plan_menu(&fixture.inputs());
        assert_eq!(rows[0].text, "Squad is stopped");
        assert_eq!(rows[1].text, "Start services");
        assert!(rows
            .iter()
            .all(|row| !row.id.starts_with("member:") && row.id != "headroom"));
        assert_eq!(texts(sub(find(&rows, "services")))[0], "Stopped");

        let loading = DesktopTrayModel::default();
        let mut inputs = fixture.inputs();
        inputs.model = &loading;
        let rows = plan_menu(&inputs);
        assert_eq!(rows[0].text, "Squad · connecting…");
        assert_eq!(rows[0].art, Some(Art::Comb(vec![Cell::Unknown])));
        assert_eq!(texts(sub(find(&rows, "services")))[0], "Starting…");
        assert_eq!(
            texts(sub(find(&rows, "account"))),
            vec!["Checking account…"]
        );
        assert!(
            rows.iter().all(|row| row.id != "login"),
            "not signed out, only unknown"
        );

        let mut signed_out = fixture.model.clone();
        signed_out.signed_in = false;
        signed_out.usage = None;
        inputs.model = &signed_out;
        let rows = plan_menu(&inputs);
        assert!(texts(&rows).contains(&"Sign in to see headroom".to_string()));
        assert!(texts(&rows).contains(&"Sign in…".to_string()));
        assert!(rows.iter().all(|row| row.id != "account"));

        let mut empty = fixture.model.clone();
        empty.members.clear();
        empty.daemon_running = true;
        inputs.model = &empty;
        inputs.needs = &[];
        let rows = plan_menu(&inputs);
        assert_eq!(rows[0].text, "Squad · no members yet");
        assert_eq!(rows[1].text, "Add a member…");
    }

    #[test]
    fn account_services_and_help() {
        let fixture = Fixture::typical();
        let rows = plan_menu(&fixture.inputs());
        assert_eq!(
            texts(sub(find(&rows, "account"))),
            vec![
                "Signed in as me@example.com",
                "Autohand Code Free",
                "Manage plan…",
                "Sign out"
            ]
        );
        assert_eq!(
            texts(sub(find(&rows, "services"))),
            vec![
                "Running since 9:12 am",
                "iPhone reachable via relay",
                "Restart services",
                "Stop services",
                "---",
                "✓ Launch at login",
                "Open logs folder",
            ]
        );
        assert_eq!(
            texts(sub(find(&rows, "help"))),
            vec![
                "Check for updates…",
                "Report a bug…",
                "Give feedback…",
                "---",
                "About Autohand Squad"
            ]
        );
    }

    #[test]
    fn member_words_carry_queue_and_engine_states() {
        let mut fixture = Fixture::typical();
        fixture.needs.clear();
        fixture.breaks.clear();
        fixture.model.members[0].queued = 3; // Leo, ready
        let noah = fixture
            .model
            .members
            .iter_mut()
            .find(|member| member.id == "noah")
            .unwrap();
        noah.queued = 2;
        let rows = plan_menu(&fixture.inputs());
        let all = texts(&rows);
        assert!(
            all.contains(&"Leo · Ready · 3 queued".to_string()),
            "{all:?}"
        );
        assert!(
            all.contains(
                &"Noah · Working on Checkout tests for the new payme… · 2 more queued".to_string()
            ),
            "{all:?}"
        );
        assert!(
            all.contains(&"Squad · 2 working, 3 ready".to_string()),
            "{all:?}"
        );
    }

    #[test]
    fn reset_times_are_absolute_and_follow_the_clock_setting() {
        let clock = clock();
        assert_eq!(when(at("2026-11-17T03:10:00Z"), &clock), "4:10 pm");
        assert_eq!(when(at("2026-11-20T20:00:00Z"), &clock), "Sat 9:00 am");
        assert_eq!(when(at("2026-12-09T00:00:00Z"), &clock), "Dec 9");
        assert_eq!(when(at("2027-01-09T00:00:00Z"), &clock), "Jan 9, 2027");
        let h24 = Clock {
            hour12: false,
            ..clock
        };
        assert_eq!(when(at("2026-11-17T03:10:00Z"), &h24), "16:10");
        let relative = Clock {
            utc_offset: None,
            ..clock
        };
        assert_eq!(when(at("2026-11-17T03:10:00Z"), &relative), "in 2h 10m");
        assert_eq!(since(at("2026-11-16T20:12:00Z"), &clock), "9:12 am");
        assert_eq!(since(at("2026-11-15T20:12:00Z"), &clock), "Mon 9:12 am");
    }

    #[test]
    fn window_labels_read_as_time_spans() {
        assert_eq!(window_label("5 h"), "5-hour window");
        assert_eq!(window_label("Weekly"), "This week");
        assert_eq!(window_label("Month"), "This month");
        assert_eq!(window_label("24 h"), "Today");
        assert_eq!(window_label("GPT-5 · Weekly"), "GPT-5 · this week");
        assert_eq!(window_label("Fable"), "Fable");
        assert_eq!(cut("  a\nb  ", 40), "a b");
    }

    #[test]
    fn the_comb_overflows_after_six() {
        let cells = vec![Cell::Ready; 12];
        let comb = comb_cells(&cells);
        assert_eq!(comb.len(), 7);
        assert_eq!(comb[6], Cell::Overflow);
        assert_eq!(comb_cells(&cells[..7]).len(), 7);
    }

    fn titles(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .filter(|row| row.kind != RowKind::Separator)
            .map(Row::spoken_title)
            .collect()
    }

    #[test]
    fn voiceover_reads_each_row_as_a_sentence() {
        let mut fixture = Fixture::typical();
        fixture.needs[0].subject =
            "push the release branch to main and tag it v0.1.23 for the store".into();
        let rows = plan_menu(&fixture.inputs());
        assert_eq!(
            titles(&rows),
            vec![
                "Squad, 2 working, 2 ready",
                // The row cuts the subject at 40; VoiceOver gets all of it.
                "Eva needs approval: push the release branch to main and tag it v0.1.23 for the store",
                "Eva, Waiting for you",
                "Noah, Working on Checkout tests for the new payment flow",
                "Chief of Staff, Ready",
                "Mia, Ready",
                "Leo, Paused",
                "All members (9)",
                "Claude Code low, 12% left, resets Sat 9:00 am",
                "Quick chat",
                "Settings…",
                "Account",
                "Services",
                "Help",
                "Quit Autohand Squad",
            ]
        );
        // The screen keeps the cut versions.
        assert_eq!(
            rows[1].text,
            "Eva needs approval: push the release branch to main and tag…"
        );
        assert!(titles(&rows).iter().all(|title| !title.contains('·')));
        assert_eq!(rows[0].help.as_deref(), Some("Opens the Squad window."));
        assert_eq!(
            rows[1].help.as_deref(),
            Some("Opens Eva's chat in Squad to approve or decline.")
        );
        assert_eq!(rows[3].help.as_deref(), Some("Opens Quick Chat with Noah."));
        // A row whose words are already the sentence carries no override.
        assert_eq!(rows[4].speech, None);
        let mut off = Fixture::typical();
        off.needs.clear();
        let quiet = off.inputs();
        let quiet = MenuInputs {
            quick_chat: QuickChat::Disabled,
            ..quiet
        };
        let rows = plan_menu(&quiet);
        assert_eq!(
            find(&rows, "member:gen:noah").help.as_deref(),
            Some("Opens a chat with Noah in Squad.")
        );
    }

    #[test]
    fn plenty_of_headroom_says_the_number_the_mark_shows() {
        let mut fixture = Fixture::typical();
        fixture.harnesses = vec![harness(
            "codex",
            "Codex",
            vec![("This week", Some(82), "2026-11-21T05:00:00Z")],
        )];
        fixture.model.usage = None;
        let rows = plan_menu(&fixture.inputs());
        let headroom = find(&rows, "headroom");
        assert_eq!(headroom.text, "Plenty of headroom");
        assert_eq!(
            headroom.spoken_title(),
            "Plenty of headroom, tightest is Codex 82% left this week"
        );
    }

    #[test]
    fn the_status_item_names_squad_and_what_needs_you() {
        let fixture = Fixture::typical();
        let inputs = fixture.inputs();
        let rows = plan_menu(&inputs);
        let speech = status_item_speech(&inputs, &rows);
        assert_eq!(speech.label, "Autohand Squad, 1 thing needs you");
        assert_eq!(speech.value, "2 working, 2 ready");
        assert!(speech.help.contains("Quick chat"));

        let mut calm = Fixture::typical();
        calm.needs.clear();
        let inputs = calm.inputs();
        let speech = status_item_speech(&inputs, &plan_menu(&inputs));
        assert_eq!(speech.label, "Autohand Squad");

        // Stopped: the needs-you row is gone, so the name drops the count.
        let mut stopped = Fixture::typical();
        stopped.model.daemon_running = false;
        let inputs = stopped.inputs();
        assert_eq!(attention_count(&inputs), 0);
        let speech = status_item_speech(&inputs, &plan_menu(&inputs));
        assert_eq!(speech.label, "Autohand Squad");
        assert_eq!(speech.value, "Stopped");

        let mut away = Fixture::typical();
        away.model.signed_in = false;
        let inputs = away.inputs();
        assert_eq!(
            status_item_speech(&inputs, &plan_menu(&inputs)).value,
            "signed out"
        );
    }

    #[test]
    fn a_members_own_icon_reads_like_their_row() {
        let fixture = Fixture::typical();
        let inputs = fixture.inputs();
        let noah = member_item_speech(&inputs, "noah").unwrap();
        assert_eq!(noah.label, "Noah");
        assert_eq!(
            noah.value,
            "Working on Checkout tests for the new payment flow"
        );
        assert_eq!(noah.help, "Opens Quick Chat with Noah.");
        assert_eq!(
            member_item_speech(&inputs, "eva").unwrap().value,
            "Waiting for you"
        );
        assert!(member_item_speech(&inputs, "nobody").is_none());
    }

    #[test]
    fn only_new_waiting_items_are_announced() {
        let mut fixture = Fixture::typical();
        let seen = HashSet::new();
        assert_eq!(
            announcement(&seen, &fixture.inputs()).as_deref(),
            Some("Squad: Eva needs approval: push to main")
        );
        let seen: HashSet<String> = fixture.needs.iter().map(needs_key).collect();
        assert_eq!(announcement(&seen, &fixture.inputs()), None);
        fixture.needs.push(NeedsYouItem {
            member_id: "noah".into(),
            kind: NeedsKind::Question,
            subject: "which card should the checkout test use?".into(),
            at: "2026-11-17T01:00:00Z".into(),
        });
        assert_eq!(
            announcement(&seen, &fixture.inputs()).as_deref(),
            Some("Squad: Noah is asking: which card should the checkout test use?")
        );
        fixture.needs.push(NeedsYouItem {
            member_id: "mia".into(),
            kind: NeedsKind::Approval,
            subject: "delete the staging database".into(),
            at: "2026-11-17T01:00:01Z".into(),
        });
        assert_eq!(
            announcement(&seen, &fixture.inputs()).as_deref(),
            Some("Squad: 2 things need you")
        );
        // Stopped services show no needs-you row, so nothing is announced.
        fixture.model.daemon_running = false;
        assert_eq!(announcement(&HashSet::new(), &fixture.inputs()), None);
    }
}
