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
import { createPhoneMarketplace, phoneHome, phoneListing, phonePublishPreview } from '../server/mobile/marketplace.mjs';
import { templateFromMember } from '../src/lib/marketplace.js';

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
  assert.match(request.result, /confirm it in Squad on your computer/, 'by default the person confirms on the computer');
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

  // "Confirm phone adds on this computer": on by default, an add waits for the
  // person in the Squad window; off, the window adds it as decided on the phone.
  assert.equal((await market.execute('marketplace.home', {})).confirmsOnComputer, true, 'confirmation on the computer is the default');
  const confirmed = (await market.execute('marketplace.add', { id: agent.id }, { deviceID: 'd1', requestID: 'r2' })).request;
  assert.match(confirmed.result, /confirm it in Squad on your computer/);
  assert.equal(market.pending().find(item => item.requestID === confirmed.id).confirm, true);
  assert.equal(await market.claim(confirmed.id), true);
  const declined = await market.settle({ requestID: confirmed.id, state: 'failed', result: 'Not added: it was closed in Squad on your computer.' });
  assert.equal(declined.state, 'failed');
  let confirm = false;
  const silent = createPhoneMarketplace({ bridge, cards, canWrite: async () => true, confirmOnComputer: () => confirm });
  assert.equal((await silent.execute('marketplace.home', {})).confirmsOnComputer, false);
  const direct = (await silent.execute('marketplace.add', { id: agent.id }, { deviceID: 'd1', requestID: 'r3' })).request;
  assert.match(direct.result, /Keep Squad open/);
  assert.equal(silent.pending().find(item => item.requestID === direct.id).confirm, false);
  const controller = await readFile(new URL('../server/mobile/controller.mjs', import.meta.url), 'utf8');
  assert.match(controller, /confirmPhoneAdds: z\.boolean\(\)\.default\(true\)/, 'the saved preference defaults to confirming');
  const route = await readFile(new URL('../server/routes/mobile.route.mjs', import.meta.url), 'utf8');
  assert.match(route, /\/api\/mobile\/preferences' && req\.method === 'PUT'/);

  // Publishing from the phone (contract 0.12, ADR-0290): the computer builds
  // and scans the template from its own member record; the phone sees only the
  // preview, publishes once per request, lists its own listings and unpublishes.
  const memberRow = { id: 'iris', name: 'Iris', role: 'Release notes writer', description: 'Writes notes people read.', instructions: 'Short paragraphs.', skills: ['changelog-style'], look: { avatar: '/avatars/birds/tui.webp' } };
  const posts = [], deletes = [];
  let signedIn = true, mineRowsList = [];
  const pubBridge = {
    async get(path) {
      if (path === '/api/marketplace/publish/context') { if (!signedIn) throw Object.assign(new Error('Sign in to Autohand to publish agents.'), { code: 'marketplace_sign_in' }); return { signedIn: true, owners: [{ kind: 'user', label: 'Igor' }, { kind: 'team', id: 'team-1', label: 'Autohand' }] }; }
      if (path === '/api/marketplace/categories') return { categories: [{ id: 'writing', label: 'Writing' }, { id: 'BAD ID', label: 'x' }] };
      if (path === '/api/marketplace/mine') { if (!signedIn) throw Object.assign(new Error('Sign in to Autohand to publish agents.'), { code: 'marketplace_sign_in' }); return { agents: mineRowsList }; }
      throw new Error(`unexpected ${path}`);
    },
    async post(path, body) {
      posts.push({ path, body });
      if (path === '/api/marketplace/publish/preview') {
        const tagline = body.tagline;
        const document = templateFromMember({ member: { ...body.member, skills: body.skills }, skills: [{ name: 'changelog-style', description: 'House style.', text: 'Use short lines.' }], notes: body.includeMemory ? 'Prefers bullet lists.' : '', tagline });
        const secret = /sk-[A-Za-z0-9]{20}/.test(tagline);
        return { document, memory: 'Prefers bullet lists.', memoryTruncated: false, skills: [{ name: 'changelog-style', description: 'House style.' }], missingSkills: [],
          findings: secret ? [{ path: 'listing.tagline', kinds: ['API key'] }] : [], error: secret ? 'Something that looks like a API key is in listing.tagline. Remove it before sharing.' : '', contentHash: secret ? '' : 'b'.repeat(64) };
      }
      if (path === '/api/marketplace/publish') {
        const version = body.listingId ? body.baseVersion + 1 : 1;
        const row = { ...agent, id: body.listingId || 'pubaaaaaaaaa', name: body.member.name, role: body.member.role, tagline: body.listing.tagline, category: body.listing.category, bird: 'tui', version, creator: { kind: 'person', name: 'Igor' } };
        mineRowsList = [{ ...row, status: 'published', updatedAt: '2026-11-27T05:00:00Z' }];
        return { agent: row, requestId: body.requestId };
      }
      throw new Error(`unexpected post ${path}`);
    },
    async delete(path) { deletes.push(path); mineRowsList = mineRowsList.map(item => ({ ...item, status: 'unpublished' })); return { id: path.split('/').pop(), status: 'unpublished' }; },
  };
  let pubEvents = 0;
  const pub = createPhoneMarketplace({ bridge: pubBridge, cards, emit: () => { pubEvents += 1; }, memberRecord: async id => (id === 'iris' ? memberRow : null) });
  for (const command of ['marketplace.publish.context', 'marketplace.publish.preview', 'marketplace.publish', 'marketplace.mine', 'marketplace.unpublish']) assert.ok(pub.commands.includes(command), `${command} is a phone command`);
  const ctx = await pub.execute('marketplace.publish.context', { memberID: 'iris' });
  assert.equal(ctx.signedIn, true); assert.deepEqual(ctx.categories.map(item => item.id), ['writing'], 'a malformed category id is dropped');
  assert.equal(ctx.owners[1].kind, 'team'); assert.equal(ctx.previous, null); assert.equal(ctx.member.name, 'Iris');
  await assert.rejects(pub.execute('marketplace.publish.context', { memberID: 'ghost' }), /no longer in this Squad/);
  const shownPreview = await pub.execute('marketplace.publish.preview', { memberID: 'iris', tagline: 'Release notes people read.' });
  assert.equal(shownPreview.name, 'Iris'); assert.equal(shownPreview.role, 'Release notes writer'); assert.equal(shownPreview.bird, 'tui');
  assert.equal(shownPreview.instructions, 'Short paragraphs.'); assert.deepEqual(shownPreview.memberSkills, ['changelog-style']);
  assert.equal(shownPreview.memory, 'Prefers bullet lists.', 'the starter memory is shown before it is ever included');
  assert.equal(shownPreview.problem, ''); assert.equal(shownPreview.findings.length, 0);
  assert.deepEqual(posts.at(-1).body.member, memberRow, 'the computer\'s own member record is what gets checked, not anything the phone sent');
  assert.equal(posts.at(-1).body.includeMemory, false, 'memory stays out unless switched on');
  const leaky = await pub.execute('marketplace.publish.preview', { memberID: 'iris', tagline: 'key sk-abcdefghijklmnopqrstuv' });
  assert.match(leaky.problem, /Remove it before sharing/); assert.equal(leaky.findings[0].path, 'listing.tagline');
  await assert.rejects(pub.execute('marketplace.publish', { memberID: 'iris', tagline: 'x', category: '../etc' }), 'a category is validated');
  await assert.rejects(pub.execute('marketplace.publish', { memberID: 'iris', tagline: '', category: 'writing' }), 'a tagline is required');
  const first = await pub.execute('marketplace.publish', { memberID: 'iris', tagline: 'Release notes people read.', category: 'writing', tags: ['writing'] }, { deviceID: 'd1', requestID: 'p1' });
  assert.equal(first.listing.status, 'published'); assert.equal(first.listing.version, 1); assert.equal(first.updated, false);
  assert.equal(first.listing.link, 'https://autohand.ai/squad/marketplace/pubaaaaaaaaa/');
  assert.match(posts.at(-1).body.requestId, /^phone-d1-p1$/, 'the request id makes a retried publish idempotent');
  assert.deepEqual(posts.at(-1).body.owner, { kind: 'user' });
  const ctx2 = await pub.execute('marketplace.publish.context', { memberID: 'iris' });
  assert.equal(ctx2.previous.id, 'pubaaaaaaaaa', 'a second publish offers a new version of the same listing');
  const second = await pub.execute('marketplace.publish', { memberID: 'iris', tagline: 'Sharper release notes.', category: 'writing' }, { deviceID: 'd1', requestID: 'p2' });
  assert.equal(second.updated, true); assert.equal(second.listing.version, 2);
  assert.equal(posts.at(-1).body.listingId, 'pubaaaaaaaaa'); assert.equal(posts.at(-1).body.baseVersion, 1);
  const mine = await pub.execute('marketplace.mine', {});
  assert.equal(mine.signedIn, true); assert.equal(mine.listings[0].status, 'published');
  const gone = await pub.execute('marketplace.unpublish', { id: 'pubaaaaaaaaa' });
  assert.equal(gone.status, 'unpublished'); assert.deepEqual(deletes, ['/api/marketplace/agents/pubaaaaaaaaa']);
  assert.equal((await pub.execute('marketplace.mine', {})).listings[0].status, 'unpublished');
  await assert.rejects(pub.execute('marketplace.unpublish', { id: '../x' }), 'an id is validated');
  assert.equal(pubEvents, 3, 'publishing and unpublishing tell the windows');
  signedIn = false;
  const out = await pub.execute('marketplace.mine', {});
  assert.equal(out.signedIn, false); assert.match(out.problem, /Sign in to Autohand on your computer/);
  assert.equal((await pub.execute('marketplace.publish.context', { memberID: 'iris' })).signedIn, false);
  await assert.rejects(createPhoneMarketplace({ bridge: pubBridge, cards }).execute('marketplace.publish.context', { memberID: 'iris' }), /newer Squad/);
  assert.match(service, /RECEIPTED = \[[^\]]*'marketplace\.publish'/, 'a retried publish replays its receipt');
  const hidden = phonePublishPreview({}, []);
  assert.equal(hidden.name, ''); assert.equal(hidden.bird, 'kiwi');

  console.log('check-mobile-marketplace: ok (publish from the phone: preview from the computer\'s record, secret scan, versioned republish, mine, unpublish, signed-out; shaping, counts, search, detail with what an agent may use, read-only refusal, add as a window decision with claim and settle, calm failures, receipts, confirmation on the computer by default and the silent add when turned off)');
} finally {
  await rm(dir, { recursive: true, force: true });
}
