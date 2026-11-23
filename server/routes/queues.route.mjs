// Durable member queues and the context gauge (ADR-0111).
//
//   GET  /api/queues[?memberId=]            { queues: { [memberId]: queue }, context: { [memberId]: gauge } }
//   GET  /api/queues/context                { [memberId]: gauge }
//   GET  /api/queues/:memberId              queue + context for one member
//   POST /api/queues/:memberId/items        enqueue (chat payload + text); 201 with the item
//   POST /api/queues/:memberId/reorder      { ids } queued ids in their new order
//   POST /api/queues/:memberId/pause|resume|stop|clear
//   POST /api/queues/items/:id/update       { text }
//   POST /api/queues/items/:id/cancel
//
// A queue is { memberId, paused, pauseReason, items[] }; an item is
// { id, memberId, workspace, text, attachments[], status, createdAt, updatedAt,
//   startedAt, finishedAt, reply, error, progress, result }.

import { QueueStore } from "../queues/store.mjs";
import { QueueDispatcher } from "../queues/dispatcher.mjs";
import { contextGauge } from "../queues/context-gauge.mjs";
import { cleanWorkResult } from "../work-progress.mjs";
import { join } from "node:path";
import { STORE_FILE, workStoreFor } from "../work/store.mjs";

export const name = "queues";

let store = null;
let dispatcher = null;

export function taskQueue() {
  if (!store || !dispatcher) throw Object.assign(new Error('Queues are not ready.'), { status: 503 });
  return { queue: store, dispatcher };
}

// Called by both direct chat routes after normal availability/remote checks.
export async function admitChat(payload) {
  if (!dispatcher) throw Object.assign(new Error('Queues are not ready.'), { status: 503 });
  return dispatcher.admit(payload);
}

export async function init(ctx) {
  store = new QueueStore({ squadStateDir: ctx.squadStateDir });
  await store.ready;
  const work = workStoreFor(join(ctx.squadStateDir, STORE_FILE));
  await work.load();
  dispatcher = new QueueDispatcher({
    store,
    executeTurn: ctx.executeTurn,
    isMemberBusy: ctx.isMemberBusy || (async () => false),
    canRun: async item => !item.workTaskId || work.task(item.workTaskId)?.memberId === item.memberId,
    availability: ctx.availability,
    registerChat: ctx.registerChat,
    emit: ctx.emit,
    cleanResult: cleanWorkResult,
  });
  if (typeof ctx.executeTurn !== "function") {
    ctx.logEvent?.(ctx.SEVERITY?.WARN ?? 13, "queues: bridge context has no executeTurn; items stay queued", {});
  } else {
    dispatcher.attach(ctx.events);
  }
  ctx.events.on("usage.recorded", (event) => {
    const memberId = String(event?.agentId || event?.memberId || "").trim();
    const contextTokens = Number(event?.contextTokens) || 0;
    if (!memberId || !contextTokens) return;
    const contextWindow = Number(event?.contextWindow) || Number(ctx.modelContextWindow?.({ provider: event.provider, model: event.model, harness: event.harness })) || 0;
    void store.recordContext(memberId, { memberId, contextTokens, contextWindow, model: String(event.model || ""), harness: String(event.harness || event.transport || ""), at: event.at || new Date().toISOString() }).catch(() => {});
  });
}

function gaugesFrom(contexts) {
  const gauges = {};
  for (const [memberId, record] of Object.entries(contexts || {})) {
    const gauge = contextGauge(record);
    if (gauge) gauges[memberId] = gauge;
  }
  return gauges;
}

async function memberQueue(memberId) {
  const queues = await store.list(memberId);
  const gauges = gaugesFrom(await store.contexts());
  return { ...queues[memberId], context: gauges[memberId] || null };
}

/** A failed chat turn waits this long before Squad tries it once more (ADR-0274). */
export const AUTO_RETRY_MS = 10 * 60 * 1000;

/**
 * Send a chat turn again as a queued follow-up with the same prompt and launch
 * payload, so it runs when the member is free and in order with anything else
 * waiting (ADR-0123: a run a restart interrupted; ADR-0274: a failed run, now
 * or after `delayMs`). The run remembers the item it became; a second retry is
 * refused. Throws with `status` for the route.
 */
export async function retryRun(run, { delayMs = 0, automatic = false, ctx = null } = {}) {
  const refuse = (status, message) => { throw Object.assign(new Error(message), { status }); };
  if (!store || !dispatcher) refuse(503, "Queues are not ready.");
  if (!["interrupted", "failed"].includes(run.status)) refuse(409, "Only a run that failed or was interrupted can be retried.");
  if (!run.launch || !run.prompt) refuse(409, "This run cannot be retried from here: it was a goal, routine, queue or channel turn, which recover on their own.");
  const existing = run.retryItemId ? store.items.get(run.retryItemId) : null;
  // A waiting automatic retry can be run now instead.
  if (existing && existing.status === "queued" && existing.notBefore && !automatic) {
    delete existing.notBefore;
    existing.updatedAt = new Date().toISOString();
    await store.save();
    dispatcher.schedule();
    run.autoRetryAt = "";
    return { item: existing, runId: run.id, ...(await memberQueue(run.agentId)) };
  }
  if (run.retryItemId) refuse(409, "This run was already retried.");
  const notBefore = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : undefined;
  const item = await store.enqueue({ ...run.launch, agentId: run.agentId, text: run.prompt, workspace: run.launch.workspace || run.workspace, retryOfRunId: run.id, automaticRetry: automatic, ...(notBefore ? { notBefore } : {}) });
  run.retryItemId = item.id;
  run.retriedAt = new Date().toISOString();
  run.autoRetryAt = notBefore || "";
  ctx?.emit?.("queue.enqueued", { memberId: run.agentId, itemId: item.id, text: item.text.slice(0, 140), retryOfRunId: run.id, ...(notBefore ? { notBefore } : {}) });
  dispatcher.schedule();
  ctx?.logEvent?.(ctx.SEVERITY?.INFO ?? 9, `run ${run.id} retried as queue item ${item.id}${notBefore ? ` at ${notBefore}` : ""}`, { "event.name": "run.retried", "autohand.run.id": run.id, "autohand.member.id": run.agentId, automatic });
  const queue = await memberQueue(run.agentId);
  return { item, runId: run.id, paused: queue.paused, pauseReason: queue.pauseReason || "", notBefore: notBefore || "" };
}

/** Cancel a waiting automatic retry. */
async function cancelRetry(run) {
  const item = run.retryItemId ? store.items.get(run.retryItemId) : null;
  if (!item || item.status !== "queued") throw Object.assign(new Error("There is no waiting retry to cancel."), { status: 409 });
  await dispatcher.cancelItem(item.id);
  run.retryItemId = "";
  run.autoRetryAt = "";
  return { runId: run.id };
}

async function retryRoute(req, res, runId, action, ctx) {
  const run = ctx.runs?.get?.(runId);
  if (!run) { ctx.json(res, 404, { success: false, error: "run not found" }); return true; }
  try {
    const data = action === "cancel" ? await cancelRetry(run) : await retryRun(run, { ctx });
    ctx.persistRuns?.();
    ctx.json(res, action === "cancel" ? 200 : 201, { success: true, data });
  } catch (error) {
    ctx.json(res, error.status || 400, { success: false, error: error.message, ...(run.retryItemId ? { itemId: run.retryItemId } : {}) });
  }
  return true;
}

export async function handle(req, res, url, ctx) {
  const retryMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/retry(?:\/(cancel))?$/);
  if (retryMatch && req.method === "POST") return retryRoute(req, res, decodeURIComponent(retryMatch[1]), retryMatch[2] || "", ctx);
  if (!url.pathname.startsWith("/api/queues")) return false;
  if (!store) { ctx.json(res, 503, { success: false, error: "queues are not ready" }); return true; }
  try {
    if (url.pathname === "/api/queues" && req.method === "GET") {
      const memberId = String(url.searchParams.get("memberId") || "").trim();
      ctx.json(res, 200, { success: true, data: { queues: await store.list(memberId), context: gaugesFrom(await store.contexts()) } });
      return true;
    }
    if (url.pathname === "/api/queues/context" && req.method === "GET") {
      ctx.json(res, 200, { success: true, data: gaugesFrom(await store.contexts()) });
      return true;
    }
    const itemMatch = url.pathname.match(/^\/api\/queues\/items\/([^/]+)\/(update|cancel)$/);
    if (itemMatch && req.method === "POST") {
      const id = decodeURIComponent(itemMatch[1]);
      if (itemMatch[2] === "update") {
        ctx.json(res, 200, { success: true, data: await store.update(id, await ctx.readBody(req)) });
        return true;
      }
      const cancelled = await dispatcher.cancelItem(id);
      ctx.json(res, 200, { success: true, data: cancelled });
      return true;
    }
    const memberMatch = url.pathname.match(/^\/api\/queues\/([^/]+)(?:\/(items|reorder|pause|resume|stop|clear))?$/);
    if (!memberMatch) return false;
    const memberId = decodeURIComponent(memberMatch[1]).trim();
    const action = memberMatch[2] || "";
    if (!action && req.method === "GET") { ctx.json(res, 200, { success: true, data: await memberQueue(memberId) }); return true; }
    if (req.method !== "POST") return false;
    if (action === "items") {
      const body = await ctx.readBody(req);
      const item = await store.enqueue({ ...body, workTaskId: undefined, agentId: memberId });
      ctx.emit?.("queue.enqueued", { memberId, itemId: item.id, text: item.text.slice(0, 140) });
      dispatcher.schedule();
      ctx.json(res, 201, { success: true, data: item });
      return true;
    }
    if (action === "reorder") {
      const body = await ctx.readBody(req);
      ctx.json(res, 200, { success: true, data: { memberId, items: await store.reorder(memberId, body.ids) } });
      return true;
    }
    if (action === "pause") { await store.setPaused(memberId, true, "Paused by you."); ctx.json(res, 200, { success: true, data: await memberQueue(memberId) }); return true; }
    if (action === "resume") {
      await store.setPaused(memberId, false);
      dispatcher.schedule();
      ctx.json(res, 200, { success: true, data: await memberQueue(memberId) });
      return true;
    }
    if (action === "stop") {
      const stopped = await dispatcher.stop(memberId);
      ctx.json(res, 200, { success: true, data: { ...stopped, ...(await memberQueue(memberId)) } });
      return true;
    }
    if (action === "clear") {
      const cleared = await store.clear(memberId);
      ctx.json(res, 200, { success: true, data: { cleared, ...(await memberQueue(memberId)) } });
      return true;
    }
    return false;
  } catch (error) {
    ctx.json(res, error.status || 400, { success: false, error: error.message });
    return true;
  }
}
