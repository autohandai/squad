# Workflows — integration note

Channel workflows with message / reaction / schedule / webhook triggers and
approval gates (issue #28, ADR-0021). Module files:

| File | Role |
| --- | --- |
| `src/lib/workflows.js` | Pure: normalizers, trigger matching, run state machine, cron parser. |
| `server/routes/workflows.route.mjs` | Bridge routes, webhook, cron scheduler, run bookkeeping, OTLP logs. |
| `src/components/channels/WorkflowsSettings.jsx` | Settings section + editor drawer. |
| `src/components/channels/WorkflowRunMessage.jsx` | `WorkflowTag` for workflow posts; approval row. |
| `scripts/check-workflows.mjs` | `bun run check:workflows` |

## package.json

Add `"check:workflows": "node scripts/check-workflows.mjs"` and append
`&& bun run check:workflows` to `ci`.

`scripts/stage-desktop.mjs` copies `server/` and `dist/` only; the route
imports `../../src/lib/workflows.js`, so add `src/lib/workflows.js` to the
runtime copy (keep the `src/lib/` path) or the plug-in fails to load in the
packaged desktop app.

## Storage

`server.mjs`'s `normalizeChannel` keeps only the fields it knows and the web
app re-PUTs the full channel list on every change, so `channel.workflows`
cannot live inside `channels.json` without touching the monolith. The route
persists `~/.autohand/squad/channel-workflows.json`
(`{ channels: { [channelId]: workflow[] } }`, runs inside each workflow) and
serves them per channel. Moving the store into `channels.json` later needs a
one-line pass-through of `workflows` in `normalizeChannel`.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/workflows` | `{ channels: { [channelId]: workflow[] } }` — load once at boot. |
| `GET /api/workflows/pending` | `{ dispatches: [{ runId, channelId, workflowId, workflowName, stepId, memberId, prompt, workspace, marker, run }] }` — steps waiting for the app to dispatch (server-started runs). |
| `GET /api/workflows/runs/:runId` | `{ workflow, run }` |
| `GET/POST /api/channels/:id/workflows` | list / create (`400` with the missing fields; webhook workflows get a `trigger.token`). |
| `GET/PUT/DELETE /api/channels/:id/workflows/:wid` | read / update (partial `{ enabled }` is fine) / delete. |
| `POST /api/channels/:id/workflows/:wid/run` | manual start → `202 { workflow, run, dispatch }`. |
| `POST /api/webhooks/:token` | webhook start; body → `run.trigger.payload`, `text`/`message` → `{{message}}`. `404` unknown, `409` disabled. |
| `POST /api/workflows/:runId/approve` / `decline` | `{ by? }` → `{ workflow, run, dispatch }`; `409` unless `waiting_approval`. |
| `POST /api/workflows/:runId/approval-message` | `{ messageId }` — remember which channel message is the approval request. |
| `POST /api/workflows/:runId/steps/:stepId/started` | `{ memberRunId?, messageId? }` |
| `POST /api/workflows/:runId/steps/:stepId/finished` | `{ status: completed\|failed, preview? }` → `{ run, dispatch }` (next step or `null`). |

Events emitted: `workflow.trigger { workflowId, workflowName, runId, channelId, trigger, memberId }`,
`approval.pending { workflowId, workflowName, runId, channelId, stepId, emoji, by }`,
`workflow.finished { workflowId, runId, channelId, status, error }`. The route
subscribes to `run.finished` for steps it started itself (`dispatch: "bridge"`
workflows whose step names a `workspace`; everything else is app-dispatched).
OTLP records carry `autohand.workflow.id`, `autohand.workflow.run_id`,
`autohand.workflow.step_id`, `autohand.channel.id`, `event.name = workflow.*`.

## App.jsx wiring

**State.** `workflowsByChannel` (`{ [channelId]: workflow[] }`) loaded from
`GET /api/workflows` when `channelsBridgeReady`; `firedWorkflowKeys`
(string array) persisted in localStorage under
`autohandSquad.v1.workflowTriggers`. Keep `workflows` off the channel object —
`normalizeChannelCopy` would drop it.

**Handlers.**
- `saveWorkflow(channelId, draft)` → `POST` or `PUT`, replace in state.
- `deleteWorkflow(channelId, id)`, `toggleWorkflow(channelId, id, enabled)` (`PUT { enabled }`).
- `runWorkflowNow(channelId, id)` → `POST .../run`, then `handleWorkflowResult`.
- `handleWorkflowResult({ run, dispatch })`: store `run` via `upsertRun`; if
  `run.status === "waiting_approval"` post the approval request (below); if
  `dispatch` call `dispatchWorkflowStep(dispatch)`.

**Evaluation loop** (single-user, ADR-0021). One `useEffect` on
`[messagesByChannel, channelReactions, workflowsByChannel]`:

```js
for (const channel of channels) {
  const hits = evaluateTriggers({ workflows: workflowsByChannel[channel.id], messages: messagesByChannel[channel.id], reactionsByMessage: channelReactions, firedKeys: firedWorkflowKeys });
  for (const hit of hits) {
    setFiredWorkflowKeys((keys) => [...keys, hit.key]);      // before any await: fires once per message/reaction
    const trigger = { type: hit.type, key: hit.key, messageId: hit.message.id, messageBody: hit.message.body, emoji: hit.reaction?.emoji || "" };
    api(`/api/channels/${channel.id}/workflows/${hit.workflow.id}/run`, { method: "POST", body: JSON.stringify(trigger) }).then(handleWorkflowResult);
  }
}
```

Messages with `workflowRunId` never match their own workflow (`isOwnWorkflowPost`).
Also poll `GET /api/workflows/pending` every ~10 s (or on focus) and dispatch
anything a schedule or webhook started while the app was closed.

**Dispatching a step** through the existing channel dispatch:

```js
async function dispatchWorkflowStep(dispatch) {
  const channel = channels.find((c) => c.id === dispatch.channelId);
  const agent = agents.find((a) => a.id === dispatch.memberId);
  const threadId = `thread_wf_${dispatch.runId}`;
  const rootMessageId = `${threadId}-${dispatch.stepId}`;
  appendChannelMessage(channel.id, { id: rootMessageId, role: "system", body: dispatch.prompt, threadId, targetMemberIds: [agent.id], ...dispatch.marker, createdAt, updatedAt, time });
  await api(`/api/workflows/${dispatch.runId}/steps/${dispatch.stepId}/started`, { method: "POST", body: JSON.stringify({ messageId: rootMessageId }) });
  await dispatchChannelMemberReply(channel, agent, { prompt: dispatch.prompt, threadId, parentMessageId: rootMessageId, targetMemberIds: [agent.id], targetLabel: dispatch.workflowName, marker: dispatch.marker });
}
```

`dispatchChannelMemberReply` needs one addition: spread `marker`
(`workflowRunId, workflowId, workflowName, stepId`) into the placeholder
message it appends and into every later update of that message, so the reply
carries the marker; then, where it settles the reply (`status: "complete"` or
`"failed"`), call
`POST /api/workflows/:runId/steps/:stepId/finished { status, preview: body.slice(0, 200) }`
and hand the result to `handleWorkflowResult`. The marker also goes in the
run payload so bridge telemetry can group by `workflowRunId`.

**Approval request message.** When a run is `waiting_approval`, append one
message to the channel: `{ id: \`wf-approval-${run.id}\`, role: "system", agentId: "", body: "Waiting for approval", workflowRunId: run.id, workflowId, workflowName, workflowApproval: true }`,
then `POST /api/workflows/:runId/approval-message { messageId }`.

**Approving.** Two paths, same route:
- `WorkflowRunMessage` buttons → `POST /api/workflows/:runId/approve` or `/decline`, then `handleWorkflowResult`.
- In the evaluation effect, for each waiting run:
  `reactionApprovesRun(run, reaction, message)` over `channelReactions[run.pendingApproval.messageId]`
  → `approve`. Remember `approval:${run.id}` in `firedWorkflowKeys` so the same reaction does not re-post.

`resumeAfterApproval` and the route both refuse anything that is not
`waiting_approval`, so a stray reaction or double click cannot advance a run.

## Where things render

- **Channel settings popover** (`ChannelPage` header, after the Projects block, before Export):
  `<WorkflowsSettings workflows={workflowsByChannel[channel.id] || []} members={channelAgents} onSave={(draft) => saveWorkflow(channel.id, draft)} onDelete={(id) => deleteWorkflow(channel.id, id)} onToggle={(id, enabled) => toggleWorkflow(channel.id, id, enabled)} onRunNow={(id) => runWorkflowNow(channel.id, id)} copy={copy} />`.
  The section is a divider list; the editor opens a right-side `Sheet`.
- **Channel stream**: pass `renderBody` to `ChannelStream`. For a message with
  `workflowApproval`, render `<WorkflowRunMessage run={run} workflow={workflow} members={agents} onApprove onDecline copy={copy} />`
  (`findRun(workflowsByChannel[channel.id], message.workflowRunId)`). For any
  other message with `workflowRunId`, render `<WorkflowTag workflow={workflow} run={run} stepId={message.stepId} copy={copy} />`
  before the body. Author name for `role: "system"` workflow messages: the workflow name.

## Copy keys (`src/locales.js`, `en`)

`workflows`, `workflowsDetail`, `newWorkflow`, `newWorkflowTitle`, `editWorkflow`,
`workflowEditorDetail`, `workflowName`, `workflowNamePlaceholder`,
`workflowTrigger`, `workflowTriggerMessage`, `workflowTriggerReaction`,
`workflowTriggerSchedule`, `workflowTriggerWebhook`, `workflowPattern`,
`workflowPatternPlaceholder`, `workflowPatternHint`, `workflowEmoji`,
`workflowEmojiHint`, `workflowCron`, `workflowCronHint`, `workflowWebhookPending`,
`workflowWebhookHint`, `workflowSteps`, `workflowStepMember`,
`workflowStepMemberPlaceholder`, `workflowStepPrompt`, `workflowStepPromptPlaceholder`,
`workflowStepWhen`, `workflowWhenAlways`, `workflowWhenPreviousFailed`,
`workflowWhenPreviousSucceeded`, `workflowRequiresApproval`, `workflowApprovalHint`,
`workflowApprovalOff`, `workflowApprovalEmoji`, `workflowAddStep`, `workflowRemoveStep`,
`workflowRunNow`, `workflowEnabled`, `workflowSave`, `workflowDelete`,
`workflowNoWorkflows`, `workflowStepCount` (`{count} steps`), `workflowStepCountOne`,
`workflowLastRun` (`Last run {status}`), `workflowTriggerMessageSummary`
(`When a message matches {pattern}`), `workflowTriggerReactionSummary`
(`When someone reacts {emoji}`), `workflowTriggerScheduleSummary` (`On schedule {cron}`),
`workflowTriggerWebhookSummary`, `workflowRunRunning`, `workflowRunWaiting`,
`workflowRunCompleted`, `workflowRunFailed`, `workflowRunDeclined`, `workflow`,
`workflowStepOf` (`step {n} of {total}`), `workflowApprovalEmojiHint`
(`or react {emoji} to this message`), `approve`, `decline`, `cancel`.
Every key has an English fallback in the component.

## DESIGN.md

Under **Squad Channels** add: "Workflows live in the channel settings popover
as a divider list (name, trigger summary, enabled switch) with a right-side
drawer editor; a run appears in the stream as ordinary member messages carrying
a small workflow tag, and an approval gate is one divider row with Approve,
Decline and the emoji hint — no banners, no cards."
