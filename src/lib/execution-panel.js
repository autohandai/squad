// What the Execution panel says about a run (ADR-0117). Pure helpers so the
// rows stay one line each and the wording can be checked without a browser.
import { harnessForAgent, harnessLabel } from "@/lib/harness";
import { dayLabel } from "@/lib/member-history";
import { latestFailedHandoff, latestPendingHandoff } from "@/lib/handoffs";

export const LIVE_RUN_STATUSES = new Set(["queued", "running", "launching"]);
export const OPEN_TASK_STATUSES = new Set(["active", "running", "launching", "blocked", "handoff-pending", "pending", "paused"]);

export function isLiveRun(run) {
  return LIVE_RUN_STATUSES.has(run?.status);
}

function dayKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Newest first, grouped by calendar day: `[{ day, label, runs }]`. */
export function groupRunsByDay(runs = [], { now = Date.now(), locale = "en-US", copy = {} } = {}) {
  const sorted = [...runs].sort((a, b) => (Date.parse(b?.startedAt || "") || 0) - (Date.parse(a?.startedAt || "") || 0));
  const groups = [];
  for (const run of sorted) {
    const day = dayKey(run?.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.runs.push(run);
    else groups.push({ day, label: day ? dayLabel(run.startedAt, { now, locale, copy }) : copy.executionUndated || "Earlier", runs: [run] });
  }
  return groups;
}

/**
 * The time at the right of a row: "now" / "3m" while the run is live or
 * started in the last hour, otherwise the clock ("11:50 PM"). The day
 * heading already says which day.
 */
export function runTimeLabel(run, { now = Date.now(), locale = "en-US" } = {}) {
  const started = Date.parse(run?.startedAt || "");
  if (!Number.isFinite(started)) return "";
  const minutes = Math.floor(Math.max(0, now - started) / 60_000);
  if (isLiveRun(run) || minutes < 60) {
    if (minutes < 1) return "now";
    return `${minutes}m`;
  }
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(started);
  } catch {
    return new Date(started).toTimeString().slice(0, 5);
  }
}

/**
 * "1m 30s" for a finished run; nothing while it is still going. The runs
 * listing carries startedAt and finishedAt but not durationMs, so the
 * difference is the fallback.
 */
export function runDurationLabel(run) {
  if (isLiveRun(run)) return "";
  let ms = Number(run?.durationMs);
  if (!Number.isFinite(ms) || ms <= 0) ms = Date.parse(run?.finishedAt || "") - Date.parse(run?.startedAt || "");
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * The person's question on one line, cut on a word boundary with an
 * ellipsis. CSS `truncate` cuts mid-word; the reader should see whole words.
 */
export function trimTitle(text, max = 88) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const head = value.slice(0, max + 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max * 0.5 ? head.slice(0, cut) : value.slice(0, max)).replace(/[\s,;:.-]+$/, "")}…`;
}

/** "chat reply" | "goal" | "launched", in the copy's words. */
export function runKindLabel(run, copy = {}) {
  if (run?.mode === "chat") return copy.chatRun || "chat reply";
  if (run?.mode === "goal" || run?.kind === "goal") return copy.runGoal || "goal";
  return copy.runLaunched || "launched";
}

/**
 * Engine and model, only where they differ from what the member normally
 * runs with; a row that repeats the member's defaults says nothing.
 */
export function runEngineAndModel(run, agent) {
  const parts = [];
  const memberHarness = harnessForAgent(agent);
  if (run?.harness && run.harness !== memberHarness.id) parts.push(harnessLabel(run.harness));
  const model = String(run?.effectiveModel?.model || "").trim();
  const memberModel = String(memberHarness.model || agent?.modelAssignment?.model || "").trim();
  if (model && model !== memberModel) parts.push(model);
  return parts;
}

/** The muted second line of a run row. */
export function runMetaParts(run, agent, { copy = {}, linked = false } = {}) {
  const parts = [runKindLabel(run, copy), ...runEngineAndModel(run, agent)];
  const duration = runDurationLabel(run);
  if (duration) parts.push(duration);
  if (linked) parts.push(copy.linkedTask || "linked task");
  return parts;
}

/** The status word a row needs beside its dot; completed is silent. */
export function runStatusWord(run, copy = {}) {
  const labels = copy.statusLabels || {};
  if (run?.status === "failed") return labels.failed || "failed";
  if (run?.status === "stopped") return labels.stopped || "stopped";
  if (run?.status === "queued") return labels.queued || "queued";
  return "";
}

/**
 * The one sentence under the title: only what is true now. Zero counts are
 * left out so a quiet member reads as quiet rather than as three zeroes.
 */
export function executionSummary({ runs = [], tasks = [], copy = {} } = {}) {
  const parts = [];
  const live = runs.filter(isLiveRun).length;
  const open = tasks.filter((task) => OPEN_TASK_STATUSES.has(task?.status)).length;
  const waiting = tasks.filter((task) => latestPendingHandoff(task)).length;
  const blocked = tasks.filter((task) => task?.status === "blocked" || latestFailedHandoff(task)).length;
  const say = (template, fallback, count) => String(template || fallback).replace("{count}", String(count));
  if (live) parts.push({ text: say(copy.executionRunning, "{count} running", live) });
  if (open) parts.push({ text: say(open === 1 ? copy.executionOpenTask : copy.executionOpenTasks, open === 1 ? "{count} open task" : "{count} open tasks", open) });
  if (waiting) parts.push({ text: say(waiting === 1 ? copy.executionHandoffWaiting : copy.executionHandoffsWaiting, waiting === 1 ? "{count} handoff waiting" : "{count} handoffs waiting", waiting) });
  if (blocked) parts.push({ text: say(copy.executionBlocked, "{count} blocked", blocked), tone: "destructive" });
  if (!parts.length) parts.push({ text: copy.executionQuiet || "Nothing running right now." });
  return parts;
}

export function compactRecordId(id) {
  const value = String(id || "");
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}
