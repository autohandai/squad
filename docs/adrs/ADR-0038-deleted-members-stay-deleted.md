# ADR-0038: A deleted member stays deleted

Date: 2026-09-28
Status: Accepted

## Context

A user reported it and was told it was a known bug:

> If I delete Eva and quit, she comes back again. Is that normal?

It is reproducible on any install, because Eva ships in the seed list.
`mergeSeedAgents` took the stored members, collected their ids, and appended
every seeded member whose id was not among them. Deleting Eva removed her from
storage, so on the next load her id was missing, so she was added back. The
merge could not tell "never seen" from "deleted", and defaulted to the
friendlier of the two.

The same shape had already been fixed once this week, for memory proposals
filed by skill provisioning. A seed list that re-adds on absence is a pattern,
not an incident.

## Decision

**A deletion is recorded, not merely applied.** `autohandSquad.v1.removedAgents`
holds the ids the person has deleted, and the merge skips a seeded member whose
id appears there. Storage answers three states now rather than two: present,
never seen, and deliberately gone.

**The roster logic moves to `src/lib/member-roster.js`**, with the member id
normaliser it depends on, so one definition exists and
`scripts/check-member-roster.mjs` can drive the whole sequence from Node:
seed, delete, reload, reload again. The check fails with the user's own
symptom, "Eva does not come back", when the fix is removed.

Legacy and current id spellings are normalised on both sides of the
comparison, so a member deleted under one spelling is not resurrected under
the other.

## Consequences

- Deleting every seeded member leaves an empty squad, which is now a state the
  app can be in. That is what the person asked for.
- The list only grows. It holds ids, one short string each, and a squad has
  tens of members, so this is not worth pruning. Pruning would also have to
  decide when a deletion stops counting, and there is no good answer.
- A stored member still wins over a seed of the same id, so a seeded member
  that was edited rather than deleted keeps its edits.
- The member's own home directory under `.autohand/agents/<id>` is not
  removed. Deleting the record is reversible by re-creating a member with the
  same id; deleting its history would not be, and nobody asked for that.
