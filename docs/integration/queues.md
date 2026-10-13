# Queues: durable member follow-ups and the context gauge (ADR-0111)

Module files:

- `server/queues/store.mjs` — `QueueStore` over `<squadStateDir>/queues.json` (atomic writes, restart recovery).
- `server/queues/dispatcher.mjs` — `QueueDispatcher`: runs the next queued item when the member is free.
- `server/queues/context-gauge.mjs` — `contextUsageFromUsage()`, `contextGauge()` (pure).
- `server/routes/queues.route.mjs` — auto-loaded route plug-in; owns the store and dispatcher.
- `src/lib/member-queue.js` — `reconcileQueueMessages()`, `movedQueueIds()`, `isQueueRunning()`, gauge labels (pure).
- `src/components/chat/FollowUpQueue.jsx` — the list above the composer.
- `src/components/chat/ContextGauge.jsx` — `ContextGaugeMeta`, `ContextWarningLine`.
- `scripts/check-queues.mjs` — real bridge + fake harness; `bun run check:queues`.

## Routes

| Route | Response `data` |
| --- | --- |
| `GET /api/queues[?memberId=]` | `{ queues: { [memberId]: queue }, context: { [memberId]: gauge } }` |
| `GET /api/queues/context` | `{ [memberId]: gauge }` — only members with a known usage and window |
| `GET /api/queues/:memberId` | `queue` plus `context` |
| `POST /api/queues/:memberId/items` | 201, the item. Body is the chat payload (`agent, squadMembers, workspace, policy, model, profile`) plus `text` |
| `POST /api/queues/:memberId/reorder` | `{ ids }` every queued id in its new order; 400 otherwise |
| `POST /api/queues/:memberId/pause` / `resume` / `stop` / `clear` | the queue; `stop` cancels the running item and pauses; `clear` cancels queued items |
| `POST /api/queues/items/:id/update` | `{ text }`; only a queued item |
| `POST /api/queues/items/:id/cancel` | the item; cancelling the running one is a stop |

`queue` = `{ memberId, paused, pauseReason, updatedAt, items[] }`. Item =
`{ id, memberId, workspace, text, attachments[], status, createdAt, updatedAt,
startedAt, finishedAt, reply, error, progress, result, interrupted? }` with
`status` in `queued | running | done | failed | cancelled`. `gauge` =
`{ percent, usedTokens, window, warning, model, harness, at }`.

### `POST /api/runs/:id/retry` (ADR-0123)

Re-sends a chat turn that a bridge restart interrupted. The run must be `status: "interrupted"` with a held launch payload (a direct chat turn; goal, queue, routine and channel turns answer 409). Enqueues `{ ...launch, text: run.prompt }` on the member's queue, records `retryItemId`/`retriedAt` on the run, emits `queue.enqueued` with `retryOfRunId`, and answers `201 { item, runId, paused, pauseReason }`. `paused` is true when the member's queue is paused (for example by the restart itself, ADR-0111); the item then waits for Resume. A second retry of the same run is 409.

## Bridge context used

`ctx.executeTurn` (the same bridge-owned turn goals use), `ctx.registerChat`,
`ctx.isMemberBusy`, `ctx.availability`, `ctx.modelContextWindow`, `ctx.events`,
`ctx.emit`. All four new fields are wired in `server.mjs` `routeContext()`.

Events consumed: `chat.finished`, `run.finished`, `member.stopped`,
`goal.finished`, `member.availability` (dispatch triggers) and
`usage.recorded` (gauge; `server.mjs` now emits it from `recordUsageTelemetry`
with `contextTokens` and `contextWindow`). Events emitted: `queue.enqueued`,
`queue.started`, `queue.finished`, and `chat.finished` with `queueItemId`.

## `App.jsx` wiring (done in this change)

- Poll: `refreshMemberQueues` beside `refreshMemberGoals`, inside
  `pollMemberWork` (2.5 s); reconciles with `reconcileQueueMessages`.
- `controlMemberQueue(memberId, action, body)` maps `edit`, `cancel`, `move`,
  `pause`, `resume`, `stop`, `clear` to the routes above.
- `sendChat(agentId, { ..., queue: true })` posts the chat payload to
  `/api/queues/:id/items` instead of streaming.
- `Conversation` props: `queue`, `contextGauge`, `onQueueAction`; both mounts
  (main chat and Quick Chat) pass them.
- Inside `Conversation`: `FollowUpQueue` replaces the local `QueuedFollowups`;
  `chatSending` includes `isQueueRunning(queue)`; `submit` enqueues when a
  queue item is running; Stop calls `stop`; New chat calls `clear`;
  `ContextGaugeMeta` sits after the model in the header meta line and
  `ContextWarningLine` above the composer.

## Copy keys (`src/locales.js`)

`queuePause, queueResume, queuePaused, queueMoveUp, queueMoveDown, queueSendNow,
queueItemQueued, queueItemRunning, queueItemDone, queueItemFailed,
queueItemCancelled, contextUsage, contextWarning`.
