// A member born in conversation (ADR-0126).
//
// "Chat with a new member" creates a member with no role. It runs with the
// shaping instruction below, takes whatever role the person gives it in plain
// English, and records that with one `profile` SQUAD_ACTION. The bridge
// validates and identity-checks the action with the same function the
// browser uses, and the browser applies the receipt through updateAgent, the
// path the profile editor already uses.
//
// Pure: no React, no DOM, so scripts/check-member-by-chat.mjs and the bridge
// (server/routes/member-shaping.route.mjs, server.mjs) import it from Node.

import { uniqueName } from "./teams.js";

export const BLANK_MEMBER_NAME = "New member";
export const PROFILE_ACTION_TYPE = "profile";

// Limits match the form's draft (src/lib/member-draft.js) so a member shaped
// in conversation fits everywhere a drafted one does.
export const PROFILE_LIMITS = Object.freeze({ name: 60, role: 80, description: 600, instructions: 1200, personality: 600, skills: 8, skill: 60 });
const PROFILE_KEYS = new Set(["type", "op", "member", "name", "role", "description", "instructions", "personality", "skills"]);
const PROFILE_FIELDS = Object.freeze(["name", "role", "description", "instructions", "personality", "skills"]);
export const MEMBER_PROFILE_FIELDS = Object.freeze(["name", "role", "description", "instructions", "skills", "brainCard", "memory", "profileFiles", "formerNames", "modelRouting"]);

export function memberProfileRevision(member) {
  const revision = member?.profileRevision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

/** Bridge-owned profile fields win over an older window's snapshot. */
export function mergeMemberProfile(local, saved) {
  if (!saved || memberProfileRevision(saved) <= memberProfileRevision(local)) return local;
  const fields = Object.fromEntries(MEMBER_PROFILE_FIELDS.filter((key) => key in saved).map((key) => [key, saved[key]]));
  return { ...local, ...fields, profileRevision: memberProfileRevision(saved) };
}

/** A member with no role is blank; setting one, anywhere, ends that. */
export function isBlankMember(agent) {
  return !String(agent?.role || "").trim();
}

/** "New member", "New member 2": the names the app gives, not the person. */
export function isPlaceholderName(name) {
  return new RegExp(`^${BLANK_MEMBER_NAME}(?:\\s+\\d+)?$`, "i").test(String(name || "").trim());
}

/**
 * The draft createAgent receives for "Chat with a new member". Every field
 * createAgent reads is present; the name is numbered like the team builder's
 * when the squad already has a "New member".
 */
export function blankMemberDraft({ existingNames = [], workspace = "", harness = null, avatar = "" } = {}) {
  return {
    name: uniqueName(BLANK_MEMBER_NAME, existingNames),
    role: "",
    description: "",
    instructions: "",
    skills: [],
    brainCard: {},
    employeeType: "",
    avatar,
    workspace,
    harness,
    profileFiles: [],
  };
}

/** The first message of a blank member, in place of the role introduction. */
export function blankGreeting(agent) {
  const name = String(agent?.name || "").trim() || BLANK_MEMBER_NAME;
  return `Hey! I'm ${name}. What can I help you with?`;
}

// Plain-English role requests. Generous on purpose: a false positive only
// sends the instruction, and the member still decides whether a role was
// asked for. "be more concise" and "can you be quick" do not match.
const ROLE_REQUEST = /\b(?:you(?:'re|’re| are)\s+(?:going\s+to\s+be|gonna\s+be|now)\s+(?:my|our|the|a|an)\b|(?:^|[,.;:!?]\s*|\b(?:actually|instead|now|please|just|i\s+want\s+you\s+to|i'd\s+like\s+you\s+to|can\s+you|could\s+you)\s*,?\s*)be\s+(?:my|our|the)\b|become\s+(?:my|our|the|a|an)\b|act\s+as\s+(?:my|our|the|a|an)\b|your\s+(?:new\s+)?(?:role|job|title)\s+is\b|take\s+on\s+the\s+role\b|switch\s+(?:roles?\s+)?to\s+being\b)/i;

// Naming the member is a profile change too (ADR-0134): "your name is
// Robert" carried no instruction before, so the member said "I'll go by
// Robert" and nothing in Squad changed.
const NAME_REQUEST = /\b(?:your\s+(?:new\s+)?name\s+(?:is|will\s+be|should\s+be)\b|(?:i(?:'ll|’ll|\s+will|\s+want\s+to|'d\s+like\s+to|’d\s+like\s+to)|we(?:'ll|’ll|\s+will)|let\s+me)\s+call\s+you\b|you(?:'ll|’ll|\s+will)\s+be\s+called\b|you(?:'re|’re|\s+are)\s+(?:now\s+)?called\b|call\s+yourself\b|rename\s+yourself\b|change\s+your\s+name\b)/i;
// "from now on you're Robert": only a capitalised word after it is a name.
const NAME_CLAIM = /\bfrom\s+now\s+on,?\s+you(?:'re|’re|\s+are)\s+[A-Z][a-z]+\b(?!\s+(?:to|for|in|on)\b)/;

/** True when the message gives the member a role ("you're going to be my GTM Leader") or a name. */
export function asksForRole(prompt) {
  const text = String(prompt || "");
  return ROLE_REQUEST.test(text) || NAME_REQUEST.test(text) || NAME_CLAIM.test(text);
}

/** Whether this turn carries the shaping instruction: blank, or asked for a role. */
export function needsShapingInstruction(agent, prompt) {
  return isBlankMember(agent) || asksForRole(prompt);
}

/**
 * The instruction, for every engine. Blank: become what the person asks.
 * Otherwise (the person asked for a different role): change, and keep the
 * name unless told otherwise. The example line is the format.
 */
export function memberShapingInstruction(agent = {}) {
  const name = String(agent?.name || "").trim() || BLANK_MEMBER_NAME;
  const blank = isBlankMember(agent);
  const placeholder = isPlaceholderName(name);
  const opening = blank
    ? `You are ${name}, a new Squad member with no role yet. Become whatever the person asks you to be. Until they give you a role, answer briefly and ask what they need, for example: "Hey! I'm ${name}. What can I help you with?"`
    : `The person may be giving you a different role. If they are ("actually, be my QA lead"), take it the same way; if not, ignore this paragraph.`;
  const naming = placeholder
    ? `Your name "${name}" is a placeholder: unless the person names you, pick one short, friendly first name that suits the role and set it.`
    : "Keep your name unless the person gives you a new one.";
  return [
    opening,
    `When the person gives you a role in plain English ("you're going to be my GTM Leader", "be our release manager"): (1) confirm in one line, like "Done, I'm your GTM Leader from here on."; (2) set your profile with one line exactly like: SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader","instructions":"How you work in this role, addressed to yourself as 'you'.","personality":"One or two sentences on tone and working style.","skills":["go-to-market strategy","market research"]}; (3) ask at most four numbered, concrete questions about what you need to start, and end with "Send what you have, even rough."; (4) from then on, work as that role.`,
    naming,
    `Fields: name (a short name, ≤${PROFILE_LIMITS.name} chars), role (a job title, ≤${PROFILE_LIMITS.role}), description (responsibilities, ≤${PROFILE_LIMITS.description}), instructions (≤${PROFILE_LIMITS.instructions}), personality (≤${PROFILE_LIMITS.personality}), skills (≤${PROFILE_LIMITS.skills} short lower-case phrases); send only the fields that change. Prefer squad_set_profile when Squad's MCP is available; the SQUAD_ACTION line is the compatibility path. You can only change your own profile. Confirm a saved change only after the operation returns its receipt.`,
  ].join(" ");
}

/**
 * The action, checked. Returns { patch, member } with only the fields that
 * change, or throws with a reason the member can read. Identity (whose
 * profile this is) is the caller's to check against `member`.
 */
export function validateProfileAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the profile action must be an object");
  const extra = Object.keys(raw).filter((key) => !PROFILE_KEYS.has(key));
  if (extra.length) throw new Error(`profile actions may only contain op, member, name, role, description, instructions, personality and skills (not ${extra.join(", ")})`);
  if (String(raw.op || "").trim().toLowerCase() !== "set") throw new Error('op must be "set"');
  if (raw.member !== undefined && typeof raw.member !== "string") throw new Error("member must be your own name or id");
  const patch = {};
  for (const field of ["name", "role", "description", "instructions", "personality"]) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "string") throw new Error(`${field} must be text`);
    const multiline = field === "instructions" || field === "personality";
    const value = multiline ? raw[field].trim() : raw[field].replace(/\s+/g, " ").trim();
    if (value.length > PROFILE_LIMITS[field]) throw new Error(`${field} is longer than ${PROFILE_LIMITS[field]} characters`);
    if (value || ["description", "instructions", "personality"].includes(field)) patch[field] = value;
  }
  if (patch.name && /\s/.test(patch.name) && patch.name.split(/\s+/).length > 3) throw new Error("name must be a short name, not a sentence");
  // The app's placeholder is never a chosen name; drop it rather than refuse
  // a role change that happened to repeat it.
  if (patch.name && isPlaceholderName(patch.name)) delete patch.name;
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills) || raw.skills.some((skill) => typeof skill !== "string")) throw new Error("skills must be a list of short phrases");
    if (raw.skills.length > PROFILE_LIMITS.skills) throw new Error(`at most ${PROFILE_LIMITS.skills} skills`);
    const seen = new Set();
    patch.skills = raw.skills.map((skill) => skill.replace(/\s+/g, " ").trim().slice(0, PROFILE_LIMITS.skill)).filter((skill) => skill && !seen.has(skill.toLowerCase()) && seen.add(skill.toLowerCase()));
  }
  if (!PROFILE_FIELDS.some((field) => patch[field] !== undefined)) throw new Error("set at least one of name, role, description, instructions, personality or skills");
  return { patch, member: typeof raw.member === "string" ? raw.member.trim() : "" };
}

/** Whether `named` (from the action's `member`) is the executing member. */
export function namesSelf(named, actor = {}) {
  const key = (value) => String(value || "").replace(/^@/, "").trim().toLowerCase();
  if (!key(named)) return true;
  return [actor.id, actor.name].some((value) => key(value) && key(value) === key(named));
}

/**
 * The receipt's one line, which is also what the chat shows under the reply:
 * "Alex is now your GTM Leader." Written from the patch and the member as it
 * was, so a rename without a role still reads naturally.
 */
export function profileChangeLine(patch = {}, before = {}) {
  const name = patch.name || String(before?.name || "").trim() || BLANK_MEMBER_NAME;
  if (patch.role) return `${name} is now your ${patch.role}.`;
  if (patch.name && patch.name !== before?.name) return `${String(before?.name || BLANK_MEMBER_NAME)} is now called ${patch.name}.`;
  const changed = ["description", "instructions", "personality", "skills"].filter((field) => patch[field] !== undefined);
  return `${name} updated its ${joinWords(changed)}.`;
}

/** The applied profile receipts in a done event's channelActions. */
export function profileReceipts(channelActions) {
  return (Array.isArray(channelActions) ? channelActions : []).filter((receipt) => receipt?.type === PROFILE_ACTION_TYPE && receipt.status === "applied" && receipt.patch && typeof receipt.patch === "object");
}

/**
 * Team tool receipts (ADR-0134) that read as a quiet line under the reply,
 * like a profile change: "Remembered for the team: …", "Asked Eva".
 */
export function teamNoteReceipts(channelActions) {
  return (Array.isArray(channelActions) ? channelActions : []).filter((receipt) => ["team_memory", "team_message"].includes(receipt?.type) && receipt.status === "applied" && receipt.message);
}

/**
 * The reply as the chat shows it: the receipt lines lifted out of the body
 * (they render as the quiet line under it instead).
 */
export function replyWithoutReceipts(reply, receipts = []) {
  let body = String(reply || "");
  for (const receipt of receipts) {
    const line = String(receipt?.message || "");
    if (line) body = body.split(line).join("");
  }
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

/** The PERSONALITY.md content a personality sentence becomes. */
export function personalityFileContent(personality, role = "") {
  return ["# Personality", role ? `Role: ${role}` : "", String(personality || "").trim()].filter(Boolean).join("\n\n");
}

function joinWords(items) {
  if (items.length <= 1) return items[0] || "profile";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The quiet line under a reply that carried profile receipts. */
export function profileNoteFor(receipts = []) {
  return receipts.map((receipt) => String(receipt?.message || "").replace(/\.$/, "")).filter(Boolean).join(" · ");
}

/**
 * Receipts from turns the browser did not stream itself (queued follow-ups,
 * goals, Telegram, routines, the control plane), found in GET /api/runs.
 * Each receipt is applied once: `seen` holds the applied ids, `since` is the
 * time this browser started watching, so history restored from before then
 * is never replayed over a later manual edit (ADR-0126, revision).
 */
export function unappliedProfileReceipts(runs = [], { seen = new Set(), since = "" } = {}) {
  const out = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    const finished = String(run?.finishedAt || "");
    if (since && finished && finished < since) continue;
    for (const receipt of profileReceipts(run?.channelActions)) {
      if (!receipt.id || seen.has(receipt.id)) continue;
      out.push({ agentId: String(run.agentId || receipt.actorId || ""), receipt });
    }
  }
  return out.filter((entry) => entry.agentId);
}
