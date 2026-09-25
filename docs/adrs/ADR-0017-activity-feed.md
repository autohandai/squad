# ADR-0017: Activity feed semantics

Date: 2026-09-26 · Status: accepted

## Context

Work details under a member's answer is an append-only timeline in which every
harness event weighs the same: streamed text chunks become many rows, a file
read looks like a file write, and a failed command sits between twelve reads
with the same grey dot. The Execution panel prints the last twelve log lines
of a run. A 200-event turn produced well over a hundred rows and hid the one
that mattered. Buzz mutates rows in place, coalesces chunks, ranks failures
above reads, hides a noise class by default, and keeps a raw rail; that is the
reading experience we want, without changing what the harness adapters emit.

## Decision

- **One pure fold, shared by bridge and browser.**
  `server/activity/normalize.mjs` turns any mix of stream events
  (`chatStreamEventFromSdkEvent`), raw harness events, trace events, and
  `run.logs` lines into `ActivityItem { id, kind, verb, object, outcome,
  state, quiet, startedAt, endedAt, detail, refs }`. It has no imports, so
  `src/lib/activity.js` re-exports it for Vite and `scripts/check-activity.mjs`
  runs it under Node. The event protocol is unchanged; the fold is a view.
- **In-place rows through deterministic ids.** An item's id depends only on
  the events before it (`tool:<toolId>`, `message:<messageId>:<n>`,
  `status:<n>`, `tool:log:<n>`), so re-folding a growing list keeps every id
  and a React list keyed by id updates rows rather than appending. A tool row
  is created pending by `tool_start`/`tool_call`, gains streamed output from
  `tool_update`, and resolves on `tool_end`/`tool_result` paired by id; log
  lines pair `started <tool>` with `<tool> completed|failed` by name, last in
  first out.
- **Coalescing.** Consecutive `message_delta`s with one message id are one
  message item, replaced by `message_end` content when it arrives; thought
  deltas are one thought; consecutive status events are one status row;
  consecutive `stdout` log lines outside a tool are one message.
- **Salience.** Reads, lists, searches, fetches, thoughts, and status are
  `quiet`; edits, writes, shell commands, approvals, messages, plans, and
  errors are prominent. A failed item is never quiet. `collapseActivity`
  folds each run of quiet items into one summary row labelled by
  `summarizeQuiet` ("read 12 files · 2 searches"), so a failing read or a
  failing command stays a top-level row without expanding anything.
- **Resolution at the end.** `normalizeActivity(events, { status })` resolves
  still-pending rows once the run is no longer running: done for `completed`,
  failed otherwise, with an outcome that says why. Nothing spins forever.
- **Component.** `src/components/activity/ActivityFeed.jsx` renders the
  collapsed rows as a divider list (no cards): spinner while pending,
  destructive colour with detail open when failed, mono for edits and shell,
  a text "Raw · n" toggle that shows the caller's raw list. The same
  component serves chat rows, channel and DM replies, and the Execution
  panel; `docs/integration/activity.md` maps the props from what
  `AgentWorkTrace` and the runs list receive today.
- **Routes.** `GET /api/runs/:id/activity` folds a run's trace or logs;
  `POST /api/activity/normalize` folds a payload the caller holds. No new SSE
  event: the browser folds the `sdk` events it already receives.

## Consequences

- A 197-event fixture folds to 28 items and 12 collapsed rows (6% of raw
  events), with the failed test command visible in the collapsed feed;
  `bun run check:activity` guards this.
- Tool classification is name-based (`read_file`, `grep`, `apply_patch`,
  `bash`, …) and covers the Autohand, Claude Code, and Codex adapters. An
  unknown tool is a prominent `call` row, never silently quiet.
- `run.logs` carries no tool ids, so log-line pairing is by name and can
  mis-pair two identical concurrent tools; the trace path (`run.trace`) is
  preferred when the harness kept it.
- The old timeline helpers in `App.jsx` (`AgentWorkTrace`, `ToolCallTrace`,
  `buildOrderedWorkEvents`) become dead once the integrator wires the feed and
  can be removed in that change.
