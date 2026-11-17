import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { createIdentityService, ownerKey } from '../server/ownership/identity.mjs';
import { createTeamSquadsFlag } from '../server/ownership/team-squads-flag.mjs';
import { writePersistentJson } from '../server/persistent-json.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'squad-ownership-'));
const serviceRoot = join(directory, 'squad'), configPath = join(directory, 'config.json');
let membership = true, readOnly = false, unavailable = false;
// squad_team_squads (ADR-0239): on only for listed people, like actor targeting in the API.
const teamSquadsFor = new Set(['alice']); let flagDown = false; const flagQueries = [];
const provider = createServer((req, res) => {
  const who = String(req.headers.authorization || '').replace('Bearer fixture-', '');
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname;
  if (path === '/v1/feature-flags/evaluate') {
    flagQueries.push(Object.fromEntries(url.searchParams));
    if (flagDown) { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ success: true, ttlSeconds: 0, flags: [{ key: 'squad_team_squads', enabled: teamSquadsFor.has(who), reason: teamSquadsFor.has(who) ? 'match' : 'actor_mismatch' }] }));
    return;
  }
  if (!['alice', 'bob'].includes(who)) { res.writeHead(401); res.end('{}'); return; }
  if (unavailable) { res.writeHead(503); res.end('{}'); return; }
  if (path === '/v1/profile') res.end(JSON.stringify({ success: true, profile: { id: who, email: `${who}@example.test`, name: who, status: 'active' } }));
  else res.end(JSON.stringify({ success: true, accounts: membership ? [{ account: { id: 'real-team', name: 'Real Autohand Team', type: 'team', accessMode: readOnly ? 'read_only' : 'full' }, role: 'contributor', permissions: ['resources:operate'] }] : [] }));
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const issuer = `http://127.0.0.1:${provider.address().port}`;
const teamFlag = root => createTeamSquadsFlag({ origin: issuer, serviceRoot: root, rootDir, fixed: undefined, minRefreshMs: 100, retryMs: 100 });
const identity = createIdentityService({ serviceRoot, configPath, origin: issuer, teamSquads: teamFlag(serviceRoot) });
const broker = createOwnershipBroker({ rootDir, serviceRoot, configPath, identity, port: 0, workerEntry: join(rootDir, 'scripts/fixtures/ownership-worker.mjs'), teamOutageGraceMs: 1500, outageRetryMs: 200 });
const origin = await broker.listen();
const context = async () => (await (await fetch(`${origin}/api/ownership/context`)).json()).data;
async function waitFor(predicate) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { const value = await context(); if (await predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('The verified ownership transition did not finish.');
}
const headers = current => ({ 'x-squad-context': current.generation, 'content-type': 'application/json' });
async function api(path, current, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, { method, headers: headers(current), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, value: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() };
}
const login = name => writePersistentJson(configPath, { auth: name ? { token: `fixture-${name}`, user: { email: 'presentation-is-not-authority@example.test' } } : {} });

try {
  const malformed = await new Promise((resolveResponse, rejectResponse) => {
    const socket = createConnection({ host: '127.0.0.1', port: new URL(origin).port });
    let response = '';
    socket.once('connect', () => socket.end('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
    socket.on('data', data => { response += data; }); socket.once('end', () => resolveResponse(response)); socket.once('error', rejectResponse);
  });
  assert.match(malformed, /^HTTP\/1\.1 400 /);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200, 'malformed targets cannot terminate the broker');
  let locked = await waitFor(value => value.state === 'signed_out');
  assert.equal((await api('/api/members', locked)).response.status, 401);
  await writePersistentJson(join(serviceRoot, 'web-status.json'), { members: [{ name: 'A legacy agent must not appear' }] });
  await login('alice');
  const alice = await waitFor(value => value.state === 'ready' && value.actor.id === 'alice');
  assert.equal(alice.owner.kind, 'user');
  assert.equal((await api('/api/members', alice, 'POST', { id: 'eva', name: 'Alice private member' })).response.status, 200);
  const before = await api('/api/members', alice);
  assert.equal(before.value.data.records[0].name, 'Alice private member');
  assert.equal((await fetch(`http://127.0.0.1:${before.value.data.port}/api/members`)).status, 401, 'a private child port cannot bypass ownership');
  const pending = fetch(`${origin}/api/slow`, { headers: headers(alice) }).then(response => response.text()).catch(() => 'closed');
  const alicePaths = JSON.parse(await readFile(join(serviceRoot, 'ownership-active.json'), 'utf8'));
  await waitFor(async () => { try { return JSON.parse(await readFile(join(alicePaths.dataRoot, 'fixture-admitted.json'), 'utf8')).generation === alice.generation; } catch { return false; } });
  await login('bob');
  const bob = await waitFor(value => value.state === 'ready' && value.actor.id === 'bob');
  assert.notEqual(bob.storageKey, alice.storageKey); assert.notEqual(bob.generation, alice.generation);
  assert.equal((await api('/api/members', alice)).response.status, 409, 'old browser/MCP context cannot read the new account');
  assert.equal((await api('/api/runtime', alice)).response.status, 409, 'public readiness cannot retarget a stale account request');
  assert.equal((await api('/api/harnesses/login?id=autohand', alice)).response.status, 409, 'stale sign-in status cannot read the next account');
  const machineRuntime = await (await fetch(`${origin}/api/runtime`)).json();
  assert.deepEqual(Object.keys(machineRuntime.data).sort(), ['ownership', 'service'], 'unbound readiness exposes no sessions, member homes or account payload');
  const after = await api('/api/members', bob);
  assert.deepEqual(after.value.data.records, []);
  // Bob is not listed for team Squads: Personal Squad only, and a team cannot be selected.
  assert.equal(bob.teamSquads, false);
  assert.deepEqual((await api('/api/ownership/owners', bob)).value.data.owners.map(item => item.owner.kind), ['user']);
  const refused = await api('/api/ownership/select', bob, 'POST', { owner: { kind: 'team', issuer, id: 'real-team' }, expectedGeneration: bob.generation });
  assert.equal(refused.response.status, 403); assert.equal(refused.value.code, 'team_squads_off');
  assert.ok(flagQueries.every(query => query.clientType === 'squad' && ['macos', 'windows', 'linux'].includes(query.platform) && query.cliVersion), 'Squad asks as itself, with platform and version');
  assert.equal((await pending).includes('bob'), false, 'a request admitted for Alice cannot complete with Bob data');
  assert.equal((await fetch(`${origin}/api/team/tools`, { method: 'POST', headers: { 'x-squad-team-token': `turn-${alice.generation}` } })).status, 401, 'old managed MCP tokens cannot reach the new worker');
  const aliceStop = JSON.parse(await readFile(join(alicePaths.dataRoot, 'fixture-stopped.json'), 'utf8'));
  assert.equal(aliceStop.actor.id, 'alice', 'the departing worker was drained into its frozen namespace');
  const ownReceipt = JSON.parse(await readFile(join(serviceRoot, 'ownership-active.json'), 'utf8'));
  assert.equal(ownReceipt.actor.id, 'bob'); assert.equal(ownReceipt.owner.id, 'bob');
  const cache = await readFile(join(serviceRoot, 'ownership-identities.json'), 'utf8');
  assert.equal(cache.includes('fixture-alice'), false); assert.equal(cache.includes('fixture-bob'), false);
  assert.equal((await stat(join(serviceRoot, 'ownership-identities.json'))).mode & 0o077, 0);
  await login('alice');
  const restored = await waitFor(value => value.state === 'ready' && value.actor.id === 'alice');
  assert.equal(restored.teamSquads, true);
  assert.deepEqual((await api('/api/ownership/owners', restored)).value.data.owners.map(item => item.owner.kind), ['user', 'team']);
  assert.equal((await api('/api/members', restored)).value.data.records[0].name, 'Alice private member', 'switching back restores the right owner without copying data');
  const teamOwner = { kind: 'team', issuer, id: 'real-team' };
  assert.equal((await api('/api/ownership/select', restored, 'POST', { owner: teamOwner, expectedGeneration: restored.generation })).response.status, 200);
  const team = await waitFor(value => value.state === 'ready' && value.owner.kind === 'team');
  assert.equal((await api('/api/members', team, 'POST', { id: 'team-eva', name: 'Team member' })).response.status, 200);
  // A brief account-service outage (api.autohand.ai answered 500s, 2026-11-17)
  // keeps a recently verified team usable instead of blocking it on one check.
  unavailable = true;
  assert.equal((await api('/api/members', team)).response.status, 200, 'an outage inside the grace window does not block a verified team');
  assert.equal((await context()).state, 'ready');
  // Past the grace window it blocks, then recovers by itself once the service answers.
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.notEqual((await api('/api/members', team)).response.status, 200, 'a long outage no longer vouches for team access');
  await waitFor(value => value.state === 'blocked');
  unavailable = false;
  const recovered = await waitFor(value => value.state === 'ready' && value.owner.kind === 'team');
  assert.equal((await api('/api/members', recovered)).value.data.records[0].name, 'Team member', 'an outage block retries without a Retry press');
  readOnly = true;
  assert.equal((await api('/api/members', recovered, 'POST', { id: 'forbidden' })).response.status, 409, 'permission changes fence the old execution context');
  const reader = await waitFor(value => value.state === 'ready' && value.canWrite === false);
  assert.equal((await api('/api/members', reader)).value.data.records[0].name, 'Team member');
  assert.equal((await api('/api/members', reader, 'POST', { id: 'forbidden' })).response.status, 403);
  membership = false;
  assert.equal((await api('/api/members', reader)).response.status, 404);
  assert.equal((await context()).state, 'blocked');
  const blocked = await context();
  const personal = { kind: 'user', issuer, id: 'alice' };
  assert.equal((await api('/api/ownership/select', blocked, 'POST', { owner: personal, expectedGeneration: blocked.generation })).response.status, 200);
  const resumed = await waitFor(value => value.state === 'ready' && value.owner.kind === 'user');
  // Team Squads behind squad_team_squads (ADR-0239).
  membership = true; readOnly = false;
  assert.equal((await api('/api/ownership/select', resumed, 'POST', { owner: teamOwner, expectedGeneration: resumed.generation })).response.status, 200);
  const flagged = await waitFor(value => value.state === 'ready' && value.owner.kind === 'team');
  flagDown = true;
  const asked = flagQueries.length;
  while (flagQueries.length < asked + 3) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal((await context()).generation, flagged.generation, 'an unreachable flag service keeps the last answer for this account');
  assert.equal((await api('/api/members', flagged)).response.status, 200);
  flagDown = false; teamSquadsFor.delete('alice');
  const fellBack = await waitFor(value => value.state === 'ready' && value.owner.kind === 'user' && value.actor.id === 'alice');
  assert.equal(fellBack.teamSquads, false, 'turning the flag off moves a team Squad to the Personal Squad');
  assert.deepEqual((await api('/api/ownership/owners', fellBack)).value.data.owners.map(item => item.owner.kind), ['user']);
  assert.equal((await api('/api/members', flagged)).response.status, 409, 'the team context is fenced once the flag is off');
  const savedChoice = JSON.parse(await readFile(join(serviceRoot, 'ownership-selections.json'), 'utf8'));
  assert.equal(Object.values(savedChoice.owners)[0]?.kind, 'team', 'the team choice is kept for when the flag returns');
  teamSquadsFor.add('alice');
  const flagBack = await waitFor(value => value.teamSquads === true);
  assert.equal(flagBack.owner.kind, 'user', 'turning the flag on lists teams without switching anyone');
  assert.equal(flagBack.generation, fellBack.generation);
  assert.deepEqual((await api('/api/ownership/owners', flagBack)).value.data.owners.map(item => item.owner.kind), ['user', 'team']);
  const flagFile = await readFile(join(serviceRoot, 'ownership-flags.json'), 'utf8');
  assert.equal(flagFile.includes('fixture-alice'), false, 'the saved flag answer holds no token');
  // A fresh install that cannot reach the flag service has team Squads off, even with a saved team choice.
  {
    const freshRoot = join(directory, 'flag-unreachable'), freshConfig = join(freshRoot, 'config.json');
    await writePersistentJson(freshConfig, { auth: { token: 'fixture-alice' } });
    const persist = async () => {
      const isolated = createOwnershipBroker({ rootDir, serviceRoot: freshRoot, configPath: freshConfig, identity: createIdentityService({ serviceRoot: freshRoot, configPath: freshConfig, origin: issuer, teamSquads: teamFlag(freshRoot) }), port: 0, workerEntry: join(rootDir, 'scripts/fixtures/ownership-worker.mjs') });
      const isolatedOrigin = await isolated.listen();
      try {
        for (let i = 0; i < 400; i++) { const value = (await (await fetch(`${isolatedOrigin}/api/ownership/context`)).json()).data; if (value.state === 'ready') return value; await new Promise(done => setTimeout(done, 25)); }
        throw new Error('isolated broker did not become ready');
      } finally { await isolated.close(); }
    };
    flagDown = true;
    await writePersistentJson(join(freshRoot, 'ownership-selections.json'), { version: 1, owners: { [Object.keys(savedChoice.owners)[0]]: teamOwner } });
    let opened = await persist();
    assert.equal(opened.teamSquads, false); assert.equal(opened.owner.kind, 'user', 'no answer means team Squads are off');
    flagDown = false;
    opened = await persist();
    assert.equal(opened.teamSquads, true); assert.equal(opened.owner.kind, 'team', 'with the flag on, the saved team choice opens');
    flagDown = true;
    opened = await persist();
    assert.equal(opened.teamSquads, true, 'a saved answer survives a restart during a flag-service outage');
    flagDown = false;
  }
  // AUTOHAND_SQUAD_FLAG_TEAM_SQUADS fixes the answer for checks without asking the service.
  {
    const before = flagQueries.length;
    const on = createTeamSquadsFlag({ origin: issuer, serviceRoot: directory, fixed: true }), off = createTeamSquadsFlag({ origin: issuer, serviceRoot: directory, fixed: false });
    assert.equal(await on.refresh({ token: 'fixture-bob', fingerprint: 'x' }), true); assert.equal(on.enabled('anything'), true);
    assert.equal(await off.refresh({ token: 'fixture-alice', fingerprint: 'y' }), false); assert.equal(off.enabled('y'), false);
    assert.equal(flagQueries.length, before);
  }
  await login(null);
  locked = await waitFor(value => value.state === 'signed_out');
  assert.equal(locked.actor, null); assert.equal((await api('/api/members', resumed)).response.status, 401);
  for (const mode of ['hang', ...(process.platform === 'win32' ? [] : ['descendants'])]) {
    const testRoot = join(directory, `lifecycle-${mode}`), testConfig = join(testRoot, 'config.json');
    await writePersistentJson(testConfig, { auth: { token: 'fixture-alice' } });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(testRoot, 'fixture-startup-mode'), mode);
    const isolated = createOwnershipBroker({ rootDir, serviceRoot: testRoot, configPath: testConfig, port: 0,
      identity: createIdentityService({ serviceRoot: testRoot, configPath: testConfig, origin: issuer }),
      workerEntry: join(rootDir, 'scripts/fixtures/ownership-startup-worker.mjs'), startupTimeoutMs: 2000, terminationGraceMs: 75 });
    const testOrigin = await isolated.listen();
    try {
      let lease;
      for (let i = 0; i < 200; i++) { lease = (await (await fetch(`${testOrigin}/api/ownership/context`)).json()).data; if (lease.state === 'ready') break; await new Promise(done => setTimeout(done, 25)); }
      assert.equal(lease.state, 'ready');
      const invoke = () => fetch(`${testOrigin}/api/members`, { headers: headers(lease) });
      if (mode === 'hang') {
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.equal((await invoke()).status, 503, 'startup timeout rejects only after the child is terminated');
          const pids = (await readFile(join(testRoot, 'fixture-startup-pids'), 'utf8')).trim().split('\n').map(Number);
          assert.equal(pids.length, attempt + 1);
          for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'a timed-out writable initializer cannot outlive its lease or a retry');
        }
      } else {
        assert.equal((await invoke()).status, 200);
        const receipt = JSON.parse(await readFile(join(testRoot, 'ownership-active.json'), 'utf8'));
        const descendant = Number(await readFile(join(receipt.dataRoot, 'fixture-descendant.pid'), 'utf8'));
        await isolated.close();
        const end = Date.now() + 5000;
        while (Date.now() < end) { try { process.kill(descendant, 0); } catch { break; } await new Promise(done => setTimeout(done, 25)); }
        assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' }, 'parent exit must not leave a private helper writing after transition');
      }
    } finally { await isolated.close(); }
  }
  console.log('Ownership broker: verified A → B → A isolation, stale requests/MCP revocation, private ports, manual legacy quarantine, team revocation, read-only access and squad_team_squads on/off/unreachable passed.');
} finally {
  await broker.close(); await new Promise(resolve => provider.close(resolve)); await rm(directory, { recursive: true, force: true });
}
