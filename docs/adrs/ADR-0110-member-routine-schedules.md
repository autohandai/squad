# ADR-0110: Member routines with real schedules on the one scheduler

Date: 2026-10-13 · Status: accepted · Lane: L10 routines

## Context and evidence

Member Automations had a Schedule trigger with Daily / Weekdays / Weekly and
a time, and a "Next: Tomorrow 09:00" line. Nothing read those fields. The
only way an automation ever ran was the explicit **Run now** button, which
dispatched a browser-started run (`runAutomation` → `startAutohand` →
`POST /api/runs`) and appended "Manual run started from Automations." to a
local history kept in `localStorage`. README's "Repeatable work" said as
much. The parity audit (`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`,
L10) asked for schedules that run, the kinds OpenMausBot offers (weekdays,
every N minutes, monthly incl. last day, yearly, custom cron, an IANA
timezone, the next three dates shown), skipping while the previous run is
still active, an optional run limit, and scheduling from chat behind a
confirmation. Its one rule: do not add a second scheduler.

The bridge already had one: `server/routes/workflows.route.mjs` ticks every
30 s, fires due cron workflows, starts member runs through `ctx.startRun`
when a step names a workspace, and settles them from the bridge's own
`run.finished` event. That loop and that executor were the right seam.

Two facts shaped the rest, both measured while building the check:

- A background member run whose adapter stays silent fails after 45 s
  (`collectSdkPrompt`'s first-event watchdog). The first version of the
  check held a run by yielding nothing and every "skip while active" and
  "run limit" assertion timed out with the run marked failed at +46 s. The
  controlled adapter now yields a heartbeat event every 200 ms while it
  holds, which is what a real harness does while working. The watchdog is
  the bridge's own protection and is not changed.
- Reaching "the right minute" in a check cannot wait for real minutes. The
  scheduler takes an optional pinned clock (`AUTOHAND_SQUAD_SCHEDULER_CLOCK`,
  an ISO start that then advances with real time) and interval
  (`AUTOHAND_SQUAD_SCHEDULER_TICK_MS`). With the clock at 09:00:50 and a
  400 ms tick, the full bridge half of `check-routines` runs in about four
  minutes, most of it the two real minutes between 09:01 and 09:03.

## Decision

**One scheduler, extended.** The workflows route keeps the only ticking
loop and gains three exports: `schedulerNow()`, `registerTickParticipant(fn)`
and `startBridgeMemberRun(ctx, …)`. Its `tick` fires due workflows, then
calls every participant with the same `since`/`now` window; a participant
that throws is logged and never blocks the rest. `startOnBridge` now calls
`startBridgeMemberRun`, so workflows and routines share the executor.

**Routines live on the bridge.** `server/routes/routines.route.mjs` with
`server/routines/schedule.mjs` (pure calendar arithmetic, no dependencies)
and `server/routines/store.mjs` (`~/.autohand/squad/routines.json`, atomic
rename via `persistent-json.mjs`). A routine is `{ memberId, title,
instructions, workspace, model, enabled, schedule, maxRunMinutes, nextAt,
runs }`. Kinds: once, weekdays (days + time), interval (5–1440 minutes,
aligned to a chosen start and counted in elapsed time), monthly (1–31 or
last), yearly, cron (five fields with lists, ranges, steps, names and `L`).
Every schedule carries a required IANA timezone; the editor defaults it to
the browser's zone and the bridge falls back to UTC only when the client
sent nothing valid.

**Timezones through Intl only.** `wallToUtc` tries the offsets at ±24 h and
picks the first exact instant; a wall-clock time inside a spring-forward gap
moves forward by the gap, a time in a fall-back hour runs once at its first
occurrence. Interval schedules never see a clock change. The check proves
both edges in Europe/London and America/New_York, the 31st in 30-day months,
Last day in February, 29 February only in leap years, and that the editor's
preview and the scheduler use one function.

**Occurrence policy.** Each routine stores `nextAt`. On a tick, a due
routine fires once and `nextAt` advances to the next occurrence after
`now`, never replaying every missed minute. If the previous run is still
active the occurrence is recorded as `skipped` with the reason, and no
second run starts. An occurrence more than 12 hours late is recorded as
`missed`. An optional run limit (`maxRunMinutes`, no limit unless chosen)
stops the member run through the bridge's own stop path and records
`stopped`; the harness's silence and ceiling timeouts still apply
underneath. The last forty records are kept per routine.

**Where a run executes.** A routine runs on the bridge, with the app
closed, when it names a workspace and the bridge knows the member: any
earlier chat or run registered the member with the channel-action manager
(ADR-0075), whose saved copy is passed to `startRun` so the member's
description is complete. Otherwise the run is queued as an app dispatch:
`GET /api/routines/pending` lists it, the app starts it through the normal
launch flow and reports `started { memberRunId }`, and the routine row says
"needs Squad open". An app dispatch nobody picks up within 12 hours becomes
`missed`. On boot, runs recorded as running whose bridge run is no longer
live become `interrupted`; nothing is replayed.

**Schedule from chat.** The SQUAD_ACTION line gains a `schedule` type
`{ title, instructions, schedule, timezone }`. `agent-channel-actions.mjs`
keeps parsing, identity, request-id and index; it now lets a module register
a handler per action type and routes `schedule` to the routines route, which
validates (only those five keys, a title, instructions, a valid IANA zone, a
schedule with at least one future occurrence) and stores a proposal. The
reply text carries the receipt ("Nothing is scheduled until you confirm it
in Squad"). The member's chat shows a confirmation section with the rule in
words, the timezone and the next three dates; Confirm creates the routine
(once, idempotent), Decline records the decision, both are 409 after. A
proposal expires after 24 hours. The format is appended to the same
instruction block as the channel action, with the browser's zone, in DM and
channel contexts.

**UI.** The Automations editor's Schedule trigger now opens
`src/components/members/RoutineSchedule.jsx`: divider rows for Repeat, the
kind's fields, Time zone, Run limit and Next (three dates from
`POST /api/routines/preview`). Saving an automation creates or updates the
bridge routine and stores `routineId` on the local automation; Manual only
or deleting removes it; the enabled switch follows it. Each automation row
and the detail page show `RoutineRunRow` (last run, outcome, next run,
needs-Squad-open) and the detail page lists the recorded occurrences. Legacy
Daily/Weekdays/Weekly fields map onto weekdays schedules when an old
automation is next edited; they are not migrated silently.

`src/App.jsx` received wiring only: imports, the `routine`/`routineId`
pass-through on the automation record, state plus a 15 s poll of routines,
proposals and pending dispatches, proposal decisions, automation→routine
sync, Run now through the routine when one exists, `startAutohand` returning
the created run, the instruction text, and mount points. `server.mjs`
received one addition: `ctx.stopRun(runId, reason)` for the run limit.

## Consequences and what was knowingly left undone

- Runs that need the app open: any routine for a member the bridge has
  never seen (no chat or run yet) and any routine without a workspace. Both
  show "needs Squad open" and wait; neither fails silently.
- A sleeping Mac runs nothing. The bridge does not keep the machine awake
  (OpenMausBot's "keep awake for routines" was not ported) and the desktop
  shell is unchanged.
- Catch-up is one occurrence, up to 12 hours late. Longer outages produce
  `missed` records, not a burst of runs.
- The run limit stops the run; it does not roll back tool effects.
- Routines do not post into channels and carry no approval gate; that
  remains a channel workflow's job. A proposal made from a channel reply
  still belongs to the member and is confirmed in that member's chat.
- Legacy `scheduleFrequency` automations keep their never-ran label until
  edited; "Run now" on an automation without a routine still goes through
  the browser launch path and its local history, as before.
- The pinned clock and tick interval are check-only knobs; the bridge
  resets the clock on restart, which is why the restart test starts the
  held run by hand instead of waiting for the next minute.
- The chat card relies on the 15 s poll (and window focus); there is no
  routines SSE stream. `routines.changed` is emitted on the bridge bus for
  a later subscriber.
- Copy strings use English fallbacks in the components; `src/locales.js`
  was not extended.

## Verification

`bun run check:routines` (34 checks, about 4 min): the arithmetic cases
above, then a real bridge with the controlled adapter and pinned clock:
create (400 on a bad cron), preview, fired at 09:01 with the adapter
receiving the instructions, app dispatch for an unknown member with
started/finished bookkeeping and a 409 on a second start, 09:02 skipped and
recorded while 09:01 is active with exactly one member run, the one-minute
run limit stopping the bridge run, completion on release, manual run via
the same dispatch and 409 while active, a reply proposal becoming a
`proposed` receipt with the next three Kolkata dates and no routine created,
idempotent proposal by request id, refusal without a timezone or with a
forged field, Decline then 409 on Confirm, Confirm creating one routine
twice-idempotently, retention across restart, interrupted-run recovery
without replay, delete. `bun run check:workflow-recovery` and
`bun run check:workflows` prove the shared scheduler and executor still pass;
`check:agent-channel-actions` and `check:run-channel-actions` cover the
action protocol change. Results are in the lane report.
