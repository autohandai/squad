// Recall (ADR-0115): what a member is told about earlier conversations at
// the start of every direct-message turn, whichever engine runs it.
//
// Sources, all already on the bridge:
//   - the member's own previous chats (server/chats/store.mjs index digests)
//   - other members' previous chats (same store, other member folders)
//   - other members' latest replies (chat runs in the runs Map, which the
//     app's live conversations do not reach the bridge in any other way)
//   - recent channel messages in channels this member belongs to
//
// The block is plain text under one heading with a character budget, so a
// long history costs a bounded slice of context. Secrets are redacted the
// way the control plane redacts replies.
import { redactSecrets } from "../control-plane/control-plane.mjs";

export const RECALL_BUDGET_CHARS = 7000;
export const RECALL_LIMITS = Object.freeze({ ownChats: 6, otherChats: 5, otherTurns: 5, channels: 3, messagesPerChannel: 4 });
export const RECALL_HEADING = "Earlier conversations";

// A goal turn's prompt starts with the bridge's own instruction (goal-manager);
// recall shows the goal itself, not the instruction.
const GOAL_PREAMBLE = /^Pursue this explicit goal[^\n]*:\s*/i;
export function turnTitle(title) {
  const text = String(title || "");
  if (!GOAL_PREAMBLE.test(text)) return text;
  const goal = text.replace(GOAL_PREAMBLE, "").split(/\n\s*\n/)[0];
  return `goal: ${goal}`;
}

function clip(text, max) {
  const value = redactSecrets(String(text || "")).replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function relativeAge(value, now = Date.now()) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.round((now - ms) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const byNewest = (key) => (a, b) => Date.parse(b?.[key] || 0) - Date.parse(a?.[key] || 0);

/**
 * Pure. `sources` is { memberId, memberName, members: [{id,name}], ownChats,
 * otherChats (summaries with memberId and digest), otherTurns (chat runs of
 * other members), channels: [{ id, name, memberIds }], messages: channel
 * messages }. Returns { text, counts }.
 */
export function buildRecall(sources, { now = Date.now(), budget = RECALL_BUDGET_CHARS, limits = RECALL_LIMITS } = {}) {
  const nameOf = (id) => sources.members?.find((member) => member.id === id)?.name || id || "a member";
  const sections = [];
  const counts = { ownChats: 0, otherChats: 0, otherTurns: 0, channels: 0 };

  const own = [...(sources.ownChats || [])].sort(byNewest("endedAt")).slice(0, limits.ownChats);
  if (own.length) {
    counts.ownChats = own.length;
    sections.push(["Your previous chats with this person (newest first; New chat started a fresh context, these are for continuity):",
      ...own.map((chat) => `- ${relativeAge(chat.endedAt, now)}, "${clip(chat.title, 90)}" (${chat.turns || 0} ${chat.turns === 1 ? "turn" : "turns"})${chat.digest?.lastReply ? `: last reply "${clip(chat.digest.lastReply, 220)}"` : ""}`)].join("\n"));
  }

  const otherTurns = [...(sources.otherTurns || [])].filter((run) => run.agentId && run.agentId !== sources.memberId && (run.reply || run.title)).sort(byNewest("finishedAt")).slice(0, limits.otherTurns);
  const otherChats = [...(sources.otherChats || [])].filter((chat) => chat.memberId !== sources.memberId).sort(byNewest("endedAt")).slice(0, limits.otherChats);
  if (otherTurns.length || otherChats.length) {
    counts.otherTurns = otherTurns.length;
    counts.otherChats = otherChats.length;
    sections.push(["What other members were asked recently:",
      ...otherTurns.map((run) => `- ${nameOf(run.agentId)}, ${relativeAge(run.finishedAt || run.startedAt, now)}: asked "${clip(turnTitle(run.title), 120)}"${run.reply ? `, replied "${clip(run.reply, 160)}"` : ""}`),
      ...otherChats.map((chat) => `- ${nameOf(chat.memberId)}, earlier chat ${relativeAge(chat.endedAt, now)}: "${clip(chat.title, 90)}"${chat.digest?.lastReply ? `, last reply "${clip(chat.digest.lastReply, 140)}"` : ""}`)].join("\n"));
  }

  const memberChannels = (sources.channels || []).filter((channel) => Array.isArray(channel.memberIds) && channel.memberIds.includes(sources.memberId));
  const channelBlocks = [];
  for (const channel of memberChannels) {
    const recent = (sources.messages || []).filter((message) => message.channelId === channel.id && message.body && message.status !== "error").sort(byNewest("createdAt")).slice(0, limits.messagesPerChannel);
    if (!recent.length) continue;
    channelBlocks.push({ at: recent[0].createdAt, text: `- #${channel.name || channel.id} (${relativeAge(recent[0].createdAt, now)}): ${recent.reverse().map((message) => `${message.role === "user" ? message.authorName || "Person" : nameOf(message.agentId) || message.authorName || "Member"}: "${clip(message.body, 140)}"`).join(" · ")}` });
  }
  const channels = channelBlocks.sort(byNewest("at")).slice(0, limits.channels);
  if (channels.length) {
    counts.channels = channels.length;
    sections.push(["Recent channel messages where you are a member:", ...channels.map((block) => block.text)].join("\n"));
  }

  if (!sections.length) return { text: "", counts };
  let text = `${RECALL_HEADING} (for continuity; the person may refer to any of these, and you may mention them when relevant):\n${sections.join("\n\n")}`;
  if (text.length > budget) text = `${text.slice(0, budget - 1)}…`;
  return { text, counts };
}

/** Gather the sources from the bridge. Every read is optional; a missing one contributes nothing. */
export async function collectRecallSources({ memberId, store, runs, readChannelsState, readStatus }) {
  const id = String(memberId || "");
  const [index, state, status] = await Promise.all([
    store?.listAll ? store.listAll().catch(() => []) : [],
    typeof readChannelsState === "function" ? readChannelsState().catch(() => null) : null,
    typeof readStatus === "function" ? readStatus().catch(() => null) : null,
  ]);
  const members = Array.isArray(status?.members) ? status.members.map((member) => ({ id: String(member.id || ""), name: String(member.name || "") })) : [];
  const otherTurns = runs ? [...runs.values()].filter((run) => run && run.mode === "chat" && run.status === "completed" && run.agentId !== id).map((run) => ({ agentId: run.agentId, title: run.title, reply: run.reply, finishedAt: run.finishedAt, startedAt: run.startedAt })) : [];
  return {
    memberId: id,
    memberName: members.find((member) => member.id === id)?.name || id,
    members,
    ownChats: index.filter((chat) => chat.memberId === id),
    otherChats: index.filter((chat) => chat.memberId !== id),
    otherTurns,
    channels: Array.isArray(state?.channels) ? state.channels : [],
    messages: Array.isArray(state?.messages) ? state.messages : [],
  };
}
