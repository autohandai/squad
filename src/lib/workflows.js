// Channel workflows: triggers, steps, approval gates and the run state
// machine (ADR-0021). Pure functions only: no React, no DOM, no timers, so
// the bridge route (server/routes/workflows.route.mjs) and the check script
// (scripts/check-workflows.mjs) can import this file from Node.
//
// Shapes
//   workflow  { id, name, enabled, dispatch, trigger, steps, runs, createdAt, updatedAt }
//   trigger   { type: message|reaction|schedule|webhook, pattern, emoji, cron, token }
//   step      { id, memberId, prompt, when: always|previous_failed|previous_succeeded,
//               workspace, approval: null | { by: user|members, emoji } }
//   run       { id, workflowId, channelId, startedAt, finishedAt, status, stepIndex,
//               stepResults, pendingApproval, trigger, error }
//   status    running | waiting_approval | completed | failed | declined

export const TRIGGER_TYPES = ["message", "reaction", "schedule", "webhook"];
export const RUN_STATUSES = ["running", "waiting_approval", "completed", "failed", "declined"];
export const TERMINAL_STATUSES = ["completed", "failed", "declined"];
export const STEP_CONDITIONS = ["always", "previous_failed", "previous_succeeded"];
export const APPROVAL_BY = ["user", "members"];
export const DISPATCH_MODES = ["app", "bridge"];
export const DEFAULT_APPROVAL_EMOJI = "✅";
export const DEFAULT_TRIGGER_EMOJI = "✅";
export const MAX_STEPS = 12;
export const MAX_RUNS_KEPT = 40;

// ---------------------------------------------------------------------------
// Small helpers

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function isoOr(value, fallback) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

let counter = 0;
/** Ids are readable and unique within a process; callers may pass their own. */
export function createWorkflowId(prefix = "wf", now = Date.now()) {
  counter = (counter + 1) % 46656;
  return `${prefix}_${now.toString(36)}${counter.toString(36).padStart(3, "0")}`;
}

export function randomWebhookToken(random = Math.random) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 24; i += 1) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// Normalization

export function normalizeTrigger(input) {
  const source = input && typeof input === "object" ? input : {};
  const type = TRIGGER_TYPES.includes(source.type) ? source.type : "message";
  return {
    type,
    pattern: type === "message" ? text(source.pattern, 400) : "",
    emoji: type === "reaction" ? text(source.emoji, 16) || DEFAULT_TRIGGER_EMOJI : "",
    cron: type === "schedule" ? text(source.cron, 120) : "",
    token: type === "webhook" ? text(source.token || source.secret, 120) : "",
  };
}

export function normalizeApproval(input) {
  if (!input || typeof input !== "object") return null;
  return {
    by: APPROVAL_BY.includes(input.by) ? input.by : "user",
    emoji: text(input.emoji, 16) || DEFAULT_APPROVAL_EMOJI,
  };
}

export function normalizeStep(input, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  return {
    id: text(source.id, 96) || `step_${index + 1}`,
    memberId: text(source.memberId, 96),
    prompt: text(source.prompt, 8000),
    when: STEP_CONDITIONS.includes(source.when) ? source.when : "always",
    workspace: text(source.workspace, 1024),
    approval: source.approval === true ? normalizeApproval({}) : normalizeApproval(source.approval),
  };
}

export function normalizeStepResult(input) {
  const source = input && typeof input === "object" ? input : {};
  const status = ["pending", "running", "completed", "failed", "skipped"].includes(source.status) ? source.status : "pending";
  return {
    stepId: text(source.stepId, 96),
    status,
    startedAt: isoOr(source.startedAt, ""),
    finishedAt: isoOr(source.finishedAt, ""),
    memberRunId: text(source.memberRunId, 96),
    messageId: text(source.messageId, 160),
    preview: text(source.preview, 400),
    approvedAt: isoOr(source.approvedAt, ""),
    approvedBy: text(source.approvedBy, 96),
  };
}

export function normalizePendingApproval(input) {
  if (!input || typeof input !== "object") return null;
  const stepId = text(input.stepId, 96);
  if (!stepId) return null;
  return {
    id: text(input.id, 96) || `approval_${stepId}`,
    stepId,
    by: APPROVAL_BY.includes(input.by) ? input.by : "user",
    emoji: text(input.emoji, 16) || DEFAULT_APPROVAL_EMOJI,
    requestedAt: isoOr(input.requestedAt, ""),
    messageId: text(input.messageId, 160),
  };
}

export function normalizeRun(input) {
  const source = input && typeof input === "object" ? input : {};
  const id = text(source.id, 96);
  if (!id) return null;
  const startedAt = isoOr(source.startedAt, new Date(0).toISOString());
  const status = RUN_STATUSES.includes(source.status) ? source.status : "running";
  const stepIndex = Number.isInteger(source.stepIndex) && source.stepIndex >= 0 ? source.stepIndex : 0;
  const trigger = source.trigger && typeof source.trigger === "object" ? source.trigger : {};
  return {
    id,
    workflowId: text(source.workflowId, 96),
    channelId: text(source.channelId, 96),
    startedAt,
    finishedAt: isoOr(source.finishedAt, ""),
    status,
    stepIndex,
    stepResults: (Array.isArray(source.stepResults) ? source.stepResults : []).map(normalizeStepResult).filter((item) => item.stepId),
    pendingApproval: status === "waiting_approval" ? normalizePendingApproval(source.pendingApproval) : null,
    trigger: {
      type: TRIGGER_TYPES.includes(trigger.type) || trigger.type === "manual" ? trigger.type : "manual",
      key: text(trigger.key, 300),
      messageId: text(trigger.messageId, 160),
      messageBody: text(trigger.messageBody, 2000),
      emoji: text(trigger.emoji, 16),
      payload: trigger.payload && typeof trigger.payload === "object" ? trigger.payload : null,
    },
    error: text(source.error, 400),
  };
}

export function normalizeWorkflow(input, { now = new Date().toISOString() } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const name = text(source.name, 120);
  const id = text(source.id, 96) || createWorkflowId();
  const createdAt = isoOr(source.createdAt, now);
  const seenSteps = new Set();
  const steps = (Array.isArray(source.steps) ? source.steps : [])
    .slice(0, MAX_STEPS)
    .map((step, index) => normalizeStep(step, index))
    .filter((step) => {
      if (seenSteps.has(step.id)) return false;
      seenSteps.add(step.id);
      return true;
    });
  const seenRuns = new Set();
  const runs = (Array.isArray(source.runs) ? source.runs : [])
    .map(normalizeRun)
    .filter((run) => {
      if (!run || seenRuns.has(run.id)) return false;
      seenRuns.add(run.id);
      return true;
    })
    .slice(-MAX_RUNS_KEPT);
  return {
    id,
    name: name || "Untitled workflow",
    enabled: source.enabled !== false,
    dispatch: DISPATCH_MODES.includes(source.dispatch) ? source.dispatch : "app",
    trigger: normalizeTrigger(source.trigger),
    steps,
    runs: runs.map((run) => ({ ...run, workflowId: run.workflowId || id })),
    createdAt,
    updatedAt: isoOr(source.updatedAt, createdAt),
  };
}

/** Workflows owned by a channel record (`channel.workflows`), normalized and de-duplicated. */
export function normalizeWorkflows(channel) {
  const list = Array.isArray(channel) ? channel : Array.isArray(channel?.workflows) ? channel.workflows : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const workflow = normalizeWorkflow(item);
    if (seen.has(workflow.id)) continue;
    seen.add(workflow.id);
    out.push(workflow);
  }
  return out;
}

/** Problems that keep a workflow from being saved; empty when it is valid. */
export function validateWorkflow(workflow) {
  const problems = [];
  const item = normalizeWorkflow(workflow);
  if (!text(workflow?.name)) problems.push("name");
  if (!item.steps.length) problems.push("steps");
  if (item.steps.some((step) => !step.memberId)) problems.push("step.memberId");
  if (item.steps.some((step) => !step.prompt)) problems.push("step.prompt");
  if (item.trigger.type === "message" && !item.trigger.pattern) problems.push("trigger.pattern");
  if (item.trigger.type === "message" && item.trigger.pattern && !compilePattern(item.trigger.pattern)) problems.push("trigger.pattern");
  if (item.trigger.type === "schedule" && !parseCron(item.trigger.cron)) problems.push("trigger.cron");
  if (item.trigger.type === "webhook" && !item.trigger.token) problems.push("trigger.token");
  return problems;
}

// ---------------------------------------------------------------------------
// Trigger matching

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/s;

/** `/foo|bar/i` becomes a RegExp; anything else is a case-insensitive substring. */
export function compilePattern(pattern) {
  const source = text(pattern, 400);
  if (!source) return null;
  const literal = source.match(REGEX_LITERAL);
  if (literal) {
    try {
      const flags = Array.from(new Set(literal[2].replace(/[^gimsuy]/g, "")))
        .join("")
        .replace("g", "");
      return new RegExp(literal[1], flags);
    } catch {
      return null;
    }
  }
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i");
}

/** True when the message was posted by this workflow (a run it owns). */
export function isOwnWorkflowPost(workflow, message) {
  if (!message || typeof message !== "object") return false;
  const runId = text(message.workflowRunId, 96);
  if (!runId) return false;
  if (text(message.workflowId, 96) === workflow?.id) return true;
  return (workflow?.runs || []).some((run) => run.id === runId);
}

export function messageTriggerKey(workflow, message) {
  return `${workflow?.id || ""}:message:${message?.id || ""}`;
}

export function reactionTriggerKey(workflow, reaction, message) {
  return `${workflow?.id || ""}:reaction:${message?.id || reaction?.messageId || ""}:${text(reaction?.emoji, 16)}`;
}

/**
 * Does a channel message start this workflow? Returns `{ matched, key }`; the
 * key is stable per (workflow, message) so the caller fires once per message.
 * Messages posted by the workflow itself (carrying `workflowRunId`) and
 * placeholders still loading never match.
 */
export function matchMessageTrigger(workflow, message) {
  const key = messageTriggerKey(workflow, message);
  if (!workflow || workflow.enabled === false || workflow.trigger?.type !== "message") return { matched: false, key };
  if (!message || typeof message !== "object" || !message.id) return { matched: false, key };
  if (message.status === "loading" || message.role === "system") return { matched: false, key };
  if (isOwnWorkflowPost(workflow, message)) return { matched: false, key };
  const regex = compilePattern(workflow.trigger.pattern);
  if (!regex) return { matched: false, key };
  const body = String(message.body || "");
  return { matched: regex.test(body), key };
}

/**
 * Does a reaction start this workflow? A reaction is identified by the
 * (message, emoji) pair, so the same reaction can only fire once even when
 * the channel state re-renders many times. Reactions on the workflow's own
 * posts (including its approval prompts) never count as triggers.
 */
export function matchReactionTrigger(workflow, reaction, message) {
  const key = reactionTriggerKey(workflow, reaction, message);
  if (!workflow || workflow.enabled === false || workflow.trigger?.type !== "reaction") return { matched: false, key };
  if (!reaction || typeof reaction !== "object") return { matched: false, key };
  if (!message || typeof message !== "object" || !message.id) return { matched: false, key };
  if (reaction.count !== undefined && !(Number(reaction.count) > 0)) return { matched: false, key };
  if (isOwnWorkflowPost(workflow, message)) return { matched: false, key };
  return { matched: text(reaction.emoji, 16) === workflow.trigger.emoji, key };
}

/**
 * The App-side evaluation loop, as a pure function: given the channel's
 * workflows, messages, reactions and the keys that already fired, list the
 * triggers to start now. Each result carries the dedupe key to remember.
 */
export function evaluateTriggers({ workflows = [], messages = [], reactionsByMessage = {}, firedKeys = [] } = {}) {
  const fired = new Set(firedKeys);
  const out = [];
  for (const workflow of workflows) {
    if (!workflow || workflow.enabled === false) continue;
    if (workflow.trigger?.type === "message") {
      for (const message of messages) {
        const { matched, key } = matchMessageTrigger(workflow, message);
        if (!matched || fired.has(key)) continue;
        fired.add(key);
        out.push({ workflow, key, type: "message", message, reaction: null });
      }
    } else if (workflow.trigger?.type === "reaction") {
      for (const message of messages) {
        for (const reaction of reactionsByMessage[message.id] || []) {
          const { matched, key } = matchReactionTrigger(workflow, reaction, message);
          if (!matched || fired.has(key)) continue;
          fired.add(key);
          out.push({ workflow, key, type: "reaction", message, reaction });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runs and the state machine

export function isTerminal(run) {
  return TERMINAL_STATUSES.includes(run?.status);
}

export function currentStep(workflow, run) {
  return workflow?.steps?.[run?.stepIndex] || null;
}

function resultFor(run, stepId) {
  return run.stepResults.find((item) => item.stepId === stepId) || null;
}

function lastFinishedResult(run) {
  for (let i = run.stepResults.length - 1; i >= 0; i -= 1) {
    const item = run.stepResults[i];
    if (item.status === "completed" || item.status === "failed") return item;
  }
  return null;
}

function stepApplies(step, run) {
  const previous = lastFinishedResult(run);
  if (step.when === "previous_failed") return previous?.status === "failed";
  if (step.when === "previous_succeeded") return !previous || previous.status === "completed";
  return true;
}

/** The approval a step asks for before it may run. */
export function approvalRequest(step, { id = "", now = new Date().toISOString(), messageId = "" } = {}) {
  const approval = normalizeApproval(step?.approval);
  if (!approval || !step?.id) return null;
  return {
    id: id || `approval_${step.id}`,
    stepId: step.id,
    by: approval.by,
    emoji: approval.emoji,
    requestedAt: now,
    messageId,
  };
}

// Move the run to the next step that applies. A gated step parks the run in
// waiting_approval; no step left means completed (or failed when the last
// executed step failed and nothing handled it).
function settle(workflow, run, now) {
  let next = { ...run, stepResults: [...run.stepResults] };
  while (next.stepIndex < workflow.steps.length) {
    const step = workflow.steps[next.stepIndex];
    const existing = resultFor(next, step.id);
    if (existing && (existing.status === "completed" || existing.status === "failed" || existing.status === "skipped")) {
      next.stepIndex += 1;
      continue;
    }
    if (!stepApplies(step, next)) {
      next.stepResults = next.stepResults.filter((item) => item.stepId !== step.id);
      next.stepResults.push({ ...normalizeStepResult({ stepId: step.id, status: "skipped" }), finishedAt: now });
      next.stepIndex += 1;
      continue;
    }
    if (step.approval && !existing?.approvedAt) {
      const request = approvalRequest(step, { now });
      return { ...next, status: "waiting_approval", pendingApproval: request };
    }
    return { ...next, status: "running", pendingApproval: null };
  }
  const previous = lastFinishedResult(next);
  const failed = previous?.status === "failed";
  return { ...next, status: failed ? "failed" : "completed", pendingApproval: null, finishedAt: now, error: failed ? next.error || stepFailureText(workflow, previous) : "" };
}

// "step 2 of 3: <reply preview>" rather than the raw step id, so the stream row
// and the search doc read like a sentence.
function stepFailureText(workflow, result) {
  const index = workflow.steps.findIndex((step) => step.id === result.stepId);
  const position = index >= 0 ? `step ${index + 1} of ${workflow.steps.length}` : "a step";
  return result.preview ? `${position}: ${result.preview}` : `${position} failed`;
}

/** A fresh run for a workflow; already parked at an approval when step one is gated. */
export function createRun(workflow, { id = "", now = new Date().toISOString(), trigger = {}, channelId = "" } = {}) {
  const run = normalizeRun({
    id: id || createWorkflowId("run"),
    workflowId: workflow.id,
    channelId: channelId || workflow.channelId || "",
    startedAt: now,
    status: "running",
    stepIndex: 0,
    stepResults: [],
    trigger,
  });
  if (!workflow.steps.length) return { ...run, status: "failed", finishedAt: now, error: "workflow has no steps" };
  return settle(workflow, run, now);
}

/**
 * The state machine. Events:
 *   { type: "step.started", stepId, memberRunId?, messageId? }
 *   { type: "step.finished", stepId, status: "completed"|"failed", preview? }
 *   { type: "approval.message", messageId }        remember the prompt's message id
 *   { type: "approval.decided", decision: "approve"|"decline", by? }
 *   { type: "fail", error }
 * Returns a new run; unknown or out-of-order events return the same run.
 */
export function nextRunState(workflow, run, event, { now = new Date().toISOString() } = {}) {
  if (!workflow || !run || !event || typeof event !== "object") return run;
  if (isTerminal(run) && event.type !== "fail") return run;
  const step = currentStep(workflow, run);

  switch (event.type) {
    case "step.started": {
      if (run.status !== "running" || !step || (event.stepId && event.stepId !== step.id)) return run;
      const existing = resultFor(run, step.id);
      const result = normalizeStepResult({ ...(existing || {}), stepId: step.id, status: "running", startedAt: now, memberRunId: event.memberRunId, messageId: event.messageId });
      return { ...run, stepResults: [...run.stepResults.filter((item) => item.stepId !== step.id), result] };
    }
    case "step.finished": {
      if (run.status !== "running" || !step || (event.stepId && event.stepId !== step.id)) return run;
      const status = event.status === "failed" ? "failed" : "completed";
      const existing = resultFor(run, step.id);
      const result = normalizeStepResult({ ...(existing || {}), stepId: step.id, status, startedAt: existing?.startedAt || now, finishedAt: now, preview: event.preview });
      const next = { ...run, stepResults: [...run.stepResults.filter((item) => item.stepId !== step.id), result], stepIndex: run.stepIndex + 1 };
      return settle(workflow, next, now);
    }
    case "approval.message": {
      if (run.status !== "waiting_approval" || !run.pendingApproval) return run;
      return { ...run, pendingApproval: { ...run.pendingApproval, messageId: text(event.messageId, 160) } };
    }
    case "approval.decided":
      return resumeAfterApproval(run, event.decision, { now, by: event.by });
    case "fail":
      return { ...run, status: "failed", pendingApproval: null, finishedAt: now, error: text(event.error, 400) || "failed" };
    default:
      return run;
  }
}

/**
 * Resume a run parked at an approval gate. "approve" lets the gated step run;
 * anything else declines: the run stops and is marked declined. Runs that are
 * not waiting never change, so a stray approval cannot advance a run.
 */
export function resumeAfterApproval(run, decision, { now = new Date().toISOString(), by = "user" } = {}) {
  if (!run || run.status !== "waiting_approval" || !run.pendingApproval) return run;
  const stepId = run.pendingApproval.stepId;
  if (decision !== "approve") {
    return { ...run, status: "declined", pendingApproval: null, finishedAt: now, error: "" };
  }
  const existing = resultFor(run, stepId);
  const result = normalizeStepResult({ ...(existing || {}), stepId, status: "pending", approvedAt: now, approvedBy: by || "user" });
  return {
    ...run,
    status: "running",
    pendingApproval: null,
    stepResults: [...run.stepResults.filter((item) => item.stepId !== stepId), result],
  };
}

/** Does this reaction approve the run's pending gate? */
export function reactionApprovesRun(run, reaction, message) {
  if (!run || run.status !== "waiting_approval" || !run.pendingApproval) return false;
  if (!run.pendingApproval.messageId || message?.id !== run.pendingApproval.messageId) return false;
  if (reaction?.count !== undefined && !(Number(reaction.count) > 0)) return false;
  if (reaction?.mine === false && run.pendingApproval.by === "user") return false;
  return text(reaction?.emoji, 16) === run.pendingApproval.emoji;
}

/** Prompt with `{{message}}`, `{{previous}}` and `{{workflow}}` filled in. */
export function renderStepPrompt(step, run, workflow) {
  const previous = lastFinishedResult(run || { stepResults: [] });
  return String(step?.prompt || "")
    .replace(/\{\{\s*message\s*\}\}/g, run?.trigger?.messageBody || "")
    .replace(/\{\{\s*previous\s*\}\}/g, previous?.preview || "")
    .replace(/\{\{\s*workflow\s*\}\}/g, workflow?.name || "");
}

/**
 * The step the caller must dispatch now, or null. Only a running run whose
 * current step has not started yet yields one; a step behind an approval gate
 * never appears here until `resumeAfterApproval` let it through.
 */
export function stepToDispatch(workflow, run) {
  if (!workflow || !run || run.status !== "running") return null;
  const step = currentStep(workflow, run);
  if (!step) return null;
  const existing = resultFor(run, step.id);
  if (existing && existing.status !== "pending") return null;
  if (step.approval && !existing?.approvedAt) return null;
  return {
    step,
    memberId: step.memberId,
    prompt: renderStepPrompt(step, run, workflow),
    workspace: step.workspace || "",
    marker: { workflowRunId: run.id, workflowId: workflow.id, workflowName: workflow.name, stepId: step.id },
  };
}

/** Replace or append a run inside a workflow, keeping the newest MAX_RUNS_KEPT. */
export function upsertRun(workflow, run) {
  const runs = (workflow.runs || []).some((item) => item.id === run.id)
    ? workflow.runs.map((item) => (item.id === run.id ? run : item))
    : [...(workflow.runs || []), run];
  return { ...workflow, runs: runs.slice(-MAX_RUNS_KEPT) };
}

export function findRun(workflows, runId) {
  for (const workflow of workflows || []) {
    const run = (workflow.runs || []).find((item) => item.id === runId);
    if (run) return { workflow, run };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Copy helpers (pure; the UI passes `copy` from locales with fallbacks)

export function triggerSummary(workflow, copy = {}) {
  const trigger = workflow?.trigger || {};
  switch (trigger.type) {
    case "reaction":
      return (copy.workflowTriggerReactionSummary || "When someone reacts {emoji}").replace("{emoji}", trigger.emoji || DEFAULT_TRIGGER_EMOJI);
    case "schedule":
      return (copy.workflowTriggerScheduleSummary || "On schedule {cron}").replace("{cron}", trigger.cron || "");
    case "webhook":
      return copy.workflowTriggerWebhookSummary || "When the webhook is called";
    default:
      return (copy.workflowTriggerMessageSummary || "When a message matches {pattern}").replace("{pattern}", trigger.pattern ? `"${trigger.pattern}"` : "");
  }
}

export function runStatusLabel(status, copy = {}) {
  const labels = {
    running: copy.workflowRunRunning || "Running",
    waiting_approval: copy.workflowRunWaiting || "Waiting for approval",
    completed: copy.workflowRunCompleted || "Completed",
    failed: copy.workflowRunFailed || "Failed",
    declined: copy.workflowRunDeclined || "Declined",
  };
  return labels[status] || status;
}

// ---------------------------------------------------------------------------
// Cron (5 fields: minute hour day-of-month month day-of-week)

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const CRON_ALIASES = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};

function parseField(field, min, max, names = null) {
  const values = new Set();
  const restricted = field !== "*";
  const toNumber = (token) => {
    const lowered = token.toLowerCase();
    if (names) {
      const index = names.indexOf(lowered.slice(0, 3));
      if (index !== -1 && lowered.length === 3) return index + min;
    }
    if (!/^\d+$/.test(token)) return NaN;
    return Number(token);
  };
  for (const part of field.split(",")) {
    if (!part) return null;
    const [rangePart, stepPart] = part.split("/");
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) return null;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (step < 1) return null;
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = toNumber(a);
      end = toNumber(b);
    } else {
      start = toNumber(rangePart);
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (names === DAY_NAMES) {
      if (start === 7) start = 0;
      if (end === 7) end = 0;
      if (rangePart.includes("-") && end < start) end = 6;
    }
    if (start < min || end > max || end < start) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, restricted };
}

/**
 * Parse a 5-field cron expression (or @daily style alias). Returns
 * `{ minute, hour, dayOfMonth, month, dayOfWeek }` sets, or null when invalid.
 */
export function parseCron(expression) {
  const source = text(expression, 120).toLowerCase();
  const expanded = CRON_ALIASES[source] || source;
  const fields = expanded.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12, MONTH_NAMES);
  const dayOfWeek = parseField(fields[4], 0, 7, DAY_NAMES);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek, expression: expanded };
}

function clock(utc) {
  return utc
    ? {
        get: (d) => ({ minute: d.getUTCMinutes(), hour: d.getUTCHours(), day: d.getUTCDate(), month: d.getUTCMonth() + 1, dow: d.getUTCDay(), year: d.getUTCFullYear() }),
        make: (y, m, d, h, min) => new Date(Date.UTC(y, m - 1, d, h, min, 0, 0)),
      }
    : {
        get: (d) => ({ minute: d.getMinutes(), hour: d.getHours(), day: d.getDate(), month: d.getMonth() + 1, dow: d.getDay(), year: d.getFullYear() }),
        make: (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0),
      };
}

function dayMatches(schedule, parts) {
  const domOk = schedule.dayOfMonth.values.has(parts.day);
  const dowOk = schedule.dayOfWeek.values.has(parts.dow);
  // Vixie cron: when both day fields are restricted, either one matching is enough.
  if (schedule.dayOfMonth.restricted && schedule.dayOfWeek.restricted) return domOk || dowOk;
  if (schedule.dayOfMonth.restricted) return domOk;
  if (schedule.dayOfWeek.restricted) return dowOk;
  return true;
}

/**
 * The first time strictly after `from` that matches the expression, or null
 * when the expression is invalid or nothing matches within five years.
 */
export function nextCronRun(expression, from = new Date(), { utc = false } = {}) {
  const schedule = typeof expression === "string" ? parseCron(expression) : expression;
  if (!schedule) return null;
  const c = clock(utc);
  const start = new Date(from);
  if (!Number.isFinite(start.getTime())) return null;
  let parts = c.get(start);
  let t = c.make(parts.year, parts.month, parts.day, parts.hour, parts.minute + 1);
  const limit = start.getTime() + 5 * 366 * 24 * 60 * 60 * 1000;
  for (let guard = 0; guard < 200000 && t.getTime() <= limit; guard += 1) {
    parts = c.get(t);
    if (!schedule.month.values.has(parts.month)) {
      t = c.make(parts.year, parts.month + 1, 1, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, parts)) {
      t = c.make(parts.year, parts.month, parts.day + 1, 0, 0);
      continue;
    }
    if (!schedule.hour.values.has(parts.hour)) {
      t = c.make(parts.year, parts.month, parts.day, parts.hour + 1, 0);
      continue;
    }
    if (!schedule.minute.values.has(parts.minute)) {
      t = c.make(parts.year, parts.month, parts.day, parts.hour, parts.minute + 1);
      continue;
    }
    return t;
  }
  return null;
}

/** Schedule workflows whose next run after `since` is at or before `now`. */
export function dueSchedules(workflows, since, now, { utc = false } = {}) {
  const due = [];
  for (const workflow of workflows || []) {
    if (!workflow || workflow.enabled === false || workflow.trigger?.type !== "schedule") continue;
    const next = nextCronRun(workflow.trigger.cron, since, { utc });
    if (next && next.getTime() <= new Date(now).getTime()) due.push({ workflow, at: next });
  }
  return due;
}
