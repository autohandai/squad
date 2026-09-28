// A new member's first message: what it is going to do.
//
// Composed from the member's own configuration rather than asked of a model.
// That means it is there the instant the member exists, and it cannot promise
// something the member is not actually set up to do. Everything it says can
// be checked against the profile beside it.
//
// Pure: no React, no DOM, so scripts/check-member-introduction.mjs can import
// it from Node. See docs/adrs/ADR-0034-member-introduction.md.

const ROLE_LIMIT = 80;
const MINOR_WORDS = new Set(["of", "the", "and", "for", "to", "in", "on", "at", "by", "with"]);

/**
 * One short message in the member's voice: what it is, where it works, what
 * it brings, and when it will stop and ask.
 */
export function introductionFor(agent, copy = {}) {
  const source = agent && typeof agent === "object" ? agent : {};
  const name = text(source.name) || "This member";
  const role = text(source.role) || copy.squadMember || "squad member";
  const project = folderName(source.workspace);
  const skills = (Array.isArray(source.skills) ? source.skills : []).map(readable).filter(Boolean).slice(0, 3);
  const purpose = asMemberSpeech(source.brainCard?.purpose, copy) || asMemberSpeech(source.description, copy);
  const escalation = asMemberSpeech(firstSentence(text(source.brainCard?.escalationRules)), copy);

  const lines = [];
  // The role keeps its own case: it is a title, and the app capitalises it
  // everywhere else.
  lines.push(`I'm ${name}, your ${role}${project ? ` on ${project}` : ""}.`);
  // The fallback draft uses the person's own words as the purpose, which then
  // just restates the title one sentence after it was said. Drop that echo;
  // a purpose the model wrote reads as its own sentence and is kept.
  if (purpose && !restatesRole(purpose, role)) {
    const sentence = purpose.charAt(0).toUpperCase() + purpose.slice(1);
    lines.push(sentence.endsWith(".") ? sentence : `${sentence}.`);
  }
  if (skills.length) {
    lines.push(`I'm set up for ${list(skills)}.`);
  }
  if (escalation) lines.push(escalation);
  lines.push(copy.introClose || "Tell me what you need, or ask me what I would start with.");
  return lines.join(" ");
}

/**
 * The role hiding at the front of a description: "Chief of staff, controls
 * everyone…" gives "Chief Of Staff". Returns "" when the description does not
 * open with one, so a caller can fall back rather than invent a title.
 */
export function roleFromDescription(description) {
  const value = text(description);
  if (!value) return "";
  // A relative pronoun ends the title and starts the description:
  // "a data engineer who owns our warehouse" is a data engineer.
  const head = value.split(/[,.;:\n]|\s+(?:who|that|which|responsible|focused)\b/i)[0].trim();
  if (!head) return "";
  const words = head.split(/\s+/).filter(Boolean);
  // A role is a short noun phrase. A whole sentence is a description.
  if (!words.length || words.length > 4) return "";
  const leading = words[0].toLowerCase();
  // "Someone who…", "a person that…": the role is not stated, it is described.
  if (["someone", "somebody", "person", "anyone", "who", "that", "which"].includes(leading)) return "";
  const cleaned = words.filter((word) => !["a", "an", "the"].includes(word.toLowerCase()));
  if (!cleaned.length) return "";
  // Title case, but connectors stay lower: "Chief of Staff", not "Chief Of Staff".
  return cleaned
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ")
    .slice(0, ROLE_LIMIT);
}

// --- helpers ---------------------------------------------------------------

// The brain card is an instruction sheet addressed to the member, so every
// "you" in it means the member: "You escalate to the lead when a task is
// blocked". The introduction is the member speaking, so quoting the card
// verbatim had it telling the user what the user does. Longest forms first,
// so "you are" is not eaten by "you".
const SECOND_PERSON = Object.freeze([
  [/\byou\s+are\b/gi, "I am"],
  [/\byou\s+were\b/gi, "I was"],
  [/\byou're\b/gi, "I'm"],
  [/\byou've\b/gi, "I've"],
  [/\byou'll\b/gi, "I'll"],
  [/\byou'd\b/gi, "I'd"],
  [/\byourself\b/gi, "myself"],
  [/\byours\b/gi, "mine"],
  [/\byour\b/gi, "my"],
  [/\byou\b/gi, "I"],
]);

/**
 * A sentence written to the member, said by the member. Text with no second
 * person in it comes back untouched, so a card written in the third person is
 * left exactly as it was.
 */
export function inMemberVoice(value) {
  let out = text(value);
  if (!out) return "";
  for (const [pattern, replacement] of SECOND_PERSON) out = out.replace(pattern, replacement);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// The other two shapes a brain card is written in, neither of which is a
// sentence the member could say.
//
// A purpose is often an infinitive phrase: "To be the single control point
// for all squad work". Quoted straight into the introduction that is a
// fragment sitting between two complete sentences.
//
// An escalation rule is usually an order: "Stop and ask the lead when
// priorities conflict". Quoted straight, the member appears to be telling the
// person what to do. The verbs that open these rules are few and they are
// listed rather than guessed, because prefixing "I" to a sentence that does
// not start with a bare verb produces something worse than the original.
const INSTRUCTION_VERBS = new Set([
  "stop",
  "ask",
  "escalate",
  "raise",
  "flag",
  "notify",
  "check",
  "confirm",
  "defer",
  "pause",
  "report",
  "request",
  "hand",
  "surface",
  "alert",
  "consult",
]);

/** A configuration line turned into something the member could say aloud. */
export function asMemberSpeech(value, copy = {}) {
  const line = inMemberVoice(value);
  if (!line) return "";
  const words = line.split(/\s+/);
  const lead = words[0].toLowerCase().replace(/[^a-z']/g, "");
  if (lead === "to" && words.length > 2) {
    const rest = line.slice(line.indexOf(" ") + 1);
    return `${copy.introHereTo || "I'm here to"} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  if (INSTRUCTION_VERBS.has(lead)) {
    return `I ${lead}${line.slice(words[0].length)}`;
  }
  return line;
}

function restatesRole(purpose, role) {
  const key = (value) => String(value || "").toLowerCase().replace(/^(?:a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const left = key(purpose);
  const right = key(role);
  return Boolean(right) && left.startsWith(right);
}

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function readable(skill) {
  const raw = typeof skill === "string" ? skill : skill?.name || skill?.id || "";
  return String(raw).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function folderName(workspace) {
  const path = text(workspace);
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function firstSentence(value) {
  if (!value) return "";
  const first = value.split(/(?<=[.!?])\s/)[0].trim();
  return first.length > 4 ? first : "";
}

function list(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
