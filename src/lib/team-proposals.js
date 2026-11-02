// A team a member proposes from a conversation (ADR-0161).
//
// Chief of Staff, asked to build a team, reached for Autohand Code's own
// create_team/add_teammate, which start processes inside its session and never
// make a Squad member. The route that works is Squad's team builder
// (ADR-0142): the member describes the roster with squad_propose_team, Squad
// shows it under the reply, and the person's "Create team" runs the same
// import as New team. This module shapes the tool's arguments into the
// proposal `teamDocumentFromProposal` (src/lib/team-builder.js) already takes,
// so nothing new creates members.

export const TEAM_PROPOSAL_LIMITS = Object.freeze({ members: 8, name: 80, objective: 600, role: 120, purpose: 600, instructions: 4000, skills: 8, memberName: 60 });

const clean = (value, limit) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const slug = (value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "member";

export class TeamProposalError extends Error {}

// The pinned CLI sometimes delivers each member as a JSON string instead of
// an object; a member may also write "Role: what they own". Both become the
// object form.
function memberEntry(given) {
  if (given && typeof given === "object" && !Array.isArray(given)) return given;
  if (typeof given !== "string") return null;
  const text = given.trim();
  if (text.startsWith("{")) {
    try { return memberEntry(JSON.parse(text)); } catch { return null; }
  }
  const match = text.match(/^(.{2,120}?)\s*(?::|—|–|-)\s+(.+)$/s);
  if (!match) return null;
  const [, role, rest] = match;
  const named = role.match(/^(.+?)\s*\((.+)\)$/);
  return named ? { name: named[1].trim(), role: named[2].trim(), purpose: rest.trim() } : { role: role.trim(), purpose: rest.trim() };
}

function uniqueName(name, taken) {
  const base = name;
  let candidate = base;
  let suffix = 2;
  const lower = (value) => value.trim().toLowerCase();
  while (taken.some((item) => lower(item) === lower(candidate))) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * The proposal for a squad_propose_team call.
 *
 *   raw            { name?, objective, members: [{ name?, role, purpose, skills?, instructions? }], lead? }
 *   existingNames  names already in the squad (members get numbered on collision)
 *   roleTemplates  built-in roles; a role whose title matches takes that template
 *
 * Throws TeamProposalError with a sentence the member can act on.
 */
export function memberTeamProposal(raw, { existingNames = [], roleTemplates = [] } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TeamProposalError("Describe the team as an object with an objective and members.");
  const objective = clean(raw.objective, TEAM_PROPOSAL_LIMITS.objective);
  if (!objective) throw new TeamProposalError("Say what the team is for (objective).");
  const rows = Array.isArray(raw.members) ? raw.members : [];
  if (!rows.length) throw new TeamProposalError("Propose at least one member with a role and what they own.");
  if (rows.length > TEAM_PROPOSAL_LIMITS.members) throw new TeamProposalError(`Propose at most ${TEAM_PROPOSAL_LIMITS.members} members; split a larger organisation into teams.`);
  const templates = roleTemplates.map((template) => ({ id: String(template.id || ""), title: String(template.title || ""), skills: Array.isArray(template.skills) ? template.skills : [] }));
  const taken = [...existingNames.map(String)];
  const keys = new Set();
  const members = rows.map((row, index) => {
    const entry = memberEntry(row);
    if (!entry || typeof entry !== "object") throw new TeamProposalError(`Member ${index + 1} must be an object with a role and purpose, or 'Role: what they own'.`);
    const role = clean(entry.role, TEAM_PROPOSAL_LIMITS.role);
    const purpose = clean(entry.purpose || entry.description || entry.responsibility, TEAM_PROPOSAL_LIMITS.purpose);
    if (!role) throw new TeamProposalError(`Member ${index + 1} needs a role (for example "SOC 2 Auditor").`);
    if (!purpose) throw new TeamProposalError(`${role} needs a purpose: one or two sentences on what they own.`);
    const template = templates.find((item) => item.id === String(entry.template || entry.templateId || "") || item.title.toLowerCase() === role.toLowerCase()) || null;
    const name = uniqueName(clean(entry.name, TEAM_PROPOSAL_LIMITS.memberName) || role, taken);
    taken.push(name);
    let key = clean(entry.key, 80) || `${slug(role)}-${index + 1}`;
    if (keys.has(key)) key = `${key}-${index + 1}`;
    keys.add(key);
    const given = Array.isArray(entry.skills) ? entry.skills.map((skill) => clean(skill, 80)).filter(Boolean) : [];
    return {
      key,
      name,
      role: template ? template.title : role,
      templateId: template ? template.id : "",
      purpose,
      instructions: String(entry.instructions || "").trim().slice(0, TEAM_PROPOSAL_LIMITS.instructions),
      skills: [...new Set(given.length ? given : template?.skills || [])].slice(0, TEAM_PROPOSAL_LIMITS.skills),
      selected: true,
    };
  });
  const name = clean(raw.name, TEAM_PROPOSAL_LIMITS.name) || `${members[0].role} team`;
  const leadKey = members.find((member) => member.key === raw.lead || member.name.toLowerCase() === String(raw.lead || "").trim().toLowerCase() || member.role.toLowerCase() === String(raw.lead || "").trim().toLowerCase())?.key || members[0].key;
  return {
    kind: "member",
    name,
    objective,
    members,
    leadKey,
    channel: { name: slug(name).slice(0, 60), section: "Teams" },
    routines: [],
  };
}

/** The quiet line under the reply, and the receipt's message. */
export function teamProposalSummary(proposal, proposerName = "The member") {
  const roster = proposal.members.map((member) => `${member.name} (${member.role})`).join(", ");
  return `${proposerName} proposes the ${proposal.name} team: ${roster}. Confirm it below to create these members.`;
}

/** The receipts of a reply that carry a team proposal the person has not decided yet. */
export function teamProposalReceipts(channelActions) {
  return (Array.isArray(channelActions) ? channelActions : []).filter((receipt) => receipt?.type === "team" && receipt.status === "proposed" && receipt.proposal?.members?.length);
}
