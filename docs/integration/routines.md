# Routines — integration note

Member automations with a real schedule kept on the bridge, run history, an
optional run limit, and schedule proposals from chat (ADR-0110). Module files:

| File | Role |
| --- | --- |
| `server/routines/schedule.mjs` | Pure: schedule shapes, validation, next occurrence in an IANA zone, cron parser, words. No dependencies. |
| `server/routines/store.mjs` | `routines.json` (routines with runs, proposals), atomic writes, run bookkeeping helpers. |
| `server/routes/routines.route.mjs` | Routes, the tick participant, bridge/app dispatch, run limits, proposals, restart recovery. |
| `src/lib/routines.js` | Pure browser helpers: editor draft, payload from an automation, labels, the chat instruction. |
| `src/components/members/RoutineSchedule.jsx` | The Schedule section of the Automations editor. |
| `src/components/members/RoutineRunRow.jsx` | `RoutineRunRow` (last run · outcome · next · needs Squad open) and `RoutineRunList`. |
| `src/components/members/RoutineProposalCard.jsx` | Confirmation section for schedule proposals in a member's chat. |
| `scripts/check-routines.mjs` | `bun run check:routines` (in `ci`). |

## Scheduler

There is one ticking loop, in `server/routes/workflows.route.mjs`. It exports
`schedulerNow()`, `registerTickParticipant(fn)` and `startBridgeMemberRun(ctx, …)`;
the routines route registers `tickRoutines` at `init` and starts member runs
through the shared executor. Check-only knobs: `AUTOHAND_SQUAD_SCHEDULER_CLOCK`
(ISO start; advances with real time) and `AUTOHAND_SQUAD_SCHEDULER_TICK_MS`.

A routine runs on the bridge when it names a workspace and the bridge knows the
member (any earlier chat or run registered it with the channel-action manager).
Otherwise its run is queued for the app (`needsApp: true`, "needs Squad open").
Occurrences while a run is active are recorded as `skipped`; more than 12 h late
as `missed`; `maxRunMinutes` stops a running member run via `ctx.stopRun`.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/routines?memberId=` | `{ routines: [{ …routine, description, problems, needsApp, next[3], activeRun, lastRun }], now }` |
| `POST /api/routines` | `{ memberId, title, instructions, workspace, model?, enabled?, schedule, maxRunMinutes? }` → `201`; `400 routine is incomplete: schedule.cron` etc. |
| `GET / PUT / DELETE /api/routines/:id` | read / update (partial `{ enabled }` is fine; a changed schedule recomputes `nextAt`) / delete. |
| `POST /api/routines/:id/run` | manual start through the same dispatch → `202 { routine, run, dispatch }`; `409` while a run is active. |
| `POST /api/routines/preview` | `{ schedule }` → `{ schedule, problems, description, timeZone, next[3], nextLabels[3] }`. |
| `GET /api/routines/pending` | `{ dispatches: [{ runId, routineId, memberId, title, prompt, workspace, model, scheduledFor, maxRunMinutes }] }` for the app. |
| `POST /api/routines/runs/:runId/started` | `{ memberRunId }` (app dispatch) → `409` unless queued. |
| `POST /api/routines/runs/:runId/finished` | `{ status: completed\|failed, preview?, reason? }` for runs the app could not start. |
| `GET /api/routines/proposals?memberId=&status=` | `{ proposals: [{ …proposal, description, timeZone, next[3], expired }] }`. |
| `POST /api/routines/proposals/:id/confirm` / `decline` | `{ proposal, routine }`; `409` when already resolved or expired; confirm is idempotent. |

Schedule shapes (`timeZone` required on all; `time` is `HH:MM`):
`once { date }`, `weekdays { days: [0-6] }`, `interval { everyMinutes: 5–1440, startDate, startTime }`
(defaults to now in the zone), `monthly { day: 1–31 | "last" }`, `yearly { month, day }`, `cron { cron }`.

Events: `routine.run { routineId, runId, memberId, status, dispatch, trigger }`,
`routine.finished { routineId, runId, memberId, status }`, `routines.changed {}`.
The route listens to `run.finished`. OTLP records use `event.name = routine.*`
with `autohand.routine.id`, `autohand.routine.run_id`, `autohand.member.id`.

## Chat proposals

`SQUAD_ACTION: {"type":"schedule","title":"…","instructions":"…","schedule":{…},"timezone":"Europe/London"}`
in a member reply (DM, channel, run) is routed by `agentChannelActions.registerHandler("schedule", …)`
to the routines route. Only those keys are accepted; the receipt is appended to
the reply and returned in `channelActions` with `type: "schedule"` and
`status: proposed | failed`. `scheduleActionInstruction(timeZone)` in
`src/lib/routines.js` is the text the app appends next to the channel-action
instruction (`SCHEDULE_ACTION_INSTRUCTION` in `App.jsx`).

## App.jsx wiring (done in this lane)

- Imports of the three components and `src/lib/routines.js`.
- `normalizeAutomationCopy` / `automationDraftFrom` / `buildAutomationFromDraft`
  pass `routine` (the editor draft) and `routineId` through.
- State `routines`, `routineProposals`; `loadRoutines()`; a 15 s poll (`ROUTINE_POLL_MS`)
  that also dispatches `GET /api/routines/pending` through `startAutohand` and reports
  `started { memberRunId }`; `decideRoutineProposal`, `syncAutomationRoutine`,
  `removeAutomationRoutine`, `previewRoutineOnBridge`.
- `startAutohand` returns the created run.
- `runAutomation` uses `POST /api/routines/:id/run` when the automation has a `routineId`.
- Member page: `routines`, `onRoutineSync`, `onRoutineRemove`, `previewRoutine` → `AutomationsPage`,
  which syncs on save / delete / toggle and passes `routine` to the card, the detail view and `RoutineRunList`.
- `AutomationFormDialog` renders `<RoutineSchedule value={draft.routine} onChange preview />` for the Schedule trigger.
- `Conversation` renders `<RoutineProposalCard proposals members onDecision />` above the messages and
  syncs automations created from the chat header; the Needs you count includes pending proposals.
