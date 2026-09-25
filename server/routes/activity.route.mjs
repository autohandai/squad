// Activity feed routes (docs/integration/activity.md).
//
//   GET  /api/runs/:id/activity        semantic rows for a run: the run's
//                                      trace events when the harness kept
//                                      them, otherwise its log lines
//   POST /api/activity/normalize       { events, status?, live? } → rows for
//                                      a trace the web app already holds
//
// Both answer { success: true, data: { items, rows, summary, stats, source } }.
// `items` are ActivityItem[]; `rows` are the collapsed feed (quiet runs folded
// into summary rows); `source` says which input was folded.

import { activityStats, activityFromTrace, collapseActivity, normalizeActivity, summarizeQuiet } from "../activity/normalize.mjs";

export const name = "activity";

const RUN_ACTIVITY_RE = /^\/api\/runs\/([^/]+)\/activity$/;
const MAX_EVENTS = 20000;

function payload(items, source) {
  return {
    items,
    rows: collapseActivity(items),
    summary: summarizeQuiet(items),
    stats: activityStats(items),
    source,
  };
}

export async function handle(req, res, url, ctx) {
  const runMatch = url.pathname.match(RUN_ACTIVITY_RE);
  if (runMatch && req.method === "GET") {
    const id = decodeURIComponent(runMatch[1]);
    const run = ctx.runs.get(id);
    if (!run) {
      ctx.json(res, 404, { success: false, error: `run ${id} not found` });
      return true;
    }
    const status = run.status || "running";
    const trace = run.trace && Array.isArray(run.trace.events) && run.trace.events.length ? run.trace : null;
    const items = trace ? activityFromTrace(trace, { status }) : normalizeActivity(Array.isArray(run.logs) ? run.logs : [], { status });
    ctx.json(res, 200, {
      success: true,
      data: {
        runId: run.id,
        status,
        ...payload(items, trace ? "trace" : "logs"),
        raw: Array.isArray(run.logs) ? run.logs.slice(-260) : [],
      },
    });
    return true;
  }

  if (url.pathname === "/api/activity/normalize" && req.method === "POST") {
    let body;
    try {
      body = await ctx.readBody(req);
    } catch (error) {
      ctx.json(res, 400, { success: false, error: `invalid JSON body: ${error?.message || error}` });
      return true;
    }
    const events = Array.isArray(body?.events) ? body.events : Array.isArray(body?.trace?.events) || body?.trace ? null : null;
    const trace = body?.trace && typeof body.trace === "object" ? body.trace : null;
    if (!events && !trace) {
      ctx.json(res, 400, { success: false, error: "expected { events: [...] } or { trace: {...} }" });
      return true;
    }
    if (events && events.length > MAX_EVENTS) {
      ctx.json(res, 413, { success: false, error: `at most ${MAX_EVENTS} events per request` });
      return true;
    }
    const options = { status: typeof body.status === "string" ? body.status : "", live: Boolean(body.live) };
    const items = events ? normalizeActivity(events, options) : activityFromTrace(trace, options);
    ctx.json(res, 200, { success: true, data: payload(items, events ? "events" : "trace") });
    return true;
  }

  return false;
}
