// Harness registry: assignment normalisation, readiness cache, and the
// generic spawn/parse loop used by every external (non-Autohand) harness.

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as autohand from "./autohand.mjs";
import * as codex from "./codex.mjs";
import * as claude from "./claude.mjs";
import { guiSafeEnv } from "./discovery.mjs";

export const DEFAULT_HARNESS_ID = "autohand";
export const HARNESS_SCHEMA_VERSION = 1;

const adapters = new Map([
  [autohand.id, autohand],
  [codex.id, codex],
  [claude.id, claude],
]);

const aliases = new Map([
  ["autohand-code", "autohand"],
  ["autohandai", "autohand"],
  ["openai-codex", "codex"],
  ["codex-cli", "codex"],
  ["claude-code", "claude"],
  ["anthropic", "claude"],
  ["claudecode", "claude"],
]);

export function listAdapters() {
  return Array.from(adapters.values());
}

export function normalizeHarnessId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_HARNESS_ID;
  if (adapters.has(raw)) return raw;
  return aliases.get(raw) || DEFAULT_HARNESS_ID;
}

export function getAdapter(idOrAssignment) {
  const id = typeof idOrAssignment === "string" ? normalizeHarnessId(idOrAssignment) : normalizeHarnessId(idOrAssignment?.id);
  return adapters.get(id) || autohand;
}

export function isExternalHarness(idOrAssignment) {
  return getAdapter(idOrAssignment).id !== DEFAULT_HARNESS_ID;
}

/** Persisted member field. Missing or malformed input maps to Autohand. */
export function normalizeHarnessAssignment(input) {
  const source = input && typeof input === "object" ? input : typeof input === "string" ? { id: input } : {};
  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    id: normalizeHarnessId(source.id || source.harnessId),
    executablePath: String(source.executablePath || "").trim(),
    model: String(source.model || "").trim().slice(0, 120),
  };
}

export function harnessAssignmentFromAgent(agent) {
  return normalizeHarnessAssignment(agent?.harness ?? agent?.harnessAssignment ?? agent?.harnessId);
}

const readinessCache = new Map();
const READINESS_TTL_MS = 5 * 60 * 1000;

function cacheKey(id, explicitPath) {
  return `${id}::${explicitPath || ""}`;
}

/**
 * Readiness for one harness. `context` carries Autohand-specific facts from
 * server.mjs (bundled path, auth state, version) so this module stays free of
 * Autohand internals.
 */
export async function detectHarness(id, { explicitPath = "", refresh = false, context = {} } = {}) {
  const adapter = getAdapter(id);
  const key = cacheKey(adapter.id, explicitPath);
  const cached = readinessCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < READINESS_TTL_MS) return cached.value;
  let readiness;
  try {
    readiness = await adapter.detect({ explicitPath, context });
  } catch (error) {
    readiness = {
      status: "unsupported",
      version: "",
      executable: "",
      detail: `Detection failed: ${error?.message || error}`,
      setup: adapter.setup?.install || "",
    };
  }
  const value = {
    id: adapter.id,
    label: adapter.label,
    vendor: adapter.vendor,
    isDefault: adapter.id === DEFAULT_HARNESS_ID,
    capabilities: adapter.capabilities,
    setupDocs: adapter.setup?.docs || "",
    checkedAt: new Date().toISOString(),
    ...readiness,
  };
  readinessCache.set(key, { at: Date.now(), value });
  return value;
}

export async function listHarnesses({ refresh = false, contextFor = () => ({}) } = {}) {
  const results = [];
  for (const adapter of listAdapters()) {
    results.push(await detectHarness(adapter.id, { refresh, context: contextFor(adapter.id) }));
  }
  return results;
}

export function publicReadiness(readiness) {
  if (!readiness) return null;
  const { executablePath, ...rest } = readiness;
  return rest;
}

export class HarnessNotReadyError extends Error {
  constructor(readiness) {
    const label = readiness?.label || readiness?.id || "harness";
    const detail = readiness?.detail ? ` ${readiness.detail}` : "";
    const setup = readiness?.setup ? ` Setup: ${readiness.setup}` : "";
    super(`${label} is not ready (${readiness?.status || "unknown"}).${detail}${setup}`);
    this.name = "HarnessNotReadyError";
    this.readiness = readiness;
  }
}

/** Throws unless the harness is ready. No fallback to another harness. */
export async function assertHarnessReady(assignment, { context = {} } = {}) {
  const normalized = normalizeHarnessAssignment(assignment);
  const readiness = await detectHarness(normalized.id, { explicitPath: normalized.executablePath, context });
  if (readiness.status !== "ready") throw new HarnessNotReadyError(readiness);
  return readiness;
}

// ---------------------------------------------------------------------------
// Session persistence (resume ids) per member home + workspace + harness.
// ---------------------------------------------------------------------------

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export function sessionStorePath(agentHome) {
  return join(agentHome, "harness-sessions.json");
}

export async function readResumeId(agentHome, harnessId, workspace) {
  const store = await readJson(sessionStorePath(agentHome));
  return String(store?.[harnessId]?.[workspace]?.resumeId || "");
}

export async function writeResumeId(agentHome, harnessId, workspace, resumeId) {
  const path = sessionStorePath(agentHome);
  const store = await readJson(path);
  const byHarness = store[harnessId] && typeof store[harnessId] === "object" ? store[harnessId] : {};
  if (resumeId) {
    byHarness[workspace] = { resumeId: String(resumeId), updatedAt: new Date().toISOString() };
  } else {
    delete byHarness[workspace];
  }
  store[harnessId] = byHarness;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Generic external harness execution.
// ---------------------------------------------------------------------------

function newParseState() {
  return {
    resumeId: "",
    sequence: 0,
    sawDelta: false,
    startedTools: new Set(),
    toolNames: new Map(),
    warnings: [],
    timestamp: () => new Date().toISOString(),
  };
}

/**
 * Spawn the harness executable, parse JSONL from stdout, and deliver
 * SDK-shaped events to `onEvent`. Resolves with { events, rawStdout,
 * rawStderr, exitCode, resumeId, error, timedOut, stopped }.
 */
export function runExternalHarness({
  adapter,
  executable,
  args,
  cwd,
  env = {},
  timeoutMs = 300000,
  firstEventTimeoutMs = 60000,
  signal,
  onEvent = () => {},
  terminate,
}) {
  return new Promise((resolve, reject) => {
    const events = [];
    let rawStdout = "";
    let rawStderr = "";
    let pending = "";
    let settled = false;
    let timedOut = false;
    let stopped = false;
    let stalled = false;
    let sawEvent = false;
    let abortHandler = null;
    const state = newParseState();
    const isWindows = process.platform === "win32";
    const shell = isWindows && /\.(cmd|bat)$/i.test(executable);

    const child = spawn(executable, args, {
      cwd,
      env: guiSafeEnv({ ...env, FORCE_COLOR: "0", NO_COLOR: "1", CI: process.env.CI || "" }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell,
      detached: !isWindows,
    });

    const stopChild = () => {
      if (typeof terminate === "function") terminate(child);
      else child.kill("SIGTERM");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);
    let firstEventTimer = setTimeout(() => {
      if (!sawEvent) {
        stalled = true;
        stopChild();
      }
    }, firstEventTimeoutMs);

    const deliver = (event) => {
      if (!event) return;
      if (event.type === "raw") {
        events.push(event);
        return;
      }
      sawEvent = true;
      if (firstEventTimer) {
        clearTimeout(firstEventTimer);
        firstEventTimer = null;
      }
      events.push(event);
      try {
        onEvent(event);
      } catch {
        // Listener failures must not break the stream.
      }
    };

    const handleLine = (line) => {
      for (const event of adapter.parseLine(line, state)) deliver(event);
    };

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      rawStdout += text;
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        handleLine(line);
        index = pending.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      rawStderr += text;
      deliver({ type: "tool_update", toolId: "harness-stderr", toolName: adapter.label, output: text, stream: "stderr", timestamp: state.timestamp() });
    });

    const finish = (error, exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (firstEventTimer) clearTimeout(firstEventTimer);
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      if (pending.trim()) handleLine(pending);
      if (error) {
        reject(error);
        return;
      }
      let failure = "";
      if (timedOut) failure = `${adapter.label} timed out after ${Math.round(timeoutMs / 1000)} s`;
      else if (stopped) failure = "chat stopped by the user";
      else if (stalled) failure = `${adapter.label} produced no events within ${Math.round(firstEventTimeoutMs / 1000)} s`;
      else {
        const errorEvent = events.find((event) => event.type === "error");
        if (errorEvent) failure = String(errorEvent.message || "");
        else if (exitCode !== 0) failure = rawStderr.trim().split(/\r?\n/).slice(-3).join("\n") || `${adapter.label} exited with code ${exitCode}`;
      }
      resolve({
        events,
        rawStdout,
        rawStderr,
        exitCode,
        resumeId: adapter.resumeIdFrom(state),
        error: failure,
        timedOut,
        stopped,
        stalled,
      });
    };

    abortHandler = () => {
      stopped = true;
      stopChild();
    };
    if (signal?.aborted) {
      abortHandler();
    } else if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(null, code));
  });
}

export function displayCommand(adapter, displayArgs, shellQuote = (value) => String(value)) {
  return `${adapter.executableName} ${displayArgs.map(shellQuote).join(" ")}`;
}
