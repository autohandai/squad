// Sessions started outside Squad (ADR-0127): pure helpers, no React, no DOM,
// so scripts/check-hooks.mjs can import this from Node.

export const EXTERNAL_RUN_MODE = "external";

function within(path, root) {
  const a = String(path || "").replace(/\/+$/, "");
  const b = String(root || "").replace(/\/+$/, "");
  return Boolean(a && b) && (a === b || a.startsWith(`${b}/`));
}

/**
 * An outside session belongs to a member when it ran on the member's engine
 * in one of the member's folders. Several members can match; each sees it.
 */
export function externalRunBelongs(run, agent) {
  if (run?.mode !== EXTERNAL_RUN_MODE || !agent) return false;
  const engine = String(agent?.harness?.id || agent?.harness || "autohand");
  if (run.harness !== engine) return false;
  const roots = [agent.workspace, ...(Array.isArray(agent.projects) ? agent.projects.map((project) => project?.path) : [])].filter(Boolean);
  return roots.some((root) => within(run.workspace, root));
}

/** The runs a member's Execution panel lists: its own plus matching outside sessions. */
export function runsForMember(runs, agent) {
  if (!agent) return [];
  return (Array.isArray(runs) ? runs : []).filter((run) => run.agentId === agent.id || externalRunBelongs(run, agent));
}
