// Harness registry: assignment normalisation, readiness cache, and the
// generic spawn/parse loop used by every external (non-Autohand) harness.

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as autohand from "./autohand.mjs";
import * as codex from "./codex.mjs";
import * as claude from "./claude.mjs";
import * as acp from "./acp.mjs";
import { listAcpAgents } from "../acp/registry.mjs";
import { compareVersions, guiSafeEnv } from "./discovery.mjs";
import { formatDuration } from "../../src/lib/duration.js";
import { attachmentLogReplacer, claudePromptInput } from "../attachments.mjs";

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

// ACP agents (ADR-0122) are `acp:<registry id>`, plus `pi` and `autohand-acp`;
// the registry's own `pi-acp` entry folds into `pi`.
export function normalizeHarnessId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return DEFAULT_HARNESS_ID;
  if (adapters.has(raw)) return raw;
  if (aliases.has(raw)) return aliases.get(raw);
  if (raw === "pi-acp") return "pi";
  if (acp.isAcpHarnessId(raw)) return raw;
  return DEFAULT_HARNESS_ID;
}

export function isAcpHarness(idOrAssignment) {
  return acp.isAcpHarnessId(typeof idOrAssignment === "string" ? normalizeHarnessId(idOrAssignment) : normalizeHarnessId(idOrAssignment?.id));
}

export function getAdapter(idOrAssignment) {
  const id = typeof idOrAssignment === "string" ? normalizeHarnessId(idOrAssignment) : normalizeHarnessId(idOrAssignment?.id);
  if (adapters.has(id)) return adapters.get(id);
  return acp.forHarnessId(id) || autohand;
}

export function isExternalHarness(idOrAssignment) {
  return getAdapter(idOrAssignment).id !== DEFAULT_HARNESS_ID;
}

/** Persisted member field. Missing or malformed input maps to Autohand. */
import { normalizeAccess, normalizeEffort } from "./access.mjs";
import { stopMessage } from "./stop-reason.mjs";
export { ACCESS_IDS, normalizeAccess, normalizeEffort, resolveAccess } from "./access.mjs";

export function normalizeHarnessAssignment(input) {
  const source = input && typeof input === "object" ? input : typeof input === "string" ? { id: input } : {};
  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    id: normalizeHarnessId(source.id || source.harnessId),
    executablePath: String(source.executablePath || "").trim(),
    model: String(source.model || "").trim().slice(0, 200),
    effort: normalizeEffort(source.effort),
    access: normalizeAccess(source.access),
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

/**
 * Every engine the chooser can offer: the built-in adapters first, then the
 * ACP agents known on this machine (bundled snapshot or the cached registry;
 * never a network fetch here, that is GET /api/acp/registry's job).
 */
export async function listHarnesses({ refresh = false, contextFor = () => ({}) } = {}) {
  const results = [];
  for (const adapter of listAdapters()) {
    results.push(await detectHarness(adapter.id, { refresh, context: contextFor(adapter.id) }));
  }
  let acpAgents = [];
  try {
    acpAgents = (await listAcpAgents({ network: false, context: contextFor("acp") })).agents;
  } catch {
    acpAgents = [];
  }
  for (const agent of acpAgents) {
    results.push(await detectHarness(agent.harnessId, { refresh, context: contextFor(agent.harnessId) }));
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
 * rawStderr, exitCode, resumeId, error, timedOut, stopped, spawnError,
 * startedAt, durationMs }. A spawn failure resolves too (exitCode null,
 * spawnError set) so a cold start can be named instead of thrown.
 */
export function runExternalHarness(options) {
  // The pinned SDK's protocol matches Claude Code 2.1.296. Older installed
  // CLIs retain the existing JSONL compatibility path rather than receiving
  // control requests/flags they do not understand.
  if (options.adapter.id === 'claude' && compareVersions(options.harnessVersion || '', '2.1.296') >= 0) {
    return import('./claude-sdk.mjs').then(({ runClaudeSdk }) => runClaudeSdk(options));
  }
  return runCliHarness(options);
}

async function runCliHarness({
  adapter,
  executable,
  args,
  cwd,
  env = {},
  timeoutMs = 300000,
  inactivityMs = 0,
  firstEventTimeoutMs = 60000,
  signal,
  onEvent = () => {},
  terminate,
  attachments = [],
}) {
  let stdin = "";
  if (adapter.id === "claude" && attachments.length) {
    const promptIndex = args.indexOf("-p");
    const prompt = promptIndex >= 0 ? args[promptIndex + 1] : "";
    const input = await claudePromptInput(prompt, attachments);
    for await (const message of input) stdin += `${JSON.stringify(message)}\n`;
    args = args.filter((_, index) => index !== promptIndex && index !== promptIndex + 1);
    args.push("-p", "--input-format", "stream-json");
  }
  return new Promise((resolve) => {
    const events = [];
    const startedAt = Date.now();
    let rawStdout = "";
    let rawStderr = "";
    let pending = "";
    let settled = false;
    let spawnError = "";
    let timedOut = false;
    let timeoutKind = '';
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
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      shell,
      detached: !isWindows,
    });
    if (stdin) { child.stdin.on("error", () => {}); child.stdin.end(stdin); }

    const stopChild = () => {
      if (typeof terminate === "function") terminate(child);
      else child.kill("SIGTERM");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutKind = 'runtime';
      stopChild();
    }, timeoutMs);
    let inactivityTimer = null;
    const armInactivity = () => {
      if (!(inactivityMs > 0) || settled || timedOut || stopped || stalled) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        timeoutKind = 'inactivity';
        stopChild();
      }, inactivityMs);
    };
    armInactivity();
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
      armInactivity();
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
      if (stdin) {
        try { rawStdout += `${JSON.stringify(JSON.parse(line), attachmentLogReplacer)}\n`; }
        catch { rawStdout += `${line}\n`; }
      }
      for (const event of adapter.parseLine(line, state)) deliver(event);
    };

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      if (!stdin) rawStdout += text;
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
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (firstEventTimer) clearTimeout(firstEventTimer);
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      if (pending.trim()) handleLine(pending);
      if (error) {
        // A spawn failure (ENOENT, EACCES) is a cold start, not an answer:
        // it resolves like any other exit so the caller can say what it was.
        spawnError = String(error?.code || error?.message || error);
        if (!rawStderr.trim()) rawStderr = String(error?.message || error);
        exitCode = null;
      }
      let failure = "";
      if (spawnError) failure = `${adapter.label} could not be started: ${spawnError}`;
      else if (timedOut) failure = timeoutKind === 'inactivity'
        ? `${adapter.label} stopped after ${formatDuration(inactivityMs)} without activity. Retry to continue.`
        : `${adapter.label} stopped after ${formatDuration(timeoutMs)} (maximum runtime). Retry to continue.`;
      else if (stopped) failure = stopMessage(signal);
      else if (stalled) failure = `${adapter.label} produced no events within ${formatDuration(firstEventTimeoutMs)}. Check its sign-in and retry.`;
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
        timeoutKind,
        stopped,
        stalled,
        spawnError,
        startedAt,
        durationMs: Date.now() - startedAt,
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

    child.on("error", (error) => finish(error, null));
    child.on("close", (code) => finish(null, code));
  });
}

export function displayCommand(adapter, displayArgs, shellQuote = (value) => String(value)) {
  return `${adapter.executableName} ${displayArgs.map(shellQuote).join(" ")}`;
}
