# ADR-0124: Members plan their own work

Date: 2026-10-14 · Status: accepted · Lane: work-plans

## Context

The person asked, in their words: "investigate why the agents are not
integrating, automating and populating the recurrent tasks they have to work
regularly; as a user I want to be able to speak plainly in English and the
agent is clever enough to automatically set tasks for itself, set up
scheduled automations and work they're going to perform."

What they saw (three screenshots, 2026-10-14 00:45): Alex (GTM APAC Leader,
Claude Code, workspace "leads") was asked "So give me a sitrep what tasks are
you working on?" and answered "Nothing is running right now. I have no active
task in this session and no cron or sequence of mine is live." The Execution
panel's Tasks tab said "Tasks appear here once work is launched or handed to
this member." and the Automations tab "Automations you set up for this member
appear here." Both empty, after days of telling this member about a campaign
with daily sends, research and follow-ups.

## Investigation and evidence

Read on 2026-10-14 from the code at `33f2ddd`, `~/.autohand/squad`
(`web-state/run-history.json`, `web-state/logs/web.otlp.jsonl`,
`channels.json`, `web-status.json`, `queues.json`) and
`GET http://127.0.0.1:19821/api/runs` for member `asq_mv639pn2`.

**(a) Did the schedule instruction reach Alex, and did Alex ever emit a
`SQUAD_ACTION` line?**

- By code, yes on app turns: `buildTeammateContext` in `src/App.jsx`
  appends `SCHEDULE_ACTION_INSTRUCTION` to every direct-message profile
  (with or without teammates), `sendChat` sends it as `profile`, and
  `prepareExternalHarness` in `server.mjs` passes the profile to Claude Code
  as `--append-system-prompt`. All 13 of Alex's recorded runs show
  `--append-system-prompt '<agent-profile>'` in their command. The exact
  text sent is not stored anywhere (the run keeps the redacted command and
  the context manifest, not the prompt), so this is a reading of the code,
  not of a captured prompt. The new check captures it (below).
- Two gaps on the way. `prepareExternalHarness` and `autohandArgs` cut the
  caller's profile at 12,000 characters, and the instruction block is the
  last thing in it: Alex's member profile alone is 6,733 characters, so it
  fit, but a member with a longer description or more skills would lose the
  instructions first. And a Telegram turn (`server/remote-access/bridge.mjs`
  `launchFor`) uses the member copy registered with the channel-action
  manager, whose `profile` is `buildAgentProfile` only: Alex's registered
  copy (`channels.json`, updated 2026-10-13T11:05:28Z) contains no
  `SQUAD_ACTION` instruction of either kind.
- Alex never emitted one: 0 of 13 replies in the run history contain
  `SQUAD_ACTION`; the 5,024-line OTLP log has 0 occurrences and 0
  `routine.*` events; `routines.json` does not exist (no routine was ever
  proposed or created on this machine); `goals.json` does not exist.
- Why not, as far as the record shows: 12 of the 13 turns ran with
  `--permission-mode plan --restricted` (the replies say "This session is
  still in planning mode" and "I can't send mail, search, or edit code"),
  and none of the 13 prompts contains a recurring-work phrase ("every day",
  "daily", "weekly", "twice"). The campaign's recurrence lived in `icp.md`
  and `rules.md` and in conversations before 2026-10-13 10:10, which
  predate ADR-0113 and were never recorded as runs; Alex's previous-chats
  index is empty. The instruction says "when the user asks for it"; nothing
  told the member to turn work it read in a file into a schedule, and
  nothing told it to keep a plan at all.

**(b) Is there any instruction or tool by which a member can create a task
for itself?** None. Tasks are created in exactly two places in
`src/App.jsx`: `startAutohand` (a launched run creates its parent task) and
`createHandoff`. They live in the browser's localStorage and reach the
bridge only as the `web-status.json` mirror, which held 0 tasks for Alex.
`registerHandler` in `server/agent-channel-actions.mjs` had one registered
type, `schedule`. The context manifest's layers (`contextLayerOrder`) carry
no tasks.

**(c) What does the member see about its own tasks, routines, goals and
queue when asked for a sitrep?** Nothing. `server/chats/recall.mjs` builds
"Earlier conversations" from four sources: the member's previous chats,
other members' previous chats, other members' chat runs, and channel
messages. No tasks, routines, goals or queue. Alex's sitrep answer was
therefore produced from the engine's own session, and it happened to be
true of the bridge as well: at that moment the bridge held no task, no
routine, no goal and an empty queue for Alex. The empty tabs were not a
display fault; nothing upstream ever turned the plain-English work into
anything the bridge could show.

## Decision

**A member's plan lives on the bridge, and every engine is told to keep
it.** Bridge-owned so that Autohand, Claude Code, Codex and the ACP agents
another lane is adding all see one plan, and so the app, a queued
follow-up, a Telegram message and a routine run all feed the same record.

1. **Work store and routes.** `server/work/store.mjs` keeps per-member tasks
   `{ id, memberId, title, detail, status: open|doing|done|blocked, due,
   recurring (routine id), source: member|person|handoff|routine, outcome,
   lastOutcome, history }` in `<squadStateDir>/work.json` through the same
   atomic write as goals and routines. `server/routes/work.route.mjs` lists
   per member, creates, edits, marks done and removes, and serves the exact
   plan text at `GET /api/work/plan/:memberId`. A `task` `SQUAD_ACTION`
   type is registered through `registerHandler`: `op: add | done | update`,
   validated like schedule proposals (only the listed keys, identity from
   the turn, a receipt appended to the reply, idempotent by member id,
   request id and index, so a replayed turn returns the same receipt and no
   second task). A member can only touch its own tasks; an unknown id or
   another member's id is refused with a reason.

2. **Plain English in.** `taskActionInstruction()` sits next to
   `scheduleActionInstruction()` in `src/lib/routines.js`: when the person
   gives work, add tasks; when done, mark done; when the work recurs,
   propose the schedule AND add the task; asked for a sitrep, answer from
   "Your work plan". Two examples carry the format. The app adds it to the
   same block as the schedule instruction (DM and channel contexts). The
   bridge also adds both instructions itself, after the 12,000-character
   cut and whatever the caller sent, when the profile lacks them, so a
   Telegram, queue, control-plane or routine turn gets them too, on all
   three profile sites (`autohandArgs`, `sdkRuntimeContext`,
   `prepareExternalHarness`). Codex receives the profile only on a thread's
   first turn (ADR-0115), so a Codex thread started before this change
   does not get the instructions until New chat.

3. **The member knows its plan.** `server/work/plan.mjs` builds "Your work
   plan" (`buildWorkPlanBlock` in `src/lib/work-plans.js`, pure): open
   tasks with ids, status and due, routines with the rule, next run and
   last outcome, running or paused goals, queued follow-ups. Bounded (2,600
   characters; 12 tasks, 6 routines, 4 goals, 4 follow-ups). It is added
   beside "Earlier conversations" on every direct-message turn and is
   present even when empty ("Nothing is planned…"), so a sitrep is answered
   from facts, not from whatever the session remembers. The context
   manifest gains a `workPlan` layer.

4. **A safety net when the model does not act.** After a direct-message
   turn whose reply carried no schedule proposal, the bridge reads the
   person's message for recurring-work phrases (`detectRecurringWork`:
   "every weekday morning", "every day", "each morning at 7", "twice a
   day", "every Monday at 8am", "every 2 hours", "weekly", "monthly", "end
   of the month") and attaches a `scheduleOffer` to the done event. The
   chat shows one quiet line under the reply, "Schedule this? You said
   'every weekday morning'; Alex did not set it up. Weekdays (Mon–Fri) at
   09:00." with Set it up and Not now. Set it up opens the existing
   Automations editor pre-filled (`RoutineSchedule`, normalised schedule,
   title and instructions from the sentence); nothing is created until it
   is saved, through the same `syncAutomationRoutine` path. The heuristic
   is English only, first match wins, skips sentences that open as a
   question or a negation, and is documented with its limits in
   `docs/integration/work.md`.

5. **Recurring tasks.** When a routine run starts (`routine.run`), the work
   route creates the task linked to that routine or reopens it as `doing`;
   when the run finishes (`routine.finished`, now carrying the member run
   id and preview) the task is marked done, blocked on failure, or reopened
   on stop, with `lastOutcome`. The Tasks tab therefore shows the recurring
   item with its last outcome. When the member or the person marks a
   recurring task done, `noteRoutineRun` writes a note on the routine's
   current or latest run, and the routine's run history shows it.

6. **The Tasks tab.** `src/components/execution/WorkPlanList.jsx` renders
   "Alex's plan" above the launched tasks, in the same row grammar: dot,
   title, dot-and-word status, one muted line (due, who added it, last
   outcome, age). Hover reveals text actions: Done, Start, Blocked, Edit,
   "Ask Alex to work on it" (sends a chat message through the composer's
   own send path), Remove. Add a task opens an inline form. Done tasks sit
   under a small Done label with Reopen. The summary line counts open plan
   tasks with launched ones. The app polls `/api/work` with routines.

`src/App.jsx` received wiring only: the instruction constant, one state
hook and three bridge calls, `workPlan` props at the two chat mount sites,
the offer line under a reply, the pre-filled automation seed, and the done
event's `scheduleOffer`.

## What was learnt

- **A line that changes every turn cold-starts the engine.** The first
  version of the plan block listed goals as `"…" (running, 3 turns)`.
  `check:goal-bridge` failed: the SDK goal pursuit reached four turns and
  paused with "Three turns reported no new checklist or evidence", because
  the warm Autohand session keys on the system prompt (ADR-0030) and the
  turn count changed it on every goal turn, so each turn started a cold
  instance whose fixture answered as a first turn. The block now carries no
  counters or timestamps for goals; relative ages remain for tasks' last
  outcomes, which change rarely. The same mechanism applies to "Earlier
  conversations" (ADR-0115), whose ages change at minute boundaries.
- **The route prefix matters.** `/api/work` as a `startsWith` prefix
  swallowed `/api/workflows`, and the plug-in loader sorts `work.route.mjs`
  before `workflows.route.mjs`. The route matches `/api/work` and
  `/api/work/` exactly; the check asserts `/api/workflows` still answers.
- **The record does not keep the prompt.** Nothing on the machine could
  show what Alex was actually told; the run keeps a redacted command. The
  new check reads the fixture's recorded arguments instead, and
  `GET /api/work/plan/:member` and `GET /api/members/:id/recall` show the
  two bridge-built blocks a person can read.

## Consequences and what was knowingly left undone

- The plan is bridge state; the browser's launched tasks stay in
  localStorage and under the plan in the tab. The two are not merged: a
  launched run does not become a plan task, and a handoff is not mirrored
  into the plan (the `handoff` source exists for a later change).
- The member is told to add tasks; it is not forced to. A model that
  ignores the instruction produces no tasks, and only the schedule half has
  a safety net. The check proves the instruction is sent and the action
  works, not that a given model obeys it.
- The heuristic reads English only and the first phrase only; it does not
  detect "fortnightly", "every other week", time zones in the sentence, or
  a schedule described across two sentences; it uses the bridge's time zone
  for the description and the browser's for the editor; and it fires on a
  statement that merely mentions recurrence ("the batch goes out every
  morning already"), where Not now is the answer.
- The plan block is appended to the system prompt, so a changed plan
  cold-starts a warm Autohand session once; the cost is the ADR-0030 cold
  start, about 42 s measured there, once per plan change.
- Routine-created tasks are not removed when the routine is deleted; they
  stay with their last outcome.
- A plan task has no owner other than the member; "Ask Alex to work on it"
  sends the message, it does not create a run or a handoff record.
- English copy only (`src/locales.js`), with literal fallbacks in the
  components.
- No notification is posted when a member adds or finishes a task; the
  receipt in the reply and the Tasks tab are the only places it shows.

## Verification

- `bun run check:work-plans` (72 checks, `scripts/check-work-plans.mjs`):
  the heuristic, the plan block and the store shapes; then a real bridge
  with the fake Claude executable from `check-chats`: (i) the task and
  schedule instructions and "Your work plan" in `--append-system-prompt`
  on a DM turn whose profile had none of them, each once, with the
  `workPlan` manifest layer included; (ii) a task action in the reply
  creates the task with the receipt in the reply, the done event and the
  run; (iii) done by title, update, replayed request id, duplicate title,
  four refusals, another member's id; (iv) a person task appears in the
  next turn's prompt with id, status and due, and the done one is gone;
  the routes; `/api/workflows` untouched; (v) "Every weekday morning send
  the NZ batch…" with a plain reply yields the offer (weekdays Mon–Fri
  09:00, title, phrase), a reply that proposed a schedule yields none,
  plain work yields none; (vi) a routine run on the bridge creates the
  linked task as doing while held, settles it done with the run's outcome,
  a second run reopens it, the member's done writes a note into the
  routine's run history; restart keeps tasks and receipts.
- `bun run check:work-plans:browser` (`scripts/check-work-plans-browser.mjs`,
  in the `ci` chain after `check:execution-panel:browser`): seeded
  `work.json` and `routines.json`, the Tasks tab opened through
  `?panel=tasks`, five plan rows with their statuses in order (doing,
  blocked, open by due, done), the last outcome, overdue and due-tomorrow
  wording, the Add control, the launched task under its own label, the
  summary counting open plan tasks, hover actions, light and dark, no
  exceptions. Screenshots: `.codex-artifacts/lanes/work-plans/light-tasks.png`
  and `dark-tasks.png` (gitignored).
- `bun run build`, `node scripts/check-render.mjs`, `check:routines` (34),
  `check:agent-channel-actions` (10), `check:run-channel-actions` (13),
  `check:chats`, `check:goal-bridge` (after the fix above),
  `check:execution-panel:browser`: all pass; results in the lane report.
