# ADR-0021: Channel workflows with triggers and approval gates

Date: 2026-09-26 · Status: accepted

## Context

Members are driven by a person typing or by per-member Automations
(schedule, git event, webhook). Nothing reacts to what happens inside a
channel, and no run can pause for a human decision. Issue #28 asks for
workflows a channel owns: start from a message pattern, a reaction, a
schedule or a webhook; run steps as ordinary member messages; let a step wait
for approval. The bridge and the web app are monoliths that feature modules
may not edit (`docs/integration/CONTRACT.md`), members live only in the
browser, and the bridge has no event stream back to the web app.

## Decision

- **Shape** (`src/lib/workflows.js`). A workflow is
  `{ id, name, enabled, dispatch, trigger, steps, runs }`; a trigger is
  `{ type: message|reaction|schedule|webhook, pattern, emoji, cron, token }`;
  a step is `{ id, memberId, prompt, when, workspace, approval? }` where
  `approval` is `{ by: user|members, emoji }` and `when` is `always`,
  `previous_failed` or `previous_succeeded` so "if it fails, Kai looks" is
  one extra step, not a branch editor. Prompts may use `{{message}}`,
  `{{previous}}` and `{{workflow}}`. A run is
  `{ id, startedAt, status, stepIndex, stepResults, pendingApproval, trigger }`
  with status `running | waiting_approval | completed | failed | declined`.
- **One pure state machine.** `createRun`, `nextRunState(workflow, run, event)`
  and `resumeAfterApproval(run, decision)` are the only ways a run changes,
  in the browser and on the bridge alike. Out-of-order events return the same
  run: a step cannot start or finish while the run waits, an approval touches
  nothing but a waiting run, a declined run stays declined. A gated step is
  never handed out by `stepToDispatch` until its result carries `approvedAt`,
  and that field survives `normalizeRun`, so a reload cannot un-gate or
  re-gate a step.
- **Triggers fire once.** Every match carries a dedupe key —
  `wf:message:<messageId>` or `wf:reaction:<messageId>:<emoji>` — and
  `evaluateTriggers` skips keys already fired. A reaction is therefore one
  event no matter how often the channel re-renders or the count changes.
  Messages posted by a workflow carry `workflowRunId` (+ `workflowId`) and
  never trigger their own workflow; reactions on those posts (including the
  approval request) are not triggers either.
- **Evaluation happens in the web app** for message and reaction triggers,
  because that is where messages and reactions live (single-user product);
  the app starts the run through the bridge and dispatches each step through
  the existing channel dispatch with the marker. The bridge starts schedule
  and webhook runs itself and either hands the step to the app
  (`GET /api/workflows/pending`, default) or, when a workflow is marked
  `dispatch: "bridge"` and the step names a workspace, starts the member run
  through `ctx.startRun` and advances on `run.finished`.
- **Approval** is a run state, not a message. The app posts one "Waiting for
  approval" message and records its id on the run; a click on Approve or a
  reaction with the gate's emoji on that message calls the same
  `POST /api/workflows/:runId/approve`. Declining marks the run `declined`
  and stops it. The bridge emits `approval.pending` so notifications can
  pick it up.
- **Scheduler.** A 30-second in-process tick computes, per enabled schedule
  workflow, the next cron time after the previous tick; anything at or before
  now fires once. The 5-field cron parser (`parseCron`, `nextCronRun`) lives
  in the shared library, supports lists, ranges, steps, names and `@daily`
  aliases, and follows Vixie cron's day-of-month OR day-of-week rule. No new
  dependency.
- **Storage.** `server.mjs`'s `normalizeChannel` strips unknown fields and the
  web app re-PUTs all channels on every change, so `channel.workflows` cannot
  survive inside `channels.json` without editing the monolith. Workflows and
  runs live in `~/.autohand/squad/channel-workflows.json` keyed by channel id,
  and the route presents them as the channel's workflows. The last 40 runs per
  workflow are kept.
- **Observability.** Every transition is an OTLP log record with
  `autohand.workflow.id`, `autohand.workflow.run_id`, `autohand.workflow.step_id`
  and `event.name = workflow.*`; the bus gets `workflow.trigger`,
  `approval.pending` and `workflow.finished`.
- **UI.** Channel settings gain a Workflows section: a divider list (name,
  trigger summary, last run, enabled switch, run-now) and a right-side sheet
  editor. Runs appear as ordinary member messages with a small workflow tag;
  the approval request is one divider row with Approve, Decline and the emoji
  hint. No YAML, no visual builder.

## Consequences

- Message and reaction triggers only fire while the web app is open; that is
  the existing single-user contract for channels. Schedule and webhook runs
  start on the bridge and wait for the app unless the workflow opts into
  bridge dispatch with an explicit workspace.
- Two sources of truth for a run (bridge file, app state) are reconciled by
  the bridge always winning: the app applies whatever `run` a route returns.
- The route imports `src/lib/workflows.js`; the desktop staging script must
  copy that file (see `docs/integration/workflows.md`).
- Moving the store into `channels.json` is a one-line pass-through of
  `workflows` in `normalizeChannel` plus a migration read of the sidecar.
