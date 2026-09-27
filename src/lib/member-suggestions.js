// What to ask a member when you open its chat.
//
// The prompts are built from that member's own role, skills and workspace, so
// a data engineer is asked about its pipelines rather than about responsive
// layout. They interpolate rather than enumerate: three shapes that make
// sense for any role beat a per-role list nobody maintains.
//
// Pure: no React, no DOM, so scripts/check-member-suggestions.mjs can import
// it from Node. See docs/adrs/ADR-0032-member-suggestions.md.

export const SUGGESTION_LIMIT = 3;

/** "react-component-architecture" -> "react component architecture". */
export function readableSkill(skill) {
  const raw = typeof skill === "string" ? skill : skill?.name || skill?.id || "";
  return String(raw).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Three prompts for this member. Always three, always sentences, never a
 * placeholder: a member with nothing configured falls back to asks that work
 * for anyone.
 */
export function suggestionsFor(agent) {
  const source = agent && typeof agent === "object" ? agent : {};
  const role = clean(source.role) || "squad member";
  const skills = (Array.isArray(source.skills) ? source.skills : []).map(readableSkill).filter(Boolean);
  const project = projectName(source.workspace);
  const where = project ? ` in ${project}` : "";
  const first = skills[0] || "";
  const second = skills[1] || first;

  const asks = [];
  if (first) {
    asks.push(`Look${where ? ` at ${project}` : " at this project"} and tell me the three things most worth fixing for ${first}.`);
  }
  asks.push(`As a ${role}, what would you take ownership of${where}? Start with what worries you most.`);
  if (second) {
    asks.push(`Find the weakest part of ${project || "this project"} for ${second}, then fix it and show me the change.`);
  }
  // Fillers, in order, for a member with few or no skills.
  asks.push(`Walk me through${where || " this project"} the way a ${role} would read it.`);
  asks.push(`What would you change first${where}, and what would you leave alone?`);
  return asks.slice(0, SUGGESTION_LIMIT);
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The folder name, which is what a person calls the project. */
function projectName(workspace) {
  const path = clean(workspace);
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
