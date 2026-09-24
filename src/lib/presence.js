// Channel presence (ADR-0014): derive who is thinking, typing, or running
// tools from a channel's loading messages, and phrase it like a sentence.

export const STATE_ORDER = ["typing", "tools", "thinking"];

export function presenceSentence(names, verb, copy = {}) {
  const list = names.filter(Boolean);
  if (!list.length) return "";
  const others = list.length - 2;
  const subject =
    list.length === 1
      ? list[0]
      : list.length === 2
        ? `${list[0]} ${copy.and || "and"} ${list[1]}`
        : `${list[0]}, ${list[1]} ${copy.and || "and"} ${others} ${others === 1 ? copy.other || "other" : copy.others || "others"}`;
  const plural = list.length > 1;
  const verbs = {
    thinking: plural ? copy.areThinking || "are thinking" : copy.isThinking || "is thinking",
    typing: plural ? copy.areTyping || "are typing" : copy.isTyping || "is typing",
    tools: plural ? copy.areRunningTools || "are running tools" : copy.isRunningTools || "is running tools",
  };
  return `${subject} ${verbs[verb] || verbs.thinking}…`;
}


/** Derive presence items from a channel's loading messages. */
// A reply still marked loading after this long is a leftover from a session
// that died, not someone working.
export const PRESENCE_STALE_MS = 30 * 60 * 1000;

export function presenceFromMessages(messages = [], agents = [], now = Date.now()) {
  const byAgent = new Map();
  for (const message of messages) {
    if (message.role !== "agent" || message.status !== "loading") continue;
    const startedMs = Date.parse(message.updatedAt || message.startedAt || message.createdAt || "");
    if (Number.isFinite(startedMs) && now - startedMs > PRESENCE_STALE_MS) continue;
    if (/^\s*⚠/.test(String(message.body || ""))) continue;
    const agent = agents.find((item) => item.id === message.agentId);
    if (!agent) continue;
    const body = String(message.body || "");
    const placeholder = /\bis typing\.{3}$|\bis typing…$/.test(body.trim());
    const label = String(message.activityLabel || "").toLowerCase();
    const state = body.trim() && !placeholder ? "typing" : /tool|running|command|shell|reading|writing|search/.test(label) ? "tools" : "thinking";
    const current = byAgent.get(agent.id);
    if (!current || STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(current.state)) byAgent.set(agent.id, { agent, state });
  }
  return [...byAgent.values()];
}
