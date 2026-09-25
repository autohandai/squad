// Member lifecycle routes (ADR-0016).
//
//   GET  /api/members/presence   presence per member from the session pool and runs
//   POST /api/members/:id/stop   close the member's warm sessions and abort its runs
//
// Members themselves live in the browser; the bridge only sees them through
// web-status.json, so presence entries exist for members the app has
// snapshotted or that currently hold a session or a run.

import { join } from "node:path";

import { derivePresence, liveRunsForMember } from "../members/presence.mjs";

export const name = "members";

const STOP_PATH = /^\/api\/members\/([^/]+)\/stop$/;
// The UI promises the dot goes grey within two seconds; anything the pool or
// an SDK client has not finished by then is left to finish in the background.
const STOP_BUDGET_MS = 1500;

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/members/presence" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: await presenceSnapshot(ctx) });
    return true;
  }

  const stop = url.pathname.match(STOP_PATH);
  if (stop && req.method === "POST") {
    const memberId = decodeURIComponent(stop[1]).trim();
    if (!memberId) {
      ctx.json(res, 400, { success: false, error: "member id is required" });
      return true;
    }
    const result = await stopMember(ctx, memberId);
    ctx.json(res, 200, { success: true, data: result });
    return true;
  }

  return false;
}

async function readSnapshotMembers(ctx) {
  if (!ctx.squadStateDir || typeof ctx.readOptionalJsonFile !== "function") return [];
  const snapshot = await ctx.readOptionalJsonFile(join(ctx.squadStateDir, "web-status.json")).catch(() => null);
  return Array.isArray(snapshot?.members) ? snapshot.members : [];
}

export async function presenceSnapshot(ctx) {
  const stats = ctx.sdkSessions?.stats?.() || { active: 0, busy: 0, sessions: [] };
  const presence = derivePresence({
    sessions: stats.sessions,
    runs: ctx.runs,
    members: await readSnapshotMembers(ctx),
  });
  return { at: new Date().toISOString(), sessions: { active: stats.active || 0, busy: stats.busy || 0 }, presence };
}

function withBudget(promise, fallback) {
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), STOP_BUDGET_MS);
  });
  return Promise.race([promise.catch(() => fallback), budget]).finally(() => clearTimeout(timer));
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

// Same escalation server.mjs uses for its own stop: signal the process group
// first (the CLI spawns helpers), then the direct child. SIGKILL follows if
// the child ignores SIGTERM.
function terminateChild(child, forceAfterMs = 4000) {
  if (childHasExited(child)) return false;
  const signal = (name) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, name);
        return true;
      } catch {
        // Not a process-group leader; fall through to the direct child.
      }
    }
    try {
      return child.kill(name);
    } catch {
      return false;
    }
  };
  const sent = signal("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (!childHasExited(child)) signal("SIGKILL");
  }, forceAfterMs);
  forceTimer.unref?.();
  child.once?.("close", () => clearTimeout(forceTimer));
  return sent;
}

function appendRunLog(run, line) {
  if (!Array.isArray(run.logs)) run.logs = [];
  run.logs.push({ source: "system", line, at: new Date().toISOString() });
}

/**
 * Stop everything the bridge holds for one member: warm sessions, child
 * processes, SDK clients, and abort controllers. Runs are marked `stopped`
 * synchronously so the next presence poll no longer counts them as live,
 * even when a process takes longer to exit.
 */
export async function stopMember(ctx, memberId, { reason = "stopped by user" } = {}) {
  const startedAt = Date.now();
  const closedSessions = ctx.sdkSessions
    ? await withBudget(Promise.resolve(ctx.sdkSessions.reset(memberId, reason)), 0)
    : 0;

  const stoppedRuns = [];
  const pending = [];
  for (const run of liveRunsForMember(ctx.runs, memberId)) {
    run.status = "stopped";
    run.finishedAt = new Date().toISOString();
    appendRunLog(run, reason);

    if (run.process) terminateChild(run.process);
    if (run.sdk) {
      const sdk = run.sdk;
      run.sdk = null;
      pending.push(Promise.resolve().then(() => sdk.interrupt?.()).then(() => sdk.close?.()));
    }
    if (run.abortController && !run.abortController.signal.aborted) run.abortController.abort();

    stoppedRuns.push(run.id);
    ctx.emit?.("run.finished", {
      runId: run.id,
      memberId,
      status: "stopped",
      title: run.title || "",
      workspace: run.workspace || "",
    });
  }
  if (pending.length) await withBudget(Promise.allSettled(pending), null);

  const result = { memberId, closedSessions: Number(closedSessions) || 0, stoppedRuns: stoppedRuns.length, runIds: stoppedRuns };
  ctx.emit?.("member.stopped", { memberId, closedSessions: result.closedSessions, stoppedRuns: result.stoppedRuns });
  ctx.logEvent?.(ctx.SEVERITY?.INFO ?? 9, "member stopped", {
    "member.id": memberId,
    "member.closed_sessions": result.closedSessions,
    "member.stopped_runs": result.stoppedRuns,
    "member.stop_ms": Date.now() - startedAt,
  });
  return result;
}
