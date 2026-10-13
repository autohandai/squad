# ADR-0063: One place for what needs a person

Date: 2026-10-01
Status: Accepted

## Context

The owner described Inbox and Work as disconnected and requested one view
with a name that communicates its importance to a person. They chose
**Needs you**, with filters for attention, ongoing work, and the full log.

Reading `src/components/inbox/InboxPage.jsx` and `MissionControlPage` in
`src/App.jsx` showed two destinations for the same work. Inbox listed unread
replies and channels, pending handoffs, workflow approvals, and memory
proposals. Work held task/run state, blockers, evidence, and recovery actions.
A pending work record linked to Inbox through Review, while a handoff row in
Inbox ignored its selected task and opened the generic Work page. The person
had to cross pages before finding the context for the decision.

The original Inbox rendered an empty-state section for every event type and
put unread messages ahead of approval gates. Its badge calculation omitted
workflow approvals. Mark all read updated channel reads and an acknowledgement
timestamp but did not update member reads, so unread DM replies could remain.
The timestamp also treated reading a pending decision as acknowledgement,
even though that decision was unresolved. These observations come from source
inspection, not a claim about measured user behaviour.

## Decision

Use one primary destination named **Needs you**. Within it, plain underlined
filters **Needs you / In progress / All work** express three questions about
the same activity. Remember the person's chosen filter; new events do not
move them to another view. Preserve task/run deep links and the former routes
so notifications, native menu actions, and older links continue to reach
their records.

Needs you puts decisions before updates: workflow approvals, handoffs,
failed or blocked work, memory proposals, then unread replies and channels.
Only populated groups appear. When there are no decisions, blockers, or
updates, show one caught-up sentence.

Reuse the calm Work grammar: one column of divider rows, concise metadata,
dot-and-word status, and actions that name the destination. Replies say
Open conversation; channels say Open channel; decision rows say Review
approval, Review handoff, or Review memory. Existing decision surfaces remain
the owners of approval, rejection, handoff review, and memory changes. Work
retains its evidence, details, replay, task/run/workspace links, evaluation
filters, recipes, and runtime failure states.

Reading is separate from deciding. **Mark updates read** clears unread
member and channel activity; it does not remove unresolved decisions from
the list or the attention count. Workflow approvals and permission warnings participate in the
count. Work details open only after a record is selected, and evaluation counts
come from the current filter before evaluation filtering. Opening a handoff retains its task id rather than landing on an
unselected work log.

## Consequences

- A person can scan what needs their judgement beside the work that produced
  it, without maintaining two navigation destinations.
- The chosen name emphasises human involvement. It is less literal for a
  completed-work log than Work; the All work filter supplies that meaning.
- The primary destination and its first filter share a phrase. This is a
  deliberate trade for an unambiguous attention filter alongside ongoing and
  historical records.
- Rows still navigate to existing decision owners. This change does not
  duplicate approvals or memory editors inline, and does not add bulk
  acceptance or rejection.
- A pending task can appear both as a decision and as a work record in
  different filters. That distinction retains useful context; the attention
  view should avoid repeating a handoff as a second generic blocker.
- Internal names and legacy routes can remain Inbox or Mission Control.
  They are compatibility details rather than parallel product destinations.

## Validation

`bun run build`, `bun run check:work-attention`,
`bun run check:notifications`, `bun run check:search`,
`bun run check:members-presence`, `bun run check:skins`, and
`bun run check:theme-tokens` passed. Native menu changes compile under
`cargo check --manifest-path src-tauri/Cargo.toml`.

`node scripts/verify-work-profile-browser.mjs` passed using isolated Chrome,
mocked APIs, and deterministic fixtures. Seven attention items become four
after Mark updates read: approvals, a handoff, blocked work, and a memory
proposal remain while unread replies and channels clear. The test verifies
In progress and All work membership, evaluation counts, no unsolicited detail
expansion, browser Back, completed-record evidence, approval/channel and
handoff/task navigation, and both legacy routes. At 390px and 768px in light
and dark, document and viewport widths match.

The local report and key screenshots live in
`.codex-artifacts/work-profile/` (ignored by Git); the full set of twenty
screenshots lives under `/tmp/autohand-work-profile-browser/`. No provider,
real approval, or run was dispatched; this is browser fixture evidence, not
live-provider or installed-native proof.

## Review corrections

The UI review caught evaluation counts built from all records while In progress
showed only running work. Counts now use the current view, so a completed
evaluation cannot promise a match in the ongoing list. It also caught the
automatic first-record detail panel repeating a row before anyone selected it;
the panel now opens from an explicit record link. Permission warnings
participate in the attention count, so the header cannot say caught up while
showing unresolved policy issues.

Visual inspection caught an unselected work row with a visible left border:
the unlayered global border colour overrode the transparent utility. Unselected
rows now have zero left-border width, reserving that mark for selection.

Removing the duplicate native Work/Mission Control menu item also removes its
separate CmdOrCtrl+Shift+M shortcut. Needs you retains CmdOrCtrl+1; legacy
routes and dispatched action ids remain supported.
