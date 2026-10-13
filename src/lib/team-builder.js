// A team from an objective, and the non-blocking build that creates it.
//
// "Marketing team for our NZ launch" becomes a proposal: three to five
// members with a name, a role title, one line of purpose and suggested
// skills, a lead, a channel and one or two routines that arrive paused. The
// proposal is deterministic. The member mix comes from a small table of
// objective kinds; each role is either a built-in role template
// (src/lib/member-profiles.js, which carries the instructions, brain card,
// personality and catalog skills New member already uses) or a custom role
// shaped by the same generator New member falls back to
// (src/lib/member-draft.js). Nothing here invents a second member designer.
//
// The proposal becomes a team file (src/lib/teams.js), so a team made from
// an objective and a team loaded from a template take the same path: the
// browser prepares the members one at a time through the app's confirmed
// creation, then the bridge adds the channel, the paused routines and the
// connectors (off) in one import call. The build record below is what the
// directory shows while that happens, and what survives a reload.
//
// Pure: no React, no DOM, no Node. scripts/check-team-builder.mjs proves it.
// See docs/adrs/ADR-0118-team-builder-and-templates.md.

import { draftFromDescription, editDraftRole } from "./member-draft.js";
import { memberDraftFromRecord, slug, uniqueName } from "./teams.js";

export const TEAM_BUILDS_STORAGE_KEY = "autohandSquad.v1.teamBuilds";
export const TEAM_CHANNEL_SECTION = "Teams";
export const PROPOSAL_MEMBER_RANGE = Object.freeze({ min: 3, max: 5 });
export const OBJECTIVE_LIMIT = 600;

// Names a proposal draws from, in rotation per role. None is a built-in
// seed member's name, so a fresh squad never gets a "Noah 2" on its first team.
const NAME_POOL = Object.freeze(["Maya", "Kai", "Theo", "Zara", "Rumi", "Ezra", "Nina", "Omar", "Sage", "Tane", "Aroha", "Finn", "Mila", "Jules", "Remy", "Wren", "Leo", "Ava", "Iris", "Noah"]);

// The member mix per objective kind. A `template` names a role template id;
// a `role` without one is a custom role whose instructions and brain card
// come from member-draft's fallback. The first member leads unless another
// says `lead: true`. Skills are catalog slugs the role templates already use.
const KITS = Object.freeze([
  {
    id: "marketing",
    match: /\b(marketing|campaign|launch|brand|growth|awareness|go[- ]to[- ]market|gtm|newsletter|social media)\b/i,
    label: "Marketing team",
    members: [
      { role: "Marketing Lead", purpose: "Owns the plan, the message and the weekly numbers.", skills: ["product-marketing-context", "content-strategy", "analytics-tracking"], lead: true },
      { template: "content-operations-specialist", purpose: "Turns the plan into posts, pages and emails on a calendar." },
      { role: "SEO Specialist", purpose: "Keeps the launch findable: keywords, pages and the technical checks.", skills: ["seo-audit", "content-strategy", "web-design-guidelines"] },
      { template: "data-analyst", purpose: "Reports what moved each week and what did not." },
    ],
    routines: [
      { member: 0, title: "Weekly status", instructions: "Summarise last week's campaign work, the numbers that moved, and the three things to do next. Post it in the team channel.", schedule: { kind: "weekdays", days: [1], time: "09:00" } },
      { member: 1, title: "Next week's content calendar", instructions: "Draft next week's content calendar from the plan: one row per piece with channel, audience, draft owner and due day.", schedule: { kind: "weekdays", days: [5], time: "15:00" } },
    ],
  },
  {
    id: "seo",
    match: /\b(seo|search (?:ranking|traffic|console)|organic|keywords?|backlinks?)\b/i,
    label: "SEO team",
    members: [
      { role: "SEO Strategist", purpose: "Sets the keyword map and decides which pages to build or fix first.", skills: ["seo-audit", "content-strategy", "analytics-tracking"], lead: true },
      { template: "content-operations-specialist", purpose: "Writes and refreshes the pages the map calls for." },
      { template: "technical-writer", purpose: "Keeps the docs and reference pages crawlable and accurate." },
      { template: "frontend-developer", purpose: "Fixes the technical findings: speed, structure, metadata." },
    ],
    routines: [
      { member: 0, title: "Weekly ranking and crawl review", instructions: "Review ranking changes and crawl issues for the tracked keywords and pages. List the three largest moves and one fix per move.", schedule: { kind: "weekdays", days: [1], time: "08:00" } },
      { member: 1, title: "Monthly content gap audit", instructions: "Compare the keyword map with the pages that exist and propose the five pages most worth writing next, with a one-line brief each.", schedule: { kind: "monthly", day: 1, time: "09:00" } },
    ],
  },
  {
    id: "sales",
    match: /\b(sales|leads?|prospects?|pipeline|outreach|crm|demos?|deals?)\b/i,
    label: "Sales team",
    members: [
      { role: "Lead Researcher", purpose: "Finds and qualifies the accounts worth talking to.", skills: ["data-analysis", "product-marketing-context"], lead: true },
      { role: "Outreach Writer", purpose: "Writes the first message and the follow-ups, one per account.", skills: ["content-strategy", "technical-writing"] },
      { template: "data-analyst", purpose: "Keeps the pipeline numbers honest week to week." },
    ],
    routines: [
      { member: 0, title: "Daily lead list refresh", instructions: "Refresh the lead list: add newly qualified accounts, retire dead ones, and note why for each change.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "08:00" } },
      { member: 2, title: "Weekly pipeline summary", instructions: "Summarise the pipeline by stage with the week-over-week change and the accounts that stalled.", schedule: { kind: "weekdays", days: [5], time: "15:00" } },
    ],
  },
  {
    id: "research",
    match: /\b(research|competitor|competitive|market (?:analysis|study)|watch|monitor|landscape|benchmark)\b/i,
    label: "Research team",
    members: [
      { role: "Research Lead", purpose: "Decides what is worth watching and keeps the findings in one place.", skills: ["data-analysis", "documentation-writing"], lead: true },
      { template: "data-analyst", purpose: "Turns what was found into numbers and trends." },
      { template: "technical-writer", purpose: "Writes the digest people read." },
    ],
    routines: [{ member: 0, title: "Weekly digest", instructions: "Write the weekly digest: what changed, why it matters, and what to do about it, with sources.", schedule: { kind: "weekdays", days: [1], time: "09:00" } }],
  },
  {
    id: "support",
    match: /\b(support|inbox|email|customers?|tickets?|follow[- ]?ups?|helpdesk|replies)\b/i,
    label: "Support team",
    members: [
      { role: "Support Lead", purpose: "Owns the queue: what gets answered first and how.", skills: ["technical-writing", "documentation-writing"], lead: true },
      { template: "technical-writer", purpose: "Turns repeated answers into docs." },
      { template: "common-qa-engineer", purpose: "Reproduces reported problems and files what is real." },
    ],
    routines: [
      { member: 0, title: "Daily follow-up sweep", instructions: "List every conversation waiting on us for more than a day, draft a reply for each, and flag the ones that need a person.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00" } },
      { member: 1, title: "Weekly unanswered-questions report", instructions: "Group the week's questions by topic, count them, and propose one doc or fix per topic that would remove the question.", schedule: { kind: "weekdays", days: [5], time: "16:00" } },
    ],
  },
  {
    id: "security",
    match: /\b(security|vulnerab|pentest|threat|compliance|audit|secrets?)\b/i,
    label: "Security team",
    members: [
      { template: "security-engineer", purpose: "Finds the risk that matters and says how to close it.", lead: true },
      { template: "devops-engineer", purpose: "Hardens the pipeline and the runtime." },
      { template: "common-qa-engineer", purpose: "Proves fixes with evidence." },
    ],
    routines: [{ member: 0, title: "Weekly dependency and secret review", instructions: "Review new dependencies and recent changes for exposed secrets or risky patterns; report findings with severity and a fix.", schedule: { kind: "weekdays", days: [1], time: "09:00" } }],
  },
  {
    id: "mobile",
    match: /\b(mobile|ios|android|app store|play store|swift|kotlin|react native|flutter)\b/i,
    label: "Mobile team",
    members: [
      { template: "mobile-developer", purpose: "Builds and ships the app.", lead: true },
      { template: "ux-ui-designer", purpose: "Shapes the screens before they are built." },
      { template: "backend-engineer", purpose: "Keeps the API the app depends on stable." },
      { template: "common-qa-engineer", purpose: "Tests on real devices and sizes." },
    ],
    routines: [{ member: 0, title: "Daily build and crash check", instructions: "Check the latest build, open crashes and failing device tests; summarise what blocks a release.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00" } }],
  },
  {
    id: "design",
    match: /\b(design|ux|ui|figma|prototype|redesign|visual|accessib)\b/i,
    label: "Design team",
    members: [
      { template: "product-manager", purpose: "Frames the problem and the acceptance criteria.", lead: true },
      { template: "ux-ui-designer", purpose: "Designs the flows and the screens." },
      { template: "frontend-developer", purpose: "Builds what was designed, pixel by pixel." },
      { template: "common-qa-engineer", purpose: "Checks it on real screens." },
    ],
    routines: [{ member: 1, title: "Weekly design review", instructions: "Review what shipped this week against the designs and list the differences worth fixing.", schedule: { kind: "weekdays", days: [4], time: "14:00" } }],
  },
  {
    id: "data",
    match: /\b(data|analytics|dashboards?|metrics|warehouse|etl|sql|reporting)\b/i,
    label: "Data team",
    members: [
      { template: "data-analyst", purpose: "Answers the questions with the data we have.", lead: true },
      { template: "backend-engineer", purpose: "Builds and fixes the pipelines that feed the numbers." },
      { template: "technical-writer", purpose: "Documents what each metric means." },
    ],
    routines: [{ member: 0, title: "Weekly metrics review", instructions: "Review the week's key metrics against the previous week; explain each notable change and flag anything that looks like a data problem.", schedule: { kind: "weekdays", days: [1], time: "09:00" } }],
  },
  {
    id: "ai",
    match: /\b(ai|llm|agents?|prompts?|model|machine learning|rag|evals?)\b/i,
    label: "AI team",
    members: [
      { template: "ai-engineer", purpose: "Designs the behaviour and measures it.", lead: true },
      { template: "backend-engineer", purpose: "Wires the model into the product." },
      { template: "common-qa-engineer", purpose: "Runs the evals and reports regressions." },
      { template: "technical-writer", purpose: "Documents the contracts and the limits." },
    ],
    routines: [{ member: 2, title: "Daily eval run", instructions: "Run the evaluation set, compare with yesterday, and report any regression with the failing cases.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "07:00" } }],
  },
  {
    id: "engineering",
    match: /\b(engineering|engineers?|developers?|build|ship|code|software|api|backend|frontend|platform|infra|devops|release|refactor|migrat)\b/i,
    label: "Engineering team",
    members: [
      { template: "solution-architect", purpose: "Maps the system and records the decisions.", lead: true },
      { template: "full-stack-developer", purpose: "Ships the slices end to end." },
      { template: "common-qa-engineer", purpose: "Keeps the suite green and the evidence clear." },
      { template: "devops-engineer", purpose: "Keeps builds, releases and environments repeatable." },
    ],
    routines: [
      { member: 3, title: "Daily CI and open PR review", instructions: "Review failing CI runs and open pull requests; summarise what is blocked and what can merge today.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00" } },
      { member: 0, title: "Weekly architecture notes", instructions: "Write up this week's technical decisions as short decision records and list the open questions.", schedule: { kind: "weekdays", days: [5], time: "16:00" } },
    ],
  },
]);

const DEFAULT_KIT = Object.freeze({
  id: "general",
  label: "Team",
  members: [
    { template: "product-manager", purpose: "Turns the objective into acceptance criteria and sequence.", lead: true },
    { template: "full-stack-developer", purpose: "Does the work across every layer." },
    { template: "common-qa-engineer", purpose: "Proves what was done." },
    { template: "technical-writer", purpose: "Writes down what changed and why." },
  ],
  routines: [{ member: 0, title: "Weekly status", instructions: "Summarise last week's progress on the objective, what is blocked, and the three things to do next.", schedule: { kind: "weekdays", days: [1], time: "09:00" } }],
});

function clean(value, limit = OBJECTIVE_LIMIT) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function hash(value) {
  let out = 7;
  for (const char of String(value)) out = (out * 31 + char.charCodeAt(0)) >>> 0;
  return out;
}

/** The objective kind this text asks for; the general kit when none matches. */
export function kitForObjective(objective) {
  const text = clean(objective);
  return KITS.find((kit) => kit.match.test(text)) || DEFAULT_KIT;
}

/**
 * The team's name from the objective: "Marketing team for our NZ launch"
 * becomes "Marketing team"; a sentence that names no team gets the kit's
 * label.
 */
export function teamNameFromObjective(objective, kit = kitForObjective(objective)) {
  const text = clean(objective, 200);
  const match = text.match(/^(?:an?\s+|the\s+|our\s+|new\s+)?([A-Za-z][A-Za-z&/ -]{1,40}?)\s+(team|squad|crew|group)\b/i);
  if (match) {
    const head = match[1].trim();
    return `${head.charAt(0).toUpperCase()}${head.slice(1)} ${match[2].toLowerCase()}`;
  }
  return kit.label;
}

/** The channel a team talks in: "Marketing team" → "marketing-team". */
export function channelNameForTeam(teamName) {
  return slug(teamName, 40) === "item" ? "team" : slug(teamName, 40);
}

/**
 * The proposal for an objective. Deterministic: the same objective and the
 * same existing names give the same team. `roleTemplates` is the built-in
 * role list (src/lib/member-profiles.js) so the browser and the check share
 * one source of instructions, brain cards and catalog skills.
 */
export function proposeTeam({ objective = "", name = "", roleTemplates = [], existingNames = [] } = {}) {
  const text = clean(objective);
  const kit = kitForObjective(text);
  const teamName = clean(name, 80) || teamNameFromObjective(text, kit);
  const templateById = new Map(roleTemplates.map((template) => [template.id, template]));
  const taken = [...existingNames];
  const members = kit.members.slice(0, PROPOSAL_MEMBER_RANGE.max).map((entry, index) => {
    const template = entry.template ? templateById.get(entry.template) || null : null;
    const role = template ? template.title : entry.role;
    const seed = hash(`${kit.id}:${index}:${role}`);
    // Walk the pool from a role-specific start so two roles rarely share a
    // name, then let uniqueName number a collision with the existing squad.
    let candidate = NAME_POOL[seed % NAME_POOL.length];
    for (let step = 0; step < NAME_POOL.length && taken.some((item) => item.toLowerCase() === candidate.toLowerCase()); step += 1) {
      candidate = NAME_POOL[(seed + step + 1) % NAME_POOL.length];
    }
    const memberName = uniqueName(candidate, taken);
    taken.push(memberName);
    return {
      key: `${slug(role)}-${index + 1}`,
      name: memberName,
      role,
      templateId: template ? template.id : "",
      purpose: entry.purpose,
      skills: template ? [...(template.skills || [])] : [...(entry.skills || [])],
      selected: true,
    };
  });
  const leadIndex = Math.max(0, kit.members.findIndex((entry) => entry.lead));
  const channel = { name: channelNameForTeam(teamName), section: TEAM_CHANNEL_SECTION };
  const routines = (kit.routines || []).slice(0, 2).map((routine) => ({
    memberKey: members[routine.member]?.key || members[0].key,
    title: routine.title,
    instructions: routine.instructions,
    schedule: { ...routine.schedule },
  }));
  return { kind: kit.id, name: teamName, objective: text, members, leadKey: members[leadIndex]?.key || members[0]?.key || "", channel, routines };
}

/** The proposal with a member's name or selection, or the lead, changed. */
export function updateProposal(proposal, patch) {
  const next = { ...proposal, members: proposal.members.map((member) => ({ ...member })) };
  if (patch.name !== undefined) next.name = clean(patch.name, 80);
  if (patch.leadKey !== undefined && next.members.some((member) => member.key === patch.leadKey)) next.leadKey = patch.leadKey;
  if (patch.member) {
    const member = next.members.find((item) => item.key === patch.member.key);
    if (member) {
      if (patch.member.name !== undefined) member.name = clean(patch.member.name, 60);
      if (patch.member.selected !== undefined) member.selected = Boolean(patch.member.selected);
    }
  }
  if (next.name) next.channel = { ...next.channel, name: channelNameForTeam(next.name) };
  // The lead must be someone who is being created.
  const selected = next.members.filter((member) => member.selected);
  if (!selected.some((member) => member.key === next.leadKey)) next.leadKey = selected[0]?.key || "";
  return next;
}

/** What is wrong with a proposal, or [] when it can be added. */
export function proposalProblems(proposal) {
  const problems = [];
  const selected = (proposal?.members || []).filter((member) => member.selected);
  if (!clean(proposal?.objective)) problems.push("objective");
  if (!clean(proposal?.name, 80)) problems.push("name");
  if (!selected.length) problems.push("members");
  if (selected.some((member) => !clean(member.name, 60))) problems.push("member-name");
  const names = selected.map((member) => member.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) problems.push("duplicate-name");
  return problems;
}

function teamBrief(proposal, selected) {
  const lead = selected.find((member) => member.key === proposal.leadKey);
  const roster = selected.map((member) => `${member.name} (${member.role}${lead && member.key === lead.key ? ", leads" : ""})`).join(", ");
  return [
    `You are part of the ${proposal.name} team. Objective: ${proposal.objective}`,
    `Teammates: ${roster}. Coordinate in #${proposal.channel.name}; ${lead ? `${lead.name} sets priorities and resolves conflicts` : "the team agrees priorities in the channel"}.`,
  ].join("\n");
}

/**
 * The member records the proposal creates, in the shape the team file holds
 * (src/lib/teams.js `memberExportRecord`), so the proposal can be imported,
 * shared and shown by the same code as a template.
 */
export function proposalMemberRecords(proposal, roleTemplates = []) {
  const templateById = new Map(roleTemplates.map((template) => [template.id, template]));
  const selected = proposal.members.filter((member) => member.selected);
  const brief = teamBrief(proposal, selected);
  return selected.map((member) => {
    const template = member.templateId ? templateById.get(member.templateId) : null;
    if (template) {
      return {
        key: member.key,
        name: member.name,
        role: template.title,
        description: member.purpose,
        instructions: `${template.starter || `Act as ${template.title}.`}\n\n${brief}`,
        brainCard: { ...(template.brainCard || {}), purpose: member.purpose },
        look: { avatar: "", employeeType: template.id },
        skills: member.skills,
        harness: { id: "autohand" },
      };
    }
    // A custom role is shaped by New member's own fallback generator.
    const draft = editDraftRole(draftFromDescription(`${member.role}. ${member.purpose}`), member.role);
    return {
      key: member.key,
      name: member.name,
      role: member.role,
      description: member.purpose,
      instructions: `Act as ${member.role}. ${member.purpose}\n\n${brief}`,
      brainCard: { ...draft.brainCard, purpose: member.purpose },
      look: { avatar: "", employeeType: "" },
      skills: member.skills,
      harness: { id: "autohand" },
    };
  });
}

/**
 * The team file for a proposal: members, one public channel with everyone
 * in it, the routines (paused on import), the lead. Validated by
 * `validateTeamFile` like any file, so the same import creates it.
 */
export function teamDocumentFromProposal(proposal, { roleTemplates = [], app = "" } = {}) {
  const members = proposalMemberRecords(proposal, roleTemplates);
  const byKey = new Map(members.map((member) => [member.key, member]));
  const lead = byKey.get(proposal.leadKey);
  return {
    format: "autohand.squad-team",
    version: 1,
    kind: "team",
    team: { name: proposal.name, description: proposal.objective, lead: lead ? lead.name : "", exportedAt: "", app },
    members,
    skills: [],
    channels: [{ name: proposal.channel.name, visibility: "public", section: proposal.channel.section, members: members.map((member) => member.name) }],
    workflows: [],
    presets: [],
    routines: proposal.routines
      .filter((routine) => byKey.has(routine.memberKey))
      .map((routine) => ({ member: byKey.get(routine.memberKey).name, title: routine.title, instructions: routine.instructions, schedule: routine.schedule })),
    connectors: [],
  };
}

// --- templates --------------------------------------------------------------

/** One line of meta for a template row: "4 members · 2 routines · needs GitHub". */
export function templateMeta(document) {
  const members = document?.members?.length || 0;
  const routines = document?.routines?.length || 0;
  const parts = [`${members} ${members === 1 ? "member" : "members"}`];
  if (routines) parts.push(`${routines} ${routines === 1 ? "routine" : "routines"}`);
  const needs = (document?.connectors || []).map((connector) => connector.name).filter(Boolean);
  if (needs.length) parts.push(`needs ${needs.join(", ")}`);
  return parts.join(" · ");
}

/** The chips under a template's title: who leads, what it creates, what stays off. */
export function templateFacts(document) {
  const facts = [];
  if (document?.team?.lead) facts.push(`${document.team.lead} leads`);
  const channels = document?.channels?.length || 0;
  if (channels) facts.push(`${channels} ${channels === 1 ? "channel" : "channels"}`);
  const routines = document?.routines?.length || 0;
  if (routines) facts.push(`${routines} paused ${routines === 1 ? "routine" : "routines"}`);
  const connectors = document?.connectors?.length || 0;
  if (connectors) facts.push(`${connectors} ${connectors === 1 ? "connection" : "connections"} off`);
  const skills = document?.skills?.length || 0;
  if (skills) facts.push(`${skills} ${skills === 1 ? "skill" : "skills"}`);
  return facts;
}

/** Template rows that match a search, by name, purpose, member role or connector. */
export function filterTemplates(templates = [], query = "") {
  const needle = clean(query, 80).toLowerCase();
  if (!needle) return templates;
  return templates.filter((template) => {
    const document = template.document || {};
    const haystack = [
      template.name,
      document.team?.name,
      document.team?.description,
      ...(document.members || []).map((member) => `${member.name} ${member.role}`),
      ...(document.connectors || []).map((connector) => connector.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

// --- the build record ---------------------------------------------------------

export const BUILD_MEMBER_STATUSES = Object.freeze(["preparing", "ready", "failed", "interrupted"]);
export const BUILD_STATUSES = Object.freeze(["preparing", "finishing", "ready", "failed", "bridge-failed", "interrupted"]);

export function createBuildId(now = Date.now(), random = Math.random) {
  return `build_${now.toString(36)}${Math.floor(random() * 1e6).toString(36)}`;
}

/**
 * The record of one team being added. `plan` is the bridge's import plan for
 * the document (names already made unique); `drafts` map a member key to the
 * draft `createAgent` takes, with `id` the member id it will get. `trusted`
 * says whether the members came from the app itself (an objective or a
 * built-in template: skills on, default permissions) or from a file on disk
 * (skills off, Ask level), the Import team rule.
 */
export function createTeamBuild({ id = createBuildId(), document, plan, drafts, memberIds, trusted = false, source = "objective", now = new Date().toISOString() }) {
  return {
    id,
    name: plan?.team || document?.team?.name || "Team",
    source,
    trusted,
    status: "preparing",
    startedAt: now,
    updatedAt: now,
    error: "",
    document,
    members: (plan?.members || []).map((member) => ({
      key: member.key,
      id: memberIds?.[member.key] || "",
      name: member.name,
      role: member.draft?.role || "",
      status: "preparing",
      error: "",
      draft: drafts?.[member.key] || member.draft,
    })),
    channels: [],
    routines: [],
    connectors: [],
  };
}

export function patchBuild(builds, id, patch) {
  return builds.map((build) => (build.id === id ? { ...build, ...patch, updatedAt: new Date().toISOString() } : build));
}

export function patchBuildMember(builds, id, key, patch) {
  return builds.map((build) =>
    build.id === id ? { ...build, updatedAt: new Date().toISOString(), members: build.members.map((member) => (member.key === key ? { ...member, ...patch } : member)) } : build
  );
}

/** Builds saved before a reload: anything still "preparing" was interrupted. */
export function resumeBuilds(saved) {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((build) => build && typeof build === "object" && build.id && Array.isArray(build.members))
    .map((build) => {
      const members = build.members.map((member) => (member.status === "preparing" ? { ...member, status: "interrupted", error: "Preparation was interrupted." } : member));
      const status = ["preparing", "finishing"].includes(build.status) ? "interrupted" : build.status;
      return { ...build, members, status, error: status === "interrupted" && !build.error ? "Preparation was interrupted on this device." : build.error || "" };
    });
}

/** The members a build still shows in the directory: everyone not yet ready. */
export function pendingBuildMembers(build) {
  return (build?.members || []).filter((member) => member.status !== "ready");
}

/** "2 of 4 ready", "1 could not be prepared". */
export function buildProgress(build) {
  const members = build?.members || [];
  const ready = members.filter((member) => member.status === "ready").length;
  const failed = members.filter((member) => member.status === "failed").length;
  const interrupted = members.filter((member) => member.status === "interrupted").length;
  return { total: members.length, ready, failed, interrupted, preparing: members.length - ready - failed - interrupted };
}

/** The bridge event raised when a build ends; the feed turns it into one notification. */
export function buildFinishedEvent(build) {
  const progress = buildProgress(build);
  const failed = build.status === "failed" || build.status === "bridge-failed";
  return {
    name: "team.built",
    status: failed ? "failed" : "completed",
    team: build.name,
    memberCount: progress.ready,
    failedCount: progress.failed + progress.interrupted,
    channels: (build.channels || []).map((channel) => channel.name),
    routines: (build.routines || []).length,
    error: failed ? String(build.error || "") : "",
  };
}

/** A draft `createAgent` accepts for a member in a document, trusted or not. */
export function buildMemberDraft(member, name, { trusted = false } = {}) {
  const draft = memberDraftFromRecord(member, name);
  if (trusted) {
    // The app's own proposals and built-in templates switch their catalog
    // skills on, like a role picked in New member.
    draft.skills = [...member.skills];
    draft.importedSkills = [];
  }
  draft.employeeType = member.look?.employeeType || "";
  return draft;
}
