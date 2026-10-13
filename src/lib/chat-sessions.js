// Previous chats (ADR-0113): pure helpers for putting a conversation away on
// New chat and bringing one back. No React, no DOM, so scripts/check-chats.mjs
// imports this from Node.

/** A conversation is worth keeping once the person has said something. */
export function conversationHasWork(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => message?.role === "user" && String(message.body || "").trim());
}

/** The first thing the person asked, as the chat's name. */
export function chatTitleFrom(messages, fallback = "Chat") {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "user") continue;
    const text = String(message.body || "").replace(/\s+/g, " ").trim();
    if (text) return text.length > 96 ? `${text.slice(0, 95)}…` : text;
  }
  return fallback;
}

/** What the browser sends to POST /api/members/:id/chats. */
export function archivePayload(agent, messages, { workspace = "", endedAt = new Date().toISOString() } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  return {
    messages: list,
    startedAt: agent?.conversationStartedAt || list[0]?.startedAt || "",
    endedAt,
    harness: String(agent?.harness?.id || agent?.harness || "").trim(),
    workspace: String(workspace || agent?.workspace || ""),
    title: chatTitleFrom(list),
  };
}

/**
 * The shared-conversation event that makes an archived chat the live one.
 * Every restored message takes the restore time as its start, so later
 * patches cannot reach it and the reset boundary moves to now.
 */
export function restoreConversationEvent(memberId, chat, at = new Date().toISOString()) {
  const messages = (Array.isArray(chat?.messages) ? chat.messages : []).map((message) => ({ ...message, status: message.status === "loading" ? "stopped" : message.status }));
  return { type: "messages.reset", memberId, at, cutoff: at, messages };
}

/** "3 turns · Claude Code · 2h ago" */
export function chatMetaLine(chat, { now = Date.now(), harnessName = (id) => id, relative = () => "", copy = {} } = {}) {
  const turns = Number(chat?.turns) || 0;
  const parts = [
    `${turns} ${turns === 1 ? copy.turn || "turn" : copy.turns || "turns"}`,
    chat?.harness ? harnessName(chat.harness) : "",
    relative(chat?.endedAt || chat?.createdAt, now),
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Newest first, as the list shows them. */
export function sortChats(chats) {
  return [...(Array.isArray(chats) ? chats : [])].sort((a, b) => Date.parse(b?.endedAt || b?.createdAt || 0) - Date.parse(a?.endedAt || a?.createdAt || 0));
}
