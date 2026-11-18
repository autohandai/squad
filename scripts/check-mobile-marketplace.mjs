#!/usr/bin/env node
// The marketplace on a paired phone (contract 0.5, ADR-0256): reads through
// this computer shaped for the phone, an Add recorded as a decision that only
// the Squad window carries out, and failures that never read as an account
// change. Drives the real phone-marketplace module and card store with a fake
// bridge; the window side is covered by the import it reuses.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCardStore } from '../server/mobile/cards.mjs';
import { createPhoneMarketplace, phoneHome, phoneListing } from '../server/mobile/marketplace.mjs';

const agent = { id: 'hm2ypxcbznko', kind: 'agent', members: 1, name: 'Abner', role: 'Spec to prototype builder', tagline: 'Turns a spec into a prototype.', category: 'engineering', categoryLabel: 'Engineering', bird: 'kiwi', creator: { kind: 'autohand', name: 'Autohand Squad team' }, version: 1, contentHash: 'a'.repeat(64), installsLabel: '', createdAt: '2026-11-17T00:00:00Z', description: 'Long description', tags: ['prototyping'] };
const team = { ...agent, id: 'teamaaaaaaaa', kind: 'team', members: 4, name: 'Code review desk', bird: 'kea', faces: ['kea', 'baldeagle', 'NOT A BIRD', 'pukeko'] };
const home = { featured: [agent, team, { id: 'bad id' }], teams: [team], sections: [{ id: 'engineering', label: 'Engineering', count: 38, teams: 3, agents: [agent] }], total: 350, teamsTotal: 21, stale: false };
const detail = { agent, preview: { brainCard: { purpose: 'Make a spec tangible.', allowedTools: 'Files in the work folder.', escalationRules: 'Asks before adding a backend.' }, skills: [{ name: 'spec-to-screen-list', description: 'Reduce a spec.' }], hasMemory: false } };

const dir = await mkdtemp(join(tmpdir(), 'squad-mobile-marketplace-'));
try {
  // Shaping: unknown fields dropped, faces cleaned, bad rows skipped.
  const row = phoneListing(team);
  assert.deepEqual(row.faces, ['kea', 'baldeagle', 'kiwi', 'pukeko']);
  assert.equal(row.creatorIsAutohand, true);
  assert.equal('contentHash' in row, false, 'the phone does not need template hashes');
  const shaped = phoneHome(home, { canAdd: true });
  assert.equal(shaped.featured.length, 2, 'a row with an invalid id is dropped');
  assert.equal(shaped.sections[0].count, 38, 'a category counts the agents its list shows, as on the website');

  let writable = true, events = 0, getCalls = [];
  const bridge = {
    async get(path) {
      getCalls.push(path);
      if (path === '/api/marketplace/home') return home;
      if (path.startsWith('/api/marketplace/agents?')) return { agents: [agent], total: 38, nextCursor: 'next' };
      if (path === `/api/marketplace/agents/${agent.id}`) return detail;
      if (path === '/api/marketplace/agents/missingmissi') throw Object.assign(new Error('This listing is not in the marketplace.'), { status: 404, code: 'listing_not_found' });
      if (path === '/api/marketplace/imports') return { imports: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
  const cards = await createCardStore({ directory: dir });
  const market = createPhoneMarketplace({ bridge, cards, canWrite: async () => writable, emit: () => { events += 1; } });

  assert.equal((await market.execute('marketplace.home', {})).canAdd, true);
  const page = await market.execute('marketplace.list', { category: 'engineering', q: ' spec ' });
  assert.equal(page.total, 38); assert.equal(page.nextCursor, 'next');
  assert.match(getCalls.at(-1), /category=engineering/); assert.match(getCalls.at(-1), /q=spec/); assert.match(getCalls.at(-1), /kind=agent/);
  await assert.rejects(market.execute('marketplace.list', { category: '../x' }), 'a category is validated before it reaches the bridge');

  const shown = await market.execute('marketplace.listing', { id: agent.id });
  assert.equal(shown.mayUse, 'Files in the work folder.');
  assert.equal(shown.asksFirst, 'Asks before adding a backend.');
  assert.equal(shown.skills[0].name, 'spec-to-screen-list');
  await assert.rejects(market.execute('marketplace.listing', { id: 'missingmissi' }), /no longer in the marketplace/);

  // A read-only Squad refuses before anything is recorded.
  writable = false;
  await assert.rejects(market.execute('marketplace.add', { id: agent.id }, { deviceID: 'd1', requestID: 'r0' }), /read-only/);
  assert.equal(market.pending().length, 0);
  writable = true;

  // Add records a decision for the window; nothing is installed here.
  const { request } = await market.execute('marketplace.add', { id: agent.id }, { deviceID: 'd1', requestID: 'r1' });
  assert.equal(request.state, 'requested');
  assert.match(request.result, /Keep Squad open/);
  assert.equal(events, 1, 'the window is told to look');
  assert.deepEqual(market.pending().map(item => item.listingId), [agent.id]);
  assert.equal((await market.execute('marketplace.listing', { id: agent.id })).request.state, 'requested', 'the listing shows its add in progress');

  // One window claims it; a second is refused; settling reports the outcome.
  assert.equal(await market.claim(request.id), true);
  assert.equal(await market.claim(request.id), false, 'a second window is refused while the first works');
  const settled = await market.settle({ requestID: request.id, state: 'done', result: 'Added Abner to your Squad.' });
  assert.equal(settled.state, 'done');
  assert.equal(market.pending().length, 0);
  const again = await market.settle({ requestID: request.id, state: 'failed', result: 'late' });
  assert.equal(again.state, 'done', 'a settled add keeps its outcome');
  const listed = await market.execute('marketplace.requests', {});
  assert.equal(listed.requests[0].result, 'Added Abner to your Squad.');
  const saved = JSON.parse(await readFile(join(dir, 'mobile-cards.json'), 'utf8'));
  assert.equal(Object.values(saved.cards)[0].source, 'phone', 'the decision survives a restart with its source');

  // A marketplace the computer cannot reach is a calm sentence, never an account code.
  const down = createPhoneMarketplace({ bridge: { get: async () => { throw Object.assign(new Error('Squad marketplace is unavailable.'), { status: 503, code: 'marketplace_unavailable' }); } }, cards, canWrite: async () => true });
  await assert.rejects(down.execute('marketplace.home', {}), error => /can’t be reached from your computer/.test(error.message) && !error.code);

  // Without the card store (an older host shape) Add explains, browsing works.
  const browseOnly = createPhoneMarketplace({ bridge, cards: null });
  assert.equal((await browseOnly.execute('marketplace.home', {})).canAdd, false);
  await assert.rejects(browseOnly.execute('marketplace.add', { id: agent.id }), /newer Squad/);

  // The host advertises and receipt-protects the commands.
  const service = await readFile(new URL('../server/mobile/service.mjs', import.meta.url), 'utf8');
  assert.match(service, /RECEIPTED = \[[^\]]*'marketplace\.add'/);
  for (const command of market.commands) assert.ok(service.includes(`'${command}'`), `${command} is routed`);

  console.log('check-mobile-marketplace: ok (shaping, counts, search, detail with what an agent may use, read-only refusal, add as a window decision with claim and settle, calm failures, receipts)');
} finally {
  await rm(dir, { recursive: true, force: true });
}
