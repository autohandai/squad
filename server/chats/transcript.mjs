// A member's direct-message transcript from the bridge's runs (ADR-0163).
//
// The conversation a window shows lives in that window's localStorage and in
// the saved chats a person puts away. A second window, a phone, or a fresh
// profile opened the same member to an empty chat while the bridge held
// every turn: `beginChatRun` keeps the prompt and `finishChatRun` the reply,
// and the history file keeps the newest 200. This folds those runs into the
// message shape the chat renders, so any window can show what was said.
//
// Pure: no I/O. The route passes the live `runs` Map (restored history
// included); the browser merges the result into what it already holds.

const PERSON_PREFIX = /^(goal|routine|observer|agenda|draft|run)-/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A direct message from a person: no channel, no goal, no automation. */
export function isPersonRun(run) {
  if (!isPlainObject(run)) return false;
  if (run.kind !== "chat" && run.mode !== "chat") return false;
  if (run.channel) return false;
  if (typeof run.person === "boolean") return run.person;
  // Records written before the flag existed: the request id's prefix says
  // what started the turn, the same test the bridge uses live.
  return !PERSON_PREFIX.test(String(run.requestId || ""));
}

function messageStatus(run) {
  switch (run.status) {
    case "completed": return "complete";
    case "failed": return "error";
    case "stopped": return "stopped";
    case "interrupted": return "stopped";
    default: return "loading";
  }
}

function replyBody(run, memberName) {
  const reply = String(run.reply || "").trim();
  if (reply) return reply;
  if (run.status === "failed") {
    const line = [...(Array.isArray(run.logs) ? run.logs : [])].reverse().find((entry) => entry?.source === "stderr")?.line;
    return `${memberName} could not answer${line ? `: ${String(line).trim()}` : "."}`;
  }
  if (run.status === "stopped") return `${memberName} was stopped before answering.`;
  if (run.status === "interrupted") return `${memberName} was interrupted by a restart before answering.`;
  return `${memberName} is thinking...`;
}

/**
 * Messages for one member, oldest first, two per turn: the person's
 * question and the member's answer, with the ids the sending window used
 * (`<requestId>-u`, `<requestId>-a`) so a merge can tell them apart.
 *
 * options.since   ISO time; turns that started before it belong to a chat
 *                 that was put away and are left out
 * options.limit   newest turns kept (default 60)
 * options.traces  how many of the newest answers carry their trace (default
 *                 12): Work details for the rest come from the saved chat,
 *                 not from here
 */
export function transcriptFromRuns(runs, { memberId, memberName = "", since = "", limit = 60, traces = 12 } = {}) {
  const list = runs instanceof Map ? [...runs.values()] : Array.isArray(runs) ? runs : [];
  const cutoff = since ? Date.parse(since) : NaN;
  const turns = list
    .filter((run) => isPersonRun(run) && run.agentId === memberId && (run.personPrompt || run.prompt))
    .filter((run) => !Number.isFinite(cutoff) || (Date.parse(run.startedAt) || 0) >= cutoff)
    .sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0))
    .slice(-Math.max(1, Number(limit) || 60));
  const name = memberName || "The member";
  const messages = [];
  turns.forEach((run, index) => {
    const requestId = String(run.requestId || run.id);
    const withTrace = index >= turns.length - Math.max(0, Number(traces) || 0);
    const status = messageStatus(run);
    messages.push({
      id: `${requestId}-u`,
      role: "user",
      body: String(run.personPrompt || run.prompt || ""),
      status: "complete",
      startedAt: run.startedAt || "",
      requestId,
      fromBridge: true,
    });
    messages.push({
      id: `${requestId}-a`,
      role: "agent",
      body: replyBody(run, name),
      status,
      startedAt: run.startedAt || "",
      ...(run.finishedAt ? { completedAt: run.finishedAt } : {}),
      ...(Number.isFinite(Number(run.durationMs)) && run.durationMs !== null ? { durationMs: Number(run.durationMs) } : {}),
      requestId,
      runId: String(run.id || ""),
      ...(run.effectiveModel ? { effectiveModel: run.effectiveModel } : {}),
      ...(run.routing ? { routing: run.routing } : {}),
      ...(run.transport ? { transport: String(run.transport) } : {}),
      ...(run.workspace ? { workspace: String(run.workspace) } : {}),
      ...(withTrace && isPlainObject(run.trace) ? { trace: run.trace } : {}),
      fromBridge: true,
    });
  });
  return { messages, turns: turns.length, live: turns.some((run) => messageStatus(run) === "loading") };
}
