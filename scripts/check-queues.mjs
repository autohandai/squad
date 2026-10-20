#!/usr/bin/env node
// Durable member queues and the context gauge (ADR-0111): a real bridge in an
// isolated state dir with a disposable fake harness. No vendor, credentials,
// installed app, or provider requests are used.
//
// Proves: items run strictly in order one at a time; reorder moves the next
// item; cancel removes it; pause stops dispatch and resume continues; a member
// on a break is not dispatched; a crash leaves queued items queued, marks the
// interrupted one failed with the restart explanation and waits for an
// explicit resume; Stop cancels the running item and pauses; the context gauge
// reflects reported usage and is absent when the window is unknown. Plus pure
// checks for the gauge arithmetic and the conversation reconciliation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { contextGauge, contextUsageFromUsage } from '../server/queues/context-gauge.mjs';
import { RESTART_PAUSE_REASON, RESTART_REASON, STOP_PAUSE_REASON } from '../server/queues/store.mjs';
import { movedQueueIds, queuedItems, reconcileQueueMessages, contextGaugeLabel, contextWarning } from '../src/lib/member-queue.js';

// ---------- pure checks ----------
assert.deepEqual(contextUsageFromUsage({ input_tokens: 4000, cache_creation_input_tokens: 20000, cache_read_input_tokens: 60000, output_tokens: 10, modelUsage: { 'claude-x': { contextWindow: 200000 } } }), { contextTokens: 84000, contextWindow: 200000 }, 'Claude: cache tokens count as context and modelUsage carries the window');
assert.deepEqual(contextUsageFromUsage({ input_tokens: 90000, cached_input_tokens: 80000, output_tokens: 5 }), { contextTokens: 90000, contextWindow: 0 }, 'Codex: input already includes cached tokens, no window');
assert.equal(contextGauge({ contextTokens: 90000, contextWindow: 0 }), null, 'unknown window: no gauge');
assert.equal(contextGauge({ contextTokens: 0, contextWindow: 200000 }), null, 'unknown usage: no gauge');
const gauge = contextGauge({ contextTokens: 84000, contextWindow: 200000, model: 'claude-x', harness: 'claude', at: 't' });
assert.equal(gauge.percent, 42); assert.equal(gauge.warning, false);
assert.equal(contextGauge({ contextTokens: 170000, contextWindow: 200000 }).warning, true, '85% warns');
assert.equal(contextGauge({ contextTokens: 400000, contextWindow: 200000 }).percent, 100, 'capped');
assert.equal(contextGaugeLabel(gauge), 'Context 42%'); assert.equal(contextGaugeLabel(null), '');
assert.equal(contextWarning(gauge), ''); assert.ok(contextWarning({ percent: 91 }).includes('91%'));

const members = [{ id: 'eva', name: 'Eva' }];
const running = { id: 'i1', memberId: 'eva', text: 'Check the build', status: 'running', createdAt: '2026-10-13T03:10:00.000Z', startedAt: '2026-10-13T03:19:30.000Z', updatedAt: '2026-10-13T03:19:30.000Z' };
const queued = { id: 'i2', memberId: 'eva', text: 'Then the tests', status: 'queued', createdAt: '2026-10-13T03:11:00.000Z', updatedAt: '2026-10-13T03:11:00.000Z' };
const olderMessage = { id: 'm1', role: 'user', body: 'Earlier', createdAt: '2026-10-13T03:00:00.000Z' };
const newerMessage = { id: 'm2', role: 'agent', body: 'Newest', createdAt: '2026-10-13T03:19:51.000Z' };
const reconciled = reconcileQueueMessages({ eva: [olderMessage, newerMessage] }, { eva: { memberId: 'eva', items: [running, queued] } }, members);
assert.deepEqual(reconciled.eva.map((m) => m.id), ['m1', 'queue-i1-u', 'queue-i1-a', 'm2'], 'a started item lands as user + reply at its start time; queued items stay above the composer');
assert.equal(reconciled.eva[1].body, 'Check the build'); assert.equal(reconciled.eva[2].status, 'loading'); assert.ok(reconciled.eva[2].activityLabel.includes('Eva'));
const done = { ...running, status: 'done', reply: 'Build is green.', finishedAt: '2026-10-13T03:20:00.000Z', updatedAt: '2026-10-13T03:20:00.000Z', result: { durationMs: 30000, workspace: '/w' } };
const updated = reconcileQueueMessages(reconciled, { eva: { memberId: 'eva', items: [done, queued] } }, members);
assert.deepEqual(updated.eva.map((m) => m.id), ['m1', 'queue-i1-u', 'queue-i1-a', 'm2'], 'a finished item updates in place');
assert.equal(updated.eva[2].status, 'complete'); assert.equal(updated.eva[2].body, 'Build is green.'); assert.equal(updated.eva[2].durationMs, 30000);
assert.equal(reconcileQueueMessages(updated, { eva: { memberId: 'eva', items: [done, queued] } }, members), updated, 'no change returns the same object');
const failed = { ...running, status: 'failed', error: RESTART_REASON, interrupted: true, updatedAt: '2026-10-13T03:21:00.000Z' };
const recovered = reconcileQueueMessages(updated, { eva: { memberId: 'eva', items: [failed] } }, members);
assert.equal(recovered.eva[2].status, 'error'); assert.ok(recovered.eva[2].body.includes('interrupted when Squad restarted')); assert.equal(recovered.eva[2].interrupted, true);
const neverRan = { ...queued, status: 'cancelled', finishedAt: 't' };
assert.equal(reconcileQueueMessages(updated, { eva: { memberId: 'eva', items: [done, neverRan] } }, members), updated, 'a cancelled item that never ran leaves no trace');
const fresh = [{ id: 'eva', name: 'Eva', conversationStartedAt: '2026-10-13T04:00:00.000Z' }];
assert.deepEqual(reconcileQueueMessages({ eva: [] }, { eva: { memberId: 'eva', items: [done] } }, fresh), { eva: [] }, '/new does not refill with older items');
const queue = { items: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }, { id: 'c', status: 'queued' }, { id: 'r', status: 'running' }] };
assert.deepEqual(movedQueueIds(queue, 'c', -1), ['a', 'c', 'b']); assert.equal(movedQueueIds(queue, 'a', -1), null); assert.equal(movedQueueIds(queue, 'c', 1), null);
assert.deepEqual(queuedItems(queue).map((i) => i.id), ['a', 'b', 'c']);
console.log('Queue pure checks passed: gauge arithmetic, reconciliation, reorder.');

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-queues-'));
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-codex');
const rootDir = resolve(new URL('..', import.meta.url).pathname);
const socket = createServer();
await new Promise((r) => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
let bridge;
let logs = '';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn().catch(() => null); if (value) return value; await delay(25); }
  throw new Error(`${label} timed out; bridge: ${logs.slice(-3000)}`);
}
const api = async (path, body, method) => {
  const response = await fetch(origin + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); return { status: response.status, ...data };
};
const calls = async () => (await readFile(callsFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const starts = async (member) => (await calls()).filter((c) => c.member === member && c.kind === 'start');
const member = (id, harness = 'codex') => ({ id, name: id, harness: { id: harness, executablePath: fake }, projects: [{ path: rootDir }] });
const payload = (id, prompt, harness) => ({ agentId: id, agent: member(id, harness), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.' });
const enqueue = (id, text) => api(`/api/queues/${id}/items`, { ...payload(id, text), text });
const queueOf = async (id) => (await api(`/api/queues/${id}`)).data;
const itemOf = async (id, itemId) => (await queueOf(id)).items.find((item) => item.id === itemId);
const release = (token) => writeFile(join(directory, `release-${token}`), '');
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CODEX_HOME: join(directory, 'codex'), OPENAI_API_KEY: 'fixture-only-no-provider', ANTHROPIC_API_KEY: 'fixture-only-no-provider' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/queues')).success, 'bridge start', 30000);
}
async function stopBridge(signal = 'SIGTERM') {
  if (!bridge || bridge.exitCode !== null) return;
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill(signal);
  await Promise.race([exited, delay(4000)]);
  if (bridge.exitCode === null && bridge.signalCode === null) { bridge.kill('SIGKILL'); await exited; }
}
try {
  await mkdir(join(directory, 'codex'), { recursive: true });
  await writeFile(join(directory, 'codex', 'auth.json'), '{}');
  await writeFile(fake, `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');
const file=${JSON.stringify(callsFile)};const dir=${JSON.stringify(directory)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}
if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'fixture'}));process.exit(0);}
const claude=args[0]==='-p';
// The person's message follows any context block Squad prepends for Codex (ADR-0134).
const prompt=String(claude?args[1]:args.at(-1)).split('</operating_instructions>').pop().split('</turn_context>').pop();
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const append=x=>fs.appendFileSync(file,JSON.stringify(x)+'\\n');
const wait=/WAIT:([a-z0-9]+)/.exec(prompt);
append({kind:'start',member,wait:wait?wait[1]:'',prompt:String(prompt).slice(0,80),args:args.slice(0,3)});
process.on('SIGTERM',()=>{append({kind:'abort',member});process.exit(143);});
const emit=x=>console.log(JSON.stringify(x));
if(claude){emit({type:'system',subtype:'init',session_id:'fixture-'+member});}else{emit({type:'thread.started',thread_id:'fixture-'+member});}
const finish=()=>{
 const text=wait?'Done '+wait[1]:'Inspected.';
 if(claude){
  emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
  emit({type:'result',subtype:'success',usage:{input_tokens:4000,cache_creation_input_tokens:20000,cache_read_input_tokens:60000,output_tokens:10},modelUsage:{'claude-fixture':{inputTokens:4000,outputTokens:10,contextWindow:200000}}});
 }else{
  emit({type:'item.completed',item:{id:'reply',type:'agent_message',text}});
  emit({type:'turn.completed',usage:{input_tokens:90000,cached_input_tokens:80000,output_tokens:5}});
 }
 append({kind:'finish',member,prompt:String(prompt).slice(0,80)});
 process.exit(0);
};
if(!wait){finish();}else{
 const flag=path.join(dir,'release-'+wait[1]);
 const timer=setInterval(()=>{if(fs.existsSync(flag)){clearInterval(timer);finish();}},40);
 setTimeout(()=>{append({kind:'timeout',member});process.exit(1);},60000);
}
`);
  await chmod(fake, 0o700);
  await startBridge();

  // 1. Three follow-ups while a browser-owned reply runs: all stay queued.
  const hold = fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload('q1', 'WAIT:hold1')) });
  await until(async () => (await starts('q1')).length === 1, 'browser chat in flight');
  const a = (await enqueue('q1', 'WAIT:qa')).data; const b = (await enqueue('q1', 'Inspect B')).data; const c = (await enqueue('q1', 'WAIT:qc')).data;
  assert.equal(a.status, 'queued'); assert.equal(a.launch, undefined, 'the public item never carries the launch payload');
  await delay(1200);
  let q1 = await queueOf('q1');
  assert.deepEqual(queuedItems(q1).map((i) => i.id), [a.id, b.id, c.id]);
  assert.equal((await starts('q1')).length, 1, 'nothing is dispatched while the member is busy');

  // 2. Reorder moves the next item; cancel removes one.
  const reordered = await api('/api/queues/q1/reorder', { ids: [c.id, a.id, b.id] });
  assert.equal(reordered.success, true); assert.deepEqual(reordered.data.items.filter((i) => i.status === 'queued').map((i) => i.id), [c.id, a.id, b.id]);
  assert.equal((await api('/api/queues/q1/reorder', { ids: [c.id, a.id] })).status, 400, 'a partial order is refused');
  assert.equal((await api(`/api/queues/items/${b.id}/cancel`, {})).data.status, 'cancelled');
  assert.equal((await api(`/api/queues/items/${a.id}/update`, { text: 'WAIT:qa edited' })).data.text, 'WAIT:qa edited');
  q1 = await queueOf('q1'); assert.deepEqual(queuedItems(q1).map((i) => i.id), [c.id, a.id]);

  // 3. Once the reply finishes, items run strictly in order, one at a time.
  await release('hold1');
  await (await hold).text();
  await until(async () => (await itemOf('q1', c.id)).status === 'running', 'next item starts when the member is free');
  await delay(900);
  assert.equal((await starts('q1')).length, 2, 'the second item waits for the first');
  assert.equal((await itemOf('q1', a.id)).status, 'queued');
  await release('qc');
  const cDone = await until(async () => { const i = await itemOf('q1', c.id); return i.status === 'done' ? i : null; }, 'item C done');
  assert.equal(cDone.reply, 'Done qc'); assert.ok(cDone.result.durationMs >= 0); assert.equal(cDone.result.workspace, rootDir);
  await until(async () => (await itemOf('q1', a.id)).status === 'running', 'item A starts after C');
  await release('qa');
  await until(async () => (await itemOf('q1', a.id)).status === 'done', 'item A done');
  assert.deepEqual((await starts('q1')).map((s) => s.wait), ['hold1', 'qc', 'qa'], 'strict order: C then the edited A');
  assert.ok((await starts('q1'))[2].prompt.includes('edited'), 'the edited text is what ran');
  assert.equal((await api('/api/queues')).data.queues.q1.paused, false);

  // 4. Pause stops dispatch; resume continues.
  await api('/api/queues/q1/pause', {});
  const d = (await enqueue('q1', 'Inspect D')).data;
  await delay(1300);
  assert.equal((await itemOf('q1', d.id)).status, 'queued', 'a paused queue does not dispatch');
  assert.equal((await starts('q1')).length, 3);
  q1 = await queueOf('q1'); assert.equal(q1.paused, true); assert.equal(q1.pauseReason, 'Paused by you.');
  await api('/api/queues/q1/resume', {});
  await until(async () => (await itemOf('q1', d.id)).status === 'done', 'resume dispatches');

  // 5. A member on a break is not dispatched; ending the break lets it run.
  await api('/api/members/q2/break', { active: true });
  const e = (await enqueue('q2', 'Inspect E')).data;
  await delay(1300);
  assert.equal((await itemOf('q2', e.id)).status, 'queued'); assert.equal((await starts('q2')).length, 0, 'no spawn for a member on a break');
  await api('/api/members/q2/break', { active: false });
  await until(async () => (await itemOf('q2', e.id)).status === 'done', 'break off dispatches');

  // 6. Stop cancels the running item and pauses the queue.
  const f = (await enqueue('q3', 'WAIT:qf')).data; const g = (await enqueue('q3', 'Inspect G')).data;
  await until(async () => (await starts('q3')).length === 1, 'F child running');
  const stopped = await api('/api/members/q3/stop', {});
  assert.equal(stopped.success, true);
  await until(async () => (await itemOf('q3', f.id)).status === 'cancelled', 'stop cancels the running item');
  await until(async () => (await calls()).some((x) => x.member === 'q3' && x.kind === 'abort'), 'child aborted');
  let q3 = await queueOf('q3');
  assert.equal(q3.paused, true); assert.equal(q3.pauseReason, STOP_PAUSE_REASON); assert.equal((await itemOf('q3', g.id)).status, 'queued');
  await delay(900); assert.equal((await starts('q3')).length, 1, 'a stopped queue stays stopped');
  await api('/api/queues/q3/resume', {});
  await until(async () => (await itemOf('q3', g.id)).status === 'done', 'resume after stop');
  // The composer's stop route does the same from the queue side.
  const h0 = (await enqueue('q3', 'WAIT:qh0')).data;
  await until(async () => (await starts('q3')).length === 3, 'H0 child running');
  const queueStop = await api('/api/queues/q3/stop', {});
  assert.equal(queueStop.data.cancelled, h0.id); assert.equal(queueStop.data.paused, true);
  await until(async () => (await itemOf('q3', h0.id)).status === 'cancelled', 'queue stop cancels');
  await api('/api/queues/q3/resume', {});

  // 7. Context gauge: Claude reports usage and a window; Codex reports no window.
  const claudeChat = await api('/api/chat', payload('ctx-claude', 'Inspect fixture', 'claude'));
  assert.equal(claudeChat.success, true, JSON.stringify(claudeChat));
  const context = await until(async () => { const r = await api('/api/queues/context'); return r.data['ctx-claude'] ? r.data : null; }, 'gauge after a Claude turn');
  assert.equal(context['ctx-claude'].percent, 42); assert.equal(context['ctx-claude'].usedTokens, 84000); assert.equal(context['ctx-claude'].window, 200000); assert.equal(context['ctx-claude'].warning, false);
  assert.equal(context.q1, undefined, 'Codex reported usage but no window: no gauge');
  const telemetry = (await readFile(join(directory, 'squad', 'telemetry.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(telemetry.some((r) => r.metadata.agentId === 'q1' && r.metadata.contextTokens === 90000 && !r.metadata.contextWindow), 'the Codex usage itself was recorded');
  assert.equal((await queueOf('ctx-claude')).context.percent, 42, 'the member queue carries its gauge');

  // 8. Crash with an item in flight: it fails with the explanation, the rest
  //    stays queued, and nothing runs until the person resumes.
  const h = (await enqueue('q4', 'WAIT:qh')).data; const i = (await enqueue('q4', 'Inspect I')).data;
  await until(async () => (await starts('q4')).length === 1, 'H child running');
  await stopBridge('SIGKILL');
  await startBridge();
  const q4 = await queueOf('q4');
  const hAfter = q4.items.find((x) => x.id === h.id); const iAfter = q4.items.find((x) => x.id === i.id);
  assert.equal(hAfter.status, 'failed'); assert.equal(hAfter.error, RESTART_REASON); assert.equal(hAfter.interrupted, true);
  assert.equal(iAfter.status, 'queued'); assert.equal(q4.paused, true); assert.equal(q4.pauseReason, RESTART_PAUSE_REASON);
  assert.equal((await queueOf('q1')).items.find((x) => x.id === d.id).status, 'done', 'finished items survive the restart');
  await delay(1300);
  assert.equal((await starts('q4')).length, 1, 'nothing is re-sent after a restart');
  assert.equal((await api('/api/queues/context')).data['ctx-claude'].percent, 42, 'the gauge survives the restart');
  await api('/api/queues/q4/resume', {});
  await until(async () => (await itemOf('q4', i.id)).status === 'done', 'explicit resume continues the queue');

  // 9. Clear cancels what is still queued, nothing else.
  await api('/api/queues/q4/pause', {});
  const j = (await enqueue('q4', 'Inspect J')).data;
  const cleared = await api('/api/queues/q4/clear', {});
  assert.deepEqual(cleared.data.cleared, [j.id]); assert.equal((await itemOf('q4', i.id)).status, 'done');

  console.log('Queue bridge checks passed: strict FIFO one at a time, reorder, edit, cancel, pause/resume, break, stop, crash recovery with explicit resume, clear, Claude gauge present and Codex gauge absent.');
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
