// ADR-0283: a squad from before account ownership comes back on update.
// Daniel's Mac: an older Squad left its CST team unowned in the service root
// (channels.json, chats) and web-state/agents; the first sign-in on 0.1.22+
// opened an empty dataset and setup ran again. This drives the real broker
// with a fixture identity and the fixture worker; no network, no real account.
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';
import { readDataset } from '../server/ownership/datasets.mjs';
import { decide } from '../server/ownership/legacy-auto-import.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url)), issuer = 'https://identity.example.test';
const directory = await mkdtemp(join(tmpdir(), 'squad-legacy-auto-'));
const seed = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashTree(root, skip = ['owners']) {
  const out = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const full = join(path, entry.name), rel = relative(root, full);
      if (skip.some(name => rel === name || rel.startsWith(`${name}/`)) || /^(legacy-import\.json|ownership-|\.ownership|config\.json|broker|.*\.sqlite)/.test(rel)) continue;
      if (entry.isDirectory()) await walk(full); else if (entry.isFile()) out[rel] = sha(await readFile(full));
    }
  }
  await walk(root); return out;
}
/** What an older Squad left behind: the CST team, its chats and memories. */
async function seedLegacy(serviceRoot) {
  const member = (id, name, role) => ({ agent: { id, name, role, description: `${name} works the CST queue.`, instructions: 'Reply within the hour.', workspace: '', projects: [] } });
  await seed(join(serviceRoot, 'channels.json'), { version: 1,
    channels: [{ id: 'cst', name: 'CST', memberIds: ['asq_cst_lead', 'asq_cst_agent'], visibility: 'private' }], threads: [],
    messages: [{ id: 'm1', channelId: 'cst', role: 'user', body: 'Morning, team.' }],
    agentChannelAccess: { asq_cst_lead: member('asq_cst_lead', 'Daniel', 'CST lead'), asq_cst_agent: member('asq_cst_agent', 'Priya', 'Support agent'),
      asq_gone: { agent: { id: 'asq_gone', name: 'Removed long ago' }, removed: true }, 'squad-designer': member('squad-designer', 'Designer', '') } });
  await seed(join(serviceRoot, 'team.json'), { version: 1, memory: [{ id: 'team-memory', scope: 'team', text: 'Refunds over $500 need the lead.' }] });
  await seed(join(serviceRoot, 'browser-state.json'), { version: 1, messagesByAgent: { asq_cst_lead: [{ id: 'c1', role: 'user', body: 'What is in the queue today?' }, { id: 'c2', role: 'assistant', body: 'Twelve tickets.' }] } });
  for (const [id, name] of [['asq_cst_lead', 'Daniel'], ['asq_cst_agent', 'Priya'], ['asq_cst_night', 'Night shift']]) {
    await seed(join(serviceRoot, 'web-state/agents', id, 'profile.json'), { id, name, role: 'CST', token: 'never-copied' });
    await seed(join(serviceRoot, 'web-state/agents', id, 'memory/MEMORY.md'), `${name} remembers the escalation path.`);
    await seed(join(serviceRoot, 'web-state/agents', id, 'config.json'), { token: 'secret' });
  }
}
const open = [];
function fixture(serviceRoot) {
  let person = 'daniel', broker, origin, context;
  const identity = { credential: () => ({ fingerprint: sha(person) }),
    async verify(current) { return { actor: { issuer, id: person, email: `${person}@example.test`, name: person }, fingerprint: current.fingerprint, expiresAt: Date.now() + 3600_000 }; },
    personal(value) { return { owner: { kind: 'user', issuer, id: value.actor.id }, label: 'Personal', role: 'owner', canWrite: true }; },
    async authorize(value, owner) { return { owner, label: owner.kind === 'team' ? 'CST team' : 'Personal', role: 'owner', canWrite: true }; },
    async owners(value) { return [this.personal(value)]; } };
  const api = {
    get context() { return context; }, set person(value) { person = value; },
    owner: () => ({ kind: 'user', issuer, id: person }),
    async start(expected = 'ready') {
      broker = createOwnershipBroker({ rootDir, serviceRoot, configPath: join(serviceRoot, 'no-real-auth'), identity, port: 0, workerEntry: join(rootDir, 'scripts', 'fixtures', 'ownership-worker.mjs') });
      origin = await broker.listen(); await api.wait(expected);
    },
    async wait(state) { for (let i = 0; i < 400; i++) { context = (await (await fetch(`${origin}/api/ownership/context`)).json()).data; if (context.state === state) return; await new Promise(done => setTimeout(done, 25)); } assert.equal(context.state, state, JSON.stringify(context)); },
    post: (path, data) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-squad-context': context.generation }, body: JSON.stringify(data) }),
    close: () => broker?.close(),
  };
  open.push(api); return api;
}

try {
  // The rule on its own: only a blank personal Squad, once per computer.
  const legacy = { members: [{ id: 'a', name: 'A' }] }, blank = { memberIds: [], blank: true };
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: true, marker: null, legacy, dataset: blank }).action, 'import');
  assert.equal(decide({ actor: 'x', ownerKind: 'team', canWrite: true, marker: null, legacy, dataset: blank }).action, 'offer', 'a team Squad is offered, never filled automatically');
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: true, marker: null, legacy, dataset: { memberIds: ['b'], blank: false } }).action, 'offer', 'a Squad that was set up is offered, never replaced');
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: true, marker: { status: 'imported', actor: 'y' }, legacy, dataset: blank }).action, 'offer', 'a second account on this computer is offered');
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: true, marker: { status: 'offered', dismissedBy: ['x'] }, legacy, dataset: blank }).action, 'none');
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: true, marker: null, legacy, dataset: { memberIds: ['a'], blank: false } }).action, 'none', 'members already here are not offered');
  assert.equal(decide({ actor: 'x', ownerKind: 'user', canWrite: false, marker: null, legacy, dataset: blank }).action, 'none');

  // Daniel's Mac: an older Squad's CST team, then the update.
  const daniel = join(directory, 'daniel');
  await seedLegacy(daniel);
  const before = await hashTree(daniel);
  const squad = fixture(daniel);
  await squad.start();
  let context = squad.context;
  assert.equal(context.legacy?.status, 'imported', JSON.stringify(context.legacy));
  assert.equal(context.legacy.memberCount, 3, 'Daniel, Priya and the night shift; the removed member and the designer stay out');
  assert.equal(context.legacy.chatCount >= 1, true);
  assert.equal(context.legacy.undo, true);
  const key = ownerKey(squad.owner()), imported = await readDataset(daniel, key);
  const channels = JSON.parse(await readFile(join(imported.dataRoot, 'channels.json'), 'utf8'));
  const members = Object.values(channels.agentChannelAccess).filter(entry => !entry.removed).map(entry => entry.agent);
  assert.deepEqual(members.map(agent => agent.name).sort(), ['Daniel', 'Night shift', 'Priya']);
  assert.ok(members.every(agent => agent.status === 'paused'), 'brought-back members start paused');
  assert.ok(!JSON.stringify(channels).includes('never-copied') && !JSON.stringify(channels).includes('Removed long ago'));
  assert.ok(channels.channels.some(channel => channel.name === 'CST'), 'the CST channel came back');
  const importedText = Object.keys(await hashTree(imported.root, [])).length && (await Promise.all(Object.keys(await hashTree(imported.root, [])).map(path => readFile(join(imported.root, path), 'utf8').catch(() => '')))).join('\n');
  assert.match(importedText, /Refunds over \$500 need the lead\./, 'team memory came back');
  assert.match(importedText, /Daniel remembers the escalation path\./, 'member memory came back');
  assert.match(importedText, /Twelve tickets\./, 'the chat with Daniel came back');
  assert.ok(!importedText.includes('"secret"'), 'credentials stay behind');
  assert.deepEqual(await hashTree(daniel), before, 'the earlier files are untouched, byte for byte');
  const marker = JSON.parse(await readFile(join(daniel, 'legacy-import.json'), 'utf8'));
  assert.equal(marker.status, 'imported'); assert.equal((await stat(join(daniel, 'legacy-import.json'))).mode & 0o777, 0o600);
  const firstImport = imported.datasetId;

  // Opening Squad again doesn't import twice; the notice stays until dismissed.
  await squad.close(); await squad.start(); context = squad.context;
  assert.equal((await readDataset(daniel, key)).datasetId, firstImport, 'never imported twice');
  assert.equal(context.legacy?.status, 'imported');
  let response = await squad.post('/api/ownership/legacy/dismiss', {}); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).data.legacy, null);
  await squad.close(); await squad.start(); assert.equal(squad.context.legacy, null, 'a dismissed notice stays dismissed');

  // Undo returns to the empty Squad; the imported one stays on disk.
  response = await squad.post('/api/ownership/legacy/undo', { confirm: 'wrong' }); assert.equal(response.status, 400);
  response = await squad.post('/api/ownership/legacy/undo', { confirm: 'undo-automatic-import' }); assert.equal(response.status, 200, await response.clone().text());
  context = (await response.json()).data; assert.equal(context.state, 'ready');
  const undone = await readDataset(daniel, key); assert.equal(undone.datasetId, marker.beforeDatasetId, 'the empty Squad is current again');
  assert.ok((await stat(imported.dataRoot)).isDirectory(), 'the imported dataset is kept');
  await squad.close(); await squad.start(); assert.equal(squad.context.legacy, null, 'after Undo nothing comes back on its own or nags');
  assert.equal((await readDataset(daniel, key)).datasetId, undone.datasetId);

  // A second account on the same Mac is offered, never filled automatically.
  await squad.close(); squad.person = 'colleague'; await squad.start(); context = squad.context;
  assert.equal(context.legacy?.status, 'offer'); assert.equal(context.legacy.memberCount, 3);
  assert.equal(context.legacy.appRoot, join(daniel, 'web-state')); assert.deepEqual(context.legacy.names.sort(), ['Daniel', 'Night shift', 'Priya']);
  const colleague = await readDataset(daniel, ownerKey(squad.owner()));
  assert.equal(JSON.parse(await readFile(join(colleague.dataRoot, 'channels.json'), 'utf8').catch(() => '{}')).agentChannelAccess, undefined, 'their Squad was not filled');
  response = await squad.post('/api/ownership/legacy/dismiss', {}); assert.equal(response.status, 200);
  await squad.close(); await squad.start(); assert.equal(squad.context.legacy, null, 'the colleague dismissed it');
  await squad.close();

  // A Squad someone already set up again (Daniel's case after setup ran) is offered.
  const setUp = join(directory, 'set-up'), again = fixture(setUp);
  await again.start(); const fresh = await readDataset(setUp, ownerKey(again.owner())); await again.close();
  await seed(join(fresh.dataRoot, 'channels.json'), { version: 1, channels: [], threads: [], messages: [], agentChannelAccess: { asq_chief: { agent: { id: 'asq_chief', name: 'Chief of Staff' } } } });
  await seedLegacy(setUp);
  await again.start();
  assert.equal(again.context.legacy?.status, 'offer', JSON.stringify(again.context.legacy));
  assert.equal((await readDataset(setUp, ownerKey(again.owner()))).datasetId, fresh.datasetId, 'a Squad with members is never replaced');
  await again.close();

  // If bringing it back fails, setup stays and the offer says why.
  const broken = join(directory, 'broken'); await seedLegacy(broken);
  await link(join(broken, 'team.json'), join(directory, 'team-hardlink.json')); // a hard-linked file is refused by recovery
  const failing = fixture(broken); await failing.start();
  assert.equal(failing.context.legacy?.status, 'failed', JSON.stringify(failing.context.legacy));
  assert.match(failing.context.legacy.error, /unsafe|limit/i);
  const unchanged = await readDataset(broken, ownerKey(failing.owner()));
  await assert.rejects(readFile(join(unchanged.dataRoot, 'channels.json')), { code: 'ENOENT' }, 'the blank Squad is left as it was');
  assert.equal(JSON.parse(await readFile(join(broken, 'legacy-import.json'), 'utf8')).status, 'failed');
  await failing.close();

  console.log('Legacy auto-import: a blank personal Squad brings back the squad from before ownership (3 members, CST channel, chats and memories, paused, no credentials or removed members) once per computer, with byte-identical originals, a dismissible notice and Undo to the empty Squad; a second account, a Squad already set up and a failed copy get an offer instead.');
} catch (failure) { console.error(failure); process.exitCode = 1; } finally { for (const squad of open) await squad.close?.().catch(() => {}); await rm(directory, { recursive: true, force: true }).catch(() => {}); if (process.exitCode) process.exit(1); }
