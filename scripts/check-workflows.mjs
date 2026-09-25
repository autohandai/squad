#!/usr/bin/env node
// Checks for channel workflows (src/lib/workflows.js, ADR-0021): reaction
// triggers fire once per reaction, message triggers ignore the workflow's own
// posts, an approval gate never proceeds without an approval, declined runs
// stop, the cron parser computes the next run correctly, and run state
// survives a JSON round trip. Also loads the route plug-in against a fake
// bridge context and drives a webhook run through approval.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  createRun,
  dueSchedules,
  evaluateTriggers,
  matchMessageTrigger,
  matchReactionTrigger,
  nextCronRun,
  nextRunState,
  normalizeWorkflow,
  normalizeWorkflows,
  parseCron,
  reactionApprovesRun,
  resumeAfterApproval,
  stepToDispatch,
  triggerSummary,
  validateWorkflow,
} from "../src/lib/workflows.js";

const T0 = "2026-09-26T09:00:00.000Z";

// ---------------------------------------------------------------------------
// Normalization

const channel = {
  id: "channel-release",
  name: "release-reviews",
  workflows: [
    {
      id: "wf_smoke",
      name: "Smoke on approval",
      trigger: { type: "reaction", emoji: "✅" },
      steps: [
        { id: "s1", memberId: "eva", prompt: "Run the smoke suite on {{message}}" },
        { id: "s2", memberId: "kai", prompt: "Look at the failure: {{previous}}", when: "previous_failed" },
      ],
    },
    { id: "wf_smoke", name: "duplicate id is dropped" },
    { id: "wf_deploy", name: "Deploy", trigger: { type: "message", pattern: "/^deploy\\b/i" }, steps: [{ id: "d1", memberId: "eva", prompt: "Deploy", approval: { emoji: "🚀" } }] },
  ],
};
const workflows = normalizeWorkflows(channel);
assert.equal(workflows.length, 2, "duplicate workflow ids are dropped");
assert.equal(workflows[0].trigger.emoji, "✅");
assert.equal(workflows[0].steps[1].when, "previous_failed");
assert.equal(workflows[1].steps[0].approval.by, "user");
assert.equal(workflows[1].steps[0].approval.emoji, "🚀");
assert.deepEqual(validateWorkflow({ name: "", trigger: { type: "schedule", cron: "bad" }, steps: [{ memberId: "", prompt: "" }] }), [
  "name",
  "step.memberId",
  "step.prompt",
  "trigger.cron",
]);
assert.deepEqual(validateWorkflow(workflows[0]), []);
assert.equal(triggerSummary(workflows[0]), "When someone reacts ✅");
assert.equal(triggerSummary(workflows[1]), 'When a message matches "/^deploy\\b/i"');

// ---------------------------------------------------------------------------
// Reaction trigger fires once per reaction

const smoke = workflows[0];
const message = { id: "m1", role: "user", body: "Release 1.4 candidate" };
const first = matchReactionTrigger(smoke, { emoji: "✅", count: 1, mine: true }, message);
assert.equal(first.matched, true);
assert.equal(first.key, "wf_smoke:reaction:m1:✅");
assert.equal(matchReactionTrigger(smoke, { emoji: "👀", count: 1 }, message).matched, false, "other emoji");
assert.equal(matchReactionTrigger(smoke, { emoji: "✅", count: 0 }, message).matched, false, "removed reaction");
assert.equal(matchReactionTrigger({ ...smoke, enabled: false }, { emoji: "✅", count: 1 }, message).matched, false, "disabled workflow");

const reactionsByMessage = { m1: [{ emoji: "✅", count: 1, mine: true }, { emoji: "👀", count: 2 }] };
const firedKeys = [];
const batch1 = evaluateTriggers({ workflows, messages: [message], reactionsByMessage, firedKeys });
assert.equal(batch1.length, 1, "one reaction starts one run");
firedKeys.push(...batch1.map((item) => item.key));
const batch2 = evaluateTriggers({ workflows, messages: [message], reactionsByMessage: { m1: [{ emoji: "✅", count: 2, mine: true }] }, firedKeys });
assert.equal(batch2.length, 0, "the same reaction never fires twice, even as the count grows");
const batch3 = evaluateTriggers({ workflows, messages: [message, { id: "m2", role: "user", body: "Another" }], reactionsByMessage: { ...reactionsByMessage, m2: [{ emoji: "✅", count: 1 }] }, firedKeys });
assert.equal(batch3.length, 1, "a reaction on a different message fires");
assert.equal(batch3[0].message.id, "m2");

// ---------------------------------------------------------------------------
// Message trigger ignores the workflow's own posts

const deploy = workflows[1];
assert.equal(matchMessageTrigger(deploy, { id: "m3", role: "user", body: "deploy 1.4 to staging" }).matched, true);
assert.equal(matchMessageTrigger(deploy, { id: "m4", role: "user", body: "please deploy" }).matched, false, "regex anchors are respected");
assert.equal(matchMessageTrigger(deploy, { id: "m5", role: "agent", body: "Deploy finished", workflowRunId: "run_x", workflowId: "wf_deploy" }).matched, false, "own post by workflowId");
const deployWithRun = { ...deploy, runs: [{ id: "run_y", status: "completed" }] };
assert.equal(matchMessageTrigger(deployWithRun, { id: "m6", role: "agent", body: "Deploy finished", workflowRunId: "run_y" }).matched, false, "own post by run id");
assert.equal(matchMessageTrigger(deploy, { id: "m7", role: "agent", body: "deploy done", workflowRunId: "run_other", workflowId: "wf_other" }).matched, true, "another workflow's post can trigger");
assert.equal(matchMessageTrigger(deploy, { id: "m8", role: "agent", body: "Eva is typing...", status: "loading" }).matched, false, "placeholders never match");
const substring = normalizeWorkflow({ name: "Sub", trigger: { type: "message", pattern: "smoke suite" }, steps: [{ memberId: "eva", prompt: "x" }] });
assert.equal(matchMessageTrigger(substring, { id: "m9", body: "Run the SMOKE SUITE please" }).matched, true, "substring is case-insensitive");
assert.equal(matchMessageTrigger(substring, { id: "m10", body: "smoke test" }).matched, false);
const reactionOnOwnPost = matchReactionTrigger(smoke, { emoji: "✅", count: 1 }, { id: "m11", workflowRunId: "r", workflowId: "wf_smoke" });
assert.equal(reactionOnOwnPost.matched, false, "reacting ✅ on the workflow's own post is not a trigger");

// ---------------------------------------------------------------------------
// Approval gate never proceeds without approval; declined runs stop

let run = createRun(deploy, { id: "run_1", now: T0, trigger: { type: "message", messageId: "m3", messageBody: "deploy 1.4 to staging" }, channelId: channel.id });
assert.equal(run.status, "waiting_approval", "a gated first step parks the run immediately");
assert.equal(run.pendingApproval.stepId, "d1");
assert.equal(run.pendingApproval.emoji, "🚀");
assert.equal(stepToDispatch(deploy, run), null, "nothing to dispatch while waiting");
const ignored = nextRunState(deploy, run, { type: "step.started", stepId: "d1" }, { now: T0 });
assert.equal(ignored.status, "waiting_approval", "a step cannot start while waiting");
assert.equal(nextRunState(deploy, run, { type: "step.finished", stepId: "d1", status: "completed" }, { now: T0 }).status, "waiting_approval", "a step cannot finish while waiting");
run = nextRunState(deploy, run, { type: "approval.message", messageId: "m-approval" }, { now: T0 });
assert.equal(run.pendingApproval.messageId, "m-approval");
assert.equal(reactionApprovesRun(run, { emoji: "🚀", count: 1, mine: true }, { id: "m-approval" }), true);
assert.equal(reactionApprovesRun(run, { emoji: "✅", count: 1, mine: true }, { id: "m-approval" }), false, "wrong emoji");
assert.equal(reactionApprovesRun(run, { emoji: "🚀", count: 1, mine: true }, { id: "m3" }), false, "wrong message");
assert.equal(reactionApprovesRun(run, { emoji: "🚀", count: 1, mine: false }, { id: "m-approval" }), false, "only the user approves a by:user gate");

const declined = resumeAfterApproval(run, "decline", { now: T0 });
assert.equal(declined.status, "declined");
assert.equal(declined.pendingApproval, null);
assert.equal(stepToDispatch(deploy, declined), null, "declined runs dispatch nothing");
assert.equal(nextRunState(deploy, declined, { type: "step.started", stepId: "d1" }, { now: T0 }).status, "declined", "declined runs stay declined");
assert.equal(resumeAfterApproval(declined, "approve", { now: T0 }).status, "declined", "a late approval does not revive a declined run");

const approved = resumeAfterApproval(run, "approve", { now: T0, by: "user" });
assert.equal(approved.status, "running");
const dispatch = stepToDispatch(deploy, approved);
assert.ok(dispatch, "an approved step is dispatched");
assert.equal(dispatch.memberId, "eva");
assert.deepEqual(dispatch.marker, { workflowRunId: "run_1", workflowId: "wf_deploy", workflowName: "Deploy", stepId: "d1" });
const started = nextRunState(deploy, approved, { type: "step.started", stepId: "d1", memberRunId: "member-run-1", messageId: "m12" }, { now: T0 });
assert.equal(stepToDispatch(deploy, started), null, "a started step is not dispatched twice");
const finished = nextRunState(deploy, started, { type: "step.finished", stepId: "d1", status: "completed", preview: "Deployed" }, { now: T0 });
assert.equal(finished.status, "completed");
assert.equal(finished.finishedAt, T0);
assert.equal(resumeAfterApproval(finished, "approve").status, "completed", "approvals never touch finished runs");

// Failure branch: step 2 only runs when step 1 failed; prompts get the previous preview.
let smokeRun = createRun(smoke, { id: "run_2", now: T0, trigger: { type: "reaction", messageId: "m1", messageBody: "Release 1.4 candidate", emoji: "✅" } });
assert.equal(smokeRun.status, "running");
assert.equal(stepToDispatch(smoke, smokeRun).prompt, "Run the smoke suite on Release 1.4 candidate");
smokeRun = nextRunState(smoke, smokeRun, { type: "step.started", stepId: "s1" }, { now: T0 });
smokeRun = nextRunState(smoke, smokeRun, { type: "step.finished", stepId: "s1", status: "failed", preview: "3 tests red" }, { now: T0 });
assert.equal(smokeRun.status, "running", "a failed step hands over to the failure handler step");
assert.equal(smokeRun.stepIndex, 1);
assert.equal(stepToDispatch(smoke, smokeRun).memberId, "kai");
assert.equal(stepToDispatch(smoke, smokeRun).prompt, "Look at the failure: 3 tests red");
smokeRun = nextRunState(smoke, smokeRun, { type: "step.started", stepId: "s2" }, { now: T0 });
smokeRun = nextRunState(smoke, smokeRun, { type: "step.finished", stepId: "s2", status: "completed", preview: "Fixed" }, { now: T0 });
assert.equal(smokeRun.status, "completed");

let greenRun = createRun(smoke, { id: "run_3", now: T0 });
greenRun = nextRunState(smoke, greenRun, { type: "step.finished", stepId: "s1", status: "completed", preview: "All green" }, { now: T0 });
assert.equal(greenRun.status, "completed", "the failure handler is skipped when step 1 passed");
assert.equal(greenRun.stepResults.find((item) => item.stepId === "s2").status, "skipped");

let redRun = createRun(normalizeWorkflow({ name: "Only", steps: [{ id: "x", memberId: "eva", prompt: "x" }] }), { id: "run_4", now: T0 });
redRun = nextRunState(normalizeWorkflow({ name: "Only", steps: [{ id: "x", memberId: "eva", prompt: "x" }] }), redRun, { type: "step.finished", stepId: "x", status: "failed" }, { now: T0 });
assert.equal(redRun.status, "failed", "a failed last step fails the run");

// ---------------------------------------------------------------------------
// State survives a JSON round trip

const stored = normalizeWorkflows({ workflows: JSON.parse(JSON.stringify([{ ...deploy, runs: [run, { ...approved, id: "run_1b" }, { ...declined, id: "run_1c" }] }, { ...smoke, runs: [smokeRun] }])) });
const back = stored[0];
assert.deepEqual(back.runs.map((item) => item.status), ["waiting_approval", "running", "declined"]);
assert.equal(back.runs[0].pendingApproval.messageId, "m-approval", "pending approval survives");
assert.equal(back.runs[1].stepResults[0].approvedAt, T0, "an approved gate survives the round trip");
assert.ok(stepToDispatch(back, back.runs[1]), "the approved step is still dispatchable after reload");
assert.equal(stepToDispatch(back, back.runs[0]), null, "the waiting run is still gated after reload");
assert.deepEqual(JSON.parse(JSON.stringify(stored[1].runs[0])), JSON.parse(JSON.stringify(smokeRun)), "runs are stable under normalize(JSON(run))");

// ---------------------------------------------------------------------------
// Cron parser

const utc = { utc: true };
const at = (iso) => new Date(iso);
assert.equal(parseCron("60 * * * *"), null, "minute out of range");
assert.equal(parseCron("* * * *"), null, "four fields");
assert.equal(parseCron("*/0 * * * *"), null, "zero step");
assert.ok(parseCron("@daily"));
assert.equal(nextCronRun("*/15 * * * *", at("2026-09-26T09:07:00Z"), utc).toISOString(), "2026-09-26T09:15:00.000Z");
assert.equal(nextCronRun("*/15 * * * *", at("2026-09-26T09:15:00Z"), utc).toISOString(), "2026-09-26T09:30:00.000Z", "strictly after `from`");
assert.equal(nextCronRun("0 9 * * *", at("2026-09-26T09:07:00Z"), utc).toISOString(), "2026-09-27T09:00:00.000Z");
assert.equal(nextCronRun("30 17 * * mon-fri", at("2026-09-26T09:00:00Z"), utc).toISOString(), "2026-09-28T17:30:00.000Z", "Saturday rolls to Monday");
assert.equal(nextCronRun("0 0 1 * *", at("2026-09-26T09:00:00Z"), utc).toISOString(), "2026-10-01T00:00:00.000Z");
assert.equal(nextCronRun("0 0 29 2 *", at("2026-01-01T00:00:00Z"), utc).toISOString(), "2028-02-29T00:00:00.000Z", "leap day");
assert.equal(nextCronRun("0 12 1 jan *", at("2026-09-26T09:00:00Z"), utc).toISOString(), "2027-01-01T12:00:00.000Z");
assert.equal(nextCronRun("0 0 13 * fri", at("2026-09-26T09:00:00Z"), utc).toISOString(), "2026-10-02T00:00:00.000Z", "dom OR dow: Friday Oct 2 comes before the 13th");
assert.equal(nextCronRun("5 4 * * 7", at("2026-09-26T09:00:00Z"), utc).toISOString(), "2026-09-27T04:05:00.000Z", "7 means Sunday");
assert.equal(nextCronRun("0 0 31 2 *", at("2026-01-01T00:00:00Z"), utc), null, "never matches");
assert.equal(nextCronRun("@hourly", at("2026-09-26T09:07:00Z"), utc).toISOString(), "2026-09-26T10:00:00.000Z");
const scheduled = normalizeWorkflow({ id: "wf_nightly", name: "Nightly", trigger: { type: "schedule", cron: "0 2 * * *" }, steps: [{ memberId: "eva", prompt: "x" }] });
assert.equal(dueSchedules([scheduled], at("2026-09-26T01:59:30Z"), at("2026-09-26T02:00:10Z"), utc).length, 1, "due inside the tick window");
assert.equal(dueSchedules([scheduled], at("2026-09-26T02:00:00Z"), at("2026-09-26T02:00:40Z"), utc).length, 0, "not due again right after firing");
assert.equal(dueSchedules([{ ...scheduled, enabled: false }], at("2026-09-26T01:59:30Z"), at("2026-09-26T02:00:10Z"), utc).length, 0);

// ---------------------------------------------------------------------------
// Route plug-in against a fake bridge context

const stateDir = await mkdtemp(join(tmpdir(), "squad-workflows-"));
try {
  const events = new EventEmitter();
  const emitted = [];
  const logged = [];
  const startedRuns = [];
  const channelsState = { version: 1, channels: [{ id: "channel-release", name: "release-reviews", memberIds: ["eva", "kai"] }], threads: [], messages: [] };
  const ctx = {
    squadStateDir: stateDir,
    SEVERITY: { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 },
    logEvent: (severity, message, attributes) => logged.push({ severity, message, attributes }),
    json: (res, status, payload) => Object.assign(res, { status, payload }),
    readBody: async (req) => req.body || {},
    readOptionalJsonFile: async (path) => {
      try {
        const { readFile } = await import("node:fs/promises");
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        return null;
      }
    },
    writeJsonFile: async (path, data) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(data, null, 2));
    },
    readChannelsState: async () => channelsState,
    writeChannelsState: async (state) => Object.assign(channelsState, state),
    startRun: async (payload) => {
      startedRuns.push(payload);
      return { id: `member-run-${startedRuns.length}`, status: "running" };
    },
    events,
    emit: (name, payload) => {
      const event = { name, at: T0, ...payload };
      emitted.push(event);
      events.emit(name, event);
      return event;
    },
  };
  const route = await import("../server/routes/workflows.route.mjs");
  await route.init(ctx, { tickMs: 0 });
  const call = async (method, pathname, body) => {
    const res = {};
    const handled = await route.handle({ method, body }, res, new URL(`http://127.0.0.1${pathname}`), ctx);
    return { handled, ...res };
  };

  assert.equal((await call("GET", "/api/other")).handled, false, "unrelated paths are not ours");
  const missing = await call("POST", "/api/channels/nope/workflows", { name: "x" });
  assert.equal(missing.status, 404);

  const created = await call("POST", "/api/channels/channel-release/workflows", {
    name: "Deploy on webhook",
    trigger: { type: "webhook" },
    steps: [
      { id: "w1", memberId: "eva", prompt: "Deploy {{workflow}}", approval: { emoji: "✅" } },
      { id: "w2", memberId: "kai", prompt: "Announce" },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const saved = created.payload.data;
  assert.match(saved.trigger.token, /^[a-z0-9]{24}$/, "webhook workflows get a token");
  assert.equal(saved.enabled, true);

  const invalid = await call("POST", "/api/channels/channel-release/workflows", { name: "", steps: [] });
  assert.equal(invalid.status, 400);
  assert.match(invalid.payload.error, /name/);

  const listed = await call("GET", "/api/channels/channel-release/workflows");
  assert.equal(listed.payload.data.length, 1);
  const all = await call("GET", "/api/workflows");
  assert.equal(all.payload.data.channels["channel-release"].length, 1, "bulk listing groups by channel");

  const toggled = await call("PUT", `/api/channels/channel-release/workflows/${saved.id}`, { enabled: false });
  assert.equal(toggled.payload.data.enabled, false);
  const blocked = await call("POST", `/api/webhooks/${saved.trigger.token}`, { ref: "main" });
  assert.equal(blocked.status, 409, "a disabled workflow refuses its webhook");
  await call("PUT", `/api/channels/channel-release/workflows/${saved.id}`, { enabled: true });

  const hook = await call("POST", `/api/webhooks/${saved.trigger.token}`, { ref: "main" });
  assert.equal(hook.status, 202, JSON.stringify(hook.payload));
  const hookRun = hook.payload.data.run;
  assert.equal(hookRun.status, "waiting_approval", "the gated first step waits");
  assert.equal(hook.payload.data.dispatch, null);
  assert.ok(emitted.some((event) => event.name === "workflow.trigger" && event.runId === hookRun.id), "workflow.trigger emitted");
  assert.ok(emitted.some((event) => event.name === "approval.pending" && event.runId === hookRun.id && event.stepId === "w1"), "approval.pending emitted");
  assert.ok(logged.some((entry) => entry.attributes?.["autohand.workflow.id"] === saved.id && entry.attributes?.["autohand.workflow.run_id"] === hookRun.id), "OTLP log carries autohand.workflow.id");
  assert.equal((await call("POST", "/api/webhooks/not-a-token", {})).status, 404);

  const pendingBefore = await call("GET", "/api/workflows/pending");
  assert.equal(pendingBefore.payload.data.dispatches.length, 0, "nothing to dispatch before approval");
  const remembered = await call("POST", `/api/workflows/${hookRun.id}/approval-message`, { messageId: "m-wait" });
  assert.equal(remembered.payload.data.run.pendingApproval.messageId, "m-wait");

  const approvedRoute = await call("POST", `/api/workflows/${hookRun.id}/approve`, { by: "user" });
  assert.equal(approvedRoute.status, 200, JSON.stringify(approvedRoute.payload));
  assert.equal(approvedRoute.payload.data.run.status, "running");
  assert.equal(approvedRoute.payload.data.dispatch.stepId, "w1", "the approved step is handed to the app for dispatch");
  assert.equal(approvedRoute.payload.data.dispatch.prompt, "Deploy Deploy on webhook");
  assert.equal((await call("POST", `/api/workflows/${hookRun.id}/approve`, {})).status, 409, "approving twice is refused");

  const pending = await call("GET", "/api/workflows/pending");
  assert.equal(pending.payload.data.dispatches.length, 1);
  const startedRoute = await call("POST", `/api/workflows/${hookRun.id}/steps/w1/started`, { messageId: "m-step1" });
  assert.equal(startedRoute.payload.data.run.stepResults[0].status, "running");
  assert.equal((await call("GET", "/api/workflows/pending")).payload.data.dispatches.length, 0, "a started step leaves the pending list");
  const finishedRoute = await call("POST", `/api/workflows/${hookRun.id}/steps/w1/finished`, { status: "completed", preview: "Deployed" });
  assert.equal(finishedRoute.payload.data.run.status, "running");
  assert.equal(finishedRoute.payload.data.dispatch.stepId, "w2", "the next step comes back for dispatch");
  await call("POST", `/api/workflows/${hookRun.id}/steps/w2/started`, {});
  const done = await call("POST", `/api/workflows/${hookRun.id}/steps/w2/finished`, { status: "completed" });
  assert.equal(done.payload.data.run.status, "completed");
  assert.equal(done.payload.data.dispatch, null);

  // Decline path through the manual run route.
  const manual = await call("POST", `/api/channels/channel-release/workflows/${saved.id}/run`, {});
  assert.equal(manual.status, 202);
  const declinedRoute = await call("POST", `/api/workflows/${manual.payload.data.run.id}/decline`, {});
  assert.equal(declinedRoute.payload.data.run.status, "declined");
  assert.equal((await call("POST", `/api/workflows/${manual.payload.data.run.id}/steps/w1/started`, {})).status, 409, "a declined run accepts no steps");

  // Bridge dispatch: the route starts the member run itself and advances on run.finished.
  const bridged = await call("POST", "/api/channels/channel-release/workflows", {
    name: "Bridge run",
    dispatch: "bridge",
    trigger: { type: "message", pattern: "ship it" },
    steps: [{ id: "b1", memberId: "eva", prompt: "Ship", workspace: "/tmp/ship" }],
  });
  const bridgeRun = await call("POST", `/api/channels/channel-release/workflows/${bridged.payload.data.id}/run`, {});
  assert.equal(bridgeRun.status, 202, JSON.stringify(bridgeRun.payload));
  assert.equal(startedRuns.length, 1, "the bridge started the member run");
  assert.equal(startedRuns[0].agentId, "eva");
  assert.equal(startedRuns[0].workflowRunId, bridgeRun.payload.data.run.id);
  assert.equal(bridgeRun.payload.data.run.stepResults[0].status, "running");
  ctx.emit("run.finished", { runId: "member-run-1", memberId: "eva", status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const bridgeDone = await call("GET", `/api/workflows/runs/${bridgeRun.payload.data.run.id}`);
  assert.equal(bridgeDone.payload.data.run.status, "completed", "run.finished advances a bridge-dispatched run");

  // Persistence: a fresh route instance reads the same file.
  const persisted = await ctx.readOptionalJsonFile(join(stateDir, "channel-workflows.json"));
  assert.equal(persisted.channels["channel-release"].length, 2);
  assert.equal(persisted.channels["channel-release"][0].runs.length, 2);

  const deleted = await call("DELETE", `/api/channels/channel-release/workflows/${saved.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await call("GET", "/api/channels/channel-release/workflows")).payload.data.length, 1);

  // Scheduler: a due cron fires exactly once per tick window.
  const nightly = await call("POST", "/api/channels/channel-release/workflows", { name: "Nightly", trigger: { type: "schedule", cron: "*/5 * * * *" }, steps: [{ id: "n1", memberId: "eva", prompt: "Nightly" }] });
  const fired1 = await route.tick(ctx, { since: at("2026-09-26T09:04:30Z"), now: at("2026-09-26T09:05:10Z") });
  assert.equal(fired1.length, 1, "due schedule fired");
  assert.equal(fired1[0].workflowId, nightly.payload.data.id);
  const fired2 = await route.tick(ctx, { since: at("2026-09-26T09:05:10Z"), now: at("2026-09-26T09:05:50Z") });
  assert.equal(fired2.length, 0, "not fired twice in the same minute");
  const nightlyRuns = (await call("GET", `/api/workflows/runs/${fired1[0].runId}`)).payload.data.run;
  assert.equal(nightlyRuns.trigger.type, "schedule");
  route.stop();
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("check-workflows: ok");
