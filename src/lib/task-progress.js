// A checklist is a report from the harness, not a reconstruction of its tool
// activity. Keep unknown states unknown and never complete a plan because a
// turn or tool finished.
const PLAN_TOOLS = new Set(["todowrite", "todo_write", "write_todos", "update_plan", "plan_update"]);
const STATES = {
  pending: "pending", todo: "pending", not_started: "pending",
  in_progress: "in_progress", "in-progress": "in_progress", running: "in_progress",
  completed: "completed", complete: "completed", done: "completed",
  failed: "failed", error: "failed", blocked: "blocked",
  cancelled: "cancelled", canceled: "cancelled", skipped: "cancelled",
};

function string(value) { return typeof value === "string" ? value.trim() : ""; }
function object(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : null; }
  catch { return null; }
}
function toolName(value) { return string(value).split(/__|\.|\//).filter(Boolean).at(-1)?.toLowerCase() || ""; }

export function normalizeTaskProgress(snapshot) {
  const data = object(snapshot);
  if (!data) return null;
  const list = Array.isArray(data.items) ? data.items : Array.isArray(data.plan) ? data.plan : Array.isArray(data.checklist) ? data.checklist : Array.isArray(data.todos) ? data.todos : Array.isArray(data.tasks) ? data.tasks : null;
  if (!list) return null;
  const occurrences = new Map();
  const items = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const title = string(entry.title) || string(entry.step) || string(entry.content) || string(entry.text);
    if (!title) continue;
    const occurrence = (occurrences.get(title) || 0) + 1;
    occurrences.set(title, occurrence);
    const id = string(entry.id) || `task:${encodeURIComponent(title)}:${occurrence}`;
    const declared = string(entry.status).toLowerCase();
    const status = Object.hasOwn(STATES, declared) ? STATES[declared] : typeof entry.completed === "boolean" ? entry.completed ? "completed" : "pending" : "unknown";
    items.set(id, { id, title, status });
  }
  return {
    items: [...items.values()],
    summary: string(data.summary) || string(data.explanation),
    outcome: string(data.outcome),
    updatedAt: string(data.timestamp) || string(data.updatedAt),
    source: string(data.source),
  };
}

function snapshotFromEvent(event, failedTools) {
  if (!event || typeof event !== "object") return null;
  if (["plan_update", "progress"].includes(event.type)) {
    // Stored SDK traces from older bridges wrap the original event in content.
    return normalizeTaskProgress(event) || normalizeTaskProgress(event.progress) || normalizeTaskProgress(object(event.content));
  }
  if (event.type === "status" && event.status === "todo_list") return normalizeTaskProgress(event);
  if (event.item?.type === "todo_list") return normalizeTaskProgress({ items: event.item.items, timestamp: event.timestamp, source: "codex" });
  const call = event.type === "tool_call" ? event.call : event.type === "tool_start" ? event.tool || { id: event.toolId, name: event.toolName, args: event.args } : null;
  if (!call || !PLAN_TOOLS.has(toolName(call.name)) || (call.id && failedTools.has(String(call.id)))) return null;
  const args = object(call.args ?? call.arguments);
  return normalizeTaskProgress(args && { ...args, timestamp: event.timestamp || call.timestamp, source: toolName(call.name) });
}

export function taskProgressFromEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const failedTools = new Set();
  for (const event of list) {
    if (event?.type === "tool_end" && (event.success === false || event.error)) failedTools.add(String(event.toolId || ""));
    if (event?.type === "tool_result" && (event.result?.is_error === true || event.result?.success === false || event.result?.error)) failedTools.add(String(event.result.id || ""));
  }
  let latest = null;
  for (const event of list) {
    const progress = snapshotFromEvent(event, failedTools);
    if (progress) latest = progress;
  }
  return latest;
}

export function taskProgressFromMessage(message) {
  if (!message || typeof message !== "object") return null;
  const explicit = normalizeTaskProgress(message.progress) || normalizeTaskProgress(message.goal);
  if (explicit) return explicit;
  const streamed = taskProgressFromEvents(message.streamEvents);
  if (streamed) return streamed;
  const trace = message.trace;
  if (!trace || typeof trace !== "object") return null;
  const events = Array.isArray(trace.events) ? [...trace.events] : [];
  const seenCalls = new Set(events.filter((event) => event?.type === "tool_call").map((event) => event.call?.id));
  for (const call of Array.isArray(trace.toolCalls) ? trace.toolCalls : []) {
    if (call?.id && seenCalls.has(call.id)) continue;
    events.push({ type: "tool_call", call, timestamp: call?.timestamp });
  }
  for (const result of Array.isArray(trace.toolResults) ? trace.toolResults : []) {
    events.push({ type: "tool_result", result, timestamp: result?.timestamp });
  }
  events.sort((a, b) => {
    const left = Date.parse(a?.timestamp || "");
    const right = Date.parse(b?.timestamp || "");
    return Number.isFinite(left) && Number.isFinite(right) ? left - right : 0;
  });
  return taskProgressFromEvents(events);
}

export function taskProgressCounts(progress) {
  const counts = { total: 0, completed: 0, pending: 0, in_progress: 0, failed: 0, blocked: 0, cancelled: 0, unknown: 0 };
  for (const item of progress?.items || []) {
    counts.total += 1;
    counts[item.status !== "total" && Object.hasOwn(counts, item.status) ? item.status : "unknown"] += 1;
  }
  return counts;
}

export function taskProgressSummary(progress, { isLoading = false, status = "" } = {}) {
  const counts = taskProgressCounts(progress);
  if (!counts.total) return "";
  const finished = counts.completed === counts.total;
  const parts = [finished ? `${counts.total} ${counts.total === 1 ? "task" : "tasks"} completed` : `${counts.completed} of ${counts.total} tasks completed`];
  for (const [state, label] of [["failed", "failed"], ["blocked", "blocked"], ["cancelled", "cancelled"], ["pending", "pending"], ["unknown", "without a reported state"]]) {
    if (counts[state]) parts.push(`${counts[state]} ${label}`);
  }
  if (counts.in_progress) parts.push(`${counts.in_progress} ${isLoading ? "in progress" : "without a completion update"}`);
  const prefix = ["stopped", "cancelled", "canceled"].includes(status) ? "Stopped · " : ["error", "failed"].includes(status) ? "Run failed · " : status === "paused" ? "Paused · " : status === "blocked" ? "Blocked · " : "";
  return `${prefix}${parts.join(" · ")}`;
}
