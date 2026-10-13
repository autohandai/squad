# ADR-0113: Previous chats, and every chat turn is a run

Date: 2026-10-13
Status: Accepted

## Context and evidence

A member running on Claude Code showed, in the chat, "Work details · 9
steps · 5 tools · 1 min 30 sec" and, in the Execution panel beside it, "0
parent tasks · 0 handoffs · 0 blocked" with an empty Runs tab. The person
asked why Claude Code and Codex were not as well integrated as Autohand
Code, and why there was no way back to an earlier conversation after New
chat.

What the code actually did, read on 2026-10-13:

- `runs` in `server.mjs` is an in-memory `Map` filled only by `POST
  /api/runs` (the launch surface, replay, automations). A chat turn, on any
  engine, went through `executeChatTurn` and never touched it. So the Runs
  tab was empty for Autohand members too; the engine was not the
  difference, the entry point was. The Map also emptied on every restart.
- "New chat" posted `/api/chat/reset`, which only closed the warm Autohand
  SDK session. Claude Code and Codex resume by id (`--resume <session>`,
  `exec resume <thread>`), and that id lives in the member's
  `harness-sessions.json` (`server/harness/registry.mjs`), which the reset
  never cleared. A "new" chat with a Claude Code member therefore continued
  the old session with the old context. The `scripts/check-chats.mjs`
  fixture records the arguments it is started with; before the fix the turn
  after a reset still carried `--resume`.
- The reset event replaced the conversation with the welcome message and
  nothing kept the old one. The member History (ADR-0018) keeps an audit
  trail, not the conversation.
- The schedule-from-chat instruction (ADR-0110) is already part of the DM
  context for every engine (`buildTeammateContext` in `src/App.jsx`), so an
  Automations tab that shows nothing for a Claude Code member means no
  routine has been proposed or created yet, not a missing seam. Nothing
  changed there.

## Decision

**Every chat turn is a run.** `executeChatTurn` registers a run record
before the turn starts (`mode: "chat"`, the member's engine as `harness`,
the prompt as the title) and finishes it with the reply, the trace, the
command, the session id and the duration. The stream is wrapped so tool
rows, the final text, errors and status lines land in the run log, in the
row kinds the Execution feed already reads. Stop in the Execution panel
aborts the turn through the run's own controller, which the chat's
controller also forwards to. Goal turns, queued follow-ups, routine
dispatches and Telegram turns all go through `executeChatTurn`, so they
appear too. No `run.finished` event is emitted for a chat run:
`chat.finished` already reaches the audit trail and the phone, and a second
event would double both.

**Finished runs outlive the process.** `server/runs/history.mjs` writes
the newest 200 finished runs (summary and the last 120 log lines) to
`<appStateDir>/run-history.json`, debounced, on every finish and at
shutdown, and reads them back into the Map at boot, oldest first, so `GET
/api/runs` keeps its newest-first order. Full activity still comes from the
run's OTLP log file. Live runs are never written; a run that was running
when the process died is simply absent.

**Previous chats.** New chat now puts the conversation away before it
resets: `POST /api/members/:id/chats` stores the messages, when it started,
the engine and the workspace under `<squadStateDir>/chats/<memberId>/`,
and in the same request captures the member's harness session ids and
forgets them, and closes the SDK session. A History icon beside New chat
lists what was put away, newest first, one row each: the first question,
turns, engine, when. Opening a row puts the current conversation away the
same way, restores that chat's session ids, removes it from the list and
makes its messages the live conversation; the next message continues with
Claude Code or Codex exactly where that session stopped. Remove deletes
one. `/api/chat/reset` also forgets the ids now, so a chat with nothing
worth keeping still starts clean. The record is bounded (400 messages, 4
MB: raw stream events go first, then trace events; the reply text always
stays) and 100 per member.

The restore reuses the `messages.reset` event, so every open window moves
together; its message cap rose from 100 to the archive's 400.

## Evidence

`bun run check:chats` (`scripts/check-chats.mjs`) runs a real bridge in a
temporary state dir with a fake Claude Code executable that records its
arguments and reports a session id. It proves: the chat turn is listed by
`GET /api/runs` with `mode: "chat"`, `harness: "claude"`, status
completed, the prompt as title, the reply and a tool row in the log; the
resume id is on disk after the first turn and gone after the chat is put
away; the next turn starts without `--resume`; opening the chat restores
the id and the following turn resumes it; a second open is 404;
`/api/chat/reset` reports `forgotten: 1`; after `SIGTERM` and a restart
the three finished runs are listed in the same order with their replies
and the activity route still answers; delete and the two validation cases.
Pure checks cover the record bounds, the summary shape, session
normalisation, the history record and a 150-message restore through
`applySharedConversationEvent`. Neighbouring checks were run after the
change: shared-conversations, bridge-imports, goal-bridge,
run-channel-actions, routines, audit, remote-access, member-goals all pass;
queues passed three times in a row after one timeout that coincided with
the web build running on the same machine.

## What was learnt: the app could not render and 79 checks passed

The first install of this change opened to "Autohand Squad could not
render — Cannot access uninitialized variable". Headless Chrome against the
installed bridge gave `ReferenceError: Cannot access 'Kl' before
initialization`; an unminified build (`vite build --minify false`) named
it: `routineProposals`. The routines lane (ADR-0110) declared
`const [routineProposals] = useState([])` about 1,800 lines below the
Needs-you count that reads `routineProposals.length`, and the merge put the
count first. Nothing in `bun run ci` executes the bundle: `check:web` only
builds it, and the browser checks are outside the chain. The wrong first
diagnosis was that the fix "held" because a second `--dump-dom` run showed
no error: that dump was empty, because the repaired app polls the bridge and
virtual time never settles, so Chrome printed nothing. Silence looked like
success.

Decision: the two routines state hooks move up beside the other state, and
`scripts/check-render.mjs` (`bun run check:render`, in the chain right
after `check:web`) serves `dist/` through a throwaway bridge, opens it in
headless Chrome over the DevTools protocol, and fails on the error boundary,
any uncaught exception, or an empty `#root`. Run against the broken bundle
it reports the boundary and the `ReferenceError`; against the fixed one it
passes. Without Chrome it warns and passes unless
`AUTOHAND_REQUIRE_BROWSER=1`.

## What was learnt, second: the first real chat was never kept

The first install showed "No previous chats yet" after New chat on a real
conversation. No file existed under `<squadStateDir>/chats`. The bridge's
`readBody` default limit is 1 MB; a conversation with Work details is a few
MB of JSON (a two-message chat with 400 tool rows measured 2,036,135 bytes
and got `413 request body too large`), and the app's catch swallowed the
refusal. Decision: the chats route reads up to 32 MB, the app drops raw
stream events above a 3 MB transfer budget before sending (the reply text
and trace stay, the message is marked), and a failed keep is written into
the fresh conversation as a Squad note with the reason. `check:chats` now
archives a 5 MB conversation and asserts it is accepted and trimmed.

## What was learnt, third: replies were unreadable

Every bullet in a reply rendered as a dot on its own line with the text
below it, and numbered lists lost their numbers. The list row used the
Tailwind class `grid-cols-[1rem,minmax(0,1fr)]`; with a comma the compiled
rule is `grid-template-columns:1rem,minmax(0,1fr)`, which is invalid CSS,
so the grid fell back to one column. The spelling is
`grid-cols-[1.25rem_minmax(0,1fr)]`. The parser now keeps the ordinal of
`1.` items and the renderer prints it. Before/after screenshots from the
headless-Chrome harness are in `.codex-artifacts/formatting/`.

## Consequences

- The Runs tab now fills with every reply, so a busy member produces a long
  list. The row says "chat reply" and the engine; there is no filter yet
  between launched runs and chat turns.
- Chat runs count as live runs in `isMemberBusy`, which is consistent with
  the active-chat set the bridge already consulted, but a reader of
  `/api/runs` can no longer assume every run was launched.
- Opening a previous chat is a swap, not a view: the record leaves the list
  and becomes the live conversation. There is no read-only preview.
- Autohand members have no resumable session id, so an opened chat shows
  its messages but the engine starts a fresh context. The row says "new
  engine session" for those.
- The Runs tab's empty-state copy changed in English only; the other locales
  still say "No Autohand runs" until translated.
- Nothing links a chat message to its run yet; the Execution panel and Work
  details show the same activity from two records.
- Runs that were live at a crash are not recovered as "interrupted"; they
  are absent, while queues and goals keep their own recovery.
- The render check needs Chrome; on a machine without one it only warns,
  so the chain can still pass without having rendered the app there.
