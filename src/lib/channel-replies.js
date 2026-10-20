import { isNoTextReply } from "./chat-recovery.js";

const ACTIVE = new Set(["loading", "queued", "pending", "running", "working", "streaming", "accepted"]);
const FAILED = new Set(["error", "failed", "cancelled", "canceled", "interrupted", "stopped", "aborted", "declined"]);

export function normalizeChannelReplyMode(value) {
  return value === "channel" ? "channel" : "thread";
}

export function isChannelPlaceholder(body) {
  const text = String(body || "").trim();
  return !text || /\bis typing(?:\.{3}|…)$/i.test(text);
}

/** Presence, errors and a successful run with no answer are not replies. */
export function channelReplyState(message) {
  if (FAILED.has(message?.status) || message?.declined) return "failed";
  if (ACTIVE.has(message?.status)) return "working";
  if (!["agent", "user"].includes(message?.role)) return "activity";
  const text = String(message.body || "").trim();
  if (isNoTextReply(text) || message.noReplyText) return "no-text";
  if (!isChannelPlaceholder(text) || message.attachments?.length) return "replied";
  return "no-text";
}

/**
 * Saved parent/thread identities are authoritative. Never infer a reply from
 * which human spoke most recently: two threads can be running concurrently.
 * Missing parents and cycles stay visible as standalone messages.
 */
export function channelReplyIndex(messages = []) {
  const byId = new Map(messages.map(message => [message.id, message]));
  const threadRoots = new Map();
  for (const message of messages) {
    if (message.threadId && !message.parentMessageId && !threadRoots.has(message.threadId)) threadRoots.set(message.threadId, message);
  }
  const roots = new Map();
  function rootOf(message) {
    if (roots.has(message.id)) return roots.get(message.id);
    const seen = new Set([message.id]);
    let current = message;
    while (current.parentMessageId) {
      const parent = byId.get(current.parentMessageId) || threadRoots.get(current.threadId);
      if (!parent || seen.has(parent.id) || (parent.channelId && message.channelId && parent.channelId !== message.channelId)
        || (parent.threadId && message.threadId && parent.threadId !== message.threadId)) return message.id;
      seen.add(parent.id);
      current = parent;
    }
    // Some older replies carry only a thread id; its saved root still owns them.
    const threadRoot = threadRoots.get(current.threadId);
    const rootId = threadRoot?.id || current.id;
    roots.set(message.id, rootId);
    return rootId;
  }
  const groups = new Map();
  for (const message of messages) {
    const rootId = rootOf(message);
    roots.set(message.id, rootId);
    if (rootId === message.id) continue;
    if (!groups.has(rootId)) groups.set(rootId, { messages: [], replies: [], replierIds: [], working: 0, failed: 0, noText: 0 });
    const group = groups.get(rootId);
    group.messages.push(message);
    const state = channelReplyState(message);
    if (state === "replied") {
      group.replies.push(message);
      if (message.role === "agent" && message.agentId && !group.replierIds.includes(message.agentId)) group.replierIds.push(message.agentId);
    } else if (state === "working") group.working++;
    else if (state === "failed") group.failed++;
    else if (state === "no-text") group.noText++;
  }
  return { roots, groups };
}

export function channelThreadSummary(group) {
  const count = group?.replies.length || 0;
  return [
    `${count} ${count === 1 ? "reply" : "replies"}`,
    group?.working ? `${group.working} working` : "",
    group?.failed ? `${group.failed} failed` : "",
    group?.noText ? `${group.noText} without reply text` : "",
  ].filter(Boolean).join(" · ");
}
