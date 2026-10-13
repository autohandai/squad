# Work plans — integration note

A member's own plan on the bridge (ADR-0124): the tasks it adds for itself
from a reply, the ones a person adds in the Tasks tab, and the recurring item
a routine run keeps. Every engine sees the same plan, every turn is told
about it, and a sitrep is answered from it. Module files:

| File | Role |
| --- | --- |
| `src/lib/work-plans.js` | Pure, shared by app and bridge: task statuses and words, `dueLabel`, `buildWorkPlanBlock` ("Your work plan"), `detectRecurringWork` (the safety-net heuristic), `replyProposedSchedule`. |
| `src/lib/routines.js` | `taskActionInstruction()` next to `scheduleActionInstruction()`: the text that makes a member keep its plan. |
| `server/work/store.mjs` | `work.json` (tasks and action receipts), atomic writes, `taskInputFrom`, `findByTitle`, one store per path (`workStoreFor`). |
| `server/work/plan.mjs` | `workPlanFor({ memberId, squadStateDir, goals })`: gathers tasks, routines (next run, last outcome), goals and queued follow-ups and builds the block. |
| `server/routes/work.route.mjs` | Routes, the `task` SQUAD_ACTION handler, and the `routine.run` / `routine.finished` listeners. |
| `src/components/execution/WorkPlanList.jsx` | "Alex's plan" in the Execution panel's Tasks tab. |
| `src/components/chat/ScheduleOffer.jsx` | The "Schedule this?" line under a reply. |
| `scripts/check-work-plans.mjs`, `scripts/check-work-plans-browser.mjs` | `bun run check:work-plans` and `check:work-plans:browser` (both in `ci`). |

## Task

```
{ id: "t_ab12cd", memberId, title, detail, status: open|doing|done|blocked, due: "YYYY-MM-DD"|"",
  recurring: routine id|"", source: member|person|handoff|routine, outcome, lastOutcome: { at, status, preview }|null,
  createdAt, updatedAt, doneAt, history: [{ at, by: member|person|routine|bridge, event, note }] }
```

Titles are cut at 160 characters, detail at 2,000, history keeps the last 30
entries, a member keeps at most 400 tasks (oldest done ones go first).

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/work?memberId=` | `{ tasks }` for one member (or all). |
| `POST /api/work` | `{ memberId, title, detail?, due?, status?, source?: person\|handoff }` → `201` task; `400 task is incomplete: title`. |
| `GET /api/work/plan/:memberId` | `{ text, counts: { tasks, routines, goals, queued } }`: the exact "Your work plan" block the member receives. |
| `GET / PATCH / PUT / DELETE /api/work/:id` | read / edit (`title`, `detail`, `due`, `status`, `outcome`; a bad status is `400`) / delete; `404` when unknown. |
| `POST /api/work/:id/done` | `{ outcome? }` marks it done for the person; a recurring task also writes a note on its routine's run. |

Events: `work.changed { memberId }` on every write. OTLP records use
`event.name = work.*` (`work.task.added`, `work.task.done`, `work.task.updated`,
`work.task.rejected`, `work.task.routine_run`, `work.schedule.offered`) with
`autohand.work.task_id` and `autohand.member.id`.

## The member's actions

One line per action in a reply (DM, channel or run), at most five per turn:

```
SQUAD_ACTION: {"type":"task","op":"add","title":"Send the NZ batch","detail":"20 ICP-matched leads","due":"2026-10-15"}
SQUAD_ACTION: {"type":"task","op":"done","id":"t_ab12cd","outcome":"18 sent, 2 bounced"}
SQUAD_ACTION: {"type":"task","op":"update","id":"t_ab12cd","status":"doing","due":"2026-10-16"}
```

Only `type, op, id, title, detail, due, status, outcome, recurring` are
accepted. `done` and `update` take an `id` from "Your work plan" or an exact
`title` of one of the member's own tasks. The channel-action manager supplies
the identity and the request id (ADR-0075); the receipt is appended to the
reply ("Added to your plan: “Send the NZ batch” [t_ab12cd], due tomorrow.")
and returned in `channelActions` with `type: "task"` and `status: added |
existing | done | updated | failed`. A replayed request id returns the same
receipt; an open task with the same title is reported as `existing`; a bad
op, an unknown or foreign id, a missing title or a forged key fails with the
reason and writes nothing.

## What the member is told

The bridge adds, on all three profile sites (`autohandArgs`,
`sdkRuntimeContext`, `prepareExternalHarness`):

- the task instruction and the schedule instruction, when the caller's
  profile does not already carry them (the app's own profile does; a
  Telegram, queue, control-plane or routine turn does not), after the
  12,000-character cut on the caller's profile;
- "Your work plan" on direct-message turns: open tasks `[id] title — detail
  (status, due, recurring: rule, next …, last run …)`, routines with the
  rule, next run and last outcome, running or paused goals, queued
  follow-ups; 2,600 characters at most; "Nothing is planned…" when empty.

The block carries no counters or timestamps that change every turn: the
warm Autohand session keys on the system prompt (ADR-0030), and a changing
line cold-starts it. Codex gets the profile on a thread's first turn only
(ADR-0115). The context manifest records a `workPlan` layer.

## "Schedule this?" — the heuristic and its limits

After a direct-message turn whose `channelActions` carry no proposed
`schedule`, the bridge runs `detectRecurringWork(prompt)` and, on a match,
sets `scheduleOffer: { phrase, title, instructions, schedule, timeZone,
description }` on the done event. Phrases and the schedule they imply:

| Phrase | Schedule |
| --- | --- |
| every weekday [morning/afternoon/evening], weekday mornings | weekdays Mon–Fri, 09:00 (14:00 / 18:00) |
| every day, each morning, daily, once a day | weekdays Sun–Sat at the period's time |
| every Monday … Sunday [at 8am] | that day |
| twice a day · three times a day | cron `0 9,15 * * *` · `0 9,13,17 * * *` |
| every N hours / minutes, hourly | interval (5–1440 minutes) |
| weekly, every week, once a week | Monday 09:00 |
| end of the month, last day of the month | monthly, last day |
| monthly, every month, first of the month | monthly, day 1 |

`at 7`, `at 7:30pm`, `at 09:00` set the time; morning / afternoon /
evening / night / noon set a default. The title is the sentence without the
phrase, cut on a word at 60 characters; the instructions are the sentence.

Limits, by design: English only; the first phrase wins; a sentence that
opens as a question or a negation ("Do you…", "Don't…", "Never…") is
skipped, but a statement that merely mentions recurrence is not; no
"fortnightly", "every other week", "weekends", time zones in the sentence,
or schedules spread over two sentences; the description uses the bridge's
time zone, the editor opens in the browser's. The offer creates nothing: Set
it up opens the Automations editor pre-filled, and saving goes through the
same routine sync as any automation.

## The next-turn nudge and plain-English drafts (ADR-0125)

After the same direct-message turn, `noteAutomationNudge` in `server.mjs`
reads the person's message with `repeatedWorkSignal` (`src/lib/work-plans.js`):
a schedule phrase from the table above, else a repeat word (`again` after a
work verb, `as usual`, `like yesterday`, `the usual`, `keep doing …`; `try
again` and questions are skipped), else a near-identical earlier ask (word
overlap of 0.6 or more against the member's completed chat runs from the
last 14 days, at least four content words). When one matches and the reply
proposed no schedule, the member's next person turn gets one line appended
to its prompt (`automationNudgeLine`) asking it to propose the routine or
ask one question. Used once, kept in memory, expires after a day; a reply
that proposes a schedule clears it. Repeat words never produce a
"Schedule this?" offer, because they say nothing about when.

`POST /api/routines/draft { memberId, text, workspace, timeZone, agent?,
profile?, question?, answer? }` runs one bounded run of the member
(`AUTOHAND_SQUAD_DRAFT_TIMEOUT_MS`, default 180 s) with
`ephemeralSession: true`, so it neither resumes nor replaces the member's
saved engine session. Answers: `{ status: "proposed", draft }` from the
member's schedule action (the proposal is resolved at once as drafted, so it
does not wait in Needs you), `{ status: "question", question }`, or
`{ status: "read-from-words", draft }` from the table above when the member
answered without an action. 409 while the member is working.

## Keep working between messages (ADR-0125)

`GET|PUT /api/agenda/:memberId` (`{ enabled, dailyCap }`, off and 6 by
default, kept in `<squadStateDir>/always-on.json`), `POST
/api/agenda/:memberId/stop`, `GET /api/agenda`. Every
`AUTOHAND_SQUAD_AGENDA_TICK_MS` (30 s) the bridge looks at each member with
the switch on and starts at most one item when the member is idle, not on a
break, has nothing queued, has been quiet for `AUTOHAND_SQUAD_AGENDA_IDLE_MS`
(10 min) since the person's last message, and is under the day's cap:
`nextAgendaItem` picks a goal paused by a restart, the runtime boundary or a
person message, else the open, non-recurring task due soonest that the
agenda has not tried today. A goal is resumed through the goal manager; a
task starts as a bridge run titled "On its own: …" with `agendaTaskPrompt`.
`chat.started` with `person: true` (any direct message the person typed or
queued, including Telegram) stops it.

## Routines and recurring tasks

`routine.run` creates the task linked to the routine (`recurring`, `source:
routine`) or reopens it as `doing`; `routine.finished` (now carrying
`memberRunId` and `preview`) marks it `done`, `blocked` on failure, or
`open` on stop, and sets `lastOutcome`. Marking a recurring task done, by the
member or the person, calls `noteRoutineRun(ctx, routineId, note)` in the
routines route, which stores `note` on the routine's current or latest run;
`RoutineRunList` shows it. Deleting a routine leaves its task.

## App.jsx wiring (done in this lane)

- `TASK_ACTION_INSTRUCTION` next to `SCHEDULE_ACTION_INSTRUCTION` in
  `buildTeammateContext` and `buildChannelProfileContext`.
- `workTasks` state, loaded with routines (`loadRoutines` also reads
  `/api/work`); `workPlanFor(memberId)` gives `{ tasks, create, update,
  remove }` to `Conversation` → `ExecutionPanel` (`workPlan`,
  `onAskMember`).
- The done event's `scheduleOffer` lands on the reply message;
  `AgentResponseMessage` renders `ScheduleOffer`; `decideScheduleOffer`
  clears it and, on Set it up, seeds `AutomationFormDialog`
  (`automationSeed`) with the title, instructions and schedule.
