// Channel responder rules (ADR-0094). Who answers a channel message that
// mentions nobody: everyone (the original fan-out), a named lead, or a member
// picked by one bounded model call. Explicit mentions and `@here` always win.
//
// This module is pure and shared by the browser dispatch (src/App.jsx), the
// bridge route (server/responders/pick.mjs) and the bridge-side purpose
// dispatch (server/agent-channel-actions.mjs), so the three paths cannot
// drift. It never calls a model; the pick result is passed in.

export const RESPONDER_MODES = ["everyone", "lead", "auto"];
export const RESPONDER_PICK_THRESHOLD = 0.6;
export const RESPONDER_PICK_TIMEOUT_MS = 3000;
export const RESPONDER_SEVERAL = "several";

export function normalizeResponder(input) {
  const source = input && typeof input === "object" ? input : {};
  const mode = RESPONDER_MODES.includes(source.mode) ? source.mode : "everyone";
  const leadMemberId = String(source.leadMemberId || "").trim();
  return { mode, leadMemberId };
}

function rosterIds(channel) {
  return Array.isArray(channel?.memberIds) ? channel.memberIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
}

/** The saved lead when it is still on the roster; "" otherwise. */
export function responderLeadId(channel) {
  const { leadMemberId } = normalizeResponder(channel?.responder);
  return leadMemberId && rosterIds(channel).includes(leadMemberId) ? leadMemberId : "";
}

/**
 * What the channel will actually do. A lead that left the roster turns Lead
 * into Everyone (and `leadMissing` says so). Auto without a callable provider
 * is reported by the caller through `autoUnavailable`; the effective mode is
 * then the lead when there is one, else everyone.
 */
export function responderStatus(channel, { autoUnavailable = "" } = {}) {
  const responder = normalizeResponder(channel?.responder);
  const leadMemberId = responderLeadId(channel);
  const leadMissing = Boolean(responder.leadMemberId) && !leadMemberId;
  let effectiveMode = responder.mode;
  if (responder.mode === "lead" && !leadMemberId) effectiveMode = "everyone";
  if (responder.mode === "auto" && autoUnavailable) effectiveMode = leadMemberId ? "lead" : "everyone";
  return { mode: responder.mode, leadMemberId, leadMissing, effectiveMode, autoUnavailable: String(autoUnavailable || "") };
}

/**
 * Does this message need the pick route? Only an un-mentioned message in an
 * Auto channel; mentions, `@here` and thread follow-ups never do. The caller
 * passes the mention resolution it already computed.
 */
export function needsResponderPick(mentions, channel) {
  if (mentions?.hasMentions) return false;
  if (mentions?.mode === "thread") return false;
  return normalizeResponder(channel?.responder).mode === "auto";
}

/**
 * Turn a validated model answer into a decision. `answer` is
 * { choice, probability } where choice is a roster id or "several".
 */
export function decideFromPick(answer, { memberIds = [], leadMemberId = "", threshold = RESPONDER_PICK_THRESHOLD } = {}) {
  const choice = String(answer?.choice || "").trim();
  const probability = Number(answer?.probability);
  const valid = Number.isFinite(probability) && probability >= 0 && probability <= 1 && (choice === RESPONDER_SEVERAL || memberIds.includes(choice));
  if (!valid) return fallbackDecision("invalid answer", { memberIds, leadMemberId });
  if (probability >= threshold) {
    if (choice === RESPONDER_SEVERAL) return { rule: "auto-everyone", memberIds: [...memberIds], probability, choice };
    return { rule: "auto", memberIds: [choice], memberId: choice, probability, choice };
  }
  return fallbackDecision("low confidence", { memberIds, leadMemberId, probability, choice });
}

/** Auto could not decide: the lead answers, or everyone when there is none. */
export function fallbackDecision(reason, { memberIds = [], leadMemberId = "", probability, choice } = {}) {
  const base = { rule: "auto-fallback", reason: String(reason || "unavailable"), ...(Number.isFinite(probability) ? { probability } : {}), ...(choice ? { choice } : {}) };
  if (leadMemberId && memberIds.includes(leadMemberId)) return { ...base, memberIds: [leadMemberId], memberId: leadMemberId, fallback: "lead" };
  return { ...base, memberIds: [...memberIds], fallback: "everyone" };
}

/**
 * Recipients for one message. Precedence: explicit mentions, then `@here`,
 * then a thread's recorded recipients, then the channel's responder mode.
 *
 * mentions: { hasMentions, mode: "mentions"|"here"|"thread"|"channel", targetMemberIds }
 * pick:     the pick route's answer for an Auto channel, or null when the
 *           route was not called (then Auto falls back like Lead/Everyone).
 */
export function resolveResponderRecipients({ mentions, channel, pick = null }) {
  const roster = rosterIds(channel);
  const targets = Array.isArray(mentions?.targetMemberIds) ? mentions.targetMemberIds.filter((id) => roster.includes(id)) : [];
  if (mentions?.hasMentions) {
    return { rule: mentions.mode === "here" ? "here" : "mentions", memberIds: targets, responder: null };
  }
  if (mentions?.mode === "thread" && targets.length) {
    return { rule: "thread", memberIds: targets, responder: null };
  }
  const status = responderStatus(channel);
  if (status.mode === "lead") {
    if (status.leadMemberId) {
      return { rule: "lead", memberIds: [status.leadMemberId], responder: { mode: "lead", rule: "lead", memberId: status.leadMemberId } };
    }
    return { rule: "everyone", memberIds: roster, responder: { mode: "lead", rule: "everyone", reason: "lead left the channel" } };
  }
  if (status.mode === "auto") {
    const decision = pick && typeof pick === "object" && Array.isArray(pick.memberIds)
      ? pick
      : fallbackDecision(pick?.reason || "pick unavailable", { memberIds: roster, leadMemberId: status.leadMemberId });
    const memberIds = decision.memberIds.filter((id) => roster.includes(id));
    return {
      rule: decision.rule,
      memberIds: memberIds.length ? memberIds : roster,
      responder: {
        mode: "auto",
        rule: decision.rule,
        ...(decision.memberId ? { memberId: decision.memberId } : {}),
        ...(Number.isFinite(decision.probability) ? { probability: decision.probability } : {}),
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(decision.fallback ? { fallback: decision.fallback } : {}),
      },
    };
  }
  return { rule: "everyone", memberIds: roster, responder: null };
}

// --- Mentions on the bridge -------------------------------------------------
// The browser has its own resolver with the same aliases (src/App.jsx,
// resolveChannelMentionTargets); this one serves the bridge, where members
// arrive as { id, name } copies.

const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const mentionKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function mentionAliases(member) {
  const name = String(member?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  return Array.from(new Set([name, firstName, name.replace(/\s+/g, ""), String(member?.id || "")].map(mentionKey).filter(Boolean)));
}

/** Mention resolution over bridge-side member copies; same shape the browser produces. */
export function resolveMentions(text, members = []) {
  const tokens = Array.from(new Set(Array.from(String(text || "").matchAll(MENTION_PATTERN), (match) => match[1])));
  if (!tokens.length) return { hasMentions: false, mode: "channel", targetMemberIds: [], invalidMentionTokens: [] };
  const buckets = new Map();
  for (const member of members) for (const alias of mentionAliases(member)) buckets.set(alias, [...(buckets.get(alias) || []), member]);
  const selected = new Map();
  const invalidMentionTokens = [];
  const here = tokens.some((token) => mentionKey(token) === "here");
  if (here) for (const member of members) selected.set(member.id, member);
  for (const token of tokens) {
    const key = mentionKey(token);
    if (!key || key === "here") continue;
    const matches = buckets.get(key) || [];
    if (matches.length === 1) selected.set(matches[0].id, matches[0]);
    else invalidMentionTokens.push(`@${token}`);
  }
  return { hasMentions: true, mode: here ? "here" : "mentions", targetMemberIds: Array.from(selected.keys()), invalidMentionTokens };
}

// --- Labels -----------------------------------------------------------------

function memberName(memberId, members = []) {
  const member = members.find((item) => item?.id === memberId);
  return String(member?.name || memberId || "").trim();
}

const percent = (value) => `${Math.round(Number(value) * 100)}%`;

/** "Answered by Noah (auto · 80%)"; "" when there is nothing worth saying. */
export function responderTagLabel(responder, members = []) {
  if (!responder || typeof responder !== "object") return "";
  const name = responder.memberId ? memberName(responder.memberId, members) : "";
  const confidence = Number.isFinite(responder.probability) ? ` · ${percent(responder.probability)}` : "";
  switch (responder.rule) {
    case "lead":
      return name ? `Answered by ${name} (lead)` : "";
    case "auto":
      return name ? `Answered by ${name} (auto${confidence})` : "";
    case "auto-everyone":
      return `Everyone answered (auto${confidence})`;
    case "auto-fallback":
      return name
        ? `Answered by ${name} (auto fell back: ${responder.reason || "unavailable"})`
        : `Everyone answered (auto fell back: ${responder.reason || "unavailable"})`;
    default:
      return "";
  }
}

/** The composer hint for an un-mentioned message. */
export function responderTargetHint(channel, members = [], { autoUnavailable = "" } = {}) {
  const status = responderStatus(channel, { autoUnavailable });
  if (status.mode === "lead" && status.leadMemberId) return `lead (${memberName(status.leadMemberId, members)})`;
  if (status.mode === "auto") {
    if (status.autoUnavailable) return status.leadMemberId ? `lead (${memberName(status.leadMemberId, members)}; auto unavailable)` : "channel (auto unavailable)";
    return "auto";
  }
  return "";
}
