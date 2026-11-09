// Member work plans route plug-in (ADR-0124): the tasks a member keeps for
// itself, kept on the bridge so every engine sees the same plan.
//
// Three ways a task appears:
//   - the member writes `SQUAD_ACTION: {"type":"task","op":"add",…}` in a
//     reply (DM, channel or run); the channel-action manager routes it here
//     with the turn's identity and request id, and the receipt is appended
//     to the reply the way schedule proposals are (ADR-0110);
//   - a person adds or edits one in the Execution panel's Tasks tab;
//   - a routine run creates or reopens the task linked to that routine, and
//     settles it with the run's outcome (`routine.run`, `routine.finished`).
//
// Storage: `<squadStateDir>/work.json` via server/work/store.mjs.

import { join } from "node:path";

import { noteRoutineRun, stopRoutineTaskWork } from "./routines.route.mjs";
import { STORE_FILE, findByTitle, taskInputFrom, validateTask, workStoreFor } from "../work/store.mjs";
import { workPlanFor } from "../work/plan.mjs";
import { dueLabel } from "../../src/lib/work-plans.js";
import { taskQueue } from "./queues.route.mjs";
import { createTaskAssignments } from "../work/assignments.mjs";

export const name = "work";

const ACTION_KEYS = new Set(["type", "op", "id", "title", "detail", "due", "status", "outcome", "recurring"]);
const ACTION_OPS = new Set(["add", "done", "update"]);

let store = null;
let bridgeContext = null;
let listening = false;
let assignments = null;

export async function assignMemberTask(input) {
  if (!assignments) throw new Error("Task assignment is not ready.");
  return assignments.assign(input);
}

function log(ctx, severity, message, attributes = {}) {
  ctx.logEvent(severity, message, { "event.domain": "autohand.squad", ...attributes });
}

function taskAttributes(task, extra = {}) {
  return { "autohand.work.task_id": task?.id || "", "autohand.member.id": task?.memberId || "", "autohand.work.status": task?.status || "", ...extra };
}

async function ensureStore(ctx) {
  if (!store) store = workStoreFor(join(ctx.squadStateDir, STORE_FILE));
  await store.load();
  return store;
}

function changed(ctx, memberId = "") {
  ctx.emit("work.changed", { memberId });
}

function assertTaskEditable(task) {
  const item = task.assignment?.queueItemId && taskQueue().queue.items.get(task.assignment.queueItemId);
  if (["queued", "running"].includes(item?.status)) throw Object.assign(new Error("This task has queued or running work. Delete it to cancel; its state follows the actual execution."), { status: 409 });
}

function quoted(title) {
  return `“${String(title || "").slice(0, 80)}”`;
}

// ---------------------------------------------------------------------------
// SQUAD_ACTION: {"type":"task", ...}

function receiptOf(record) {
  return { id: record.id, type: "task", actorId: record.actorId, status: record.status, message: record.message, taskId: record.taskId || "" };
}

function resolveTarget(raw, memberId) {
  const byId = raw.id ? store.task(String(raw.id).trim()) : null;
  if (byId && byId.memberId === memberId) return byId;
  if (raw.id && !byId) {
    const byTitle = findByTitle(store.tasks(), raw.id, memberId);
    if (byTitle) return byTitle;
  }
  if (raw.title) return findByTitle(store.tasks(), raw.title, memberId);
  return null;
}

async function taskAction({ id, context, raw, digest, signal, declined }) {
  const ctx = bridgeContext;
  await ensureStore(ctx);
  const existing = store.receipt(id);
  if (existing) {
    if (existing.digest !== digest) return { id, type: "task", actorId: context.actorId, status: "failed", message: "This request ID was already used for a different task action." };
    return receiptOf(existing);
  }
  const record = { id, digest, actorId: context.actorId, requestId: context.requestId, status: "failed", message: "", taskId: "", at: new Date().toISOString() };
  try {
    if (signal?.aborted || declined) throw new Error("this turn was stopped before the task action could run");
    if (!context.identityValid) throw new Error("the action identity does not match the executing member");
    const extra = Object.keys(raw).filter((key) => !ACTION_KEYS.has(key));
    if (extra.length) throw new Error(`task actions may only contain op, id, title, detail, due, status, outcome and recurring (not ${extra.join(", ")})`);
    const op = String(raw.op || "").trim().toLowerCase();
    if (!ACTION_OPS.has(op)) throw new Error('op must be "add", "done" or "update"');
    const memberId = context.actorId;
    const now = new Date().toISOString();
    if (op === "add") {
      const task = taskInputFrom({ title: raw.title, detail: raw.detail, due: raw.due, status: ["open", "doing", "blocked"].includes(raw.status) ? raw.status : "open", recurring: raw.recurring }, null, { now, memberId, source: "member", by: "member" });
      const problems = validateTask(task);
      if (problems.length) throw new Error(`give the task a ${problems.join(" and ")}`);
      const duplicate = findByTitle(store.tasks(), task.title, memberId);
      if (duplicate && duplicate.status !== "done") {
        record.status = "existing";
        record.taskId = duplicate.id;
        record.message = `Already on your plan: ${quoted(duplicate.title)} [${duplicate.id}].`;
      } else {
        store.replaceTask(task);
        record.status = "added";
        record.taskId = task.id;
        const due = dueLabel(task.due);
        record.message = `Added to your plan: ${quoted(task.title)} [${task.id}]${due ? `, ${due}` : ""}.`;
        log(ctx, ctx.SEVERITY.INFO, `work: ${memberId} added task ${task.title}`, taskAttributes(task, { "event.name": "work.task.added", "autohand.work.source": "member" }));
      }
    } else {
      const target = resolveTarget(raw, memberId);
      if (!target) throw new Error(`no task of yours matches ${raw.id ? `id ${raw.id}` : raw.title ? `title ${quoted(raw.title)}` : "that"}; use an id from "Your work plan"`);
      assertTaskEditable(target);
      const patch = op === "done" ? { status: "done", ...(raw.outcome !== undefined ? { outcome: raw.outcome } : {}) } : Object.fromEntries(["title", "detail", "due", "status", "outcome"].filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
      if (op === "update" && patch.status && !["open", "doing", "blocked", "done"].includes(patch.status)) throw new Error("status must be open, doing, blocked or done");
      if (op === "update" && !Object.keys(patch).length) throw new Error("update needs at least one of title, detail, due, status or outcome");
      const task = taskInputFrom(patch, target, { now, by: "member" });
      store.replaceTask(task);
      record.status = op === "done" ? "done" : "updated";
      record.taskId = task.id;
      record.message = op === "done" ? `Marked done: ${quoted(task.title)}${task.outcome ? ` (${task.outcome.slice(0, 120)})` : ""}.` : `Updated ${quoted(task.title)}: ${Object.keys(patch).map((key) => (key === "status" ? `status ${task.status}` : key)).join(", ")}.`;
      log(ctx, ctx.SEVERITY.INFO, `work: ${memberId} ${record.status} task ${task.title}`, taskAttributes(task, { "event.name": `work.task.${record.status}` }));
      if (op === "done" && task.recurring) await noteRoutineRun(ctx, task.recurring, `Marked done by the member${task.outcome ? `: ${task.outcome}` : ""}`).catch(() => false);
    }
  } catch (error) {
    record.status = "failed";
    record.message = `Task action not recorded: ${error?.message || error}.`;
    log(ctx, ctx.SEVERITY.WARN, `work: task action rejected: ${error?.message || error}`, { "event.name": "work.task.rejected", "autohand.member.id": context.actorId });
  }
  store.recordReceipt(record);
  await store.save();
  changed(ctx, context.actorId);
  return receiptOf(record);
}

// ---------------------------------------------------------------------------
// Routine runs keep the recurring task (ADR-0124 §5)

async function onRoutineRun(ctx, event) {
  const routineId = String(event?.routineId || "");
  const memberId = String(event?.memberId || "");
  if (!routineId || !memberId) return;
  await ensureStore(ctx);
  const now = new Date().toISOString();
  // A run can finish preparing after its previous plan row was deleted.
  // Cancel that occurrence, while letting future scheduled occurrences appear.
  if (event.queuedAt && store.deletedTasks().some(task => task.recurring === routineId && task.memberId === memberId && task.at >= event.queuedAt)) {
    await stopRoutineTaskWork(ctx, { routineId, memberId, runId: event.runId, memberRunId: event.memberRunId });
    return;
  }
  const running = event.status === "running";
  const note = running ? `run started (${event.trigger || "schedule"})` : event.status === "queued" ? "run waiting for Squad to open" : `run ${event.status}`;
  let task = store.recurringTask(routineId, memberId);
  if (!task) {
    task = taskInputFrom({ title: event.routineTitle || "Scheduled work", detail: "Recurring: created by the routine's run; its last outcome shows here.", status: running ? "doing" : "open", recurring: routineId }, null, { now, memberId, source: "routine", by: "routine" });
    task.history.push({ at: now, by: "routine", event: "run", note });
  } else {
    task = taskInputFrom({ status: running ? "doing" : task.status === "done" ? "open" : task.status }, task, { now, by: "routine" });
    task.history = [...task.history, { at: now, by: "routine", event: "run", note }].slice(-30);
  }
  store.replaceTask(task);
  await store.save();
  changed(ctx, memberId);
  log(ctx, ctx.SEVERITY.INFO, `work: routine run ${running ? "reopened" : "touched"} task ${task.title}`, taskAttributes(task, { "event.name": "work.task.routine_run", "autohand.routine.id": routineId }));
}

async function onRoutineFinished(ctx, event) {
  const routineId = String(event?.routineId || "");
  if (!routineId) return;
  await ensureStore(ctx);
  const task = store.recurringTask(routineId, String(event.memberId || ""));
  if (!task) return;
  const now = new Date().toISOString();
  const status = event.status === "completed" ? "done" : event.status === "failed" ? "blocked" : "open";
  const settled = taskInputFrom({ status }, task, { now, by: "routine" });
  settled.lastOutcome = { at: now, status: String(event.status || ""), preview: String(event.preview || "").slice(0, 400) };
  settled.history = [...settled.history, { at: now, by: "routine", event: "run", note: `run ${event.status}${event.preview ? `: ${String(event.preview).slice(0, 200)}` : ""}` }].slice(-30);
  store.replaceTask(settled);
  await store.save();
  changed(ctx, settled.memberId);
}

// ---------------------------------------------------------------------------
// Lifecycle

export async function init(ctx) {
  bridgeContext = ctx;
  await ensureStore(ctx);
  const { queue, dispatcher } = taskQueue();
  assignments = createTaskAssignments({ work: store, queue, dispatcher, emit: ctx.emit, prepare: ctx.prepareMemberTask });
  // Queue state is the execution record, including restart interruption.
  // An intent saved before a crash but never queued remains visibly blocked.
  for (const task of store.tasks()) {
    const item = [...queue.items.values()].find(item => item.workTaskId === task.id);
    if (item) await assignments.sync(item.id);
    else if (task.assignment?.state === "pending") {
      const blocked = taskInputFrom({ status: "blocked", outcome: "Squad restarted before this task was queued. Queue it when ready." }, task, { by: "bridge" });
      blocked.assignment = { ...task.assignment, state: "failed" };
      store.replaceTask(blocked);
      await store.save();
    }
  }
  if (!listening && ctx.events?.on) {
    for (const eventName of ["queue.started", "queue.finished"]) ctx.events.on(eventName, event => assignments.sync(event.itemId).catch(error => log(bridgeContext, bridgeContext.SEVERITY.WARN, `work: queue bookkeeping failed: ${error.message}`)));
    ctx.events.on("routine.run", (event) => onRoutineRun(bridgeContext, event).catch((error) => log(bridgeContext, bridgeContext.SEVERITY.WARN, `work: routine run bookkeeping failed: ${error?.message || error}`, { "event.name": "work.routine.failed" })));
    ctx.events.on("routine.finished", (event) => onRoutineFinished(bridgeContext, event).catch((error) => log(bridgeContext, bridgeContext.SEVERITY.WARN, `work: routine finish bookkeeping failed: ${error?.message || error}`, { "event.name": "work.routine.failed" })));
    listening = true;
  }
  try {
    ctx.agentChannelActions?.registerHandler?.("task", taskAction);
  } catch (error) {
    log(ctx, ctx.SEVERITY.WARN, `work: task actions unavailable: ${error?.message || error}`, { "event.name": "work.actions.unavailable" });
  }
  log(ctx, ctx.SEVERITY.INFO, `work plans loaded: ${store.tasks().length} tasks`, { "event.name": "work.store.loaded" });
}

// ---------------------------------------------------------------------------
// Routes

const TASK = /^\/api\/work\/([^/]+)$/;
const TASK_DONE = /^\/api\/work\/([^/]+)\/done$/;
const PLAN = /^\/api\/work\/plan\/([^/]+)$/;

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

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (path !== "/api/work" && !path.startsWith("/api/work/")) return false;
  await ensureStore(ctx);

  if (path === "/api/work" && req.method === "GET") {
    const memberId = String(url.searchParams.get("memberId") || "");
    const { queue } = taskQueue();
    for (const task of store.tasks(memberId)) {
      const item = task.assignment?.queueItemId && queue.items.get(task.assignment.queueItemId);
      if (item && task.assignment.state !== item.status) await assignments.sync(item.id);
    }
    return ok(ctx, res, 200, { tasks: store.tasks(memberId), deletedTaskIds: store.deletedTasks().map(task => task.id) });
  }

  const runtimeMatch = path.match(/^\/api\/work\/runtime\/([^/]+)$/);
  if (runtimeMatch && req.method === "DELETE") {
    const body = await ctx.readBody(req);
    const id = decode(runtimeMatch[1]);
    const memberId = String(body?.memberId || "");
    if (!memberId) return fail(ctx, res, 400, "memberId is required");
    // Persist a tombstone before stopping: a late result in any window must
    // not make the row reappear. Other tasks and member runs keep working.
    const requestIds = (Array.isArray(body?.requestIds) ? body.requestIds : []).filter(value => typeof value === "string").map(value => value.slice(0, 200)).slice(0, 100);
    store.hideRuntimeTask(id, memberId, requestIds);
    await store.save();
    for (const run of ctx.runs.values()) {
      if (run.ownerTaskId === id || requestIds.includes(run.requestId) || (body?.runId === run.id && run.agentId === memberId)) await ctx.stopRun(run.id, "task deleted by owner");
    }
    changed(ctx, memberId);
    return ok(ctx, res, 200, { id });
  }

  const queueMatch = path.match(/^\/api\/work\/([^/]+)\/queue$/);
  if (queueMatch && req.method === "POST") {
    try { return ok(ctx, res, 201, await assignments.enqueue(decode(queueMatch[1]))); }
    catch (error) { return fail(ctx, res, error.status || 400, error.message); }
  }

  if (path === "/api/work" && req.method === "POST") {
    const body = await ctx.readBody(req);
    const memberId = String(body?.memberId || "").trim();
    const source = body?.source === "handoff" ? "handoff" : "person";
    const task = taskInputFrom(body, null, { memberId, source, by: "person" });
    const problems = validateTask(task);
    if (problems.length) return fail(ctx, res, 400, `task is incomplete: ${problems.join(", ")}`);
    store.replaceTask(task);
    await store.save();
    changed(ctx, memberId);
    log(ctx, ctx.SEVERITY.INFO, `work: task ${task.title} added for ${memberId}`, taskAttributes(task, { "event.name": "work.task.added", "autohand.work.source": source }));
    return ok(ctx, res, 201, task);
  }

  let match = path.match(PLAN);
  if (match && req.method === "GET") {
    const memberId = decode(match[1]);
    const plan = await workPlanFor({ memberId, squadStateDir: ctx.squadStateDir, goals: ctx.goals });
    return ok(ctx, res, 200, plan);
  }

  match = path.match(TASK_DONE);
  if (match && req.method === "POST") {
    const existing = store.task(decode(match[1]));
    if (!existing) return fail(ctx, res, 404, "task not found");
    try { assertTaskEditable(existing); } catch (error) { return fail(ctx, res, error.status, error.message); }
    const body = await ctx.readBody(req).catch(() => ({}));
    const task = taskInputFrom({ status: "done", ...(body?.outcome !== undefined ? { outcome: body.outcome } : {}) }, existing, { by: "person" });
    store.replaceTask(task);
    await store.save();
    changed(ctx, task.memberId);
    if (task.recurring) await noteRoutineRun(ctx, task.recurring, "Marked done by the person").catch(() => false);
    return ok(ctx, res, 200, task);
  }

  match = path.match(TASK);
  if (match) {
    const existing = store.task(decode(match[1]));
    if (!existing) return fail(ctx, res, 404, "task not found");
    if (req.method === "GET") {
      const item = existing.assignment?.queueItemId && taskQueue().queue.items.get(existing.assignment.queueItemId);
      if (item && existing.assignment.state !== item.status) await assignments.sync(item.id);
      return ok(ctx, res, 200, store.task(existing.id));
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      try { assertTaskEditable(existing); } catch (error) { return fail(ctx, res, error.status, error.message); }
      const body = await ctx.readBody(req);
      if (body?.status !== undefined && !["open", "doing", "blocked", "done"].includes(body.status)) return fail(ctx, res, 400, "status must be open, doing, blocked or done");
      const task = taskInputFrom(body, existing, { by: "person" });
      const problems = validateTask(task);
      if (problems.length) return fail(ctx, res, 400, `task is incomplete: ${problems.join(", ")}`);
      store.replaceTask(task);
      await store.save();
      changed(ctx, task.memberId);
      return ok(ctx, res, 200, task);
    }
    if (req.method === "DELETE") {
      if (existing.recurring) await stopRoutineTaskWork(ctx, { routineId: existing.recurring, memberId: existing.memberId });
      const removed = await assignments.remove(existing.id);
      log(ctx, ctx.SEVERITY.INFO, `work: task ${existing.title} removed`, taskAttributes(existing, { "event.name": "work.task.removed" }));
      return ok(ctx, res, 200, removed);
    }
  }

  return false;
}
