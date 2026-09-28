import { roleFromDescription } from "./member-introduction.js";

// Creating a squad member from a sentence.
//
// The shaping rules live here rather than in the create form, so the same
// draft comes out whether a model filled it in or the deterministic fallback
// did, and so a model can never hand back a member the app would choke on.
// Every field is normalised on the way in; nothing downstream has to guard.
//
// Pure: no React, no DOM, so scripts/check-member-draft.mjs can import it
// from Node. See docs/adrs/ADR-0031-member-draft-skill.md.

export const DRAFT_FIELDS = Object.freeze(["name", "role", "description", "instructions", "skills", "brainCard"]);

// The agent that designs members. Not a member of the squad: it answers one
// question with JSON and never runs a tool, so the bridge gives it no MCP
// servers (server.mjs `utilityAgentIds`) and the create screen warms it on
// open. scripts/check-member-draft.mjs holds those two ends together.
export const MEMBER_DESIGNER_ID = "squad-designer";

const NAME_LIMIT = 60;
const ROLE_LIMIT = 80;
const TEXT_LIMIT = 600;
const SKILL_LIMIT = 8;

/** Brain card fields the create form expects; mirrors src/data.js. */
const BRAIN_CARD_FIELDS = Object.freeze(["purpose", "defaultWorkflow", "allowedTools", "escalationRules", "successCriteria"]);

// Enough to produce a sensible member with no model available. Ordered, so
// the first match wins: a description mentioning both tests and security is a
// tester who cares about security, in the order the person said it.
const ROLE_HINTS = Object.freeze([
  { match: /\b(test|tests|testing|qa|e2e|playwright|cypress|regression)\b/i, role: "QA Engineer", name: "Wren", skills: ["end-to-end tests", "regression triage"] },
  { match: /\b(security|vulnerab|threat|pentest|owasp|secrets?)\b/i, role: "Security Reviewer", name: "Vale", skills: ["threat modelling", "dependency review"] },
  { match: /\b(infra|terraform|kubernetes|k8s|deploy|aws|gcp|azure|cost|bill)\b/i, role: "DevOps Engineer", name: "Ridge", skills: ["infrastructure as code", "cost review"] },
  { match: /\b(design|ux|ui|figma|accessib|visual)\b/i, role: "Product Designer", name: "Juno", skills: ["interface review", "accessibility"] },
  { match: /\b(docs?|documentation|write|writing|technical writer)\b/i, role: "Technical Writer", name: "Quill", skills: ["reference docs", "release notes"] },
  { match: /\b(data|sql|analytics|etl|pipeline|warehouse)\b/i, role: "Data Engineer", name: "Delta", skills: ["query review", "pipeline checks"] },
  { match: /\b(review|architecture|design doc|adr)\b/i, role: "Solution Architect", name: "Atlas", skills: ["architecture review", "decision records"] },
  { match: /\b(front-?end|react|vue|css|component)\b/i, role: "Frontend Developer", name: "Pica", skills: ["component work", "interaction polish"] },
  { match: /\b(back-?end|api|server|database|endpoint)\b/i, role: "Backend Developer", name: "Corbin", skills: ["api design", "database work"] },
]);

const GENERIC = Object.freeze({ role: "Squad Member", name: "Nova", skills: ["research", "implementation"] });

/**
 * A complete, usable draft from a free-text description, with no model in the
 * loop. This is what ships when the bridge cannot reach one, and it is the
 * base a model's answer is merged onto.
 */
export function draftFromDescription(description) {
  const text = typeof description === "string" ? description.trim() : "";
  const hint = ROLE_HINTS.find((entry) => entry.match.test(text)) || GENERIC;
  // A description often opens with the job title: "Chief of staff, controls
  // everyone…". Use it rather than calling that member "Squad Member", which
  // is what happened when the model timed out (ADR-0031).
  const stated = roleFromDescription(text);
  const summary = text || "Helps with whatever the squad needs.";
  return normalizeDraft({
    name: hint.name,
    role: stated || hint.role,
    description: summary,
    instructions: text,
    skills: hint.skills,
    brainCard: {
      purpose: summary,
      defaultWorkflow: "Understand the ask, do the work in the workspace, and report what changed.",
      allowedTools: "Reading and editing files in the workspace, and running the project's own commands.",
      escalationRules: "Stop and ask when the change is destructive, outside the workspace, or not what was asked for.",
      successCriteria: "The work is done, the checks pass, and the reply says what changed and why.",
    },
  });
}

/** Every field present, every type correct, every length sane. */
export function normalizeDraft(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const brainCardSource = source.brainCard && typeof source.brainCard === "object" && !Array.isArray(source.brainCard) ? source.brainCard : {};
  const brainCard = {};
  for (const field of BRAIN_CARD_FIELDS) brainCard[field] = line(brainCardSource[field], TEXT_LIMIT);
  return {
    name: line(source.name, NAME_LIMIT),
    role: line(source.role, ROLE_LIMIT),
    description: line(source.description, TEXT_LIMIT),
    instructions: text(source.instructions, TEXT_LIMIT * 2),
    skills: skillList(source.skills),
    brainCard,
  };
}

/**
 * A model's answer laid over the fallback. Anything the model left blank,
 * mistyped or omitted keeps the deterministic value, so the result is always
 * a complete member.
 */
export function mergeModelDraft(fallback, model) {
  const base = normalizeDraft(fallback);
  if (!model || typeof model !== "object" || Array.isArray(model)) return base;
  const candidate = normalizeDraft(model);
  const merged = { ...base };
  for (const field of ["name", "role", "description", "instructions"]) {
    if (candidate[field]) merged[field] = candidate[field];
  }
  if (candidate.skills.length) merged.skills = candidate.skills;
  merged.brainCard = { ...base.brainCard };
  for (const field of BRAIN_CARD_FIELDS) {
    if (candidate.brainCard[field]) merged.brainCard[field] = candidate.brainCard[field];
  }
  return merged;
}

/** What the model is asked for. Strict, small, and quotes the person. */
export function draftInstruction(description) {
  const ask = typeof description === "string" ? description.trim().slice(0, 1200) : "";
  return [
    "Design one member of a small software squad from the request below.",
    "",
    "Request:",
    ask || "(no description given)",
    "",
    "Answer with JSON only, no prose and no code fence, in exactly this shape:",
    '{"name":"","role":"","description":"","instructions":"","skills":[],',
    '"brainCard":{"purpose":"","defaultWorkflow":"","allowedTools":"","escalationRules":"","successCriteria":""}}',
    "",
    "Rules:",
    "- name: one word, a person's name, no title.",
    `- role: a job title of at most ${ROLE_LIMIT} characters.`,
    // The description labels the member everywhere: the directory, the profile
    // header, the channel picker. Saying "instructions" are addressed as "you"
    // pulled the model into the second person for this field too, so it read
    // "You own squad-wide coordination" in a list of members.
    "- description: one sentence about what this member owns, written about the member, never addressed to it as 'you'.",
    "- instructions: how it should work, addressed to the member as 'you'.",
    `- skills: at most ${SKILL_LIMIT} short phrases, lower case, no sentences.`,
    "- brainCard: one sentence per field.",
    "- Base every field on the request. Do not invent a different job.",
  ].join("\n");
}

// --- helpers ---------------------------------------------------------------

function line(value, limit) {
  return text(value, limit).replace(/\s+/g, " ").trim();
}

function text(value, limit) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

function skillList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const skill = line(typeof entry === "string" ? entry : entry?.name, 60);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
    if (out.length >= SKILL_LIMIT) break;
  }
  return out;
}
