// Search route plug-in (ADR-0020). Owns the FTS index at
// <squadStateDir>/search.sqlite and keeps the bridge-held records in it:
// runs (from ctx.runs, refreshed on run.finished) and channels plus their
// messages (from channels.json, refreshed on chat.finished / mention.received).
// Everything the browser holds instead (DM messages, tasks, handoffs, members,
// canvases, workflow runs) arrives through POST /api/search/index.
//
//   GET  /api/search?q=&types=&limit=   → { query, mode, results, tookMs }
//   GET  /api/search/stats              → { path, mode, total, byType, updatedAt, rebuiltAt }
//   POST /api/search/index   { docs }   → { indexed, changed, skipped }
//   POST /api/search/remove  { ids }    → { removed }
//   POST /api/search/rebuild { docs? }  → stats (bridge records + the docs in the body)

import { openSearchIndex } from "../search/index.mjs";

export const name = "search";

const MISSION_CONTROL_ROUTE = "/mission-control";
const CHANNELS_ROUTE = "/channels";
const RUN_LOG_LINES = 60;
const RUN_LOG_CHARS = 6000;
const CHANNEL_REFRESH_MS = 400;

let index = null;
let refreshTimer = null;
let refreshing = null;

/** The open index (tests and other plug-ins). */
export function getSearchIndex() {
  return index;
}

/** Index document for a bridge run (the raw `ctx.runs` value). */
export function runDoc(run) {
  if (!run?.id) return null;
  const logs = Array.isArray(run.logs) ? run.logs.slice(-RUN_LOG_LINES) : [];
  const tail = logs
    .map((entry) => (typeof entry === "string" ? entry : entry?.line || ""))
    .filter(Boolean)
    .join("\n")
    .slice(-RUN_LOG_CHARS);
  const body = [run.command, run.workspace, run.status ? `status ${run.status}` : "", run.harness, tail].filter(Boolean).join("\n");
  return {
    id: `run:${run.id}`,
    type: "run",
    title: String(run.title || run.command || "Run").trim(),
    body,
    memberId: String(run.agentId || ""),
    channelId: String(run.channel?.id || ""),
    runId: String(run.id),
    route: `${MISSION_CONTROL_ROUTE}?run=${encodeURIComponent(run.id)}`,
    at: run.finishedAt || run.startedAt || undefined,
  };
}

/** Index document for a channel record from channels.json. */
export function channelDoc(channel) {
  if (!channel?.id || !channel?.name) return null;
  const projects = Array.isArray(channel.projects) ? channel.projects.map((project) => project?.name || project?.path || "").filter(Boolean) : [];
  return {
    id: `channel:${channel.id}`,
    type: "channel",
    title: `#${channel.name}`,
    body: [channel.description || channel.topic || "", channel.visibility === "private" ? "private" : "", ...projects].filter(Boolean).join("\n"),
    channelId: String(channel.id),
    route: `${CHANNELS_ROUTE}/${encodeURIComponent(channel.id)}`,
    at: channel.updatedAt || channel.createdAt || undefined,
  };
}

/** Index document for a channel message from channels.json. */
export function channelMessageDoc(message, channelsById = new Map()) {
  if (!message?.id || !message?.channelId) return null;
  const body = String(message.body || "").trim();
  if (!body) return null;
  const channel = channelsById.get(message.channelId);
  const channelName = channel?.name || message.channelName || "";
  return {
    id: `message:${message.id}`,
    type: "message",
    title: channelName ? `#${channelName}` : "Channel message",
    body,
    memberId: String(message.agentId || ""),
    channelId: String(message.channelId),
    runId: String(message.runId || ""),
    route: `${CHANNELS_ROUTE}/${encodeURIComponent(message.channelId)}?message=${encodeURIComponent(message.id)}`,
    at: message.createdAt || message.updatedAt || undefined,
  };
}

/** Every document the bridge can produce on its own: channels, their messages, runs. */
export async function bridgeDocs(ctx) {
  const docs = [];
  const state = await ctx.readChannelsState();
  const channelsById = new Map((state?.channels || []).map((channel) => [channel.id, channel]));
  for (const channel of state?.channels || []) {
    const doc = channelDoc(channel);
    if (doc) docs.push(doc);
  }
  for (const message of state?.messages || []) {
    const doc = channelMessageDoc(message, channelsById);
    if (doc) docs.push(doc);
  }
  for (const run of ctx.runs?.values?.() || []) {
    const doc = runDoc(run);
    if (doc) docs.push(doc);
  }
  return docs;
}

async function refreshChannels(ctx) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const state = await ctx.readChannelsState();
      const channelsById = new Map((state?.channels || []).map((channel) => [channel.id, channel]));
      const docs = [...(state?.channels || []).map(channelDoc), ...(state?.messages || []).map((message) => channelMessageDoc(message, channelsById))].filter(Boolean);
      if (docs.length) index?.upsert(docs);
    } catch (error) {
      ctx.logEvent?.(ctx.SEVERITY?.WARN, "search: channel refresh failed", { error: String(error?.message || error) });
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function scheduleChannelRefresh(ctx) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshChannels(ctx);
  }, CHANNEL_REFRESH_MS);
  refreshTimer.unref?.();
}

function indexRun(ctx, runId) {
  const run = runId ? ctx.runs?.get?.(runId) : null;
  const doc = runDoc(run);
  if (doc) index?.upsert(doc);
}

export async function init(ctx) {
  const fts = process.env.AUTOHAND_SEARCH_FTS === "0" ? false : "auto";
  index = openSearchIndex(ctx.squadStateDir, { fts });
  try {
    const docs = await bridgeDocs(ctx);
    if (docs.length) index.upsert(docs);
  } catch (error) {
    ctx.logEvent?.(ctx.SEVERITY?.WARN, "search: initial indexing failed", { error: String(error?.message || error) });
  }
  const stats = index.stats();
  ctx.logEvent?.(ctx.SEVERITY?.INFO, "search index ready", { mode: stats.mode, total: stats.total, path: stats.path });

  ctx.events?.on?.("run.finished", (event) => indexRun(ctx, event?.runId));
  ctx.events?.on?.("chat.finished", (event) => {
    if (event?.channelId) scheduleChannelRefresh(ctx);
  });
  ctx.events?.on?.("mention.received", (event) => {
    if (event?.channelId) scheduleChannelRefresh(ctx);
  });
}

function fail(ctx, res, status, error) {
  ctx.json(res, status, { success: false, error: String(error?.message || error) });
  return true;
}

export async function handle(req, res, url, ctx) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/search")) return false;
  if (!index) return fail(ctx, res, 503, "search index is not open");

  try {
    if (pathname === "/api/search" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const types = url.searchParams.get("types") || "";
      const limit = url.searchParams.get("limit") || "";
      const started = performance.now();
      const results = index.query(q, { types, limit });
      ctx.json(res, 200, { success: true, data: { query: q, mode: index.mode, results, tookMs: Math.round((performance.now() - started) * 100) / 100 } });
      return true;
    }

    if (pathname === "/api/search/stats" && req.method === "GET") {
      ctx.json(res, 200, { success: true, data: index.stats() });
      return true;
    }

    if (pathname === "/api/search/index" && req.method === "POST") {
      const body = await ctx.readBody(req);
      const docs = Array.isArray(body?.docs) ? body.docs : body?.doc ? [body.doc] : [];
      if (!docs.length) return fail(ctx, res, 400, "docs[] is required");
      ctx.json(res, 200, { success: true, data: index.upsert(docs) });
      return true;
    }

    if (pathname === "/api/search/remove" && req.method === "POST") {
      const body = await ctx.readBody(req);
      const ids = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : [];
      if (!ids.length) return fail(ctx, res, 400, "ids[] is required");
      ctx.json(res, 200, { success: true, data: index.remove(ids) });
      return true;
    }

    if (pathname === "/api/search/rebuild" && req.method === "POST") {
      const body = await ctx.readBody(req);
      const pushed = Array.isArray(body?.docs) ? body.docs : [];
      const docs = [...(await bridgeDocs(ctx)), ...pushed];
      const result = index.rebuild(docs);
      ctx.logEvent?.(ctx.SEVERITY?.INFO, "search index rebuilt", { indexed: result.indexed, pushed: pushed.length });
      ctx.json(res, 200, { success: true, data: { ...index.stats(), indexed: result.indexed } });
      return true;
    }

    return false;
  } catch (error) {
    return fail(ctx, res, 500, error);
  }
}
