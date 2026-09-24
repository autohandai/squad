// Squad recruiting and role suggestion: pure functions over folder profiles
// (server/workspace-profile.mjs), role templates, and members. See ADR-0015.

/** Needs a role serves, by role template id / member employeeType. */
export const ROLE_NEEDS = {
  "frontend-developer": ["frontend"],
  "backend-engineer": ["backend", "data"],
  "full-stack-developer": ["frontend", "backend"],
  "mobile-developer": ["mobile"],
  "ux-ui-designer": ["frontend"],
  "solution-architect": ["backend", "docs"],
  "devops-engineer": ["infra"],
  "platform-engineer": ["infra"],
  "security-engineer": ["security"],
  "ai-engineer": ["ai"],
  "scrum-master": [],
  "technical-writer": ["docs"],
  "common-qa-engineer": ["tests"],
  "product-manager": [],
  "data-analyst": ["data"],
  "content-operations-specialist": ["docs"],
};

const ROLE_KEYWORDS = [
  [/front|ui|ux|design|web/i, ["frontend"]],
  [/back|api|server|service/i, ["backend"]],
  [/full[- ]?stack/i, ["frontend", "backend"]],
  [/mobile|ios|android|flutter|react native/i, ["mobile"]],
  [/devops|platform|infra|sre|release|ci|deploy|cloud/i, ["infra"]],
  [/qa|test|quality/i, ["tests"]],
  [/doc|writer|content/i, ["docs"]],
  [/data|analyst|analytics|sql/i, ["data"]],
  [/secur|auth/i, ["security"]],
  [/\bai\b|ml|machine learning|llm|agent/i, ["ai"]],
];

export const NEED_HELP = {
  frontend: "the UI",
  backend: "the service code",
  mobile: "the mobile app",
  infra: "the Dockerfile and CI",
  tests: "the test suite",
  docs: "the docs",
  data: "the data layer",
  security: "auth and security",
  ai: "the AI integration",
};

/** Needs served by a member or role template. */
export function needsServedBy(subject) {
  const typeId = String(subject?.employeeType || subject?.id || "").trim();
  if (ROLE_NEEDS[typeId]) return [...ROLE_NEEDS[typeId]];
  const text = `${subject?.role || ""} ${subject?.title || ""}`;
  const found = new Set();
  for (const [pattern, needs] of ROLE_KEYWORDS) {
    if (pattern.test(text)) needs.forEach((need) => found.add(need));
  }
  return [...found];
}

/** Needs raised by a set of folder profiles, deduplicated in profile order. */
export function needsOf(profiles = []) {
  const set = new Set();
  for (const profile of profiles) for (const need of profile?.needs || []) set.add(need);
  return [...set];
}

/**
 * Rank role templates for a folder profile. Templates serving more of the
 * folder's needs come first; ties keep the template order. With no signal,
 * a sensible default order applies.
 */
export function suggestRoles(profile, templates = [], limit = 3) {
  const needs = new Set(profile?.needs || []);
  const defaults = ["full-stack-developer", "frontend-developer", "backend-engineer", "devops-engineer", "common-qa-engineer"];
  const scored = templates.map((template, index) => {
    const own = needsServedBy(template);
    const served = own.filter((need) => needs.has(need));
    const fallback = defaults.indexOf(template.id);
    // A specialist whose primary need is the folder's beats a generalist
    // that merely covers it among others.
    const primary = own.length && needs.has(own[0]) ? 1 : 0;
    return { template, served, score: served.length, primary, index, fallback: fallback === -1 ? defaults.length : fallback };
  });
  scored.sort((a, b) => b.score - a.score || b.primary - a.primary || a.fallback - b.fallback || a.index - b.index);
  return scored.slice(0, limit).map(({ template, served }) => ({ template, needs: served }));
}

/**
 * Members worth inviting to a channel: candidates (not already members) who
 * serve a need the channel's projects raise and no current member covers.
 */
export function proposeMembers({ projects = [], members = [], candidates = [], limit = 2 } = {}) {
  const profiles = projects.map((project) => project.profile).filter(Boolean);
  const raised = needsOf(profiles);
  if (!raised.length) return [];
  const covered = new Set(members.flatMap((member) => needsServedBy(member)));
  const uncovered = raised.filter((need) => !covered.has(need));
  if (!uncovered.length) return [];
  const memberIds = new Set(members.map((member) => member.id));
  const proposals = [];
  for (const candidate of candidates) {
    if (!candidate?.id || memberIds.has(candidate.id)) continue;
    if (["offline", "archived", "disabled"].includes(String(candidate.status || ""))) continue;
    const served = needsServedBy(candidate).filter((need) => uncovered.includes(need));
    if (!served.length) continue;
    const project = projects.find((item) => (item.profile?.needs || []).some((need) => served.includes(need))) || projects[0];
    proposals.push({ agent: candidate, needs: served, project, signature: signatureOf(projects) });
  }
  proposals.sort((a, b) => b.needs.length - a.needs.length || String(a.agent.name).localeCompare(String(b.agent.name)));
  // Each need is proposed once: the best candidate for it wins.
  const taken = new Set();
  return proposals
    .filter((proposal) => {
      const fresh = proposal.needs.filter((need) => !taken.has(need));
      if (!fresh.length) return false;
      fresh.forEach((need) => taken.add(need));
      proposal.needs = fresh;
      return true;
    })
    .slice(0, limit);
}

export function signatureOf(projects = []) {
  return projects
    .map((project) => project.profile?.signature || "")
    .filter(Boolean)
    .sort()
    .join("+");
}

export function proposalKey(channelId, agentId, signature) {
  return `${channelId}|${agentId}|${signature}`;
}

export function joinList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join("");
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

/** "Kai wants to join #client-abc — DevOps engineer." + reason sentence. */
export function proposalCopy(proposal, channelName) {
  const name = proposal.agent.name;
  const role = String(proposal.agent.role || "").trim();
  const help = joinList(proposal.needs.map((need) => NEED_HELP[need] || need));
  const where = proposal.project?.name ? ` in ${proposal.project.name}` : "";
  return {
    title: `${name} wants to join #${channelName}${role ? ` — ${role}` : ""}`,
    body: `${name} can help with ${help}${where}; nobody in the channel covers that yet.`,
  };
}

/** The drafted first message for a brand-new teammate. */
export function firstPromptFor(role, folderName, summary = "") {
  const what = summary ? summary.replace(/\.$/, "").replace(/^An? /, "") : "this project";
  return `Walk me through ${folderName || "this folder"} (${what}) and tell me what you'd tackle first as ${articleFor(role)} ${role}.`;
}

function articleFor(word) {
  return /^[aeiou]/i.test(String(word || "")) ? "an" : "a";
}
