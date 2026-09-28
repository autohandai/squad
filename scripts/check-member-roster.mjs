#!/usr/bin/env node
// A deleted member stays deleted.
//
// Deleting a seeded member used to remove it from storage and nothing else,
// so the next load saw its id missing and added it back from the seed list.
// Delete Eva, quit, and Eva was there again. Reported by a user; "known bug"
// is not a resting place for one.
//
// See docs/adrs/ADR-0038-deleted-members-stay-deleted.md.

import assert from "node:assert/strict";

import { initialAgents } from "../src/data.js";
import { mergeSeedAgents, normalizeSquadMemberId, rememberRemovedAgent, removedIdSet } from "../src/lib/member-roster.js";

const seed = [{ id: "eva", name: "Eva" }, { id: "noah", name: "Noah" }];

// --- the reported bug ------------------------------------------------------

{
  // Fresh install: every seeded member shows up.
  const first = mergeSeedAgents([], seed, []);
  assert.deepEqual(first.map((agent) => agent.id).sort(), ["eva", "noah"], "a fresh install seeds the squad");

  // The person deletes Eva. Storage keeps Noah; the deletion is recorded.
  const afterDelete = first.filter((agent) => agent.id !== "eva");
  const removed = rememberRemovedAgent([], "eva");
  assert.deepEqual(removed, ["eva"]);

  // Quit and reopen.
  const reopened = mergeSeedAgents(afterDelete, seed, removed);
  assert.deepEqual(reopened.map((agent) => agent.id), ["noah"], "Eva does not come back");

  // And again, however many times.
  const third = mergeSeedAgents(reopened, seed, removed);
  assert.deepEqual(third.map((agent) => agent.id), ["noah"], "still gone on the next load");
}

{
  // Deleting every seeded member leaves an empty squad, not a restored one.
  const removed = seed.reduce((list, agent) => rememberRemovedAgent(list, agent.id), []);
  assert.deepEqual(mergeSeedAgents([], seed, removed), [], "an emptied squad stays empty");
}

// --- the merge's other promises -------------------------------------------

{
  // A stored member always wins over the seed of the same id, so edits survive.
  const edited = [{ id: "eva", name: "Eva the second" }];
  const merged = mergeSeedAgents(edited, seed, []);
  assert.equal(merged.filter((agent) => agent.id === "eva").length, 1, "no duplicate of a stored member");
  assert.equal(merged.find((agent) => agent.id === "eva").name, "Eva the second", "the stored copy wins");
}

{
  // The old id spelling is the same member on both sides of the comparison.
  assert.equal(normalizeSquadMemberId("wk_abc"), "asq_abc");
  const removed = rememberRemovedAgent([], "wk_abc");
  assert.deepEqual(mergeSeedAgents([], [{ id: "asq_abc" }], removed), [], "a legacy id still matches its deletion");
  assert.deepEqual(mergeSeedAgents([], [{ id: "wk_abc" }], ["asq_abc"]), [], "and the other way round");
}

{
  // Recording the same deletion twice does not grow the list.
  let list = rememberRemovedAgent([], "eva");
  list = rememberRemovedAgent(list, "eva");
  list = rememberRemovedAgent(list, "wk_eva");
  assert.equal(list.length, 2, "one entry per member, legacy spelling folded in");
  assert.equal(rememberRemovedAgent(list, "").length, 2, "an empty id records nothing");
}

{
  // Nothing throws on the shapes storage can actually hand back.
  for (const bad of [null, undefined, "", 42, {}]) {
    assert.deepEqual(mergeSeedAgents(bad, [], bad), [], `survives ${JSON.stringify(bad)}`);
    assert.equal(removedIdSet(bad).size, 0);
  }
  assert.ok(Array.isArray(mergeSeedAgents(null, seed, null)), "a broken store still seeds");
}

{
  // The real seed list works, and every seeded member can be deleted.
  const all = mergeSeedAgents([], initialAgents, []);
  assert.ok(all.length >= 1, "the shipped seed list is not empty");
  const removed = initialAgents.reduce((list, agent) => rememberRemovedAgent(list, agent.id), []);
  assert.deepEqual(mergeSeedAgents([], initialAgents, removed), [], "every shipped member can be deleted for good");
}

console.log("check-member-roster: ok");
