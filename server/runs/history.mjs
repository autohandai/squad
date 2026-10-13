// Run history (ADR-0113): finished runs outlive the bridge process.
//
// `runs` in server.mjs is an in-memory Map, so every restart emptied the
// Execution panel's Runs tab. This keeps the newest finished runs in
// <appStateDir>/run-history.json (summary plus the tail of the log; the full
// activity is still read from the run's OTLP file) and puts them back into
// the Map at boot, oldest first so GET /api/runs keeps its newest-first order.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RUN_HISTORY_LIMIT = 200;
export const RUN_HISTORY_LOG_LINES = 120;
export const FINISHED_STATUSES = new Set(["completed", "failed", "stopped"]);

export function runHistoryPath(appStateDir) {
  return join(appStateDir, "run-history.json");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The part of a finished run worth keeping. Live runs are never recorded. */
export function historyRecord(run) {
  if (!isPlainObject(run) || !FINISHED_STATUSES.has(run.status)) return null;
  const logs = Array.isArray(run.logs) ? run.logs.slice(-RUN_HISTORY_LOG_LINES) : [];
  return {
    id: String(run.id || ""),
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

/** A stored record back as a run the Map can hold. */
export function runFromRecord(record) {
  if (!isPlainObject(record) || !record.id || !FINISHED_STATUSES.has(record.status)) return null;
  return {
    ...record,
    logs: Array.isArray(record.logs) ? record.logs : [],
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

export async function readRunHistory(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const list = Array.isArray(parsed?.runs) ? parsed.runs : [];
    return list.map(runFromRecord).filter(Boolean);
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

  return {
    path,
    async restore() {
      const records = await readRunHistory(path);
      let added = 0;
      for (const run of records) {
        if (runs.has(run.id)) continue;
        runs.set(run.id, run);
        added += 1;
      }
      if (added) log(`run history: ${added} finished run${added === 1 ? "" : "s"} restored from ${path}`);
      return added;
    },
    persist() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        writing = writing.then(write).catch((error) => log(`run history: could not save (${error?.message || error})`));
      }, debounceMs);
      if (typeof timer.unref === "function") timer.unref();
    },
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
