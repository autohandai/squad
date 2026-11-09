# ADR-0187: Agent assignments use the member queue

Date: 2026-11-09

## Context and evidence

The Tasks view combined persisted commitments with browser-owned launched
and handed-off work. A member could edit its own plan or message a teammate,
but could not create a queued commitment in that teammate's Tasks view.
Launched tasks had no owner Delete action, plan actions were hover-only and
the Done list hid all but six records. Messaging and task assignment were
different operations; a sentence saying work was sent did not establish a task.

The existing queue already serializes direct work per member, waits for busy
engines, persists across restarts and reports real execution outcomes. Creating
a second task executor would give the member two conflicting admission paths.

## Decision

Add `squad_assign_task(to, title, detail, request_id)` to the managed team MCP.
Resolve the sender from the active turn and the recipient from the saved roster.
Record a persisted work task with its sender, then enqueue it in the existing
member queue. Deduplicate by sender/request id and by work-task id in the queue.
Keep delegation depth and ancestor identities across delayed execution to
prevent assignments back to a waiting sender and unbounded delegation chains.

Queue events and authoritative reads project queued/running/finished states into the task, including Clear and cancellation before a run starts. Linked queued/running tasks cannot be manually marked complete or edited independently of their queued instructions; delete cancels them. Only a real
successful result marks execution done. Startup reconciles queue records with
the plan. An intent that never reached the queue becomes visibly blocked rather
than pretending to have run. Owner-created plan tasks use the same Queue task
action, replacing a plain Ask message with no linked execution record.

Every plan and launched/handoff row has a visible text Delete action with an
inline second decision. Show every retained Done task. Deleting an assigned
task cancels that exact queue item and preserves the other items' order. Owner
deletion does not pause unrelated work. Ordinary composer Stop still pauses. Deleting a recurring plan task stops its current occurrence while retaining the future schedule; the inline confirmation states that distinction. A deletion cutoff also cancels an already-preparing occurrence that reports its start late, without recreating its plan row.
Persist deletion tombstones so retries, stale windows and late run results
cannot restore deleted rows. Runs carry their owner task identity; deleted
task identities are rejected before starting an engine. Task refresh is independent of automation/bootstrap polling: a browser reload test initially restored a stale local row when that polling had not started, despite a saved bridge tombstone. The dedicated work refresh removes that dependency. The first interpretation was incomplete: subsequent multi-navigation folder tests also stalled because Chrome's back-forward cache retained old pages' SSE connections. Those full-navigation fixtures now disable that cache; the reload failure alone is not evidence that automation polling was its only cause.

## Validation

`check-task-assignments.mjs` first failed on the missing managed tool. It now
uses the actual MCP dispatcher, disk stores and queue dispatcher with a gated
executor to verify busy waiting, concurrent retry deduplication, persisted
sender identity, request collisions, cancellation before dispatch, selected
running-item deletion, the following item continuing and the real completion
outcome. Sender spoofing and self-assignment are refused.

`check-team.mjs` also exercises assignment through a child MCP process and the
actual bridge, then deletes the resulting task through the owner API. Its held
engine fixtures verify targeted runtime deletion and rejection of a deleted
task before execution. Existing work-plan, queue and team checks pass with
fixture engines; these are not claims about a live provider. A held recurring-run test first showed that removing its row left the occurrence executing. The work-plan regression now verifies that it stops while its schedule remains enabled; `check-routine-task-delete-race.mjs` gates preparation and verifies cancellation of the late run receipt without row resurrection.

## Consequences

Assignments wait behind other direct work and inherit queue pause/restart
rules; they are not an immediate parallel lane. Independent reply threads
retain their existing separate-session contract. Tasks keep their sender's
name at assignment time, even if that member later changes their name.
Tombstones are durable administrative state and intentionally outlive the
visible rows. Deleting a task removes its management row and cancels associated
execution; it does not erase the conversation, run evidence or files produced
before cancellation. Already performed external effects cannot be undone by
deleting their task.
