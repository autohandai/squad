// Who is on the squad: stored members, the seeded ones, and the ones the
// person deleted.
//
// Deleting a seeded member used to remove it from storage and nothing else.
// The next load found its id missing from storage and helpfully added it back
// from the seed list, so deleting Eva and quitting brought Eva back. A
// deletion is a decision, and it has to outlive the session that made it.
//
// Pure: no React, no DOM, so scripts/check-member-roster.mjs can import it
// from Node. See docs/adrs/ADR-0038-deleted-members-stay-deleted.md.

export const SQUAD_MEMBER_ID_PREFIX = "asq_";
export const LEGACY_SQUAD_MEMBER_ID_PREFIXES = Object.freeze(["wk_"]);

/** One spelling for a member id, with the old prefix carried forward. */
export function normalizeSquadMemberId(id) {
  const value = String(id || "").trim();
  const legacyPrefix = LEGACY_SQUAD_MEMBER_ID_PREFIXES.find((prefix) => value.startsWith(prefix));
  return legacyPrefix ? `${SQUAD_MEMBER_ID_PREFIX}${value.slice(legacyPrefix.length)}` : value;
}

/**
 * Stored members, plus every seeded member the person has not deleted.
 *
 * A stored member always wins over a seed of the same id, so edits survive.
 * A deleted id is never re-seeded, however the list is spelled.
 */
export function mergeSeedAgents(storedAgents, seedAgents = [], removedIds = []) {
  const records = Array.isArray(storedAgents) ? storedAgents : [];
  const seeds = Array.isArray(seedAgents) ? seedAgents : [];
  const seen = new Set(records.map((agent) => normalizeSquadMemberId(agent?.id)).filter(Boolean));
  const removed = removedIdSet(removedIds);
  return [
    ...records,
    ...seeds.filter((agent) => {
      const id = normalizeSquadMemberId(agent?.id);
      return Boolean(id) && !seen.has(id) && !removed.has(id);
    }),
  ];
}

/** The deletion list, normalised and deduplicated. */
export function removedIdSet(removedIds) {
  const list = Array.isArray(removedIds) ? removedIds : [];
  return new Set(list.map((id) => normalizeSquadMemberId(id)).filter(Boolean));
}

/** Record a deletion without duplicating one already recorded. */
export function rememberRemovedAgent(removedIds, agentId) {
  const id = normalizeSquadMemberId(agentId);
  const list = Array.isArray(removedIds) ? removedIds : [];
  if (!id || list.some((entry) => normalizeSquadMemberId(entry) === id)) return list;
  return [...list, id];
}
