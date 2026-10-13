# Previous chats and chat runs (ADR-0113)

Module files:

- `server/chats/store.mjs` — `ChatStore` over `<squadStateDir>/chats/<memberId>/<chatId>.json`; `buildChatRecord()`, `boundMessages()`, `chatSummary()` (pure).
- `server/chats/recall.mjs` — `buildRecall()` (pure), `collectRecallSources()`; the block is appended to the profile on every direct-message turn (ADR-0115).
- `server/chats/sessions.mjs` — read, capture, clear and restore a member's harness resume ids (`<agentHome>/harness-sessions.json`).
- `server/routes/chats.route.mjs` — auto-loaded route plug-in.
- `server/runs/history.mjs` — finished runs persisted to `<appStateDir>/run-history.json` and restored at boot.
- `server.mjs` — `beginChatRun` / `chatRunStream` / `finishChatRun` around `executeChatTurn`; `/api/chat/reset` also forgets harness ids.
- `src/lib/chat-sessions.js` — `conversationHasWork()`, `archivePayload()`, `restoreConversationEvent()`, `chatMetaLine()` (pure).
- `src/components/chat/PreviousChats.jsx` — the History control beside New chat.
- `scripts/check-chats.mjs` — real bridge + fake harness; `bun run check:chats`.

## Routes

| Route | Response `data` |
| --- | --- |
| `GET /api/members/:id/chats` | `{ chats: [summary] }` newest first |
| `POST /api/members/:id/chats` | 201, the summary. Body `{ messages, startedAt, endedAt, harness, workspace, title }`. Captures and forgets the member's harness session ids, closes its SDK session |
| `GET /api/members/:id/chats/:chatId` | the record: summary fields plus `messages` and `sessions` |
| `POST /api/members/:id/chats/:chatId/open` | `{ chat, archived, sessionsRestored }`. Body `{ current? }` with the same shape as the POST above puts the current conversation away first. Restores the chat's session ids and removes it from the list; 404 once opened |
| `DELETE /api/members/:id/chats/:chatId` | `{ removed }` |
| `GET /api/members/:id/recall` | `{ text, counts }` — the "Earlier conversations" block the member receives on its next direct-message turn (ADR-0115); `counts` is `{ ownChats, otherChats, otherTurns, channels }` |
| `POST /api/chat/reset` | `{ agentId, closed, forgotten }` — `forgotten` is the number of harness ids cleared |

A summary is `{ id, memberId, title, startedAt, endedAt, createdAt, harness, workspace, messageCount, turns, limited, resumable }`. `limited` means stream events or trace events were dropped to fit; `resumable` means the record holds at least one engine session id.

## Chat runs

`GET /api/runs` lists chat turns with `mode: "chat"`, `kind: "chat"`, `harness` (`autohand` | `codex` | `claude`), `transport` (`sdk` or the harness id), the prompt as `title`, `reply`, `sessionId`, `durationMs` and the log rows the Execution feed reads. `POST /api/runs/:id/stop` aborts the turn. No `run.finished` event is emitted for a chat run; `chat.finished` already covers it.

Finished runs (completed, failed, stopped, interrupted) are written to `<appStateDir>/run-history.json` (newest 200, last 120 log lines each) and restored at boot with `restored: true`. `GET /api/runs/:id/activity` still reads the run's OTLP file.

Live chat turns are written too (ADR-0123), with `prompt` and the launch payload a retry needs (never returned by the API). A record that was live when the bridge died comes back as `status: "interrupted"`, `interrupted: true`, `finishedAt` = boot time, with one `system` log line ("Squad restarted while this reply was running…"). Its summary carries `retryable` (true while the launch is held and it has not been retried), `retriedAt` and `retryItemId`. `POST /api/runs/:id/retry` (served by the queues plug-in, see `docs/integration/queues.md`) re-sends the prompt through the member's queue; 409 for any other status, a second retry, or a goal/queue/routine/channel turn.

Cold starts (ADR-0123): when an engine exits with no events, the bridge classifies it (`server/harness/cold-start.mjs`: `disk-space`, `binary-missing`, `not-signed-in`, `bad-flag`, `engine-crash`), retries a transient one once after 750 ms with the same resume id, and the `error` event's `error` text is the classified reason. The run log gets `system` lines (`cold start: …; retrying once in 750 ms`, `… started on the second attempt`). The structured log carries `harness.cold_start` with `autohand.cold_start.kind`. The stale-session retry (forget the resume id, run again fresh) only fires when the engine named the session as the problem.

## Browser

New chat: if the conversation has a user message, `POST …/chats` with `archivePayload(agent, messages)`, then `/api/chat/reset`, then the usual `messages.reset`. Opening: `POST …/chats/:id/open` with the current conversation (or `current: null`), then `restoreConversationEvent(memberId, chat)` through `applySharedConversationEvent` and the BroadcastChannel so every window follows. The control is disabled while the member is answering.
