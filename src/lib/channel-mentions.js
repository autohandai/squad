// Channel @mentions in the browser (moved out of src/App.jsx so they are
// testable in Node; scripts/check-channel-mentions.mjs). The bridge resolves
// the same aliases in src/lib/channel-responders.js.

import { addFormerNameBuckets, mentionTokens, projectMentionKeys } from "./channel-responders.js";

export function normalizeChannelMentionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function channelMentionHandle(agent) {
  const name = String(agent?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  const handle = firstName.replace(/[^A-Za-z0-9._-]/g, "");
  return handle || String(agent?.id || "").replace(/[^A-Za-z0-9._-]/g, "");
}

export function channelMentionLabel(agent) {
  const handle = channelMentionHandle(agent);
  return handle ? `@${handle}` : String(agent?.name || "member");
}

export function channelMentionAliases(agent) {
  const name = String(agent?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  return Array.from(
    new Set(
      [name, firstName, name.replace(/\s+/g, ""), channelMentionHandle(agent)]
        .map(normalizeChannelMentionKey)
        .filter(Boolean)
    )
  );
}

export function channelMembersFor(channel, agents = []) {
  const channelMemberIds = new Set(Array.isArray(channel?.memberIds) ? channel.memberIds : []);
  return agents.filter((agent) => channelMemberIds.has(agent.id));
}

export function channelAgentsByIds(memberIds = [], agents = []) {
  const wanted = new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean));
  return agents.filter((agent) => wanted.has(agent.id));
}

export function resolveChannelMentionTargets(prompt, channel, agents = [], options = {}) {
  const text = String(prompt || "");
  const channelAgents = channelMembersFor(channel, agents);
  const fallbackAgents = channelAgentsByIds(options.fallbackMemberIds, agents);
  const defaultAgents = fallbackAgents.length ? fallbackAgents : channelAgents;
  const aliasBuckets = new Map();
  for (const agent of channelAgents) {
    for (const alias of channelMentionAliases(agent)) {
      aliasBuckets.set(alias, [...(aliasBuckets.get(alias) || []), agent]);
    }
  }
  addFormerNameBuckets(aliasBuckets, channelAgents);
  // Addresses, canvases, files and channel projects are not recipients
  // (src/lib/channel-responders.js, mentionTokens).
  const projectKeys = projectMentionKeys(channel?.projects);
  const uniqueTokens = mentionTokens(text).filter(
    (token) => aliasBuckets.has(normalizeChannelMentionKey(token)) || !projectKeys.has(normalizeChannelMentionKey(token))
  );
  const hasMentions = uniqueTokens.length > 0;
  if (!hasMentions) {
    return {
      mode: fallbackAgents.length ? "thread" : "channel",
      hasMentions,
      invalidMentionTokens: [],
      targetAgents: defaultAgents,
      targetMemberIds: defaultAgents.map((agent) => agent.id),
      targetLabel: fallbackAgents.length ? "thread recipients" : "channel",
    };
  }

  const selected = new Map();
  const invalidMentionTokens = [];
  const mentionsHere = uniqueTokens.some((token) => normalizeChannelMentionKey(token) === "here");
  if (mentionsHere) {
    for (const agent of channelAgents) selected.set(agent.id, agent);
  }

  for (const token of uniqueTokens) {
    const key = normalizeChannelMentionKey(token);
    if (!key || key === "here") continue;
    const matches = aliasBuckets.get(key) || [];
    if (matches.length === 1) {
      selected.set(matches[0].id, matches[0]);
    } else {
      invalidMentionTokens.push(`@${token}`);
    }
  }

  const targetAgents = Array.from(selected.values());
  const targetLabel = mentionsHere
    ? "@here"
    : targetAgents.length
      ? targetAgents.map(channelMentionLabel).join(", ")
      : "";
  return {
    mode: mentionsHere ? "here" : "mentions",
    hasMentions,
    invalidMentionTokens,
    targetAgents,
    targetMemberIds: targetAgents.map((agent) => agent.id),
    targetLabel,
  };
}

// What the person reads when an @mention reached nobody: a teammate outside
// the channel, a name two members share, or nobody by that name. Before, the
// message was dropped without a word when no mention resolved.
export function unreachedMentionNote(resolution, channel, agents = []) {
  const tokens = resolution?.invalidMentionTokens || [];
  if (!tokens.length) return "";
  const channelIds = new Set(channel?.memberIds || []);
  const lines = tokens.map((token) => {
    const key = normalizeChannelMentionKey(token);
    const matches = agents.filter((agent) => channelMentionAliases(agent).includes(key));
    const inChannel = matches.filter((agent) => channelIds.has(agent.id));
    if (inChannel.length > 1) return `${token} matches ${inChannel.map((agent) => agent.name).join(" and ")}; use the full name.`;
    if (matches.length === 1) return `${matches[0].name} is not in #${channel.name}. Add them to the channel to ask them here.`;
    return `Nobody in #${channel.name} is called ${token}.`;
  });
  if (!resolution.targetAgents?.length) lines.push("Nobody was asked.");
  return lines.join(" ");
}

export function withoutHereMentions(text) {
  return String(text || "").replace(/(^|[^A-Za-z0-9._%+-])@here\b/gi, "$1here");
}

// "Kai mentioned you in #general" is for a reply that names the person or
// @here, not for one that asks a teammate (it fired on every @Eva).
export function mentionsPerson(text, profile = {}) {
  const tokens = mentionTokens(text).map(normalizeChannelMentionKey);
  const name = String(profile.name || "").trim();
  const names = new Set([name, name.split(/\s+/)[0], String(profile.email || "").split("@")[0]].map(normalizeChannelMentionKey).filter(Boolean));
  return tokens.some((token) => token === "here" || token === "channel" || token === "everyone" || names.has(token));
}

export function formatChannelTargetLabel(resolution) {
  if (!resolution?.targetAgents?.length) return "";
  if (resolution.mode === "here") return "@here";
  return resolution.targetAgents.map(channelMentionLabel).join(", ");
}

// Which targets a message still needs a chip for. A root message that says
// "@iris" drew Iris twice (the target chip and the inline mention), and a
// member's reply wore a chip of its own name; both are already on screen.
export function targetChipMemberIds(message, agents = []) {
  const ids = Array.isArray(message?.targetMemberIds) ? message.targetMemberIds : [];
  const inline = new Set(mentionTokens(message?.body).map(normalizeChannelMentionKey));
  return ids.filter((id) => {
    if (id === message?.agentId) return false;
    const agent = agents.find((item) => item.id === id);
    return !agent || !channelMentionAliases(agent).some((alias) => inline.has(alias));
  });
}

// Who a DM message or a member's reply @mentions among the other members
// (moved from src/App.jsx so it is testable; scripts/check-channel-mentions.mjs).
export function mentionedSquadMembers(text, agents = [], activeAgentId = "") {
  const tokens = new Set(
    Array.from(String(text || "").matchAll(/@([A-Za-z0-9._/-]+)/g))
      .map((match) => match[1].toLowerCase().replace(/[._/-]+$/, ""))
      .filter(Boolean)
  );
  if (!tokens.size) return [];
  const candidates = agents.filter((agent) => agent.id !== activeAgentId && agent.status !== "offline");
  const firstName = (agent) => String(agent.name || "").trim().split(/\s+/)[0].toLowerCase();
  const firstNameCounts = candidates.reduce((counts, agent) => counts.set(firstName(agent), (counts.get(firstName(agent)) || 0) + 1), new Map());
  const currentNames = (agent) => [
    agent.id,
    agent.employeeId,
    agent.staffId,
    String(agent.name || "").trim().replace(/\s+/g, ""),
    String(agent.name || ""),
    firstNameCounts.get(firstName(agent)) === 1 ? firstName(agent) : "",
  ].map((value) => String(value || "").toLowerCase()).filter(Boolean);
  // A name someone went by before a rename reaches them while nobody has it
  // now, as squad_message does: "@Max" after Max became Robert reached nobody.
  const taken = new Set(agents.flatMap((agent) => [String(agent.name || "").toLowerCase(), firstName(agent)]));
  const formerOwners = new Map();
  for (const agent of candidates) {
    for (const former of Array.isArray(agent.formerNames) ? agent.formerNames : []) {
      const value = String(former || "").trim().toLowerCase();
      for (const name of new Set([value.replace(/\s+/g, ""), value.split(/\s+/)[0]])) {
        if (name && !taken.has(name)) formerOwners.set(name, new Set([...(formerOwners.get(name) || []), agent.id]));
      }
    }
  }
  return candidates.filter((agent) =>
    currentNames(agent).some((name) => tokens.has(name)) ||
    [...tokens].some((token) => formerOwners.get(token)?.size === 1 && formerOwners.get(token).has(agent.id))
  );
}
