# ADR-0258: Inbox, the account menu, and agents that report problems

Status: Accepted
Date: 2026-11-19

## Context

The owner, on 19 November 2026:

- The page and sidebar row called "Needs you" should be Inbox. The account
  menu already said Inbox for the same page, so one place had two names.
- The account menu should lead with where you go: Inbox, Marketplace,
  Connectors, then About, Report a bug, Give feedback. Marketplace was only
  reachable from the Squad page and the command menu; Connectors only through
  Settings.
- "Report bug and feedback also should be part of the autohand squad mcp
  server too, agents can report automatically when that happens." The same
  day a Chief of Staff run failed on a Squad tool limit (ADR-0257) and nobody
  at Autohand would have heard of it unless the owner filed it by hand.

## Decision

1. **Inbox.** The page title, sidebar row, search entry, settings section,
   window title and the macOS View menu say Inbox (`copy.needsYou` is
   "Inbox"; Rust menu item `inbox`). The page's first tab stays "Needs you":
   inside the Inbox it is the filter for what waits on you, beside In
   progress and All work.
2. **Account menu order.** Inbox, Marketplace, Connectors, Settings (and
   Switch Squad… when there is a choice); then About, Licenses and
   agreements, Keyboard shortcuts; then Report a bug, Give feedback; then
   Sign out. Marketplace opens the in-app marketplace through
   `AccountContext` (the menu is rendered in five places); Connectors opens
   Settings › Connectors.
3. **Agents report through the Squad MCP.** Members get
   `squad_report_bug` and `squad_give_feedback`; MCP clients get
   `report_bug` and `give_feedback`. Both go through `POST
   /api/feedback/agent`, which wraps the app's own sanitised
   `submitSquadFeedback`: labelled "[Bug reported by <member> through the
   Squad MCP]", diagnostics attached (sanitised, can be turned off per call),
   never a screenshot, never the person's email, at most five an hour from
   this computer, and the same text once an hour. The tool descriptions say
   when to use them (Squad problems, not the agent's own mistakes) and to
   tell the person in one line. The member tools default to allowed in the
   permission rows so an agent can report without asking first; the person
   can set them to Ask or Block per member.

## Evidence

- `scripts/check-agent-feedback.mjs` (`check:agent-feedback`) runs a real
  bridge against a local stand-in for the feedback API: label, no
  screenshot, no email, duplicate dropped, 400 for an empty summary, 429 on
  the sixth report with "Tell the person instead".
- `check-control-plane` and `check-team` pass with the tool lists updated;
  `check-team` also proves the permission rows match the tools (ADR-0161).

## Consequences

- Agents can send diagnostics to Autohand without the person approving each
  report. That is the owner's request; the safeguards are the sanitiser,
  the hourly cap, the label, the per-member permission row, and the
  one-line notice the agent is told to give.
- The cap is per computer and in memory; it resets when Squad restarts.
- Older checks and ADRs still say "Needs you" for the page; they are history.

## Addendum, 19 November 2026: Quick Chat composer and Liquid Glass sidebar

The owner: the Quick Chat composer "doesn't look and feel like the main
window, which should be a better send button", and the sidebar should use
Liquid Glass on macOS 27 (27.2.1, "Golden Gate").

- **Quick Chat composer.** It was an `InputGroup` with a hint line, square
  icon buttons and a 28px square send button that read as disabled until
  typing. It now uses the main composer's grammar at Quick Chat's size: the
  rounded card with a soft shadow, the same field, round ghost attach and
  mic, and a 32px round primary send button that becomes a filled Stop while
  a reply runs; the key hint shows only while the field is focused and empty.
  Over Quick Chat's glass the card is 70% opaque so the glass shows through.
- **Liquid Glass sidebar.** The main window was already transparent with
  Sidebar vibrancy behind the default skin's transparent sidebar.
  `src-tauri/src/main_window_material.rs` now puts native Liquid Glass there
  instead when the Mac has `NSGlassEffectView` (macOS 26 and later) and
  Settings › Appearance › "Liquid Glass sidebar" is on (`sidebarLiquidGlass`
  in the Squad's `settings.json`, on by default), using the same
  `window_vibrancy::apply_liquid_glass` path Quick Chat uses. Otherwise, and
  on every earlier macOS, it is the Sidebar vibrancy as before. The page is
  told `data-window-material` and `data-liquid-glass-available` on every page
  load; the setting appears only where Liquid Glass exists. Changing it
  re-applies through the existing settings refresh, without a restart.

Not proven yet: no screenshot of the main window over Liquid Glass exists at
the time of writing; `cargo check` passes and the change is verified in the
signed build installed after this lane (see below). Skins that paint their
own sidebar keep it painted, so they look the same either way.
