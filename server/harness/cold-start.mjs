// Cold-start failures (ADR-0123): an engine that exits before it has said
// anything did not fail the person's request, it failed to start. Those
// exits were reported as the raw last stderr line ("error: An unknown error
// occurred (Unexpected)") and, because the attempt carried a `--resume` id,
// were taken for a stale session: the id was wiped and the member lost its
// conversation. This module says what actually happened, in words, from the
// stderr text and the free space on the disks the engine writes to, and
// says whether trying again is worth it.
//
// Pure apart from `freeDiskBytes`, which takes an injectable `statfs`, so
// scripts/check-reliability.mjs can drive every branch without an engine.

import { statfsSync } from "node:fs";
import { join } from "node:path";
import { formatDuration } from "../../src/lib/duration.js";

/** An exit this soon after the spawn, with no events, is a start failure. */
export const COLD_START_WINDOW_MS = 1500;
/** Below this much free space an engine cannot write its own state. */
export const LOW_DISK_BYTES = 512 * 1024 * 1024;
/** How long to wait before the one automatic retry of a transient failure. */
export const COLD_START_RETRY_DELAY_MS = 750;

const SESSION_RE = /no conversation found|session (?:id|not found)|thread (?:id|not found)|resume/i;
const SIGN_IN_RE = /not logged in|please run \/login|run `?claude auth login|authentication(?: failed| required| error)|unauthorized|invalid api key|no api key|sign in|login required|not signed in|auth(?:entication)? token/i;
const BAD_FLAG_RE = /unknown option|unrecognized (?:option|argument)|invalid (?:option|argument|value)|error: option|too many arguments|missing required argument|expected argument|unknown command|usage:/i;
const DISK_RE = /no space left|enospc|disk full|not enough space|out of disk/i;
const MISSING_RE = /\benoent\b|command not found|no such file or directory|not found on this machine|cannot execute binary|exec format error|\beacces\b|permission denied/i;
const RUNTIME_CRASH_RE = /an unknown error occurred|\(unexpected\)|segmentation fault|bus error|illegal instruction|abort trap|out of memory|cannot allocate memory|\benomem\b|\beagain\b|resource temporarily unavailable/i;

function text(value) {
  return String(value || "");
}

function mib(bytes) {
  return `${Math.max(0, Math.round(Number(bytes) / (1024 * 1024)))} MiB`;
}

/** Events that mean the engine actually ran: raw lines and stderr echoes do not. */
export function substantiveEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event && event.type !== "tool_update" && event.type !== "raw");
}

/** Free bytes on the volume that holds `path`, or -1 when it cannot be read. */
export function freeDiskBytes(path, { statfs = statfsSync } = {}) {
  let target = text(path);
  if (!target) return -1;
  // Walk up until a path exists: the engine home may not have been created yet.
  for (let attempt = 0; attempt < 8 && target; attempt += 1) {
    try {
      const stats = statfs(target);
      const free = Number(stats.bavail) * Number(stats.bsize);
      return Number.isFinite(free) && free >= 0 ? free : -1;
    } catch {
      const parent = target.replace(/[\\/][^\\/]*$/, "");
      if (!parent || parent === target) return -1;
      target = parent;
    }
  }
  return -1;
}

/** Where an engine keeps its own state: that disk is the one that matters. */
export function engineHome(adapterId, { env = process.env, homeDir = "", agentHome = "" } = {}) {
  const home = text(homeDir);
  switch (adapterId) {
    case "claude":
      return text(env.CLAUDE_CONFIG_DIR) || (home ? join(home, ".claude") : "");
    case "codex":
      return text(env.CODEX_HOME) || (home ? join(home, ".codex") : "");
    default:
      return text(agentHome) || home;
  }
}

/**
 * The failure was a stale resume id: the engine said so, or it answered with
 * exactly one event (the error result) and nothing else. The caller may then
 * forget the id and try a fresh session; a cold start must never reach here.
 */
export function looksLikeStaleSession(output) {
  if (!output || !output.error) return false;
  const stderr = text(output.rawStderr);
  const errorEvent = substantiveEvents(output.events).find((event) => event.type === "error");
  if (SESSION_RE.test(stderr) || SESSION_RE.test(text(errorEvent?.message))) return true;
  return false;
}

/**
 * `null` when the engine ran (it produced events, or took its time, or the
 * failure names a stale session); otherwise `{ kind, transient, reason,
 * detail }`. `reason` is written for the reply, `detail` for the run log.
 *
 *   kind       disk-space | binary-missing | not-signed-in | bad-flag | engine-crash
 *   transient  true when the same command may work a moment later
 */
export function classifyColdStart({ adapterLabel = "The engine", output, durationMs = 0, freeBytes = {}, executable = "" } = {}) {
  if (!output) return null;
  const exitCode = output.exitCode;
  const stderr = text(output.rawStderr).trim();
  const stdout = text(output.rawStdout).trim();
  const spawnError = text(output.spawnError);
  const events = substantiveEvents(output.events);
  const elapsed = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 0;
  const stopped = Boolean(output.stopped || output.timedOut || output.stalled);
  if (stopped || events.length) return null;
  if (!spawnError && (exitCode === 0 || exitCode === null || exitCode === undefined)) return null;
  if (looksLikeStaleSession({ ...output, error: output.error || stderr || "exit" })) return null;
  const quick = elapsed > 0 && elapsed <= COLD_START_WINDOW_MS;
  // One line: the run log is one row per line, and the reply quotes it.
  const lastLines = Array.from(new Set(stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3))).join(" / ");
  const where = executable ? ` (${executable})` : "";
  const homeFree = Number(freeBytes.home);
  const workspaceFree = Number(freeBytes.workspace);
  const lowHome = Number.isFinite(homeFree) && homeFree >= 0 && homeFree < LOW_DISK_BYTES;
  const lowWorkspace = Number.isFinite(workspaceFree) && workspaceFree >= 0 && workspaceFree < LOW_DISK_BYTES;
  const after = quick ? `${formatDuration(elapsed)} after starting` : "before it produced any output";

  if (spawnError === "ENOENT" || (spawnError && MISSING_RE.test(spawnError)) || (!stdout && MISSING_RE.test(stderr) && !DISK_RE.test(stderr))) {
    return {
      kind: "binary-missing",
      transient: false,
      reason: `${adapterLabel} could not be started${where}: ${spawnError || lastLines || "the executable was not found"}. Check its install in the member's Harness page.`,
      detail: `cold start: executable missing or not runnable (${spawnError || lastLines || "no stderr"})`,
    };
  }
  if (DISK_RE.test(stderr) || lowHome || lowWorkspace) {
    const measured = lowHome ? `${mib(homeFree)} free where ${adapterLabel} keeps its state` : lowWorkspace ? `${mib(workspaceFree)} free in the workspace` : "the disk reported no space left";
    return {
      kind: "disk-space",
      transient: true,
      reason: `${adapterLabel} exited ${after} because the disk is nearly full: ${measured}. It needs room to write its own session before it can answer. Free some space and retry.`,
      detail: `cold start: disk space (${measured}${lastLines ? `; stderr: ${lastLines}` : ""})`,
    };
  }
  if (SIGN_IN_RE.test(stderr) || SIGN_IN_RE.test(stdout)) {
    return {
      kind: "not-signed-in",
      transient: false,
      reason: `${adapterLabel} is not signed in: ${lastLines || "it asked for a login before answering"}. Sign in from the member's Harness page and retry.`,
      detail: `cold start: not signed in (${lastLines || "no stderr"})`,
    };
  }
  if (BAD_FLAG_RE.test(stderr) && !RUNTIME_CRASH_RE.test(stderr)) {
    return {
      kind: "bad-flag",
      transient: false,
      reason: `${adapterLabel} rejected the command it was started with: ${lastLines}. This installed version may not accept one of the options Squad passes; update it or report the command shown in Work details.`,
      detail: `cold start: rejected flag (${lastLines})`,
    };
  }
  if (RUNTIME_CRASH_RE.test(stderr) || quick) {
    const described = lastLines ? `its runtime reported "${lastLines}"` : `it exited with code ${exitCode}`;
    return {
      kind: "engine-crash",
      transient: true,
      reason: `${adapterLabel} exited ${after}, before it read the request: ${described}. That is the engine failing to start on this machine (disk, memory or file limits), not a problem with the conversation. Retry; if it keeps happening, check free disk space.`,
      detail: `cold start: engine exited ${after} with code ${exitCode}${lastLines ? ` (${lastLines})` : ""}`,
    };
  }
  return null;
}
