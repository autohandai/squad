# ADR-0111: Durable member queues and a context gauge

Date: 2026-10-13
Status: Accepted
Lane: L11 queues (docs/superpowers/specs/2026-10-13-parity-lanes-design.md)

## Context and evidence

The follow-up queue above the member composer lived in React state
(`queuedFollowupsByAgent` in `src/App.jsx`). It was lost on reload, on
`/new`, and when the quick-chat popover was dismissed; its items were sent
by the browser one after another from the `finally` of the previous turn, so
closing the window dropped them, and nothing could pause or reorder them.
The reference behaviour (nightly-labs OpenBot "What works": FIFO queues with
pause, resume and cancel, crash-safe persistence, per-agent context
monitoring) was read for behaviour only; its code is PolyForm Noncommercial
and nothing from it was copied.

Durable goals (ADR-0066) already show the shape that survives all of this:
state on the bridge, a bridge-owned turn through `executeChatTurn`, and the
browser reconciling the record into the conversation instead of owning it.

What the harnesses report about context, checked in the adapters and against
the fixture in `scripts/check-queues.mjs`:

| Harness | Usage event | Tokens that count as context | Model window |
| --- | --- | --- | --- |
| Claude Code (`server/harness/claude.mjs`) | `result.usage` | `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` | `result.modelUsage[model].contextWindow` in current builds; absent in older ones |
| Codex (`server/harness/codex.mjs`) | `turn.completed.usage` | `input_tokens` (already includes `cached_input_tokens`) | not reported; the bridge has no catalog window for OpenAI models |
| Autohand SDK / CLI | none reaches the trace | none | the Autohand AI catalog carries `contextWindow`, but with no usage figure it is unused |

So only Claude Code produces both halves today. The fixture turn with
4,000 input, 20,000 cache-creation and 60,000 cache-read tokens against a
200,000 window yields the 42% the check asserts; the Codex fixture turn with
90,000 input tokens records usage (`telemetry.jsonl` carries
`contextTokens: 90000`) and shows no gauge. The Autohand SDK only reports
`hook_context_overflow` with `usagePercent` once the ceiling is hit
(`server/sdk-events.mjs`), which is too late to be a gauge.

Two wrong first answers from writing the check, kept because they say what
the bridge actually does:

- Presence does not show a bridge-owned follow-up as Working. Presence is
  derived from the warm session pool and the run table
  (`server/members/presence.mjs`); an external-harness chat, browser-owned or
  queue-owned, registers in `activeChats` only. The member chat header shows
  Working from its own state, which now includes a running queue item; the
  directory dot does not change for either kind of chat. Left as is.
- Stop arrived 5 ms after the item turned `running` (07:19:30.937 to .942 in
  the run) and the harness child had not spawned yet, so no abort record
  appeared. The turn's preparation (saved member, channel actions, runtime)
  is asynchronous; the item is `running` from the moment the dispatcher
  claims it. The check now waits for the child, not the status.

## Decision

The bridge owns one FIFO queue per member in `<squadStateDir>/queues.json`
(`server/queues/store.mjs`, atomic writes through `server/persistent-json.mjs`).
Items carry `id, memberId, workspace, text, attachments[] (references only),
status, createdAt, updatedAt, startedAt, finishedAt, reply, error, progress,
result` plus a private scrubbed launch payload that the public item never
exposes. Routes live in `server/routes/queues.route.mjs`: list, enqueue,
update, reorder, cancel, pause, resume, stop, clear, and the context map.

`server/queues/dispatcher.mjs` starts the next queued item only when the
member is free: no active chat, no busy warm session, no live run, no
running goal (`isMemberBusy` in `server.mjs`), not on a break, queue not
paused. It runs the item through the same `executeBridgeTurn` goals use and
registers it as an active chat, so the member stop route aborts it and the
project observer defers to it. There is no second harness launcher.

Restart recovery follows ADR-0066: a running item becomes `failed` with
"This follow-up was interrupted when Squad restarted. No final update was
received. Queue it again to continue." (same family as
`src/lib/chat-recovery.js`), queued items stay queued, and every member with
queued or interrupted items is paused with "The bridge restarted. Resume the
queue when you are ready to continue." Nothing is re-sent until a person
resumes. Stop, from the composer or the member stop route, cancels the
running item and pauses the queue with "Stopped by you." A failed turn also
pauses the queue with its cause, so the next follow-up does not build on a
failure nobody read. A member on a break is not dispatched; ending the break
lets an unpaused queue continue, and does not resume a paused one.

The browser (`src/lib/member-queue.js`, `src/components/chat/FollowUpQueue.jsx`)
polls `GET /api/queues` with the goals poll and reconciles items that have
started into the conversation as a user row and a reply row, in start-time
order, exactly like goals. Queued items stay above the composer: editable
text, Move up/down, Send now, Edit, Remove, one Pause/Resume control, status
dots; the quick-chat popover shows the same list compactly. Sending while the
member is busy enqueues through the chat payload builder (`launch.queue`);
sending while free streams as before. Send now takes the item off the bridge
first, then steers.

The context gauge (`server/queues/context-gauge.mjs`) is computed from the
`usage.recorded` event the bridge already records for every turn, extended
with `contextTokens` and `contextWindow`, and exposed at
`GET /api/queues/context` and on each member's queue. The meta line shows
"Context 42%"; at 85% and above the figure turns amber and one line above the
composer says so. Unknown usage or window shows nothing.

## Consequences

- Explicit resume after a restart, even when nothing was running: a queued
  item waiting on a member that was idle still needs a person to resume. This
  trades a small annoyance for never surprising someone with work that starts
  the moment the app reopens.
- Only Claude Code members get a gauge today. Codex members report usage
  without a window; Autohand SDK members report nothing. The Autohand AI
  catalog windows are wired (`modelContextWindow` in the route context) and
  will light up when the SDK reports input tokens. Older Claude Code builds
  without `modelUsage` also show nothing.
- Bridge-owned follow-ups do not stream text deltas to the browser. The reply
  row shows "working on the follow-up" with the reported checklist until the
  final reply lands on the next poll (2.5 s cadence). A per-item SSE stream
  was left out; goals have one and the same pattern would fit.
- Cancelling the running item is a stop: it pauses the queue rather than
  skipping to the next item. A "skip and continue" was not built.
- Attachments are stored as references only; the direct-message composer has
  no attachment control, so nothing produces them yet.
- The queue lost one behaviour: Stop used to clear the local list. Now Stop
  keeps the items and pauses, which is what durable means; Remove and New
  chat (clear) are the ways to drop them.
- No drag reorder; arrows only. Drag was not worth a dependency or a custom
  pointer handler for a list that is rarely longer than three.
- Presence still does not count an external-harness chat as Working (noted
  above). Changing that is a presence decision, not a queue one.
