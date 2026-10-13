# ADR-0125: Always-on members

Date: 2026-10-14 · Status: accepted · Lane: always-on

## Context

The person asked, in their words:

1. "alex is on claude code harness, but showing autohandai/moa as provider
   which is totally wrong"
2. "when the user uses plain english, claude code or codex or autohand
   harness is clever enough to actually set up the automation, or ask
   follow-up questions if the user wants to automate the process they keep
   asking over and over; I guess this is just an instruction to give.
   Architect this well and fill the gaps on my existing features and new
   features working now and my entire notion of always-on agent working."

What they saw: Alex's chat header meta line read "Working · leads · Autohand
AI / moa · Context 24% · Claude Code", while the Runs with popover beside it
said "Claude Code · Ready · Claude 2.1.296". And the calendar icon in the
chat header opened New Automation: Name, Workspace source, an "Automation
Description" box with a model select set to "auto", and three Trigger cards
(Schedule / Event / Webhook). They do not want to fill that in by hand.

## Architecture: the agenda

"Always on" is not a new engine or a daemon per member. It is a name for
four things the bridge already keeps for a member, read as one list, plus a
rule for when the bridge may act on that list without being asked.

| Part of the agenda | Kept in | Who starts it today | ADR |
| --- | --- | --- | --- |
| Routines (scheduled work) | `routines.json` | the bridge scheduler, at the time | 0110 |
| Queue (follow-ups the person sent while busy) | `queues.json` | the queue dispatcher, when the member is free | 0111 |
| Goals (pursue until done) | `goals.json` | the goal manager, turn after turn, until done, paused or blocked | 0066 |
| Work-plan tasks (what the member said it will do) | `work.json` | nobody: a task waits until someone asks | 0124 |

Three of the four already run without the person. The gap is the fourth,
and the edges between them: a goal paused by a restart stays paused, an
open task stays open, and recurring work the person keeps asking for by
hand never becomes a routine unless the member happens to propose one.

So the agenda is:

- **One reader.** `buildWorkPlanBlock` (ADR-0124) is already the one place
  that reads all four for the member's prompt. The agenda picker
  (`nextAgendaItem` in `src/lib/work-plans.js`, pure) reads the same
  sources and answers one question: what, if anything, should this member
  start now? Routines and the queue are never picked; they have their own
  starters. A goal is picked only when it is paused for a reason that is
  not a person's decision (the bridge restarted, the runtime boundary was
  reached). Then an open task, by due date and age, that the agenda has not
  already tried today and that no routine owns.
- **One permission.** A per-member switch, "Keep working between messages",
  off by default, kept on the bridge (`always-on.json`) like breaks are
  (ADR-0027), so it holds with the app closed. The bridge never starts
  anything for a member whose switch is off.
- **One starter, one at a time.** `server/routes/agenda.route.mjs` ticks.
  For a member with the switch on that is idle (no chat, run, goal or queue
  item in flight, not on a break) and has been quiet since the person's
  last message for the idle period, it starts the picked item: a goal by
  resuming it through the goal manager, a task as an ordinary bridge run
  (`startRun`, the routine path) under the member's own engine, access and
  folders. It starts at most one item per member at a time and at most the
  daily cap per member per day.
- **The person wins.** A message from the person to that member stops the
  agenda's run at once and holds the agenda until the member has been idle
  again for the idle period. Turning the switch off stops it too.
- **Visible, quiet.** The started item is an ordinary run in the Execution
  panel. The chat shows one muted line above the composer while it runs and
  after it finishes ("Working on “Send the NZ batch” on its own · Stop"),
  never a card, banner or notification.
- **Turning talk into the agenda.** The schedule instruction now tells every
  engine to propose a routine when the person describes repeating work or
  asks for the same thing again, to ask exactly one short question when a
  needed detail is missing, and to repeat the action when the person says
  yes. When the person's message reads as repeating work and the reply
  proposed nothing, the bridge carries one line into the member's next turn
  asking it to propose or ask. The New Automation dialog takes one sentence
  and has the member's own engine turn it into a proposal.

### What is a slice now, and what is later

Now (this change):

- The switch, the picker over goals and tasks, the starter with the idle
  period, the daily cap, one item at a time, stop-on-message, the run and
  the quiet chat line.
- The instruction, the next-turn nudge and the plain-English New Automation.
- The header label fix.

Later, named so nobody assumes it exists:

- The agenda does not pick blocked or `doing` tasks, and does not re-pick a
  task it tried today even when the run ended without marking it done.
- The agenda does not write task status itself; the member marks the task
  done or blocked through the task action, as it would in chat.
- No priority between members, no shared budget across the squad, no token
  or cost budget: the cap counts starts, not spend.
- No "quiet hours" or working-day calendar for the agenda; the routine
  scheduler already covers timed work.
- No mobile or Telegram control for the switch; it lives in the app.
- Goals paused by the person, by the three-unchanged-turns rule or by the
  pursuit limit are never resumed by the agenda; those need a person.

## The header bug: what the old code read

Read on 2026-10-14 from the code at `e6c636f` and, read-only, from
`~/.autohand/squad/channels.json`, `web-state/provider-settings.json` and
`GET http://127.0.0.1:19821/api/runs` for Alex (`asq_mv639pn2`).

- The meta line, the profile preview and `/model` all printed
  `providerSummaryLabel(effectiveModelForAgent(agent, providerSettings))`.
  `effectiveModelForAgent` reads only the member's `modelAssignment` and the
  provider settings. Alex's assignment is `{ mode: "inherit" }`, so it fell
  through to `defaultProvider: "autohandai"` and that provider's model,
  `moa`. The harness (`{ id: "claude" }`) was never consulted. Every Claude
  Code, Codex or ACP member showed the Autohand provider default.
- The engine itself knew better. All 13 of Alex's runs record
  `effectiveModel: { provider: "anthropic", model: "" }` (one has
  `"sonnet"`, the turn where a model was chosen): `prepareExternalHarness`
  sets the provider to the adapter's vendor and the model to the turn's or
  the member's choice, empty when the engine picks. A reply's own model line
  therefore printed the bare provider id, "anthropic".
- `GET /api/harnesses` reports the engine's default: Claude Code
  `defaults.model: "opus"` and Codex `"gpt-6.1-sol"` on this machine.

**Fix.** `engineModelSummary` in `src/lib/harness.js` (pure) returns `null`
for Autohand members, so they keep the provider label, and otherwise the
engine's short name with the first of: the member's own model, the model
the last reply ran on when its provider is this engine's vendor, the
engine's reported default, else "<engine> default". `replyModelLabel` does
the same for a reply's recorded model. The member profile's Model page
still describes the Autohand provider assignment; for an external member
that page is about a setting the engine does not use, and it is left as is.

## Decision details

1. **Instruction.** `scheduleActionInstruction` (the same block as the task
   instruction, sent by the app and added by the bridge when missing, on
   every engine) now opens with "Set up repeating work yourself.": propose
   on repeating work or a second identical ask, ask exactly one short
   question when time, days, time zone, destination or folder is missing,
   repeat the action on "yes"/"do it". Two examples; the action format line
   appears once (`check:work-plans` asserts that).
2. **Nudge.** `detectRecurringWork` was not extended with "again", "as
   usual", "like yesterday", "keep doing": it feeds "Schedule this?", which
   must show a rule, and those words carry none. A separate
   `detectRepeatRequest` and a word-overlap `similarRequest` (against the
   member's completed chat runs of the last 14 days) join it in
   `repeatedWorkSignal`. When the reply proposed nothing, the next person
   turn's **prompt** (not the system prompt) carries one line. The prompt,
   because Codex reads the profile only on a thread's first turn
   (ADR-0115), and a system-prompt line would cold-start a warm Autohand
   session (ADR-0124's lesson). The run keeps the person's words as its
   title; the line is added after the run is recorded.
3. **Plain-English New Automation.** `POST /api/routines/draft` starts a
   bounded run of the member (the routine path, `startRun`), which receives
   the schedule instruction from the bridge and must answer with the
   action. The existing proposal handler records it; the route resolves the
   proposal at once ("Drafted in New Automation") so it does not also wait
   in Needs you, and returns it for the existing `RoutineSchedule` control.
   Saving goes through the existing automation save and routine sync.
4. **Agenda slice** as described above: `server/agenda/store.mjs`,
   `server/routes/agenda.route.mjs`, `nextAgendaItem` and
   `agendaTaskPrompt` in `src/lib/work-plans.js`, the `chat.started` bridge
   event (emitted by `executeChatTurn` with `person: true` for direct
   messages the person typed or queued), `KeepWorkingSwitch` and
   `AgendaLine` in the app.

## What was learnt

- **A one-off run stole the member's conversation.** The first draft route
  passed `resumeSession: false`, which looked like "leave the session
  alone". It is not: `executeExternalHarness` writes whatever session the
  run produced as the member's resume id, so the next chat message would
  have resumed the draft's throwaway session instead of the conversation.
  `check-always-on` (iii) asserts the conversation resumes its own session
  after a draft; the fix is `ephemeralSession: true`, which neither reads
  nor writes the resume id. Routine runs started through the same path
  still write it, as before; that is existing behaviour, not changed here.
- **The header was never wrong about Autohand.** The label function was
  correct for the provider model; it was asked the wrong question for
  external engines. The run history already held the answer.

## Consequences and what was knowingly left undone

- Everything under "Later" above.
- The nudge lives in memory: a bridge restart forgets a pending one. It
  fires on statements that merely mention repetition ("we did this again
  last week"); the member is told to propose only if the person wants it
  done regularly. English only.
- The same-ask signal compares words, not meaning; a rephrased request with
  different words is not caught, and a retry of a failed turn is excluded
  only because failed runs are not compared.
- A draft costs one run of the member's engine (tokens, and up to 180 s).
  It is refused while the member is working rather than queued. It appears
  in the Execution panel as a run titled "Draft an automation: …".
- The drafted proposal is stored as `declined` with a "Drafted in New
  Automation" message; the proposal store has no `drafted` status and
  adding one was left to the routines lane.
- The agenda reads tasks and goals but does not change task status; a task
  the member neither finishes nor marks blocked stays open and is not
  retried until tomorrow. Stopping a goal for a person message pauses it
  with a reason the agenda will resume once the member is idle again.
- The agenda's quiet line is polled every 15 s, not pushed; it can lag.
  The agenda never notifies.
- The cap counts starts per bridge-local day, not cost. Idle period and tick
  are environment settings, not UI.

## Verification

Run on 2026-10-14 in the lane worktree:

- `bun run check:always-on` (`scripts/check-always-on.mjs`, 60 checks, in
  the `ci` chain after `check:work-plans`): 23 pure checks (header label
  for Autohand, Claude, Codex, ACP, member model, last reply, provider
  switch; instruction text; repeat signal; nudge; picker; settings), then a
  real bridge with the fake Claude executable from `check-chats`: (i) the
  instruction in `--append-system-prompt` once; (ii) "Every weekday morning
  send the NZ batch…" keeps the offer and the next turn's prompt is
  "thanks\n\n(Squad note: … said \"Every weekday morning\" …)", used once;
  "again" and a second near-identical ask do the same; a reply with a
  schedule action leaves none; (iii) the draft route returns the proposal
  (weekdays 08:00 Pacific/Auckland), a question, the answer round trip, the
  read-from-words fallback, refusals, no `--resume` on the draft and the
  conversation's own session resumed after it; (iv) the agenda: off by
  default, the soonest task started as a visible run "On its own: …", one at
  a time, stopped by the person's message, nothing within the 1.5 s idle
  period, the next task after it, the daily cap of 2, a restart-paused goal
  resumed, off again, settings kept across a restart.
- `bun run check:always-on:browser` (`scripts/check-always-on-browser.mjs`,
  in the `ci` chain after `check:work-plans:browser`): a Claude Code member
  with a fake executable; the header meta line reads "Claude · fable", not
  "Autohand AI"; New Automation opens on the one field with the old fields
  under "Fill in by hand"; Draft it fills "Signups summary" and weekdays
  08:00 Pacific/Auckland into the schedule control; Event and Webhook are
  still under the disclosure; light and dark, no exceptions. Screenshots
  (looked at): `.codex-artifacts/lanes/always-on/{light,dark}-chat-header.png`,
  `-chat.png`, `-new-automation.png`, `-new-automation-drafted.png`
  (gitignored).
- `bun run build`, `node scripts/check-render.mjs`, `check:routines` (34),
  `check:work-plans` (72), `check:harness`, `check:chats`,
  `check:goal-bridge`, `check:member-goals`, `check:reliability`,
  `check:execution-panel:browser`: all pass.
