import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamService } from '../server/team/service.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-wait-budget-'));
let team;
try {
  team = createTeamService({ stateDir: directory, rootDir: process.cwd(), bridgeUrl: 'http://127.0.0.1:12345',
    members: async () => [{ id: 'a', name: 'Tatiana' }, { id: 'b', name: 'James Hill' }],
    isBusy: async () => false, deliver: async () => ({ reply: 'Keep the public API stable.' }) });
  const work = await team.openWork({ memberId: 'a', runId: 'wait-regression', maxWaitSeconds: 25 });
  const token = work.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN;
  const initialized = await team.dispatch(token, { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
  assert.equal(initialized.serverInfo.version, '2.0.0');
  let sequence = 0;
  const call = args => team.dispatch(token, { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name: 'squad_message', arguments: args } });
  const response = await call({ to: 'James Hill', message: 'What architectural boundaries should I respect?', wait_seconds: 60 });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  assert.equal(response.structuredContent.status, 'replied');
  assert.equal(response.structuredContent.requestedWaitSeconds, 60);
  assert.equal(response.structuredContent.effectiveWaitSeconds, 25);
  const long = await call({ to: 'James Hill', message: 'Same bounded transport.', wait_seconds: 600 });
  assert.notEqual(long.isError, true, JSON.stringify(long));
  assert.equal(long.structuredContent.effectiveWaitSeconds, 25);
  for (const wait_seconds of [-1, 601, 0.5, '60']) assert.equal((await call({ to: 'James Hill', message: 'Invalid budget', wait_seconds })).isError, true);
  const noWait = await team.openWork({ memberId: 'a', runId: 'no-wait', scope: 'no-wait', maxWaitSeconds: 0 });
  const sent = await team.dispatch(noWait.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN, { jsonrpc: '2.0', id: ++sequence, method: 'tools/call', params: { name: 'squad_message', arguments: { to: 'James Hill', message: 'Return a durable receipt.', wait_seconds: 60 } } });
  assert.notEqual(sent.isError, true, JSON.stringify(sent));
  assert.equal(sent.structuredContent.effectiveWaitSeconds, 0);
  assert(sent.structuredContent.deliveryId);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await team.store.read()).deliveries.some(row => ['queued', 'running'].includes(row.status))) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert(!(await team.store.read()).deliveries.some(row => ['queued', 'running'].includes(row.status)));
  console.log('PASS: the reported 60-second call delivers, longer requests stay transport-bounded, and invalid budgets are rejected.');
} finally { team?.close(); await rm(directory, { recursive: true, force: true }); }
