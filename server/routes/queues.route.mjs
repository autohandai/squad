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

export const name = "queues";

let store = null;
let dispatcher = null;

export async function init(ctx) {
  store = new QueueStore({ squadStateDir: ctx.squadStateDir });
  await store.ready;
  dispatcher = new QueueDispatcher({
    store,
    executeTurn: ctx.executeTurn,
    isMemberBusy: ctx.isMemberBusy || (async () => false),
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

export async function handle(req, res, url, ctx) {
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
      const cancelled = await store.cancel(id);
      // Cancelling the item in flight is a stop: the turn is aborted and the
      // queue waits for a person, exactly like the composer's stop control.
      if (cancelled.wasRunning) await dispatcher.stop(cancelled.memberId);
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
      const item = await store.enqueue({ ...body, agentId: memberId });
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
