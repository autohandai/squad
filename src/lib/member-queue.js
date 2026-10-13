// Browser-side view of the bridge-owned member queues (ADR-0111). Pure: no
// React, no DOM, so scripts/check-queues.mjs can import it from Node.
//
// The bridge's GET /api/queues returns { queues: { [memberId]: queue },
// context: { [memberId]: gauge } }. A queue is { memberId, paused,
// pauseReason, items[] }; items carry status queued | running | done |
// failed | cancelled. Queued items show above the composer; anything that
// started is reconciled into the conversation as a user message plus the
// member's reply, the same way durable goals are (src/lib/member-goals.js).

export const CONTEXT_WARNING_PERCENT = 85;

export function queuedItems(queue) {
  return (Array.isArray(queue?.items) ? queue.items : []).filter((item) => item.status === "queued");
}

export function runningQueueItem(queue) {
  return (Array.isArray(queue?.items) ? queue.items : []).find((item) => item.status === "running") || null;
}

export function isQueueRunning(queue) {
  return Boolean(runningQueueItem(queue));
}

/** Ids of the queued items after moving `id` by `delta` places (-1 up, +1 down); null when nothing moves. */
export function movedQueueIds(queue, id, delta) {
  const ids = queuedItems(queue).map((item) => item.id);
  const index = ids.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}

export function queueItemStatusLabel(item, copy = {}) {
  switch (item?.status) {
    case "running": return copy.queueItemRunning || "Running";
    case "done": return copy.queueItemDone || "Done";
    case "failed": return copy.queueItemFailed || "Failed";
    case "cancelled": return copy.queueItemCancelled || "Cancelled";
    default: return copy.queueItemQueued || "Queued";
  }
}

/** "Context 42%" or "" when the bridge has no gauge for the member. */
export function contextGaugeLabel(gauge, copy = {}) {
  const percent = Number(gauge?.percent);
  if (!Number.isFinite(percent) || percent <= 0) return "";
  return (copy.contextUsage || "Context {percent}%").replace("{percent}", String(Math.round(percent)));
}

/** One line of warning once the window is nearly full; "" otherwise. */
export function contextWarning(gauge, copy = {}) {
  const percent = Number(gauge?.percent);
  if (!Number.isFinite(percent) || percent < CONTEXT_WARNING_PERCENT) return "";
  return (copy.contextWarning || "This conversation has used {percent}% of the model's context. Start a new chat soon so replies stay complete.").replace("{percent}", String(Math.round(percent)));
}

function timeOf(iso, locale) {
  const date = new Date(iso || "");
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
}

export function queueItemMessagePatch(item, member = {}) {
  const name = String(member?.name || "").trim() || "The member";
  const running = item.status === "running";
  const status = running ? "loading" : item.status === "done" ? "complete" : item.status === "cancelled" ? "stopped" : "error";
  const fallback = running ? `${name} is working on this follow-up.`
    : item.status === "cancelled" ? `${name} stopped this reply.`
      : item.status === "failed" ? `${name} could not answer: ${item.error || "no final update was received."}`
        : `${name} returned no chat text.`;
  const reply = String(item.reply || "").trim();
  return {
    queueItemId: item.id,
    queueUpdatedAt: item.updatedAt,
    body: status === "complete" && reply ? reply : status === "stopped" && reply ? reply : fallback,
    status,
    interrupted: Boolean(item.interrupted),
    activityLabel: running ? `${name} is working on the follow-up` : "",
    workspace: item.result?.workspace || item.workspace || "",
    startedAt: item.startedAt || item.createdAt,
    completedAt: running ? null : item.finishedAt || item.updatedAt,
    ...(item.result?.durationMs ? { durationMs: item.result.durationMs } : {}),
    ...(item.result?.transport ? { transport: item.result.transport } : {}),
    ...(item.result?.effectiveModel ? { effectiveModel: item.result.effectiveModel } : {}),
    ...(item.result?.command ? { command: item.result.command } : {}),
    ...(item.progress ? { progress: item.progress } : {}),
    ...(status === "error" ? { error: item.error || "" } : {}),
  };
}

/**
 * Reconcile queue items that have started into the conversations, without
 * duplicating rows and without touching items that are still queued (those
 * live above the composer). Returns the same object when nothing changes.
 */
export function reconcileQueueMessages(current, queues, members, locale = "en") {
  let next = current;
  for (const queue of Object.values(queues || {})) {
    const member = members.find((item) => item.id === queue?.memberId);
    if (!member) continue;
    for (const item of Array.isArray(queue.items) ? queue.items : []) {
      if (!item?.id || item.status === "queued") continue;
      const messages = next[member.id] || [];
      const existing = messages.find((message) => message.queueItemId === item.id && message.role === "agent");
      // A cancelled item that never ran leaves no trace in the conversation;
      // a fresh conversation (/new) must not refill with older items.
      if (!existing && item.status === "cancelled" && !item.startedAt) continue;
      if (!existing && member.conversationStartedAt && (item.startedAt || item.createdAt) < member.conversationStartedAt) continue;
      if (existing?.queueUpdatedAt === item.updatedAt && existing.status === queueItemMessagePatch(item, member).status) continue;
      const startedAt = item.startedAt || item.createdAt;
      const time = timeOf(startedAt, locale);
      const patch = queueItemMessagePatch(item, member);
      const agentMessage = {
        id: existing?.id || `queue-${item.id}-a`, role: "agent", time: existing?.time || time, createdAt: existing?.createdAt || startedAt,
        requestId: `queue-${item.id}`,
        ...existing, ...patch,
      };
      if (next === current) next = { ...current };
      if (existing) {
        next[member.id] = messages.map((message) => (message.id === existing.id ? agentMessage : message));
      } else {
        const userMessage = { id: `queue-${item.id}-u`, role: "user", body: item.text, time, createdAt: startedAt, startedAt, requestId: `queue-${item.id}`, queueItemId: item.id };
        next[member.id] = insertByTime(insertByTime(messages, userMessage), agentMessage);
      }
    }
  }
  return next;
}

// Place a rehydrated message before the first message known to be later, so
// a follow-up restored after its neighbours does not become the newest row.
function insertByTime(messages, message) {
  const at = String(message.createdAt || "");
  const index = at ? messages.findIndex((item) => String(item.createdAt || item.startedAt || "") > at) : -1;
  return index < 0 ? [...messages, message] : [...messages.slice(0, index), message, ...messages.slice(index)];
}
