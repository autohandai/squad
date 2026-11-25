// Computers (ADR-0282): SSH computers, their forwards to another Squad,
// the relay address, and the /api/computers route. A fake `ssh` stands in for
// a real remote: it records its arguments, refuses one host, and implements
// `-N -L` as a real TCP forward, so the tunnel lifecycle is exercised end to end.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer as createHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSshComputer, createSshComputers, sshArguments, sshProblem } from '../server/computers/ssh.mjs';
import { AUTOHAND_RELAY, relayDescription, relayOrigin } from '../server/mobile/controller.mjs';
import { CLOUD_PROVIDERS, cloudSetupSteps } from '../src/lib/cloud-computers.js';

const root = await mkdtemp(join(tmpdir(), 'squad-computers-'));
const home = join(root, 'home'), state = join(root, 'state'), log = join(root, 'ssh.log');
await mkdir(join(home, '.ssh'), { recursive: true });
await writeFile(join(home, '.ssh', 'id_ed25519'), 'fixture key\n', { mode: 0o600 });
await writeFile(join(home, '.ssh', 'id_ed25519.pub'), 'ssh-ed25519 fixture\n');
await writeFile(join(home, '.ssh', 'config'), '');
const fakeSsh = join(root, 'ssh');
await writeFile(fakeSsh, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const net = require('node:net');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const dest = args[args.indexOf('--') + 1] || '';
if (dest.endsWith('@refuse.test')) { process.stderr.write('user@refuse.test: Permission denied (publickey).\\n'); process.exit(255); }
if (dest.endsWith('@nowhere.test')) { process.stderr.write('ssh: Could not resolve hostname nowhere.test: nodename nor servname provided\\n'); process.exit(255); }
const at = args.indexOf('-L');
if (at < 0) process.exit(0);
const [, localPort, , remotePort] = args[at + 1].split(':');
const server = net.createServer(socket => { const upstream = net.connect(Number(remotePort), '127.0.0.1'); socket.pipe(upstream).pipe(socket); upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); });
server.on('error', () => { process.stderr.write('bind: Address already in use\\nchannel_setup_fwd_listener_tcpip: cannot listen to port: ' + localPort + '\\nCould not request local forwarding.\\n'); process.exit(255); });
server.listen(Number(localPort), '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`);
await chmod(fakeSsh, 0o755);

// A Squad bridge "over there": it asks for a token, like a real one.
let runtimeHits = 0;
const remoteSquad = createHttp((req, res) => { if (req.url === '/api/runtime') runtimeHits++; res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"success":false,"error":"token required"}'); });
await new Promise(done => remoteSquad.listen(0, '127.0.0.1', done));
const squadPort = remoteSquad.address().port;
const deadPort = await new Promise(done => { const probe = createHttp(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); }); });

const computers = createSshComputers({ squadStateDir: state, sshPath: fakeSsh, home });
const until = async (check, label, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); } throw Error(`${label} timed out`); };
try {
  // Validation never lets ssh read a host or user as an option.
  for (const bad of [{ user: 'igor', host: '-oProxyCommand=touch /tmp/x' }, { user: '-x', host: 'studio.local' }, { user: 'ig or', host: 'studio.local' }, { user: 'igor', host: 'studio.local', port: 0 }, { user: 'igor', host: 'a b' }])
    assert.throws(() => cleanSshComputer(bad, { home }), /./, JSON.stringify(bad));
  assert.throws(() => cleanSshComputer({ user: 'igor', host: 'studio.local', identityFile: '/etc/passwd' }, { home }), /~\/\.ssh/);
  assert.deepEqual(cleanSshComputer({ user: 'igor', host: 'studio.local', identityFile: '~/.ssh/id_ed25519' }, { home }), { label: 'studio.local', user: 'igor', host: 'studio.local', port: 22, identityFile: join(home, '.ssh', 'id_ed25519'), remotePort: 19821 });
  assert.equal(cleanSshComputer({ user: 'root', host: '[::1]' }, { home }).label, '::1');
  const args = sshArguments({ user: 'igor', host: 'studio.local', port: 2222, identityFile: '' }, { command: ['true'] });
  assert.ok(args.includes('BatchMode=yes') && args.includes('StrictHostKeyChecking=accept-new'), 'never prompts for a password or a host key');
  assert.deepEqual(args.slice(-3), ['--', 'igor@studio.local', 'true'], 'the destination comes after --');
  assert.match(sshProblem('Permission denied (publickey).', { user: 'a', host: 'b', port: 22 }), /authorized_keys/);
  assert.deepEqual((await computers.keys()).map(key => key.name), ['id_ed25519'], 'keys are listed by name, private keys with a .pub only');

  // Test: signed in + Squad answers; refused key; unknown host; no Squad there.
  const good = { label: 'Studio', user: 'igor', host: 'studio.local', remotePort: squadPort, identityFile: '~/.ssh/id_ed25519' };
  const tested = await computers.test(good);
  assert.deepEqual([tested.reachable, tested.squad], [true, true], tested.message);
  assert.match(tested.message, /Squad is running there/);
  assert.ok(runtimeHits >= 1, 'the test reached Squad through the forward');
  assert.match((await computers.test({ user: 'igor', host: 'refuse.test' })).message, /refused the key/);
  assert.match((await computers.test({ user: 'igor', host: 'nowhere.test' })).message, /could not be found/);
  const noSquad = await computers.test({ ...good, remotePort: deadPort });
  assert.deepEqual([noSquad.reachable, noSquad.squad], [true, false]);
  assert.match(noSquad.message, /isn’t answering on port/);

  // Add: saved 0600, the forward stays open and reaches Squad over there.
  await assert.rejects(computers.add({ user: 'igor', host: 'refuse.test' }), /refused the key/, 'an unreachable computer is not saved');
  const added = await computers.add(good);
  assert.equal((await stat(join(state, 'computers.json'))).mode & 0o777, 0o600);
  assert.ok(!(await readFile(join(state, 'computers.json'), 'utf8')).includes('fixture key'), 'no key material is stored');
  await until(async () => (await computers.list())[0]?.state === 'connected', 'forward connected');
  const [saved] = await computers.list();
  assert.equal(saved.identityFile, '~/.ssh/id_ed25519', 'the key path is shown from home');
  const through = await fetch(`${saved.localUrl}/api/runtime`);
  assert.equal(through.status, 401, 'the forward reaches the other Squad, which still asks for its token');
  await assert.rejects(computers.add(good), /already saved/);
  const forwardArgs = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.includes('-N')).at(-1);
  assert.ok(forwardArgs.includes('ExitOnForwardFailure=yes') && forwardArgs.includes(`127.0.0.1:${new URL(saved.localUrl).port}:127.0.0.1:${squadPort}`), 'loopback on both ends');

  // A dropped connection comes back by itself.
  const { execSync } = await import('node:child_process');
  execSync(`pkill -f -- "-L 127.0.0.1:${new URL(saved.localUrl).port}:"`);
  await until(async () => (await computers.list())[0]?.state === 'reconnecting', 'drop noticed', 5000).catch(() => {});
  await until(async () => (await computers.list())[0]?.state === 'connected' && (await fetch(`${saved.localUrl}/api/runtime`).then(r => r.status).catch(() => 0)) === 401, 'forward reopened', 10000);

  // Restart: a new store restores the saved forward.
  await computers.close();
  const restarted = createSshComputers({ squadStateDir: state, sshPath: fakeSsh, home });
  await restarted.start();
  await until(async () => (await restarted.list())[0]?.state === 'connected', 'restored after restart');
  const removed = await restarted.remove(added.computer.id);
  assert.equal(removed.localUrl, saved.localUrl);
  await until(async () => (await fetch(`${saved.localUrl}/api/runtime`).then(() => false).catch(() => true)), 'forward closed on remove');
  assert.deepEqual(await restarted.list(), []);
  await restarted.close();

  // The relay: Squad relay by Autohand unless the person chose their own.
  assert.equal(AUTOHAND_RELAY.name, 'Squad relay by Autohand');
  assert.equal(relayOrigin(''), '');
  assert.equal(relayOrigin(AUTOHAND_RELAY.url + '/'), '', 'choosing Autohand’s address is the default');
  assert.equal(relayOrigin('https://relay.example.com/'), 'https://relay.example.com');
  for (const bad of ['http://relay.example.com', 'https://relay.example.com/v1', 'relay.example.com', 'https://user:pw@relay.example.com', 'ftp://x'])
    assert.throws(() => relayOrigin(bad), /HTTPS address/, bad);
  assert.deepEqual(relayDescription({ relayUrl: '' }, { connected: true, latencyMs: 42, lastSeenAt: '2026-11-26T00:00:00.000Z' }),
    { name: 'Squad relay by Autohand', url: AUTOHAND_RELAY.url, custom: false, connected: true, latencyMs: 42, lastSeenAt: '2026-11-26T00:00:00.000Z', error: '' });
  assert.equal(relayDescription({ relayUrl: 'https://relay.example.com' }, null).name, 'relay.example.com');

  // Cloud providers are data with steps; none claims a price.
  assert.ok(CLOUD_PROVIDERS.length >= 3 && CLOUD_PROVIDERS.every(row => row.id && row.name && !/\$|€|month/i.test(JSON.stringify(row))));
  assert.match(cloudSetupSteps(CLOUD_PROVIDERS[0]).join(' '), /Over SSH/);

  // The route, as the bridge calls it.
  const { handle } = await import('../server/routes/computers.route.mjs');
  const call = async (method, path, body) => {
    let status = 0, payload = null;
    const req = { method }; const url = new URL(`http://bridge${path}`);
    const ctx = { squadStateDir: join(root, 'route-state'), sshPath: fakeSsh, homeDir: home, readBody: async () => body, json: (_res, code, value) => { status = code; payload = value; } };
    assert.equal(await handle(req, {}, url, ctx), true);
    return { status, payload };
  };
  const listed = await call('GET', '/api/computers');
  assert.equal(listed.status, 200); assert.ok(listed.payload.data.thisComputer.name && Array.isArray(listed.payload.data.ssh) && listed.payload.data.providers.length);
  assert.equal((await call('POST', '/api/computers/ssh/test', { user: 'igor', host: '-oProxyCommand=x' })).status, 400);
  const account = await call('GET', '/api/computers/account');
  assert.equal(account.payload.data.available, false, 'signed out: no account list');
  assert.equal((await call('DELETE', '/api/computers/ssh/00000000-0000-0000-0000-000000000000')).status, 404);
  console.log('Computers checks passed: SSH validation never yields an ssh option, test sentences (signed in + Squad, refused key, unknown host, no Squad), saved 0600 without key material, loopback forward reaches the other Squad and comes back after a drop and a restart, remove closes it, relay default/custom address rules, provider data without prices, /api/computers route.');
} finally {
  await computers.close().catch(() => {});
  remoteSquad.close();
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
