// Run history (ADR-0113): finished runs outlive the bridge process.
//
// `runs` in server.mjs is an in-memory Map, so every restart emptied the
// Execution panel's Runs tab. This keeps the newest finished runs in
// <appStateDir>/run-history.json (summary plus the tail of the log; the full
// activity is still read from the run's OTLP file) and puts them back into
// the Map at boot, oldest first so GET /api/runs keeps its newest-first order.
//
// Live chat turns are written as well (ADR-0123): a turn that was running
// when the process died used to be simply absent, and with it the person's
// question. At boot such a record becomes `interrupted`, keeps the prompt
// and the launch payload, and the Runs tab offers Retry.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RUN_HISTORY_LIMIT = 200;
export const RUN_HISTORY_LOG_LINES = 120;
export const FINISHED_STATUSES = new Set(["completed", "failed", "stopped", "interrupted"]);
export const LIVE_STATUSES = new Set(["queued", "running", "launching"]);
export const INTERRUPTED_REASON = "Squad restarted while this reply was running. No final update was received. Retry sends the same request again through the member's queue.";

export function runHistoryPath(appStateDir) {
  return join(appStateDir, "run-history.json");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The part of a run worth keeping: every finished run, and a live chat turn
 * (so a crash leaves a trace). A live launched run is still never recorded;
 * its process is gone with the bridge and it has no prompt to retry.
 */
export function historyRecord(run) {
  if (!isPlainObject(run)) return null;
  const liveChat = LIVE_STATUSES.has(run.status) && run.kind === "chat";
  if (!FINISHED_STATUSES.has(run.status) && !liveChat) return null;
  const logs = Array.isArray(run.logs) ? run.logs.slice(-RUN_HISTORY_LOG_LINES) : [];
  return {
    id: String(run.id || ""),
    prompt: String(run.prompt || "").slice(0, 20000),
    launch: liveChat || run.status === "interrupted" ? (isPlainObject(run.launch) ? run.launch : null) : null,
    interrupted: run.interrupted === true,
    retriedAt: String(run.retriedAt || ""),
    retryItemId: String(run.retryItemId || ""),
    agentId: String(run.agentId || ""),
    title: String(run.title || ""),
    mode: String(run.mode || "prompt"),
    kind: String(run.kind || "launch"),
    workspace: String(run.workspace || ""),
    configPath: run.configPath || "",
    displayConfigPath: run.displayConfigPath || "",
    agentHome: run.agentHome || "",
    effectiveModel: isPlainObject(run.effectiveModel) ? run.effectiveModel : null,
    transport: String(run.transport || "cli"),
    harness: String(run.harness || ""),
    harnessVersion: String(run.harnessVersion || ""),
    command: String(run.command || ""),
    logPath: String(run.logPath || ""),
    status: run.status,
    exitCode: Number.isFinite(Number(run.exitCode)) && run.exitCode !== null ? Number(run.exitCode) : null,
    startedAt: String(run.startedAt || ""),
    finishedAt: String(run.finishedAt || ""),
    durationMs: Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : null,
    channel: isPlainObject(run.channel) ? run.channel : null,
    recipeId: run.recipeId || null,
    canvasId: run.canvasId || null,
    reply: String(run.reply || "").slice(0, 20000),
    sessionId: String(run.sessionId || ""),
    logs: logs.map((entry) => ({ source: String(entry?.source || "stdout"), line: String(entry?.line || ""), at: String(entry?.at || "") })),
  };
}

/**
 * A stored record back as a run the Map can hold. A record that was live
 * when it was written belongs to a process that no longer exists: it comes
 * back `interrupted`, at `bootAt`, with one log line saying so.
 */
export function runFromRecord(record, { bootAt = new Date().toISOString() } = {}) {
  if (!isPlainObject(record) || !record.id) return null;
  const wasLive = LIVE_STATUSES.has(record.status);
  if (!FINISHED_STATUSES.has(record.status) && !wasLive) return null;
  const logs = Array.isArray(record.logs) ? record.logs : [];
  const interrupted = wasLive
    ? { status: "interrupted", interrupted: true, exitCode: null, reply: "", finishedAt: bootAt, durationMs: Math.max(0, Date.parse(bootAt) - (Date.parse(record.startedAt || "") || Date.parse(bootAt))), logs: [...logs, { source: "system", line: INTERRUPTED_REASON, at: bootAt }] }
    : {};
  return {
    ...record,
    ...interrupted,
    logs: interrupted.logs || logs,
    contextPack: null,
    contextLayers: null,
    computerUse: null,
    channelActions: [],
    restored: true,
    abortController: null,
    process: null,
    finishedEventAt: record.finishedAt || "",
  };
}

export async function readRunHistory(path, { bootAt = new Date().toISOString() } = {}) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const list = Array.isArray(parsed?.runs) ? parsed.runs : [];
    return list.map((record) => runFromRecord(record, { bootAt })).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `runs` is the live Map. `persist()` is debounced and never throws;
 * `restore()` runs once at boot and only adds ids the Map does not hold.
 */
export function createRunHistory({ path, runs, limit = RUN_HISTORY_LIMIT, debounceMs = 400, log = () => {} }) {
  let timer = null;
  let writing = Promise.resolve();

  async function write() {
    const finished = [...runs.values()].map(historyRecord).filter(Boolean);
    const recent = finished.slice(-limit);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), runs: recent }), "utf8");
    await rename(temp, path);
    return recent.length;
  }

  function persist() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      writing = writing.then(write).catch((error) => log(`run history: could not save (${error?.message || error})`));
    }, debounceMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  return {
    path,
    async restore() {
      const bootAt = new Date().toISOString();
      const records = await readRunHistory(path, { bootAt });
      let added = 0;
      let interrupted = 0;
      for (const run of records) {
        if (runs.has(run.id)) continue;
        runs.set(run.id, run);
        added += 1;
        if (run.status === "interrupted" && run.finishedAt === bootAt) interrupted += 1;
      }
      if (added) log(`run history: ${added} run${added === 1 ? "" : "s"} restored from ${path}${interrupted ? `, ${interrupted} interrupted by the restart` : ""}`);
      if (interrupted) persist();
      return added;
    },
    persist,
    /** Wait for any pending write; used at shutdown and by checks. */
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        writing = writing.then(write).catch((error) => log(`run history: could not save (${error?.message || error})`));
      }
      await writing;
    },
  };
}
