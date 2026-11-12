import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createMobileService } from '../server/mobile/service.mjs';
import { createMobileHTTP } from '../server/mobile/http.mjs';
import { pairingURL } from '../server/mobile/protocol.mjs';

if (!process.argv[2]) throw Error('Pass the Squad Mobile project directory.');
const mobile = resolve(process.argv[2]), directory = await mkdtemp(join(tmpdir(), 'squad-mobile-interop-'));
let server, approval, child, executions = 0;
try {
  const service = await createMobileService({ directory, computerName: 'Interop Mac', assertCurrent: async () => {}, execute: async (command, parameters) => {
    if (command === 'snapshot') return { computer: { id: service.computerID, name: 'Interop Mac', version: 'fixture', connectedAt: new Date().toISOString() },
      members: [{ id: 'fixture-eva', name: 'Eva', role: 'QA Engineer', presence: 'online', harness: 'fixture', executionMode: 'workspace', computerName: 'Interop Mac', workspace: '/fixture' }] };
    if (command === 'message') { executions++; return { messageID: 'fixture-message-one', status: 'queued' }; }
    if (command === 'conversation') return { turns: [{ id: 'fixture-message-one', prompt: 'Hello from CryptoKit', reply: 'Acknowledged', status: 'complete', error: '' }] };
    throw Error('Unexpected command.');
  } });
  server = createMobileHTTP(service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const offer = await service.createOffer(origin), offerFile = join(directory, 'offer.txt');
  await writeFile(offerFile, pairingURL(offer), { mode: 0o600 });
  let approving = false;
  approval = setInterval(async () => {
    if (approving) return;
    approving = true;
    try {
      const code = await readFile(offerFile + '.approve', 'utf8');
      const pending = service.status().pending;
      if (pending) { assert.equal(code, pending.code, 'Swift and Node must compute the same confirmation code'); await service.approve(offer.pairingID, code); }
    } catch (error) { if (error.code !== 'ENOENT') process.stderr.write(error.message + '\n'); }
    finally { approving = false; }
  }, 50);
  child = spawn('swift', ['run', '--package-path', mobile, 'SquadMobileProbe', offerFile], { stdio: 'inherit' });
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
  try { assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0, 'Swift HTTP probe must pass'); }
  finally { clearTimeout(timer); }
  assert.equal(executions, 1, 'the actual encrypted HTTP retry must not execute twice');
} finally {
  clearInterval(approval);
  if (child && child.exitCode === null) child.kill('SIGTERM');
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
