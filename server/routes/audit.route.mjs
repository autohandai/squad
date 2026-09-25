// Audit trail route plug-in (ADR-0018, docs/integration/audit.md).
//
// Subscribes to every bridge event and appends exactly one record to the
// acting member's trail; serves the trail back as pages and as a JSONL
// download; accepts client-side actions (messages a member posted in a
// channel, file edits the web app observed) from the web app.
//
//   GET  /api/members/:id/activity?before=&limit=&kind=
//   GET  /api/members/:id/activity/export
//   POST /api/members/:id/activity   { kind, summary, refs, eventName?, status?, at? }

import { ACTIVITY_KINDS, appendRecord, buildRecord, exportStats, exportStream, readRecords, safeMemberId } from "../audit/trail.mjs";

export const name = "audit";

const PATH = /^\/api\/members\/([^/]+)\/activity(\/export)?\/?$/;
const EVENT_NAME = /^[a-z]+(\.[a-z_]+)+$/;

/** Bridge event name → activity kind. Unknown events are not recorded. */
export const KIND_BY_EVENT = Object.freeze({
  "run.finished": "run",
  "member.stopped": "run",
  "chat.finished": "message",
  "mention.received": "message",
  "shell.ran": "shell",
  "handoff.pending": "handoff",
  "approval.pending": "approval",
  "file.edited": "edit",
});

function text(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function severityFor(status) {
  return status === "failed" || status === "error" ? 13 : 9;
}

function summaryFor(event, kind) {
  const title = text(event.title);
  const preview = text(event.preview, 140);
  switch (event.name) {
    case "run.finished":
      return `${event.status === "failed" ? "Run failed" : event.status === "stopped" ? "Run stopped" : "Run finished"}${title ? `: ${title}` : ""}`;
    case "member.stopped":
      return `Stopped${Number(event.stoppedRuns) ? ` (${event.stoppedRuns} run${Number(event.stoppedRuns) === 1 ? "" : "s"})` : ""}`;
    case "chat.finished":
      return `${event.status === "failed" ? "Reply failed" : "Replied"}${event.channelId ? " in channel" : ""}${preview ? `: ${preview}` : ""}`;
    case "mention.received":
      return `Mentioned${preview ? `: ${preview}` : ""}`;
    case "shell.ran":
      return `Ran ${text(event.command, 160) || "a command"}${Number.isFinite(Number(event.exitCode)) && Number(event.exitCode) !== 0 ? ` (exit ${event.exitCode})` : ""}`;
    case "handoff.pending":
      return `Handed off${title ? `: ${title}` : ""}`;
    case "approval.pending":
      return `Waiting for approval${event.stepId ? ` at ${text(event.stepId, 60)}` : ""}`;
    case "file.edited":
      return `Edited ${text(event.path, 160) || "a file"}`;
    default:
      return `${kind}: ${event.name}`;
  }
}

/** The member an event should be attributed to; empty when nobody acted. */
export function actorOf(event, { memberFor } = {}) {
  const direct = text(event.memberId, 128);
  if (direct) return direct;
  if (event.name === "handoff.pending") return text(event.fromMemberId, 128);
  if (typeof memberFor === "function" && event.runId) return text(memberFor(String(event.runId)), 128);
  return "";
}

/**
 * Map one bridge event to one audit record, or `null` when the event has no
 * member to attribute it to. Pure: `memberFor(runId)` is the only lookup and
 * is optional (the bridge passes `ctx.runs`).
 */
export function recordFromEvent(event, { memberFor } = {}) {
  if (!event || typeof event !== "object" || !event.name) return null;
  const kind = KIND_BY_EVENT[event.name];
  if (!kind) return null;
  const memberId = actorOf(event, { memberFor });
  if (!memberId) return null;
  const refs = {
    runId: text(event.runId, 128),
    channelId: text(event.channelId, 128),
    taskId: text(event.taskId, 128),
    workflowId: text(event.workflowId, 128),
    stepId: text(event.stepId, 128),
    messageId: text(event.messageId, 128),
    workspace: text(event.workspace, 512),
    path: text(event.path, 512),
    command: event.name === "shell.ran" ? text(event.command, 512) : "",
    exitCode: event.name === "shell.ran" && Number.isFinite(Number(event.exitCode)) ? Number(event.exitCode) : "",
    memberId: event.name === "handoff.pending" ? text(event.toMemberId, 128) : "",
  };
  const status = text(event.status, 32) || (event.name.endsWith(".pending") ? "pending" : "");
  return buildRecord({
    memberId,
    kind,
    eventName: event.name,
    summary: summaryFor(event, kind),
    status,
    source: "bridge",
    severityNumber: severityFor(status),
    timestamp: event.at || Date.now(),
    refs,
  });
}

/**
 * Validate a client-side action (`POST /api/members/:id/activity`) into a
 * record spec. Throws with a message fit for a 400.
 */
export function recordFromClientAction(memberId, body = {}) {
  const id = text(memberId, 128);
  if (!id) throw new Error("member id is required");
  const kind = String(body?.kind || "").trim();
  if (!ACTIVITY_KINDS.includes(kind)) throw new Error(`kind must be one of ${ACTIVITY_KINDS.join(", ")}`);
  const summary = text(body?.summary, 1000);
  if (!summary) throw new Error("summary is required");
  const eventName = text(body?.eventName, 80);
  if (eventName && !EVENT_NAME.test(eventName)) throw new Error("eventName must look like channel.message.posted");
  const refs = {};
  if (body?.refs && typeof body.refs === "object" && !Array.isArray(body.refs)) {
    for (const [key, value] of Object.entries(body.refs)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
      if (value === undefined || value === null || value === "") continue;
      refs[key] = typeof value === "number" ? value : text(value, 512);
    }
  }
  return buildRecord({
    memberId: id,
    kind,
    eventName: eventName || `web.${kind}`,
    summary,
    status: text(body?.status, 32),
    source: "web",
    timestamp: body?.at || Date.now(),
    refs,
  });
}

let subscribed = null;

export async function init(ctx) {
  if (subscribed) return;
  const memberFor = (runId) => ctx.runs?.get?.(runId)?.agentId || "";
  subscribed = (event) => {
    let record = null;
    try {
      record = recordFromEvent(event, { memberFor });
    } catch (error) {
      ctx.logEvent?.(ctx.SEVERITY?.WARN || 13, `audit: could not map ${event?.name}: ${error?.message || error}`, { "event.name": "audit.map_failed" });
      return;
    }
    if (!record) return;
    appendRecord(ctx.squadStateDir, record).catch((error) => {
      ctx.logEvent?.(ctx.SEVERITY?.WARN || 13, `audit: append failed for ${event?.name}: ${error?.message || error}`, {
        "event.name": "audit.append_failed",
        "autohand.member.id": event?.memberId || "",
      });
    });
  };
  ctx.events.on("*", subscribed);
}

export async function handle(req, res, url, ctx) {
  const match = url.pathname.match(PATH);
  if (!match) return false;
  const memberId = safeMemberId(decodeURIComponent(match[1]));
  const isExport = Boolean(match[2]);
  if (!memberId) {
    ctx.json(res, 400, { success: false, error: "member id is required" });
    return true;
  }

  if (isExport && req.method === "GET") {
    const stats = await exportStats(ctx.squadStateDir, memberId);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="${memberId}-activity.jsonl"`,
      "cache-control": "no-store",
      ...(stats ? { "content-length": String(stats.size), "last-modified": new Date(stats.modifiedAt).toUTCString() } : { "content-length": "0" }),
    });
    if (!stats) {
      res.end();
      return true;
    }
    const stream = exportStream(ctx.squadStateDir, memberId);
    stream.on("error", () => res.end());
    stream.pipe(res);
    return true;
  }

  if (!isExport && req.method === "GET") {
    try {
      const page = await readRecords(ctx.squadStateDir, memberId, {
        before: url.searchParams.get("before") || "",
        limit: url.searchParams.get("limit") || undefined,
        kind: url.searchParams.get("kind") || "",
      });
      ctx.json(res, 200, { success: true, data: { memberId, ...page } });
    } catch (error) {
      ctx.json(res, 500, { success: false, error: error?.message || "could not read activity" });
    }
    return true;
  }

  if (!isExport && req.method === "POST") {
    let record;
    try {
      record = recordFromClientAction(memberId, await ctx.readBody(req));
    } catch (error) {
      ctx.json(res, 400, { success: false, error: error?.message || "invalid activity" });
      return true;
    }
    try {
      await appendRecord(ctx.squadStateDir, record);
      ctx.json(res, 200, { success: true, data: { memberId, id: record.id } });
    } catch (error) {
      ctx.json(res, 500, { success: false, error: error?.message || "could not append activity" });
    }
    return true;
  }

  ctx.json(res, 405, { success: false, error: `${req.method} is not supported here` });
  return true;
}
