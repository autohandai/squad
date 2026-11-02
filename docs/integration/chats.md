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
| `POST /api/chat/question` | `{ requestId, agentId, question, options, answer }` — the person's answer to a member's `squad_ask` question (ADR-0161 §2.1); body `{ requestId, answer }`. 410 once answered or after the reply ended |
| `GET /api/chat/questions` | `{ pending: [...] }` — questions still waiting, `?agentId=` to filter; for a reopened window |
| `GET /api/members/:id/transcript` | `{ messages, turns, live }` — the member's direct conversation from the bridge's runs (ADR-0163), oldest first, two messages per turn with ids `<requestId>-u` / `<requestId>-a`; `?since=<iso>` leaves out turns before a chat was put away, `?limit=` newest turns (60, max 200), `?name=` the member's name for the placeholder bodies. The newest 12 answers carry `trace` |

A summary is `{ id, memberId, title, startedAt, endedAt, createdAt, harness, workspace, messageCount, turns, limited, resumable }`. `limited` means stream events or trace events were dropped to fit; `resumable` means the record holds at least one engine session id.

## Chat runs

`GET /api/runs` lists chat turns with `mode: "chat"`, `kind: "chat"`, `harness` (`autohand` | `codex` | `claude`), `transport` (`sdk` or the harness id), the prompt as `title`, `reply`, `sessionId`, `durationMs`, `requestId` (the browser's id for the turn), `person` (a direct message from the person, not a goal, routine or channel turn) and the log rows the Execution feed reads. The record also keeps `personPrompt` (what was typed, without the briefing) and the trace while it is under 64 KB, for the transcript (ADR-0163). `POST /api/runs/:id/stop` aborts the turn. No `run.finished` event is emitted for a chat run; `chat.finished` already covers it.

Finished runs (completed, failed, stopped, interrupted) are written to `<appStateDir>/run-history.json` (newest 200, last 120 log lines each) and restored at boot with `restored: true`. `GET /api/runs/:id/activity` still reads the run's OTLP file.

Live chat turns are written too (ADR-0123), with `prompt` and the launch payload a retry needs (never returned by the API). A record that was live when the bridge died comes back as `status: "interrupted"`, `interrupted: true`, `finishedAt` = boot time, with one `system` log line ("Squad restarted while this reply was running…"). Its summary carries `retryable` (true while the launch is held and it has not been retried), `retriedAt` and `retryItemId`. `POST /api/runs/:id/retry` (served by the queues plug-in, see `docs/integration/queues.md`) re-sends the prompt through the member's queue; 409 for any other status, a second retry, or a goal/queue/routine/channel turn.

Cold starts (ADR-0123): when an engine exits with no events, the bridge classifies it (`server/harness/cold-start.mjs`: `disk-space`, `binary-missing`, `not-signed-in`, `bad-flag`, `engine-crash`), retries a transient one once after 750 ms with the same resume id, and the `error` event's `error` text is the classified reason. The run log gets `system` lines (`cold start: …; retrying once in 750 ms`, `… started on the second attempt`). The structured log carries `harness.cold_start` with `autohand.cold_start.kind`. The stale-session retry (forget the resume id, run again fresh) only fires when the engine named the session as the problem.

## Channel threads

A channel thread turn is `ephemeralSession: true` (the member's direct-message resume id is never used) with `_threadSession: thread:<channelId>/<threadId>`: the team and vault servers scope their session to the thread, their config copies are `thread-<hash>.json`, and a healthy session is kept in the pool under that key, so the thread's next turn reuses it until the idle TTL (ADR-0161 §2.5). The thread history (`_channelThreadContext`, with `toolsUsed` per reply) rides on every prompt. `check-thread-warmth` covers it with a fixture SDK.

## Browser

Transcript (ADR-0163): on opening a member, and when one of its chat runs starts or finishes, the app fetches `…/transcript?since=<conversationStartedAt>&name=` and merges it with `mergeTranscript` (`src/lib/transcript.js`): ids and request ids already held are skipped, so is a question with the same words within two minutes (turns from before request ids were recorded), and new turns go in time order. The window that sent the turns sees no change.

New chat: if the conversation has a user message, `POST …/chats` with `archivePayload(agent, messages)`, then `/api/chat/reset`, then the usual `messages.reset`. Opening: `POST …/chats/:id/open` with the current conversation (or `current: null`), then `restoreConversationEvent(memberId, chat)` through `applySharedConversationEvent` and the BroadcastChannel so every window follows. The control is disabled while the member is answering.
