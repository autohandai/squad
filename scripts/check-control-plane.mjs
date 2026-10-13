#!/usr/bin/env node
// Control plane check (ADR-0095): a real bridge in an isolated state dir,
// seeded with a member mirror and channel state, driven through the stdio MCP
// server in both framings. A fake Codex executable stands in for the harness;
// no vendor, credentials, installed app or provider requests are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  TOOL_NAMES, decodeFrames, goalOutcome, parseBridgeUrl, redactSecrets, runOutcome, validateArgs, TOOLS,
} from '../server/control-plane/control-plane.mjs';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const mcpEntry = join(rootDir, 'server', 'control-plane', 'mcp-server.mjs');
const SECRET_A = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET_B = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123';
const EXPECTED_TOOLS = ['list_members', 'list_channels', 'get_messages', 'search', 'create_member', 'create_channel', 'send_message', 'wait_for_reply', 'interrupt', 'set_model'];

let passed = 0;
const ok = (condition, label) => { assert.ok(condition, label); passed += 1; };
const eq = (actual, expected, label) => { assert.equal(actual, expected, label); passed += 1; };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- pure checks ----------------------------------------------------------

eq(parseBridgeUrl('http://127.0.0.1:19821'), 'http://127.0.0.1:19821', 'loopback v4 accepted');
eq(parseBridgeUrl('http://localhost:19821/'), 'http://localhost:19821', 'localhost accepted');
eq(parseBridgeUrl('http://[::1]:19821'), 'http://[::1]:19821', 'loopback v6 accepted');
for (const bad of ['http://10.1.2.3:19821', 'http://example.com', 'http://192.168.1.5:19821', 'http://0.0.0.0:19821', 'ftp://127.0.0.1', 'http://user:pw@127.0.0.1:19821']) {
  assert.throws(() => parseBridgeUrl(bad), /this machine|http or https|credentials/, `refused ${bad}`); passed += 1;
}
const redacted = redactSecrets(`token ${SECRET_A} and ${SECRET_B} AKIAABCDEFGHIJKLMNOP Bearer abcdefghijklmnopqrstuvwxyz0123 api_key=supersecretvalue path /Users/someone/Documents/autohand/web/prototypes/autohandSWE/server.mjs eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef123456`);
ok(!redacted.includes(SECRET_A) && !redacted.includes(SECRET_B) && !redacted.includes('AKIAABCDEFGHIJKLMNOP') && !redacted.includes('supersecretvalue') && !redacted.includes('eyJhbGci'), 'secrets redacted');
ok(redacted.includes('/Users/someone/Documents/autohand/web/prototypes/autohandSWE/server.mjs'), 'paths survive redaction');
ok(redacted.includes('api_key=[redacted]'), 'key=value keeps the key');
eq(runOutcome({ status: 'running' }), null, 'live run keeps waiting');
eq(runOutcome({ status: 'completed' }).outcome, 'settled', 'completed run settles');
eq(runOutcome({ status: 'completed', channelActions: [{ status: 'proposed' }] }).outcome, 'needs-you', 'proposal needs you');
eq(runOutcome({ status: 'stopped' }).outcome, 'failed', 'stopped run fails');
eq(runOutcome({ status: 'failed', logs: [{ source: 'stderr', line: `boom ${SECRET_A}` }] }).reason.includes(SECRET_A), false, 'failure reason redacted');
eq(goalOutcome({ status: 'paused' }).outcome, 'needs-you', 'paused goal needs you');
eq(goalOutcome({ status: 'blocked' }).outcome, 'needs-you', 'blocked goal needs you');
eq(goalOutcome({ status: 'cancelled' }).outcome, 'failed', 'cancelled goal fails');
eq(goalOutcome({ status: 'running' }), null, 'running goal keeps waiting');
const getMessagesSchema = TOOLS.find((tool) => tool.name === 'get_messages').inputSchema;
ok(validateArgs(getMessagesSchema, { bogus: 1 }).some((problem) => problem.includes('not a known field')), 'unknown fields rejected');
ok(validateArgs(getMessagesSchema, { limit: 999 }).some((problem) => problem.includes('at most')), 'bounds enforced');
eq(validateArgs(getMessagesSchema, { channel_id: 'c', limit: 5 }).length, 0, 'valid arguments pass');
const mixed = Buffer.concat([Buffer.from('{"a":1}\n'), Buffer.from('Content-Length: 7\r\n\r\n{"b":2}'), Buffer.from('\n{"c":3}\nContent-Length: 2')]);
const decoded = decodeFrames(mixed);
assert.deepEqual(decoded.frames.map((frame) => [JSON.parse(frame.body.toString()), frame.framing]), [[{ a: 1 }, 'newline'], [{ b: 2 }, 'header'], [{ c: 3 }, 'newline']]); passed += 1;
eq(decoded.rest.toString(), 'Content-Length: 2', 'partial header kept for the next chunk');
assert.deepEqual(TOOL_NAMES, EXPECTED_TOOLS); passed += 1;

// ---- isolated bridge ------------------------------------------------------

const directory = await mkdtemp(join(tmpdir(), 'squad-control-plane-'));
const squadHome = join(directory, 'squad');
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-codex');
const socket = createServer();
await new Promise((done) => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
let bridge = null;
let logs = '';
const children = new Set();

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

function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: {
      ...process.env,
      AUTOHAND_SQUAD_HOME: squadHome,
      AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'),
      AUTOHAND_HOME: join(directory, 'autohand'),
      AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'),
      CODEX_HOME: join(directory, 'codex'),
      OPENAI_API_KEY: 'fixture-only-no-provider',
      ANTHROPIC_API_KEY: 'fixture-only-no-provider',
      AUTOHAND_SQUAD_BRIDGE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (data) => { logs += data; });
  bridge.stderr.on('data', (data) => { logs += data; });
  return until(async () => (await api('/api/channels')).success, 'bridge start');
}
async function stopBridge() {
  if (!bridge) return;
  const child = bridge; bridge = null;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(4000).then(() => child.kill('SIGKILL'))]);
}

// ---- stdio MCP client -----------------------------------------------------

function mcpClient(framing, args = ['--bridge', origin]) {
  const child = spawn(process.execPath, [mcpEntry, ...args], { cwd: directory, env: { ...process.env, AUTOHAND_SQUAD_BRIDGE_URL: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = Buffer.alloc(0);
  let stderr = '';
  let raw = '';
  const waiting = new Map();
  const exited = new Promise((done) => child.once('exit', (code) => done(code)));
  child.stderr.on('data', (data) => { stderr += data; });
  const deliver = (message) => {
    for (const item of Array.isArray(message) ? message : [message]) {
      const waiter = waiting.get(item.id);
      if (waiter) { waiting.delete(item.id); waiter(item); }
    }
  };
  child.stdout.on('data', (chunk) => {
    stdout = Buffer.concat([stdout, chunk]);
    raw += chunk.toString();
    // Independent parser: one Content-Length frame or one line at a time.
    for (;;) {
      const text = stdout.toString();
      if (!text.trim()) { stdout = Buffer.alloc(0); break; }
      const header = text.match(/^Content-Length:\s*(\d+)\r\n\r\n/);
      if (header) {
        const size = Number(header[1]);
        const start = Buffer.byteLength(header[0]);
        if (stdout.length < start + size) break;
        deliver(JSON.parse(stdout.subarray(start, start + size).toString()));
        stdout = stdout.subarray(start + size);
        continue;
      }
      const end = stdout.indexOf('\n');
      if (end < 0) break;
      const line = stdout.subarray(0, end).toString();
      stdout = stdout.subarray(end + 1);
      if (line.trim()) deliver(JSON.parse(line));
    }
  });
  let nextId = 1;
  const send = (message) => {
    const encoded = Buffer.from(JSON.stringify(message));
    child.stdin.write(framing === 'header' ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded]) : Buffer.concat([encoded, Buffer.from('\n')]));
  };
  const request = (method, params, timeout = 30000) => new Promise((done, fail) => {
    const id = nextId++;
    const timer = setTimeout(() => { waiting.delete(id); fail(new Error(`${method} (${framing}) got no reply in ${timeout} ms; stderr: ${stderr.slice(-800)}`)); }, timeout);
    waiting.set(id, (message) => { clearTimeout(timer); done(message); });
    send({ jsonrpc: '2.0', id, method, params });
  });
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
  const call = async (name, args = {}, timeout) => {
    const response = await request('tools/call', { name, arguments: args }, timeout);
    if (response.error) return { rpcError: response.error };
    return { ...response.result, data: response.result.structuredContent };
  };
  const close = async () => { child.stdin.end(); await Promise.race([exited, delay(3000).then(() => child.kill('SIGKILL'))]); children.delete(child); };
  return { request, notify, call, close, exited, stderr: () => stderr, raw: () => raw, framingMatches: () => framing === 'header' ? /^Content-Length: \d+\r\n\r\n\{/.test(raw) : raw.startsWith('{') };
}

try {
  // Seed the state the app would have written.
  await mkdir(squadHome, { recursive: true });
  await mkdir(join(directory, 'codex'), { recursive: true });
  await writeFile(join(directory, 'codex', 'auth.json'), '{}');
  await writeFile(join(squadHome, 'web-status.json'), JSON.stringify({
    generatedAt: '2026-10-13T08:00:00.000Z',
    members: [
      { id: 'kai', name: 'Kai', role: 'Engineer', status: 'online', lastActivityAt: '2026-10-13T07:59:00.000Z' },
      { id: 'iris', name: 'Iris', role: 'Reviewer', status: 'offline', lastActivityAt: '2026-10-12T07:59:00.000Z' },
    ],
  }));
  const seededAt = '2026-10-13T08:00:00.000Z';
  await writeFile(join(squadHome, 'channels.json'), JSON.stringify({
    version: 1,
    revision: 3,
    channels: [{ id: 'channel-general', name: 'general', visibility: 'public', memberIds: ['kai', 'iris'], projects: [{ path: rootDir, name: 'autohandSWE' }], createdAt: seededAt, updatedAt: seededAt }],
    threads: [{ id: 'thread-seeded', channelId: 'channel-general', title: 'Seeded kickoff', creatorId: 'iris', memberIds: ['kai'], replyCount: 1, createdAt: seededAt, updatedAt: seededAt }],
    messages: { 'channel-general': [
      { id: 'msg-seeded-root', role: 'user', agentId: '', authorName: 'Iris', body: 'Seeded kickoff: please review the launch checklist', threadId: 'thread-seeded', status: 'complete', createdAt: seededAt, updatedAt: seededAt },
      { id: 'msg-seeded-reply', role: 'agent', agentId: 'kai', authorName: 'Kai', body: 'Seeded reply: checklist looks complete', threadId: 'thread-seeded', parentMessageId: 'msg-seeded-root', status: 'complete', createdAt: '2026-10-13T08:01:00.000Z', updatedAt: '2026-10-13T08:01:00.000Z' },
    ] },
  }));
  await writeFile(fake, `#!${process.execPath}
const fs=require('node:fs');
const file=${JSON.stringify(callsFile)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}
if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'fixture'}));process.exit(0);}
const prompt=args.at(-1);
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const append=x=>fs.appendFileSync(file,JSON.stringify(x)+'\\n');
append({kind:'start',member,prompt,cwd:process.cwd()});
process.on('SIGTERM',()=>{append({kind:'abort',member});process.exit(143);});
const emit=x=>console.log(JSON.stringify(x));
emit({type:'thread.started',thread_id:'fixture-'+member});
if(prompt.includes('HOLD fixture')){setTimeout(()=>process.exit(0),45000);return;}
const text='Fixture reply for: '+prompt.split('\\n').at(-1).slice(0,60)+'. Token ${SECRET_A} and ${SECRET_B} end.';
emit({type:'item.completed',item:{id:'reply',type:'agent_message',text}});
emit({type:'turn.completed'});
`);
  await chmod(fake, 0o700);
  await startBridge();

  // The app prepares a member before its first turn; the bridge keeps that
  // profile (harness, projects) and reuses it for bridge-owned runs.
  const provision = await api('/api/agents/provision', { agentId: 'kai', agent: { id: 'kai', name: 'Kai', role: 'Engineer', harness: { id: 'codex', executablePath: fake }, projects: [{ path: rootDir }] }, workspace: rootDir });
  ok(provision.success, `member prepared on the bridge: ${provision.error || ''}`);

  // ---- newline framing -----------------------------------------------------
  const client = mcpClient('newline');
  const init = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
  eq(init.result?.protocolVersion, '2024-11-05', 'initialize echoes a supported protocol version');
  eq(init.result?.serverInfo?.name, 'autohand-squad-control-plane', 'server name');
  ok(client.framingMatches(), 'newline request gets a newline reply');
  client.notify('notifications/initialized', {});
  const list = await client.request('tools/list', {});
  assert.deepEqual(list.result.tools.map((tool) => tool.name), EXPECTED_TOOLS, 'exact tool set'); passed += 1;
  ok(list.result.tools.every((tool) => tool.inputSchema?.additionalProperties === false), 'every schema rejects unknown fields');
  const unknown = await client.request('resources/list', {});
  eq(unknown.error?.code, -32601, 'unknown method is -32601');
  const invalid = await client.call('get_messages', { bogus: 1 });
  eq(invalid.rpcError?.code, -32602, 'unknown argument field is -32602');
  ok(String(invalid.rpcError?.message).includes('bogus'), 'invalid argument names the field');

  const members = await client.call('list_members');
  ok(!members.isError, `list_members ok: ${members.data?.error || ''}`);
  const kai = members.data.members.find((member) => member.id === 'kai');
  const iris = members.data.members.find((member) => member.id === 'iris');
  eq(kai?.name, 'Kai', 'seeded member name'); eq(kai?.role, 'Engineer', 'seeded member role'); eq(kai?.presence, 'online', 'presence from the bridge');
  eq(iris?.presence, 'offline', 'offline member presence'); eq(kai?.harness, null, 'harness unknown before any bridge-owned run');
  ok(String(members.data.source.roster).includes('web-status.json'), 'roster source is stated');

  const channels = await client.call('list_channels');
  ok(!channels.isError, 'list_channels ok');
  const general = channels.data.channels.find((channel) => channel.id === 'channel-general');
  eq(general?.name, 'general', 'seeded channel'); eq(general?.threads, 1, 'seeded thread count'); eq(general?.messages, 2, 'seeded message count');
  assert.deepEqual(general?.memberIds, ['kai', 'iris']); passed += 1;

  const transcript = await client.call('get_messages', { channel_id: 'channel-general' });
  ok(!transcript.isError, 'get_messages channel ok');
  eq(transcript.data.messages.length, 2, 'seeded messages returned');
  eq(transcript.data.messages[0].body, 'Seeded kickoff: please review the launch checklist', 'oldest first');
  eq(transcript.data.threads[0].id, 'thread-seeded', 'thread listed');
  const onlyThread = await client.call('get_messages', { channel_id: 'channel-general', thread_id: 'thread-seeded', limit: 1 });
  eq(onlyThread.data.messages.length, 1, 'limit honoured'); eq(onlyThread.data.messages[0].id, 'msg-seeded-reply', 'newest kept when limited'); eq(onlyThread.data.truncated, true, 'truncation flagged');
  const missing = await client.call('get_messages', { channel_id: 'channel-nope' });
  eq(missing.isError, true, 'unknown channel is a tool error'); eq(missing.data.status, 404, 'unknown channel status');
  const memberHistory = await client.call('get_messages', { member_id: 'kai' });
  ok(!memberHistory.isError, 'get_messages member ok');
  eq(memberHistory.data.items.length, 0, 'no bridge-owned items yet');
  ok(String(memberHistory.data.note).includes('not mirrored to the bridge'), 'browser-only history is disclosed');

  const search = await client.call('search', { query: 'checklist' });
  ok(!search.isError, `search ok: ${search.data?.error || ''}`);
  ok(search.data.results.some((hit) => hit.type === 'message' && hit.channelId === 'channel-general'), `search finds the seeded message: ${JSON.stringify(search.data.results).slice(0, 300)}`);

  const created = await client.call('create_channel', { name: 'ops', visibility: 'private', member_ids: ['kai'] });
  ok(!created.isError, `create_channel ok: ${created.data?.error || ''}`);
  const opsId = created.data.channel.id;
  ok(opsId && created.data.channel.visibility === 'private', 'created channel is private');
  const duplicate = await client.call('create_channel', { name: 'ops' });
  eq(duplicate.isError, true, 'duplicate channel name is refused'); ok(String(duplicate.data.error).includes('already exists'), 'duplicate reason surfaced');

  const notAvailableCreate = await client.call('create_member', { name: 'Nova' });
  eq(notAvailableCreate.isError, true, 'create_member is a tool error');
  eq(notAvailableCreate.data.code, 'not_available_from_bridge', 'create_member error code');
  ok(String(notAvailableCreate.data.error).startsWith('create_member is not available from the bridge'), 'create_member error text');
  const notAvailableModel = await client.call('set_model', { member_id: 'kai', model: 'gpt-5' });
  eq(notAvailableModel.isError, true, 'set_model is a tool error');
  eq(notAvailableModel.data.code, 'not_available_from_bridge', 'set_model error code');
  ok(String(notAvailableModel.data.error).startsWith('set_model is not available from the bridge'), 'set_model error text');

  const posted = await client.call('send_message', { channel_id: 'channel-general', text: 'Hello from the control plane', author: 'Operator' });
  ok(!posted.isError, `send_message channel ok: ${posted.data?.error || ''}`);
  eq(posted.data.dispatched, false, 'no member dispatched without member_id');
  const afterPost = await client.call('get_messages', { channel_id: 'channel-general', thread_id: posted.data.message.thread_id });
  eq(afterPost.data.messages.length, 1, 'posted message is in its thread');
  eq(afterPost.data.messages[0].body, 'Hello from the control plane', 'posted body'); eq(afterPost.data.messages[0].authorName, 'Operator', 'author recorded'); eq(afterPost.data.messages[0].role, 'user', 'posted as the person');
  const threadReply = await client.call('send_message', { channel_id: 'channel-general', thread_id: 'thread-seeded', text: 'Follow-up in the seeded thread' });
  ok(!threadReply.isError, 'reply inside an existing thread ok');
  eq(threadReply.data.message.thread_id, 'thread-seeded', 'reply keeps the thread');

  // Direct message to a member: a bridge-owned run on the fake harness.
  const direct = await client.call('send_message', { member_id: 'kai', text: 'Reply with the fixture secret', workspace: rootDir });
  ok(!direct.isError, `send_message member ok: ${direct.data?.error || ''}`);
  ok(direct.data.run_id, 'run id returned'); eq(direct.data.kind, 'run', 'direct message starts a run'); eq(direct.data.harness, 'codex', 'run uses the member\'s saved harness');
  const settled = await client.call('wait_for_reply', { run_id: direct.data.run_id, timeout_ms: 20000 }, 30000);
  ok(!settled.isError, `wait_for_reply ok: ${settled.data?.error || ''}`);
  eq(settled.data.outcome, 'settled', `run settled: ${JSON.stringify(settled.data).slice(0, 400)}`);
  ok(settled.data.reply.startsWith('Fixture reply for:'), 'reply text returned');
  ok(settled.data.reply.includes('[redacted]'), 'reply tokens replaced');
  ok(Array.isArray(settled.data.tail) && settled.data.tail.length > 0, 'tail returned');
  const settledJson = JSON.stringify(settled);
  ok(!settledJson.includes(SECRET_A) && !settledJson.includes(SECRET_B) && !settledJson.includes('ghp_'), 'no token-like string in the wait result');
  const runCalls = (await calls()).filter((call) => call.kind === 'start' && call.member === 'kai');
  eq(runCalls.length, 1, 'fake harness ran once'); eq(runCalls[0].cwd, rootDir, 'run used the given workspace');
  const historyAfterRun = await client.call('get_messages', { member_id: 'kai' });
  eq(historyAfterRun.data.items.length, 1, 'bridge-owned run listed for the member'); eq(historyAfterRun.data.items[0].status, 'completed', 'listed with its status');
  ok(!JSON.stringify(historyAfterRun).includes(SECRET_A), 'member history is redacted');
  const membersAfterRun = await client.call('list_members');
  eq(membersAfterRun.data.members.find((member) => member.id === 'kai')?.harness, 'codex', 'harness learnt from the run'); eq(membersAfterRun.data.members.find((member) => member.id === 'kai')?.lastWorkspace, rootDir, 'last workspace learnt from the run');

  // Workspace reuse: omit it and the member's last bridge-owned workspace is used.
  const reuse = await client.call('send_message', { member_id: 'kai', text: 'Second direct turn' });
  ok(!reuse.isError, `workspace reused: ${reuse.data?.error || ''}`); eq(reuse.data.workspace, rootDir, 'reused workspace');
  const reuseSettled = await client.call('wait_for_reply', { run_id: reuse.data.run_id, timeout_ms: 20000 }, 30000);
  eq(reuseSettled.data.outcome, 'settled', 'second run settled');
  const noWorkspace = await client.call('send_message', { member_id: 'iris', text: 'No workspace known' });
  eq(noWorkspace.isError, true, 'unknown workspace is refused'); ok(String(noWorkspace.data.error).includes('workspace is required'), 'refusal explains the workspace');

  // Channel dispatch: post, run the member in the thread, mirror the reply.
  const dispatched = await client.call('send_message', { channel_id: 'channel-general', member_id: 'kai', text: 'Kai, summarise the seeded thread', workspace: rootDir });
  ok(!dispatched.isError, `channel dispatch ok: ${dispatched.data?.error || ''}`);
  eq(dispatched.data.dispatched, true, 'member dispatched in the channel'); ok(dispatched.data.run_id, 'channel run id');
  const channelSettled = await client.call('wait_for_reply', { run_id: dispatched.data.run_id, timeout_ms: 20000 }, 30000);
  eq(channelSettled.data.outcome, 'settled', `channel run settled: ${JSON.stringify(channelSettled.data).slice(0, 400)}`);
  eq(channelSettled.data.replyPostedToThread, true, 'reply mirrored into the thread');
  eq(channelSettled.data.channel?.threadId, dispatched.data.message.thread_id, 'run carries its thread');
  const channelThread = await client.call('get_messages', { channel_id: 'channel-general', thread_id: dispatched.data.message.thread_id });
  eq(channelThread.data.messages.length, 2, 'thread holds the prompt and the reply');
  eq(channelThread.data.messages[1].role, 'agent', 'reply is from the member'); eq(channelThread.data.messages[1].agentId, 'kai', 'reply author');
  ok(channelThread.data.messages[1].body.startsWith('Fixture reply for:'), 'reply body mirrored');
  ok(!JSON.stringify(channelThread).includes(SECRET_A), 'mirrored reply holds no raw token');
  const bridgeThreads = await api('/api/channels/channel-general/threads');
  ok(bridgeThreads.data.some((thread) => thread.id === dispatched.data.message.thread_id && thread.replyCount >= 1), 'bridge counted the dispatch on the thread');

  // Interrupt a running fake turn and a timed-out wait.
  const held = await client.call('send_message', { member_id: 'kai', text: 'HOLD fixture until interrupted', workspace: rootDir });
  ok(!held.isError, 'held run started');
  await until(async () => (await calls()).some((call) => call.kind === 'start' && call.prompt.includes('HOLD fixture')), 'held fixture running');
  const timedOut = await client.call('wait_for_reply', { run_id: held.data.run_id, timeout_ms: 1000 }, 10000);
  eq(timedOut.data.outcome, 'timed-out', 'short wait times out'); eq(timedOut.data.status, 'running', 'still running when timed out');
  const interrupted = await client.call('interrupt', { run_id: held.data.run_id });
  ok(!interrupted.isError, `interrupt ok: ${interrupted.data?.error || ''}`); eq(interrupted.data.stopped, true, 'run reported stopped'); eq(interrupted.data.status, 'stopped', 'run status stopped');
  await until(async () => (await calls()).some((call) => call.kind === 'abort'), 'fake harness received SIGTERM');
  const afterInterrupt = await client.call('wait_for_reply', { run_id: held.data.run_id, timeout_ms: 5000 });
  eq(afterInterrupt.data.outcome, 'failed', 'stopped run reports failed'); ok(String(afterInterrupt.data.reason).includes('stopped'), 'stop reason');
  const twice = await client.call('interrupt', { run_id: held.data.run_id });
  eq(twice.data.stopped, false, 'second interrupt is a no-op');
  const bothIds = await client.call('interrupt', { run_id: 'a', member_id: 'kai' });
  eq(bothIds.isError, true, 'interrupt wants exactly one id');
  const memberStop = await client.call('interrupt', { member_id: 'kai' });
  ok(!memberStop.isError, 'member stop ok'); eq(memberStop.data.kind, 'member', 'member stop kind');
  const missingRun = await client.call('wait_for_reply', { run_id: 'run-does-not-exist', timeout_ms: 1000 });
  eq(missingRun.isError, true, 'unknown run is a tool error');
  await client.close();

  // ---- restart: created channel and posted messages persist ----------------
  await stopBridge();
  await startBridge();
  const afterRestart = mcpClient('header');
  const headerInit = await afterRestart.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-header', version: '1' } });
  eq(headerInit.result?.protocolVersion, '2025-06-18', 'header-framed initialize');
  ok(afterRestart.framingMatches(), 'Content-Length request gets a Content-Length reply');
  const headerList = await afterRestart.request('tools/list', {});
  assert.deepEqual(headerList.result.tools.map((tool) => tool.name), EXPECTED_TOOLS); passed += 1;
  const persisted = await afterRestart.call('list_channels');
  ok(persisted.data.channels.some((channel) => channel.id === opsId && channel.name === 'ops'), 'created channel survives a bridge restart');
  const persistedThread = await afterRestart.call('get_messages', { channel_id: 'channel-general', thread_id: dispatched.data.message.thread_id });
  eq(persistedThread.data.messages.length, 2, 'channel dispatch and reply survive a restart');
  const persistedSearch = await afterRestart.call('search', { query: 'control plane' });
  ok(persistedSearch.data.results.some((hit) => hit.type === 'message'), 'posted message is indexed after restart');
  const ping = await afterRestart.request('ping', {});
  assert.deepEqual(ping.result, {}); passed += 1;
  await afterRestart.close();

  // ---- refusals at start-up ------------------------------------------------
  for (const bad of ['http://10.1.2.3:19821', 'http://example.com:19821']) {
    const refused = mcpClient('newline', ['--bridge', bad]);
    const code = await refused.exited;
    eq(code, 2, `non-loopback bridge ${bad} exits 2`);
    ok(refused.stderr().includes('this machine'), 'refusal says why');
    children.delete(refused);
  }
  const fromEnv = spawn(process.execPath, [mcpEntry], { cwd: directory, env: { ...process.env, AUTOHAND_SQUAD_BRIDGE_URL: 'http://192.168.0.9:19821' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let envErr = ''; fromEnv.stderr.on('data', (data) => { envErr += data; });
  eq(await new Promise((done) => fromEnv.once('exit', done)), 2, 'non-loopback AUTOHAND_SQUAD_BRIDGE_URL exits 2'); ok(envErr.includes('192.168.0.9'), 'env refusal names the host');

  // A bridge that is down is a tool error, not a crash.
  const down = mcpClient('newline', ['--bridge', 'http://127.0.0.1:9']);
  const downInit = await down.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
  ok(downInit.result, 'initialize works without a bridge');
  const downCall = await down.call('list_channels');
  eq(downCall.isError, true, 'unreachable bridge is a tool error'); ok(String(downCall.data.error).includes('did not answer'), 'unreachable bridge explained');
  await down.close();

  console.log(`Control plane checks passed (${passed}): loopback refusal, redaction, both framings, exact tool set, seeded roster/channels/messages/search, channel creation across restart, channel post and member dispatch with mirrored reply, interrupt, timed-out wait, and documented not-available errors.`);
} finally {
  for (const child of children) child.kill('SIGKILL');
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
