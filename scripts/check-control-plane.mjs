#!/usr/bin/env node
// Control plane check (ADR-0109): a real bridge in an isolated state dir,
// seeded with a member mirror and channel state, driven through the stdio MCP
// server in both framings. A fake Codex executable stands in for the harness;
// no vendor, credentials, installed app or provider requests are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';

import {
  TOOL_NAMES, decodeFrames, goalOutcome, parseBridgeUrl, redactSecrets, runOutcome, validateArgs, TOOLS,
} from '../server/control-plane/control-plane.mjs';

const rootDir = resolve(new URL('..', import.meta.url).pathname);
const mcpEntry = join(rootDir, 'server', 'control-plane', 'mcp-server.mjs');
const SECRET_A = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SECRET_B = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123';
const MANAGEMENT_TOOLS = ['get_member_profile', 'update_member_profile', 'set_member_abilities', 'add_member_directory', 'remove_member_directory', 'list_skills', 'set_member_skills', 'get_channel', 'update_channel', 'set_channel_members', 'list_channel_threads', 'create_group_chat', 'send_channel_message', 'list_routines', 'get_routine', 'preview_routine', 'create_routine', 'update_routine', 'run_routine'];
const EXPECTED_TOOLS = ['list_members', 'list_channels', 'get_messages', 'search', 'create_member', 'create_channel', 'send_message', 'wait_for_reply', 'interrupt', 'set_model', 'message_member', 'get_conversation', 'get_member_queue', 'wait_for_message', 'list_artifacts', 'get_artifact', 'list_memories', 'read_memory', ...MANAGEMENT_TOOLS];

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

const catalogReads = [];
const catalogTools = createTools({ get: async path => { catalogReads.push(path); return path.startsWith('/api/control-plane/') ? { workspace: '/fixture/project' } : { skills: [{ id: 'fixture-skill' }] }; } });
const catalog = await catalogTools.list_skills({ member_id: 'kai', query: 'fixture', offset: 40 });
eq(catalog.skills[0].id, 'fixture-skill', 'skill discovery returns catalog packages');
const catalogUrl = new URL(catalogReads[1], 'http://localhost');
eq(catalogUrl.searchParams.get('workspace'), '/fixture/project', 'catalog uses saved member workspace');
eq(catalogUrl.searchParams.get('offset'), '40', 'catalog pagination is passed through');
const oldBridge = createBridgeClient('http://127.0.0.1:19821', { fetchImpl: async () => new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404 }) });
await assert.rejects(() => oldBridge.get('/api/control-plane/members/kai'), /Update Autohand Squad/); passed++;
const monthlySchema = TOOLS.find(tool => tool.name === 'preview_routine').inputSchema;
eq(validateArgs(monthlySchema, { schedule: { kind: 'monthly', day: 'last', time: '09:00', timeZone: 'UTC' } }).length, 0, 'monthly last-day schedule passes MCP validation');

// ---- isolated bridge ------------------------------------------------------

await mkdir(join(rootDir, '.codex-artifacts'), { recursive: true });
const directory = await mkdtemp(join(rootDir, '.codex-artifacts', 'squad-control-plane-'));
const workspaceDir = join(directory, 'workspace');
const squadHome = join(directory, 'squad');
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-codex.cjs');
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
      AUTOHAND_SKILLS_REPO_DIR: join(directory, 'skill-repo'),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${join(directory, 'skill-fixture.mjs')}`.trim(),
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
  return { request, notify, call, close, exited, nextRequestId: () => nextId, stderr: () => stderr, raw: () => raw, framingMatches: () => framing === 'header' ? /^Content-Length: \d+\r\n\r\n\{/.test(raw) : raw.startsWith('{') };
}

try {
  // Seed the state the app would have written.
  await mkdir(workspaceDir, { recursive: true });
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
    channels: [{ id: 'channel-general', name: 'general', visibility: 'public', memberIds: ['kai', 'iris'], projects: [{ path: workspaceDir, name: 'autohandSWE' }], createdAt: seededAt, updatedAt: seededAt }],
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
append({kind:'start',member,prompt,cwd:process.cwd(),args});
process.on('SIGTERM',()=>{append({kind:'abort',member});process.exit(143);});
const emit=x=>console.log(JSON.stringify(x));
emit({type:'thread.started',thread_id:'fixture-'+member});
if(prompt.includes('HOLD fixture')){setTimeout(()=>process.exit(0),45000);return;}
const finish=()=>{
const text='Fixture reply for: '+prompt.split('\\n').at(-1).slice(0,60)+'. Token ${SECRET_A} and ${SECRET_B} end.';
emit({type:'item.completed',item:{id:'reply',type:'agent_message',text}});
emit({type:'turn.completed'});
};
if(prompt.includes('DELAY GROUP fixture'))setTimeout(finish,600);else finish();
`);
  await chmod(fake, 0o700);
  const registry = { skills: [{ id: 'fixture-registry', name: 'Registry fixture', directory: 'fixture-registry', files: ['SKILL.md'] }] };
  await mkdir(join(directory, 'skill-repo', 'fixture-registry'), { recursive: true });
  await writeFile(join(directory, 'skill-repo', 'fixture-registry', 'SKILL.md'), '---\nname: Registry fixture\n---\nRegistry fixture package.\n');
  await writeFile(join(directory, 'skill-fixture.mjs'), `const original = globalThis.fetch; globalThis.fetch = (url, options) => String(url) === 'https://skilled.autohand.ai/skills-index.json' ? Promise.resolve(new Response(${JSON.stringify(JSON.stringify(registry))}, { headers: { 'content-type': 'application/json' } })) : original(url, options);`);
  await startBridge();

  // The app prepares a member before its first turn; the bridge keeps that
  // profile (harness, projects) and reuses it for bridge-owned runs.
  const provision = await api('/api/agents/provision', { agentId: 'kai', agent: { id: 'kai', name: 'Kai', role: 'Engineer', harness: { id: 'codex', executablePath: fake }, projects: [{ path: workspaceDir }] }, workspace: workspaceDir });
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
  eq(iris?.presence, 'offline', 'offline member presence'); eq(kai?.harness, null, 'provisioned-only fixture has no registered roster profile before the first turn');
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
  ok(String(memberHistory.data.note).includes('get_conversation'), 'summary history points to the actual transcript tool');

  {
    const direct = await client.call('message_member', { member_id: 'kai', text: 'CLI direct conversation fixture', workspace: workspaceDir });
    ok(!direct.isError, `direct message accepted: ${direct.data?.error || ''}`);
    ok(direct.data.message_id, 'direct message returns a durable receipt');
    const directReply = await client.call('wait_for_message', { member_id: 'kai', message_id: direct.data.message_id, timeout_ms: 15000 });
    eq(directReply.data.outcome, 'settled', `direct reply settled: ${JSON.stringify(directReply.data)}`);
    ok(!JSON.stringify(directReply.data).includes(SECRET_A), 'direct replies redact secrets');
    const conversation = await client.call('get_conversation', { member_id: 'kai' });
    ok(conversation.data.messages.some(message => message.role === 'user' && message.body?.includes('CLI direct conversation fixture')), 'CLI message appears in the actual member conversation');
    const queue = await client.call('get_member_queue', { member_id: 'kai' });
    eq(queue.data.items.find(item => item.id === direct.data.message_id)?.status, 'done', 'queue receipt agrees with completed delivery');
    const artifacts = await client.call('list_artifacts', { member_id: 'kai' });
    eq(artifacts.isError, false, 'artifact library can be read');
    const memories = await client.call('list_memories', { member_id: 'kai', query: 'fixture' });
    eq(memories.isError, false, 'memory library can be searched');
  }

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
  const direct = await client.call('send_message', { member_id: 'kai', text: 'Reply with the fixture secret', workspace: workspaceDir });
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
  eq(runCalls.length, 2, 'direct queue and legacy run each reached the fake harness'); eq(runCalls[1].cwd, workspaceDir, 'run used the given workspace');
  const historyAfterRun = await client.call('get_messages', { member_id: 'kai' });
  eq(historyAfterRun.data.items.length, 2, 'direct chat and legacy run listed for the member'); eq(historyAfterRun.data.items[0].status, 'completed', 'listed with its status');
  ok(!JSON.stringify(historyAfterRun).includes(SECRET_A), 'member history is redacted');
  const membersAfterRun = await client.call('list_members');
  eq(membersAfterRun.data.members.find((member) => member.id === 'kai')?.harness, 'codex', 'harness learnt from the run'); eq(membersAfterRun.data.members.find((member) => member.id === 'kai')?.lastWorkspace, workspaceDir, 'last workspace learnt from the run');

  // Workspace reuse: omit it and the member's last bridge-owned workspace is used.
  const reuse = await client.call('send_message', { member_id: 'kai', text: 'Second direct turn' });
  ok(!reuse.isError, `workspace reused: ${reuse.data?.error || ''}`); eq(reuse.data.workspace, workspaceDir, 'reused workspace');
  const reuseSettled = await client.call('wait_for_reply', { run_id: reuse.data.run_id, timeout_ms: 20000 }, 30000);
  eq(reuseSettled.data.outcome, 'settled', 'second run settled');
  const noWorkspace = await client.call('send_message', { member_id: 'iris', text: 'No workspace known' });
  eq(noWorkspace.isError, true, 'unknown workspace is refused'); ok(String(noWorkspace.data.error).includes('workspace is required'), 'refusal explains the workspace');

  // Channel dispatch: post, run the member in the thread, mirror the reply.
  const dispatched = await client.call('send_message', { channel_id: 'channel-general', member_id: 'kai', text: 'Kai, summarise the seeded thread', workspace: workspaceDir });
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
  const held = await client.call('send_message', { member_id: 'kai', text: 'HOLD fixture until interrupted', workspace: workspaceDir });
  ok(!held.isError, 'held run started');
  await until(async () => (await calls()).some((call) => call.kind === 'start' && call.prompt.includes('HOLD fixture')), 'held fixture running');
  const busyMessage = await client.call('message_member', { member_id: 'kai', text: 'Wait behind current work fixture' });
  eq(busyMessage.isError, false, 'busy member accepts a queued direct message');
  const busyQueue = await client.call('get_member_queue', { member_id: 'kai' });
  eq(busyQueue.data.items.find(item => item.id === busyMessage.data.message_id)?.status, 'queued', 'busy member message stays queued');
  ok(!(await calls()).some(call => call.prompt?.includes('Wait behind current work fixture')), 'message never interrupts current work');
  const busyTimeout = await client.call('wait_for_message', { member_id: 'kai', message_id: busyMessage.data.message_id, timeout_ms: 1000 });
  eq(busyTimeout.data.outcome, 'timed-out', 'a queued message wait times out without resending');
  await api('/api/queues/kai/pause', {});
  const pausedMessage = await client.call('wait_for_message', { member_id: 'kai', message_id: busyMessage.data.message_id });
  eq(pausedMessage.data.outcome, 'needs-you', 'a paused queue returns needs-you immediately');
  await api('/api/queues/kai/resume', {});
  const waitId = client.nextRequestId();
  const cancelledWait = client.call('wait_for_message', { member_id: 'kai', message_id: busyMessage.data.message_id, timeout_ms: 15000 }, 3000);
  await delay(50);
  client.notify('notifications/cancelled', { requestId: waitId });
  const cancelledReply = await cancelledWait;
  eq(cancelledReply.isError, true, 'a waiting MCP request can be cancelled while other frames are handled');
  ok(String(cancelledReply.data.error).includes('cancelled'), 'cancelled wait explains that delivery is retained');
  await api(`/api/queues/items/${busyMessage.data.message_id}/cancel`, {});
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

  const beforeProfile = await afterRestart.call('get_member_profile', { member_id: 'kai' });
  eq(beforeProfile.isError, false, 'read canonical member profile');
  const changedProfile = await afterRestart.call('update_member_profile', { member_id: 'kai', expected_revision: beforeProfile.data.revision, name: 'Morgan', personality: 'Calm and precise.', instructions: 'Verify each result.' });
  eq(changedProfile.isError, false, `profile changed: ${changedProfile.data?.error || ''}`);
  eq(changedProfile.data.name, 'Morgan', 'member rename is saved');
  ok(changedProfile.data.personality.includes('Calm and precise.'), 'personality is saved');
  const stale = await afterRestart.call('update_member_profile', { member_id: 'kai', expected_revision: beforeProfile.data.revision, name: 'Stale' });
  eq(stale.data.status, 409, 'stale profile edit cannot overwrite a later change');
  const extraDirectory = join(directory, 'extra-project');
  await mkdir(extraDirectory);
  const granted = await afterRestart.call('add_member_directory', { member_id: 'kai', path: extraDirectory });
  eq(granted.isError, false, `directory granted: ${granted.data?.error || ''}`);
  ok(granted.data.projects.some(project => project.path === extraDirectory), 'directory saved on member');
  const abilities = await afterRestart.call('set_member_abilities', { member_id: 'kai', capabilities: [{ id: 'web.fetch', mode: 'block' }], tool_policies: [{ id: 'write_file', mode: 'ask' }] });
  eq(abilities.data.permissions.modes['web.fetch'], 'block', 'capability saved');
  eq(abilities.data.permissions.builtInPolicies.write_file, 'ask', 'tool ability saved');
  const invalidAbility = await afterRestart.call('set_member_abilities', { member_id: 'kai', capabilities: [{ id: 'invented.ability', mode: 'allow' }] });
  eq(invalidAbility.isError, true, 'unknown capabilities are rejected');
  const duplicateGrant = await afterRestart.call('add_member_directory', { member_id: 'kai', path: extraDirectory });
  eq(duplicateGrant.data.projects.filter(item => item.path === extraDirectory).length, 1, 'folder grant is idempotent');
  const escaped = join(directory, 'outside-link');
  await symlink('/etc', escaped);
  for (const path of [process.env.HOME, escaped, join(directory, 'missing')]) {
    const refused = await afterRestart.call('add_member_directory', { member_id: 'kai', path });
    eq(refused.isError, true, 'home, escaped symlink and missing folder grants are refused');
  }
  const staleSnapshot = await api('/api/members/kai/channel-access', { agent: { id: 'kai', name: 'Kai', projects: [{ path: workspaceDir }], permissions: {}, profileRevision: beforeProfile.data.revision } }, 'PUT');
  ok(staleSnapshot.success, 'old tab snapshot is accepted without restoring old fields');
  const currentProfile = await afterRestart.call('get_member_profile', { member_id: 'kai' });
  eq(currentProfile.data.name, 'Morgan', 'stale tab cannot restore old identity');
  ok(currentProfile.data.projects.some(item => item.path === extraDirectory), 'stale tab cannot revoke a folder grant');
  eq(currentProfile.data.permissions.modes['web.fetch'], 'block', 'stale tab cannot restore old policies');

  await mkdir(join(squadHome, 'skills', 'fixture-skill'), { recursive: true });
  await writeFile(join(squadHome, 'skills', 'fixture-skill', 'SKILL.md'), '---\nname: Fixture skill\ndescription: Local fixture package\n---\nVerify fixture results.\n');
  const discoveredSkills = await afterRestart.call('list_skills', { member_id: 'kai', query: 'fixture' });
  ok(discoveredSkills.data.skills.some(item => item.id === 'fixture-skill' && item.local), 'local skill appears in catalog');
  ok(discoveredSkills.data.skills.some(item => item.qualifiedId === 'registry:autohandai/community-skills::fixture-registry'), 'registry skill has a qualified package ID');
  const selectedSkills = await afterRestart.call('set_member_skills', { member_id: 'kai', skill_ids: ['fixture-skill', 'registry:autohandai/community-skills::fixture-registry'] });
  eq(selectedSkills.isError, false, `skill assignment: ${selectedSkills.data?.error || ''}`);
  assert.deepEqual(selectedSkills.data.skills, ['fixture-skill', 'registry:autohandai/community-skills::fixture-registry']); passed++;
  const grantedRun = await afterRestart.call('send_message', { channel_id: 'channel-general', member_id: 'kai', text: 'Verify added directory and skills', workspace: workspaceDir });
  eq(grantedRun.isError, false, `granted run: ${grantedRun.data?.error || ''}`);
  const grantedReply = await afterRestart.call('wait_for_reply', { run_id: grantedRun.data.run_id, timeout_ms: 10000 });
  eq(grantedReply.data.outcome, 'settled', 'run with granted folder completes');
  const latestCall = (await calls()).filter(item => item.kind === 'start').at(-1);
  ok(latestCall.args.some((arg, index) => arg === '--add-dir' && latestCall.args[index + 1] === extraDirectory) || latestCall.args.some(arg => arg.startsWith('sandbox_workspace_write.writable_roots=') && JSON.parse(arg.split('=').slice(1).join('=')).includes(extraDirectory)), 'extra folder reaches fresh or resumed engine access settings');
  const savedProfile = JSON.parse(await readFile(join(directory, 'app', 'agents', 'kai', 'profile.json'), 'utf8'));
  eq(savedProfile.name, 'Morgan', 'profile projection preserves rename');
  ok(savedProfile.skillInstall.installed.some(item => item.id === 'fixture-skill'), 'selected skill package is installed on next turn');
  ok(savedProfile.skillInstall.installed.some(item => item.id === 'registry:autohandai/community-skills::fixture-registry' && item.reference.authority === 'registry:autohandai/community-skills'), 'qualified registry package installs with its explicit origin');
  const revoked = await afterRestart.call('remove_member_directory', { member_id: 'kai', path: extraDirectory });
  eq(revoked.data.projects.some(item => item.path === extraDirectory), false, 'extra grant is removed');
  await writeFile(join(extraDirectory, 'still-here.txt'), 'preserved');
  eq(await readFile(join(extraDirectory, 'still-here.txt'), 'utf8'), 'preserved', 'revoking a grant leaves files untouched');
  const primaryRemoval = await afterRestart.call('remove_member_directory', { member_id: 'kai', path: workspaceDir });
  eq(primaryRemoval.isError, true, 'primary workspace cannot be removed');

  const irisProvision = await api('/api/agents/provision', { agentId: 'iris', agent: { id: 'iris', name: 'Iris', role: 'Reviewer', harness: { id: 'codex', executablePath: fake }, projects: [{ path: workspaceDir }] }, workspace: workspaceDir });
  ok(irisProvision.success, 'second group member prepared');
  await api('/api/members/iris/channel-access', { agent: { id: 'iris', name: 'Iris', role: 'Reviewer', harness: { id: 'codex', executablePath: fake }, projects: [{ path: workspaceDir }] } }, 'PUT');
  const group = await afterRestart.call('create_group_chat', { name: 'Fixture review', member_ids: ['kai', 'iris'] });
  eq(group.isError, false, `group created: ${group.data?.error || ''}`);
  const groupId = group.data.channel.id;
  const groupSettings = await afterRestart.call('get_channel', { channel_id: groupId });
  eq(groupSettings.data.visibility, 'private', 'group is private');
  const renamedGroup = await afterRestart.call('update_channel', { channel_id: groupId, name: 'Fixture renamed', purpose: 'Review fixtures' });
  eq(renamedGroup.data.name, 'Fixture renamed', 'channel settings are saved');
  const removedMember = await afterRestart.call('set_channel_members', { channel_id: groupId, remove: ['iris'] });
  eq(removedMember.isError, false, 'channel member removed');
  const nonMember = await afterRestart.call('send_channel_message', { channel_id: groupId, text: 'Must not dispatch', member_ids: ['iris'] });
  eq(nonMember.isError, true, 'nonmember dispatch rejected');
  await afterRestart.call('set_channel_members', { channel_id: groupId, add: ['iris'] });
  const sender = mcpClient('newline');
  await sender.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'group-sender', version: '1' } });
  const groupSend = await sender.call('send_channel_message', { channel_id: groupId, text: 'DELAY GROUP fixture review', member_ids: ['kai', 'iris'] });
  eq(groupSend.isError, false, `group send: ${groupSend.data?.error || ''}`);
  eq(groupSend.data.deliveries.length, 2, 'only selected members dispatched');
  ok(groupSend.data.deliveries.every(item => item.run_id), 'both recipients return run receipts');
  await sender.close();
  const groupMessages = await until(async () => {
    const result = await afterRestart.call('get_messages', { channel_id: groupId, thread_id: groupSend.data.thread_id });
    return result.data?.messages?.filter(item => item.role === 'agent').length === 2 && result.data.messages;
  }, 'group replies persist after sender disconnect');
  eq(groupMessages.length, 3, 'one prompt and two replies persisted without polling runs');
  for (const delivery of groupSend.data.deliveries) await afterRestart.call('wait_for_reply', { run_id: delivery.run_id, timeout_ms: 1000 });
  const deduped = await afterRestart.call('get_messages', { channel_id: groupId, thread_id: groupSend.data.thread_id });
  eq(deduped.data.messages.length, 3, 'wait_for_reply does not duplicate persisted group replies');
  const threads = await afterRestart.call('list_channel_threads', { channel_id: groupId });
  ok(threads.data.threads.some(item => item.id === groupSend.data.thread_id), 'group thread appears in channel thread list');
  const postOnly = await afterRestart.call('send_channel_message', { channel_id: groupId, thread_id: groupSend.data.thread_id, text: 'Saved without starting work' });
  eq(postOnly.data.deliveries.length, 0, 'post-only message starts no work');

  const schedule = { kind: 'once', date: '2099-11-05', time: '09:00', timeZone: 'UTC' };
  const preview = await afterRestart.call('preview_routine', { schedule });
  eq(preview.data.next[0], '2099-11-05T09:00:00.000Z', 'routine preview uses explicit timezone');
  const routine = await afterRestart.call('create_routine', { member_id: 'kai', title: 'Fixture routine', instructions: 'Verify this fixture.', schedule });
  eq(routine.isError, false, `routine created: ${routine.data?.error || ''}`);
  eq(routine.data.enabled, false, 'new routine is disabled by default');
  const routineId = routine.data.id;
  const enabledRoutine = await afterRestart.call('update_routine', { routine_id: routineId, enabled: true });
  eq(enabledRoutine.data.enabled, true, 'explicit enable schedules the routine');
  const pausedRoutine = await afterRestart.call('update_routine', { routine_id: routineId, enabled: false, title: 'Fixture paused' });
  eq(pausedRoutine.data.enabled, false, 'explicit disable pauses scheduling');
  const routineList = await afterRestart.call('list_routines', { member_id: 'kai' });
  ok(routineList.data.routines.some(item => item.id === routineId), 'routine listed for its member');
  const manualRun = await afterRestart.call('run_routine', { routine_id: routineId });
  eq(manualRun.isError, false, `manual routine run: ${manualRun.data?.error || ''}`);
  const settledRoutine = await until(async () => {
    const result = await afterRestart.call('get_routine', { routine_id: routineId });
    return result.data?.runs?.some(item => item.id === manualRun.data.run.id && item.status === 'completed') && result.data;
  }, 'manual routine run settles');
  ok(settledRoutine.runs[0].reply.includes('Fixture reply'), 'manual routine reply saved in routine history');
  const irisBeforeEngineEdit = (await api('/api/channels')).data.agentChannelAccess.iris.agent;
  const engineEdit = await api('/api/members/iris/channel-access', { agent: { ...irisBeforeEngineEdit, harness: { ...irisBeforeEngineEdit.harness, model: 'fixture-new-model' } } }, 'PUT');
  ok(engineEdit.success, 'app engine edit saved independently');
  const preparedProfileEdit = await api('/api/members/iris/channel-access', { agent: irisBeforeEngineEdit, profilePatch: { description: 'Rebased profile edit' }, expectedProfileRevision: irisBeforeEngineEdit.profileRevision || 0 }, 'PUT');
  ok(preparedProfileEdit.success, 'prepared profile edit rebases on latest configuration');
  eq((await api('/api/channels')).data.agentChannelAccess.iris.agent.harness.model, 'fixture-new-model', 'operator profile patch preserves a concurrent engine setting');
  const beforeRemoval = await afterRestart.call('get_member_profile', { member_id: 'iris' });
  const removal = await api('/api/members/iris/channel-access', { removed: true }, 'PUT');
  ok(removal.success, 'temporary member removed');
  const lateEdit = await api('/api/members/iris/channel-access', { agent: { id: 'iris', name: 'Restored by stale edit' }, expectedProfileRevision: beforeRemoval.data.revision }, 'PUT');
  eq(lateEdit.status, 409, 'an edit prepared before deletion cannot restore the removed member');
  const stillRemoved = await afterRestart.call('get_member_profile', { member_id: 'iris' });
  eq(stillRemoved.data.status, 404, 'removed member stays removed');
  await afterRestart.close();
  await stopBridge();
  await startBridge();
  const finalReader = mcpClient('newline');
  const restoredProfile = await finalReader.call('get_member_profile', { member_id: 'kai' });
  eq(restoredProfile.data.name, 'Morgan', 'managed profile survives bridge restart');
  eq(restoredProfile.data.permissions.modes['web.fetch'], 'block', 'ability policy survives bridge restart');
  const restoredRoutine = await finalReader.call('get_routine', { routine_id: routineId });
  eq(restoredRoutine.data.title, 'Fixture paused', 'routine edits survive bridge restart');
  const restoredGroup = await finalReader.call('get_messages', { channel_id: groupId, thread_id: groupSend.data.thread_id });
  eq(restoredGroup.data.messages.length, 4, 'group history survives bridge restart');
  await finalReader.close();

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

  console.log(`Control plane checks passed (${passed}): loopback refusal, redaction, both framings, exact tool set, seeded roster/channels/messages/search, channel creation across restart, channel post and member dispatch with mirrored reply, interrupt, timed-out wait, member profile revisions, engine folder grants and skill installation, disconnected group replies, routine execution, and documented not-available errors.`);
} finally {
  for (const child of children) child.kill('SIGKILL');
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
