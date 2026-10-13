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

import { noteRoutineRun } from "./routines.route.mjs";
import { STORE_FILE, findByTitle, taskInputFrom, validateTask, workStoreFor } from "../work/store.mjs";
import { workPlanFor } from "../work/plan.mjs";
import { dueLabel } from "../../src/lib/work-plans.js";

export const name = "work";

const ACTION_KEYS = new Set(["type", "op", "id", "title", "detail", "due", "status", "outcome", "recurring"]);
const ACTION_OPS = new Set(["add", "done", "update"]);

let store = null;
let bridgeContext = null;
let listening = false;

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
  if (!listening && ctx.events?.on) {
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
    return ok(ctx, res, 200, { tasks: store.tasks(memberId) });
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
    if (req.method === "GET") return ok(ctx, res, 200, existing);
    if (req.method === "PUT" || req.method === "PATCH") {
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
      const removed = store.removeTask(existing.id);
      await store.save();
      changed(ctx, existing.memberId);
      log(ctx, ctx.SEVERITY.INFO, `work: task ${existing.title} removed`, taskAttributes(existing, { "event.name": "work.task.removed" }));
      return ok(ctx, res, 200, removed);
    }
  }

  return false;
}
