// Task ownership and handoff lookups shared by the Execution panel and the
// chat integrator in src/App.jsx. Pure: a task record in, a value out.
import { normalizeSquadMemberId } from "@/lib/member-roster";

export function taskOwner(task, agents = []) {
  const ownerId = normalizeSquadMemberId(task?.currentOwnerId || task?.agentId);
  return agents.find((agent) => agent.id === ownerId);
}

export function latestHandoff(task) {
  const handoffs = Array.isArray(task?.handoffs) ? task.handoffs : [];
  return handoffs[handoffs.length - 1] || null;
}

export function latestPendingHandoff(task) {
  return [...(Array.isArray(task?.handoffs) ? task.handoffs : [])].reverse().find((handoff) => handoff.status === "pending") || null;
}

export function latestFailedHandoff(task) {
  return [...(Array.isArray(task?.handoffs) ? task.handoffs : [])].reverse().find((handoff) => handoff.status === "failed") || null;
}
