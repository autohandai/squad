// Channel workflows route plug-in (ADR-0021): CRUD per channel, manual and
// webhook starts, approval gates, a cron scheduler, and step bookkeeping for
// runs the web app dispatches through the channel stream.
//
// Storage. Workflows and their runs are the channel's own data
// (`channel.workflows`), but server.mjs's `normalizeChannel` keeps only the
// fields it knows and the web app re-PUTs the whole channel list on every
// change, so anything stored inside channels.json would be wiped within
// seconds. The durable copy therefore lives beside it in
// `~/.autohand/squad/channel-workflows.json`, keyed by channel id, and every
// read of a channel through this route returns the channel with its
// `workflows` attached. Deleting a channel drops its workflows on the next
// read (the channel is gone from channels.json).
//
// The pure logic (normalization, trigger matching, the run state machine and
// the cron parser) is shared with the browser through src/lib/workflows.js.

import { join } from "node:path";

import {
  createRun,
  dueSchedules,
  findRun,
  isTerminal,
  nextRunState,
  normalizeWorkflow,
  normalizeWorkflows,
  randomWebhookToken,
  resumeAfterApproval,
  stepToDispatch,
  upsertRun,
  validateWorkflow,
} from "../../src/lib/workflows.js";

export const name = "workflows";

export const STORE_FILE = "channel-workflows.json";
const DEFAULT_TICK_MS = 30_000;
const MAX_PAYLOAD_CHARS = 4000;

let store = null; // { version: 1, channels: { [channelId]: workflow[] } }
let writing = Promise.resolve();
let timer = null;
let lastTick = null;
let bridgeContext = null;
let listening = false;

// ---------------------------------------------------------------------------
// Store

function storePath(ctx) {
  return join(ctx.squadStateDir, STORE_FILE);
}

function normalizeStore(input) {
  const channels = {};
  const source = input?.channels && typeof input.channels === "object" ? input.channels : {};
  for (const [channelId, list] of Object.entries(source)) {
    const id = String(channelId || "").trim();
    if (!id || !Array.isArray(list)) continue;
    channels[id] = normalizeWorkflows(list).map((workflow) => ({ ...workflow, channelId: id }));
  }
  return { version: 1, channels };
}

async function loadStore(ctx) {
  if (store) return store;
  const saved = await ctx.readOptionalJsonFile(storePath(ctx));
  store = normalizeStore(saved || {});
  return store;
}

function saveStore(ctx) {
  const snapshot = { version: 1, updatedAt: new Date().toISOString(), channels: store.channels };
  writing = writing.then(() => ctx.writeJsonFile(storePath(ctx), snapshot)).catch((error) => {
    ctx.logEvent(ctx.SEVERITY.ERROR, `workflows: could not write ${STORE_FILE}: ${error?.message || error}`, { "event.name": "workflow.store.failed" });
  });
  return writing;
}

function allWorkflows() {
  return Object.values(store?.channels || {}).flat();
}

function workflowsFor(channelId) {
  return store.channels[channelId] || [];
}

function replaceWorkflow(channelId, workflow) {
  const list = workflowsFor(channelId);
  const exists = list.some((item) => item.id === workflow.id);
  store.channels[channelId] = exists ? list.map((item) => (item.id === workflow.id ? workflow : item)) : [...list, workflow];
  return workflow;
}

function locateRun(runId) {
  for (const [channelId, list] of Object.entries(store.channels)) {
    const found = findRun(list, runId);
    if (found) return { channelId, ...found };
  }
  return null;
}

async function channelRecord(ctx, channelId) {
  const state = await ctx.readChannelsState();
  return (state?.channels || []).find((channel) => channel.id === channelId) || null;
}

function publicWorkflow(workflow) {
  return workflow;
}

function publicRun(workflow, run) {
  return { workflow: { id: workflow.id, name: workflow.name, channelId: workflow.channelId, dispatch: workflow.dispatch }, run };
}

function boundedPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_PAYLOAD_CHARS) return payload;
  return { truncated: true, preview: serialized.slice(0, MAX_PAYLOAD_CHARS) };
}

function log(ctx, severity, message, attributes = {}) {
  ctx.logEvent(severity, message, { "event.domain": "autohand.squad", ...attributes });
}

function runAttributes(workflow, run, extra = {}) {
  return {
    "autohand.workflow.id": workflow.id,
    "autohand.workflow.name": workflow.name,
    "autohand.workflow.run_id": run.id,
    "autohand.workflow.status": run.status,
    "autohand.channel.id": workflow.channelId || run.channelId || "",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Runs

// Persist a run transition and act on the state it landed in: announce a
// pending approval, start the next step on the bridge when the workflow asks
// for it, or leave the step for the web app to dispatch (`dispatch` result).
async function afterTransition(ctx, workflow, run, { reason = "" } = {}) {
  const channelId = workflow.channelId;
  let current = run;
  let dispatch = null;

  if (current.status === "waiting_approval" && current.pendingApproval) {
    ctx.emit("approval.pending", {
      workflowId: workflow.id,
      workflowName: workflow.name,
      runId: current.id,
      channelId,
      stepId: current.pendingApproval.stepId,
      emoji: current.pendingApproval.emoji,
      by: current.pendingApproval.by,
    });
    log(ctx, ctx.SEVERITY.INFO, `workflow ${workflow.name} waits for approval`, runAttributes(workflow, current, { "event.name": "workflow.approval.pending", "autohand.workflow.step_id": current.pendingApproval.stepId }));
  } else if (current.status === "running") {
    const next = stepToDispatch(workflow, current);
    if (next) {
      if (workflow.dispatch === "bridge" && next.workspace) {
        current = await startOnBridge(ctx, workflow, current, next);
      } else {
        dispatch = describeDispatch(workflow, current, next);
      }
    }
  }

  if (isTerminal(current)) {
    const severity = current.status === "completed" ? ctx.SEVERITY.INFO : ctx.SEVERITY.WARN;
    log(ctx, severity, `workflow ${workflow.name} ${current.status}${current.error ? `: ${current.error}` : ""}`, runAttributes(workflow, current, { "event.name": `workflow.run.${current.status}` }));
    ctx.emit("workflow.finished", { workflowId: workflow.id, workflowName: workflow.name, runId: current.id, channelId, status: current.status, error: current.error || "" });
  }

  const saved = replaceWorkflow(channelId, upsertRun(workflow, current));
  await saveStore(ctx);
  if (reason) log(ctx, ctx.SEVERITY.DEBUG, `workflow ${workflow.name}: ${reason}`, runAttributes(saved, current, { "event.name": "workflow.run.transition" }));
  return { workflow: saved, run: current, dispatch };
}

function describeDispatch(workflow, run, next) {
  return {
    runId: run.id,
    channelId: workflow.channelId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    stepId: next.step.id,
    memberId: next.memberId,
    prompt: next.prompt,
    workspace: next.workspace,
    marker: next.marker,
  };
}

// Bridge dispatch: the route starts the member run itself. Members live in
// the browser, so this only works when the step names a workspace; the run
// advances from the bridge's own run.finished event.
async function startOnBridge(ctx, workflow, run, next) {
  const now = new Date().toISOString();
  const channel = await channelRecord(ctx, workflow.channelId);
  try {
    const memberRun = await ctx.startRun({
      agentId: next.memberId,
      prompt: next.prompt,
      workspace: next.workspace,
      title: `${workflow.name} · ${next.step.id}`,
      transport: "cli",
      timeoutMs: 300000,
      channelId: workflow.channelId,
      memberIds: [next.memberId],
      channel: channel
        ? { id: channel.id, name: channel.name, visibility: channel.visibility, memberIds: [next.memberId], channelMemberIds: channel.memberIds || [], targetLabel: workflow.name }
        : { id: workflow.channelId, name: "", memberIds: [next.memberId] },
      workflowRunId: run.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepId: next.step.id,
    });
    const started = nextRunState(workflow, run, { type: "step.started", stepId: next.step.id, memberRunId: memberRun?.id || "" }, { now });
    log(ctx, ctx.SEVERITY.INFO, `workflow ${workflow.name} started ${next.step.id} on the bridge`, runAttributes(workflow, started, { "event.name": "workflow.step.started", "autohand.workflow.step_id": next.step.id, "autohand.run.id": memberRun?.id || "" }));
    return started;
  } catch (error) {
    const failed = nextRunState(workflow, run, { type: "fail", error: `bridge dispatch failed: ${error?.message || error}` }, { now });
    log(ctx, ctx.SEVERITY.ERROR, `workflow ${workflow.name} could not start ${next.step.id}: ${error?.message || error}`, runAttributes(workflow, failed, { "event.name": "workflow.step.failed", "autohand.workflow.step_id": next.step.id }));
    return failed;
  }
}

async function startWorkflowRun(ctx, workflow, trigger) {
  const now = new Date().toISOString();
  const run = createRun(workflow, { now, trigger, channelId: workflow.channelId });
  ctx.emit("workflow.trigger", { workflowId: workflow.id, workflowName: workflow.name, runId: run.id, channelId: workflow.channelId, trigger: trigger.type, memberId: workflow.steps[0]?.memberId || "" });
  log(ctx, ctx.SEVERITY.INFO, `workflow ${workflow.name} started (${trigger.type})`, runAttributes(workflow, run, { "event.name": "workflow.run.started", "autohand.workflow.trigger": trigger.type }));
  return afterTransition(ctx, workflow, run, { reason: `started by ${trigger.type}` });
}

function onMemberRunFinished(ctx, event) {
  const memberRunId = String(event?.runId || "");
  if (!memberRunId || !store) return;
  for (const workflow of allWorkflows()) {
    for (const run of workflow.runs || []) {
      if (run.status !== "running") continue;
      const result = run.stepResults.find((item) => item.memberRunId === memberRunId && item.status === "running");
      if (!result) continue;
      const status = event.status === "completed" ? "completed" : "failed";
      const next = nextRunState(workflow, run, { type: "step.finished", stepId: result.stepId, status, preview: String(event.title || "") }, { now: new Date().toISOString() });
      void afterTransition(ctx, workflow, next, { reason: `member run ${memberRunId} ${status}` });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler

/** Fire every schedule workflow due between `since` and `now`. Exported for the check. */
export async function tick(ctx, { since = lastTick || new Date(), now = new Date() } = {}) {
  await loadStore(ctx);
  lastTick = now;
  const fired = [];
  for (const { workflow } of dueSchedules(allWorkflows(), since, now)) {
    const { run } = await startWorkflowRun(ctx, workflow, { type: "schedule", key: `${workflow.id}:schedule:${now.toISOString()}` });
    fired.push({ workflowId: workflow.id, runId: run.id, channelId: workflow.channelId });
  }
  return fired;
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function init(ctx, { tickMs = DEFAULT_TICK_MS } = {}) {
  bridgeContext = ctx;
  await loadStore(ctx);
  if (!listening && ctx.events?.on) {
    ctx.events.on("run.finished", (event) => onMemberRunFinished(bridgeContext, event));
    listening = true;
  }
  stop();
  lastTick = new Date();
  if (tickMs > 0) {
    timer = setInterval(() => {
      tick(bridgeContext).catch((error) => log(bridgeContext, bridgeContext.SEVERITY.ERROR, `workflow scheduler tick failed: ${error?.message || error}`, { "event.name": "workflow.scheduler.failed" }));
    }, tickMs);
    if (typeof timer.unref === "function") timer.unref();
  }
  const scheduled = allWorkflows().filter((workflow) => workflow.enabled && workflow.trigger.type === "schedule").length;
  log(ctx, ctx.SEVERITY.INFO, `workflows loaded: ${allWorkflows().length} (${scheduled} scheduled)`, { "event.name": "workflow.store.loaded" });
}

// ---------------------------------------------------------------------------
// Routes

const CHANNEL_WORKFLOWS = /^\/api\/channels\/([^/]+)\/workflows$/;
const CHANNEL_WORKFLOW = /^\/api\/channels\/([^/]+)\/workflows\/([^/]+)$/;
const CHANNEL_WORKFLOW_RUN = /^\/api\/channels\/([^/]+)\/workflows\/([^/]+)\/run$/;
const WEBHOOK = /^\/api\/webhooks\/([^/]+)$/;
const RUN = /^\/api\/workflows\/runs\/([^/]+)$/;
const RUN_DECISION = /^\/api\/workflows\/([^/]+)\/(approve|decline|approval-message)$/;
const RUN_STEP = /^\/api\/workflows\/([^/]+)\/steps\/([^/]+)\/(started|finished)$/;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fail(ctx, res, status, error) {
  ctx.json(res, status, { success: false, error });
  return true;
}

function ok(ctx, res, status, data) {
  ctx.json(res, status, { success: true, data });
  return true;
}

function prepareWorkflow(input, channelId, existing = null) {
  const now = new Date().toISOString();
  const merged = existing ? { ...existing, ...input, id: existing.id, runs: existing.runs, createdAt: existing.createdAt, updatedAt: now } : { ...input, runs: [], createdAt: now, updatedAt: now };
  if (merged.trigger?.type === "webhook" && !String(merged.trigger.token || merged.trigger.secret || "").trim()) {
    merged.trigger = { ...merged.trigger, token: existing?.trigger?.type === "webhook" && existing.trigger.token ? existing.trigger.token : randomWebhookToken() };
  }
  const workflow = normalizeWorkflow(merged, { now });
  return { ...workflow, channelId };
}

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (!path.startsWith("/api/channels/") && !path.startsWith("/api/workflows") && !path.startsWith("/api/webhooks/")) return false;
  if (path.startsWith("/api/channels/") && !path.includes("/workflows")) return false;
  await loadStore(ctx);

  // GET /api/workflows — every channel's workflows and runs, for one-shot loading.
  if (path === "/api/workflows" && req.method === "GET") {
    return ok(ctx, res, 200, { channels: store.channels });
  }

  // GET /api/workflows/pending — steps waiting for the web app to dispatch.
  if (path === "/api/workflows/pending" && req.method === "GET") {
    const dispatches = [];
    for (const workflow of allWorkflows()) {
      if (workflow.dispatch === "bridge") continue;
      for (const run of workflow.runs || []) {
        const next = stepToDispatch(workflow, run);
        if (next) dispatches.push({ ...describeDispatch(workflow, run, next), run });
      }
    }
    return ok(ctx, res, 200, { dispatches });
  }

  let match = path.match(RUN);
  if (match && req.method === "GET") {
    const found = locateRun(decode(match[1]));
    if (!found) return fail(ctx, res, 404, "run not found");
    return ok(ctx, res, 200, publicRun(found.workflow, found.run));
  }

  // POST /api/workflows/:runId/approve | decline | approval-message
  match = path.match(RUN_DECISION);
  if (match && req.method === "POST") {
    const found = locateRun(decode(match[1]));
    if (!found) return fail(ctx, res, 404, "run not found");
    const body = await ctx.readBody(req);
    const now = new Date().toISOString();
    if (found.run.status !== "waiting_approval") return fail(ctx, res, 409, `run is ${found.run.status}, not waiting for approval`);
    if (match[2] === "approval-message") {
      const next = nextRunState(found.workflow, found.run, { type: "approval.message", messageId: body?.messageId }, { now });
      replaceWorkflow(found.channelId, upsertRun(found.workflow, next));
      await saveStore(ctx);
      return ok(ctx, res, 200, publicRun(found.workflow, next));
    }
    const decision = match[2] === "approve" ? "approve" : "decline";
    const next = resumeAfterApproval(found.run, decision, { now, by: String(body?.by || "user") });
    log(ctx, decision === "approve" ? ctx.SEVERITY.INFO : ctx.SEVERITY.WARN, `workflow ${found.workflow.name} ${decision === "approve" ? "approved" : "declined"} by ${String(body?.by || "user")}`, runAttributes(found.workflow, next, { "event.name": `workflow.approval.${decision}d`, "autohand.workflow.step_id": found.run.pendingApproval?.stepId || "" }));
    const result = await afterTransition(ctx, found.workflow, next, { reason: decision });
    return ok(ctx, res, 200, { ...publicRun(result.workflow, result.run), dispatch: result.dispatch });
  }

  // POST /api/workflows/:runId/steps/:stepId/started | finished — bookkeeping for app-dispatched steps.
  match = path.match(RUN_STEP);
  if (match && req.method === "POST") {
    const found = locateRun(decode(match[1]));
    if (!found) return fail(ctx, res, 404, "run not found");
    const stepId = decode(match[2]);
    if (found.run.status !== "running") return fail(ctx, res, 409, `run is ${found.run.status}`);
    const body = await ctx.readBody(req);
    const now = new Date().toISOString();
    const event =
      match[3] === "started"
        ? { type: "step.started", stepId, memberRunId: String(body?.memberRunId || ""), messageId: String(body?.messageId || "") }
        : { type: "step.finished", stepId, status: body?.status === "failed" ? "failed" : "completed", preview: String(body?.preview || "") };
    const next = nextRunState(found.workflow, found.run, event, { now });
    if (next === found.run) return fail(ctx, res, 409, `step ${stepId} is not the current step`);
    log(ctx, event.type === "step.finished" && event.status === "failed" ? ctx.SEVERITY.WARN : ctx.SEVERITY.INFO, `workflow ${found.workflow.name} step ${stepId} ${match[3]}${event.status ? ` (${event.status})` : ""}`, runAttributes(found.workflow, next, { "event.name": `workflow.step.${match[3]}`, "autohand.workflow.step_id": stepId }));
    const result = await afterTransition(ctx, found.workflow, next, { reason: `${stepId} ${match[3]}` });
    return ok(ctx, res, 200, { ...publicRun(result.workflow, result.run), dispatch: result.dispatch });
  }

  // POST /api/webhooks/:token
  match = path.match(WEBHOOK);
  if (match && req.method === "POST") {
    const token = decode(match[1]);
    const workflow = allWorkflows().find((item) => item.trigger.type === "webhook" && item.trigger.token && item.trigger.token === token);
    if (!workflow) return fail(ctx, res, 404, "webhook not found");
    if (!workflow.enabled) return fail(ctx, res, 409, "workflow is disabled");
    const body = await ctx.readBody(req);
    const payload = boundedPayload(body);
    const result = await startWorkflowRun(ctx, workflow, {
      type: "webhook",
      key: `${workflow.id}:webhook:${Date.now().toString(36)}`,
      messageBody: String(body?.text || body?.message || body?.title || ""),
      payload,
    });
    return ok(ctx, res, 202, { workflow: { id: workflow.id, name: workflow.name, channelId: workflow.channelId }, run: result.run, dispatch: result.dispatch });
  }

  // POST /api/channels/:id/workflows/:wid/run — manual start.
  match = path.match(CHANNEL_WORKFLOW_RUN);
  if (match && req.method === "POST") {
    const channelId = decode(match[1]);
    const workflow = workflowsFor(channelId).find((item) => item.id === decode(match[2]));
    if (!workflow) return fail(ctx, res, 404, "workflow not found");
    const body = await ctx.readBody(req);
    const result = await startWorkflowRun(ctx, workflow, {
      type: "manual",
      key: `${workflow.id}:manual:${Date.now().toString(36)}`,
      messageId: String(body?.messageId || ""),
      messageBody: String(body?.messageBody || body?.message || ""),
    });
    return ok(ctx, res, 202, { workflow: { id: workflow.id, name: workflow.name, channelId }, run: result.run, dispatch: result.dispatch });
  }

  // /api/channels/:id/workflows
  match = path.match(CHANNEL_WORKFLOWS);
  if (match) {
    const channelId = decode(match[1]);
    if (req.method === "GET") {
      if (!(await channelRecord(ctx, channelId)) && !store.channels[channelId]) return fail(ctx, res, 404, "channel not found");
      return ok(ctx, res, 200, workflowsFor(channelId).map(publicWorkflow));
    }
    if (req.method === "POST") {
      if (!(await channelRecord(ctx, channelId))) return fail(ctx, res, 404, "channel not found");
      const body = await ctx.readBody(req);
      const workflow = prepareWorkflow(body, channelId);
      const problems = validateWorkflow({ ...body, ...workflow, name: body?.name });
      if (problems.length) return fail(ctx, res, 400, `workflow is incomplete: ${problems.join(", ")}`);
      if (workflowsFor(channelId).some((item) => item.id === workflow.id)) return fail(ctx, res, 409, "workflow id already exists");
      replaceWorkflow(channelId, workflow);
      await saveStore(ctx);
      log(ctx, ctx.SEVERITY.INFO, `workflow ${workflow.name} created`, { "event.name": "workflow.created", "autohand.workflow.id": workflow.id, "autohand.channel.id": channelId, "autohand.workflow.trigger": workflow.trigger.type });
      return ok(ctx, res, 201, workflow);
    }
    return false;
  }

  // /api/channels/:id/workflows/:wid
  match = path.match(CHANNEL_WORKFLOW);
  if (match) {
    const channelId = decode(match[1]);
    const workflowId = decode(match[2]);
    const existing = workflowsFor(channelId).find((item) => item.id === workflowId);
    if (!existing) return fail(ctx, res, 404, "workflow not found");
    if (req.method === "GET") return ok(ctx, res, 200, existing);
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await ctx.readBody(req);
      const workflow = prepareWorkflow(body, channelId, existing);
      const problems = validateWorkflow(workflow);
      if (problems.length) return fail(ctx, res, 400, `workflow is incomplete: ${problems.join(", ")}`);
      replaceWorkflow(channelId, workflow);
      await saveStore(ctx);
      log(ctx, ctx.SEVERITY.INFO, `workflow ${workflow.name} updated`, { "event.name": "workflow.updated", "autohand.workflow.id": workflow.id, "autohand.channel.id": channelId, "autohand.workflow.enabled": workflow.enabled });
      return ok(ctx, res, 200, workflow);
    }
    if (req.method === "DELETE") {
      store.channels[channelId] = workflowsFor(channelId).filter((item) => item.id !== workflowId);
      await saveStore(ctx);
      log(ctx, ctx.SEVERITY.INFO, `workflow ${existing.name} deleted`, { "event.name": "workflow.deleted", "autohand.workflow.id": workflowId, "autohand.channel.id": channelId });
      return ok(ctx, res, 200, existing);
    }
    return false;
  }

  return false;
}
