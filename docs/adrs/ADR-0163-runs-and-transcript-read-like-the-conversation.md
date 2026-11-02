# ADR-0163: The Runs tab and the transcript read like the conversation

Date: 2026-11-02
Status: Accepted. Amends the run row of ADR-0117 and the chat storage note of ADR-0113.

## Context and evidence

Watching the demo team build the pie shop site (ADR-0161 §11), the person
opened the Frontend Developer's Runs tab and read, under a finished reply:

```
autohand --mode rpc --path /Users/…/pie-shop --config /Users/…/config.json …
Output · 260 lines                                   Raw · 260
  3 status updates
  Edited styles.css · Added 492 lines
  7 status updates
  Edited app.js · Added 118 lines
```

Their question was what a person is supposed to do with that. The command
line is how the bridge started the engine; "Output · 260 lines" counts log
lines, which say nothing about the work; "Raw · 260" is the unprocessed
log; and the "status updates" rows are the engine's keep-alive pings and
hook notifications, folded into summary rows between the edits. The chat's
Work details for the same reply already filters those out
(`chatWorkActivity`, ADR-0153) and reads "Work details · 2 tools · 1m 12s";
the Runs tab used the unfiltered feed and the `Output` label from ADR-0117,
written when the Runs tab was the only place a launched run's log could be
read.

The second thing the person asked for: clicking a member and seeing the
conversation. A direct conversation lives in the browser that sent it
(localStorage, synced across that browser's windows by a BroadcastChannel,
ADR-0113) and in the chats a person puts away. The demo was driven from a
headless browser, so the desktop app's window opened the Frontend Developer
to an empty chat while the bridge had every turn: `beginChatRun` keeps the
prompt, `finishChatRun` the reply and trace, and `run-history.json` keeps
the newest 200. The same gap meets anyone who opens Squad from a phone, a
second machine's browser, or after a profile reset.

## Decision

1. **A run row's disclosure is the chat's Work details.** `RunActivity`
   (`src/components/execution/RunList.jsx`) runs the feed through
   `chatWorkActivity`, so thoughts, status chatter and message echoes are
   gone unless they failed, and its summary reads "Work details · 2 tools ·
   1m 12s" from `activityStats`. A live turn reads "Working…"; a finished
   turn with an answer and no tools reads "Reply only"; one with neither
   reads "No work recorded". A chat turn shows its reply text under the
   summary (six lines, then an ellipsis). The command line and the Raw
   toggle appear only with the chat's diagnostic-output setting on, the
   same setting that gates them in the chat; `ExecutionPanel` receives it
   as `diagnostics`.

2. **The bridge serves the transcript.** `GET /api/members/:id/transcript`
   (`server/chats/transcript.mjs`, pure, over the live `runs` Map) returns
   the member's direct turns as messages with the ids the sending window
   used, `<requestId>-u` and `<requestId>-a`, oldest first: the question,
   then the answer with its status, times, duration, model and, for the
   newest twelve, the trace Work details needs. `?since=` leaves out turns
   of a chat that was put away. For that, chat runs now record
   `requestId`, `person` (the bridge's own `isPersonTurn`) and
   `personPrompt`, what the person typed without the briefing the first
   message carries; the history record keeps them and a trace up to 64 KB.
   Channel turns, goals, routines and launched runs are not the
   conversation and are left out.

3. **The window merges, never replaces.** On opening a member, and whenever
   one of its chat turns starts or finishes (`transcriptKey` over the runs
   list the app already polls), the app fetches the transcript since the
   member's `conversationStartedAt` and `mergeTranscript`
   (`src/lib/transcript.js`) adds only what the window has never seen, in
   time order among what it holds. A message with the same id, or the same
   request id and role, is already here. So is a question with the same
   words within two minutes, which is how a turn sent before the bridge kept
   request ids is recognised; its answer is skipped with it. A turn learnt
   from the bridge while it was running resolves on the next merge; a turn
   this window is streaming is never overwritten. The window that sent the
   turns therefore sees no change.

## Consequences and validation

- `check-transcript` covers the person-run test (flag, then prefix for
  older records), the message shape, `since` and `limit`, the trace cap,
  the history round trip, and every merge rule above.
  `check-execution-panel-browser` now expects the Work details line, no
  output count, Raw toggle, status chatter or command line, the reply under
  the row, and a browser profile that sent none of the seeded turns showing
  them in the chat, from the conversation start onward, with the one turn
  it held not added twice. Screenshots in `.codex-artifacts/runs-panel/`.
- The fixture's "tool" log lines were written with `source: "stdout"` and
  had folded into a single message row all along; the check passed because
  it only counted lines. They now carry `source: "tool"` as `appendLog`
  writes them.
- Left undone: a transcript turn's Work details come from the trace only
  for the newest twelve turns and only when the trace fit the history
  record; older turns show the reply alone. Permission cards, team
  proposals and attachments are not reconstructed from runs. Members
  themselves still live in the browser's localStorage; a machine with no
  roster snapshot shows no member to click. The transcript is read on
  opening and on turn boundaries, not streamed, so a reply running in
  another window shows as "thinking" until it finishes.
- The run history file grows by the traces it now keeps, at most 200 ×
  64 KB.
