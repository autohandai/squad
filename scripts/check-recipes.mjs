#!/usr/bin/env node
// Recipes from observed work (ADR-0259): the spotter finds requests the person
// keeps making to the same member, and the store keeps what the Chief of Staff
// or the person saved.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestWords, similarity, spotRecipes } from '../src/lib/recipe-observations.js';
import { createRecipeStore } from '../server/recipes/store.mjs';

const at = (d, h = 9) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
const runs = [
  { agentId: 'tatiana', prompt: 'Pull yesterday’s signups and post a short summary in #growth', startedAt: at(18) },
  { agentId: 'tatiana', prompt: 'pull the signups from yesterday and post a short summary to #growth please', startedAt: at(17) },
  { agentId: 'tatiana', prompt: 'Pull yesterday signups, post a short summary #growth (2026-11-14)', startedAt: at(14) },
  { agentId: 'eva', prompt: 'Pull yesterday’s signups and post a short summary in #growth', startedAt: at(16) },
  { agentId: 'tatiana', prompt: 'Write the release notes for 0.1.22', startedAt: at(18, 11) },
  { agentId: 'tatiana', prompt: 'Draft a reply to the Acme renewal email', startedAt: at(18, 12) },
  { agentId: 'tatiana', prompt: 'Draft a reply to the Acme renewal email', startedAt: at(18, 13) },
  { agentId: 'tatiana', prompt: 'Draft a reply to the Acme renewal email', startedAt: at(18, 14) },
  { agentId: 'tatiana', prompt: 'Pull yesterday’s signups and post a short summary in #growth', startedAt: at(12), recipeId: 'recipe-1' },
];
const members = [{ id: 'tatiana', name: 'Tatiana' }, { id: 'eva', name: 'Eva' }];

assert.ok(similarity(requestWords(runs[0].prompt), requestWords(runs[2].prompt)) >= 0.5, 'dates and punctuation do not split a pattern');
const spotted = spotRecipes(runs, { members });
assert.equal(spotted.length, 1, JSON.stringify(spotted, null, 2));
const [signups] = spotted;
assert.equal(signups.memberId, 'tatiana');
assert.equal(signups.evidence.runs, 3, 'three requests to Tatiana (Eva’s is another member; the recipe-run one is excluded)');
assert.match(signups.description, /You asked Tatiana for this 3 times since 2026-11-14/);
assert.match(signups.name.toLowerCase(), /signups/);
assert.equal(signups.prompt, runs[0].prompt, 'the newest wording is the one offered');
// Same request three times on one day is not a habit yet.
assert.ok(!spotted.some((item) => /acme/i.test(item.prompt)), 'three times in one day is not spotted');
// A saved recipe is not suggested again.
assert.equal(spotRecipes(runs, { members, known: [runs[1].prompt] }).length, 0);

const dir = await mkdtemp(join(tmpdir(), 'squad-recipes-'));
try {
  const store = createRecipeStore(dir);
  await assert.rejects(store.save({ name: 'x', prompt: 'do the thing please' }), /short name/);
  const saved = await store.save({ name: 'Daily signups summary', prompt: signups.prompt, memberId: 'tatiana', source: 'chief-of-staff', savedBy: 'Chief of Staff', evidence: 'asked 3 times since 14 Nov' });
  assert.equal(saved.source, 'chief-of-staff');
  const again = await store.save({ name: 'Daily signups', prompt: signups.prompt, memberId: 'tatiana', source: 'person' });
  assert.equal(again.id, saved.id, 'saving the same request for the same member updates it');
  assert.equal((await store.list()).length, 1);
  await store.remove(saved.id);
  assert.equal((await store.list()).length, 0);
  await assert.rejects(store.remove(saved.id), /not saved/);
} finally { await rm(dir, { recursive: true, force: true }); }

console.log('check-recipes: ok (a request made three times on different days is spotted with its evidence; one-day bursts, other members, recipe runs and saved recipes are not; the store saves, updates and removes)');
