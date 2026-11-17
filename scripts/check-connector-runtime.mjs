#!/usr/bin/env node
// The connector launcher end to end (ADR-0244) without the full bridge: a
// tiny 127.0.0.1 server answers the two runtime routes with the real
// createConnectorRuntime over a real connector store (temp dir, test keyring)
// and a stub sign-in; each check spawns `node runtime-proxy.mjs` with the
// launcher env a member's engine would get. Covers the supervised stdio child
// (crash, restart, initialize replay, give-up, missing command, both
// framings), the HTTP bridge (401 renew, forgotten session, SSE bodies, down
// server, legacy SSE) and the token checks. Nothing reaches the network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createFrameReader, encodeMessage } from '../server/connectors/framing.mjs';
import { createConnectorRuntime } from '../server/connectors/runtime.mjs';
import { createConnectorStore } from '../server/connectors/store.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-connector-runtime-'));
const key = randomBytes(32);
const keyring = { load: async () => ({ key, source: 'test' }), source: () => 'test', sources: ['test'], forget() {} };
const SECRETS = { env: 'stdio-secret-env-4821', header: 'sse-secret-header-9134', tokenOne: 'tok-1', tokenTwo: 'tok-2' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBody = (req) => new Promise((r) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => r(data)); });
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const clients = [];
const servers = [];
const covered = [];

// --------------------------------------------------------- stdio fixture MCP
const fixture = join(directory, 'fixture-mcp.cjs');
await writeFile(fixture, `const fs=require('node:fs');const args=process.argv.slice(2);const log=args[args.indexOf('--log')+1];
if(args.includes('--exit-on-start')){fs.appendFileSync(log,JSON.stringify({start:true})+'\\n');process.stderr.write('fixture refused to start\\n');process.exit(2);}
let buf=Buffer.alloc(0);
process.stdin.on('data',(chunk)=>{buf=Buffer.concat([buf,chunk]);for(;;){let body,framing;
if(buf.subarray(0,15).toString().toLowerCase()==='content-length:'){const end=buf.indexOf('\\r\\n\\r\\n');if(end<0)return;const size=Number(buf.subarray(15,end).toString().trim());if(buf.length<end+4+size)return;body=buf.subarray(end+4,end+4+size);buf=buf.subarray(end+4+size);framing='header';}
else{const end=buf.indexOf('\\n');if(end<0)return;body=buf.subarray(0,end);buf=buf.subarray(end+1);framing='newline';}
let m;try{m=JSON.parse(body.toString());}catch{continue;}
fs.appendFileSync(log,JSON.stringify({method:m.method,id:m.id,framing,pid:process.pid,apiToken:process.env.API_TOKEN||'',connectorToken:process.env.AUTOHAND_SQUAD_CONNECTOR_TOKEN||''})+'\\n');
if(m.id===undefined)continue;
if(m.method==='tools/call'&&m.params&&m.params.name==='crash')process.exit(1);
let result={};
if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture-stdio',version:'1'}};
else if(m.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}},{name:'crash',inputSchema:{type:'object'}}]};
else if(m.method==='tools/call')result={content:[{type:'text',text:'echo '+JSON.stringify(m.params.arguments||{})}]};
const out=JSON.stringify({jsonrpc:'2.0',id:m.id,result});
process.stdout.write(framing==='header'?'Content-Length: '+Buffer.byteLength(out)+'\\r\\n\\r\\n'+out:out+'\\n');}});`);
const logLines = async (file) => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));

// ---------------------------------------------------------- HTTP fixture MCP
const http = { initializes: 0, sessions: new Set(), auth: [], rejectTokOne: false, accepted: new Set(['Bearer tok-1']), sse: new Map(), sseAuth: [] };
const tools = { tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'notify', inputSchema: { type: 'object' } }] };
const mcpServer = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const json = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/mcp') {
    const auth = String(req.headers.authorization || '');
    http.auth.push(auth);
    if (auth === 'Bearer tok-1' && http.rejectTokOne) return json(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
    if (!http.accepted.has(auth)) return json(401, { error: 'unauthorized' });
    if (req.method === 'DELETE') { http.sessions.delete(req.headers['mcp-session-id']); res.writeHead(200); return res.end(); }
    const message = JSON.parse(await readBody(req));
    if (message.method === 'initialize') {
      http.initializes += 1;
      const session = `session-${http.initializes}`;
      http.sessions.add(session);
      return json(200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-http', version: '1' } } }, { 'mcp-session-id': session });
    }
    const session = req.headers['mcp-session-id'];
    if (!session) return json(400, { error: 'missing session' });
    if (!http.sessions.has(session)) return json(404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' } });
    if (message.id === undefined) { res.writeHead(202); return res.end(); }
    if (message.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: message.id, result: tools });
    if (message.method === 'tools/call' && message.params?.name === 'notify') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 2 } })}\n\n`);
      await sleep(30);
      res.write(`id: 2\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'streamed' }] } })}\n\n`);
      return res.end();
    }
    return json(200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `http ${JSON.stringify(message.params?.arguments || {})}` }] } });
  }
  if (url.pathname === '/sse' && req.method === 'GET') {
    http.sseAuth.push(String(req.headers['x-api-key'] || ''));
    if (req.headers['x-api-key'] !== SECRETS.header) return json(401, { error: 'unauthorized' });
    const sid = String(http.sse.size + 1);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`event: endpoint\ndata: /messages?sid=${sid}\n\n`);
    http.sse.set(sid, res);
    req.on('close', () => http.sse.delete(sid));
    return undefined;
  }
  if (url.pathname === '/messages' && req.method === 'POST') {
    if (req.headers['x-api-key'] !== SECRETS.header) return json(401, { error: 'unauthorized' });
    const message = JSON.parse(await readBody(req));
    const stream = http.sse.get(url.searchParams.get('sid'));
    res.writeHead(202); res.end();
    if (stream && message.id !== undefined) {
      const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture-sse', version: '1' } } : message.method === 'tools/list' ? tools : { content: [{ type: 'text', text: 'sse' }] };
      stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
    }
    return undefined;
  }
  return json(404, { error: 'not found' });
});
servers.push(mcpServer);
const mcpPort = await listen(mcpServer);
const mcpOrigin = `http://127.0.0.1:${mcpPort}`;
const closedPort = await (async () => { const probe = createNetServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r)); return port; })();

// ------------------------------------------------------- store, runtime, bridge
const store = createConnectorStore({ stateDir: join(directory, 'state'), rootDir: root, keyring });
const freshCalls = [];
let currentToken = SECRETS.tokenOne;
const oauth = { async fresh(id, { stale = false } = {}) { freshCalls.push({ id, stale }); if (stale) currentToken = SECRETS.tokenTwo; return { accessToken: currentToken, expiresAt: null }; } };
let bridgePort = 0;
const runtime = createConnectorRuntime({ store, oauth, bridgeUrl: () => `http://127.0.0.1:${bridgePort}`, rootDir: root });
const bridgeCalls = [];
const bridge = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://bridge').pathname;
  const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    if (req.method !== 'POST' || (path !== '/api/connectors/runtime' && path !== '/api/connectors/runtime/report')) return reply(404, { success: false, error: 'not found' });
    const token = String(req.headers['x-squad-connector-token'] || '');
    const body = JSON.parse((await readBody(req)) || '{}');
    bridgeCalls.push({ path, body });
    const data = path.endsWith('/report') ? await runtime.report(token, body) : await runtime.resolve(token, body);
    return reply(200, { success: true, data });
  } catch (error) {
    return reply(error.status || 500, { success: false, error: error.message });
  }
});
servers.push(bridge);
bridgePort = await listen(bridge);
const bridgeAsk = async (token, body, path = '/api/connectors/runtime') => {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-squad-connector-token': token }, body: JSON.stringify(body) });
  return { status: response.status, ...(await response.json()) };
};

/** An engine's side of one launcher: spawn the proxy and speak JSON-RPC to it in one framing. */
function engine(launcher, framing = 'newline') {
  const child = spawn(launcher.command, launcher.args, { env: { ...process.env, ...launcher.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const received = [];
  const waiters = new Set();
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const reader = createFrameReader((message, seenFraming) => {
    received.push({ message, framing: seenFraming });
    for (const waiter of waiters) waiter();
  });
  child.stdout.on('data', (chunk) => reader.feed(chunk));
  const write = (message) => child.stdin.write(encodeMessage(message, framing));
  const until = (predicate, label, timeoutMs = 15_000) => new Promise((resolveWait, reject) => {
    const check = () => { const found = received.find(predicate); if (found) { waiters.delete(check); clearTimeout(timer); resolveWait(found); } };
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`${label} timed out. Received: ${JSON.stringify(received.map((entry) => entry.message)).slice(0, 1200)} stderr: ${stderr.slice(-400)}`)); }, timeoutMs);
    waiters.add(check);
    check();
  });
  const api = {
    child, received,
    async request(id, method, params = {}, timeoutMs) { write({ jsonrpc: '2.0', id, method, params }); return (await until((entry) => entry.message.id === id && entry.message.method === undefined, `${method} #${id}`, timeoutMs)); },
    notify(method, params) { write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }); },
    until,
    async close() { if (child.exitCode !== null) return; const closed = new Promise((r) => child.once('exit', r)); child.stdin.end(); await Promise.race([closed, sleep(3000)]); if (child.exitCode === null) child.kill('SIGKILL'); },
  };
  clients.push(api);
  return api;
}
const initialize = (client, id = 1) => client.request(id, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-engine', version: '1' } });
async function eventually(check, label, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error(`${label} never happened`); await sleep(40); }
}

try {
  // --------------------------------------------------------------- connectors
  const stdioLog = join(directory, 'stdio.jsonl'), headerLog = join(directory, 'header.jsonl'), crashyLog = join(directory, 'crashy.jsonl');
  const make = async (input, extra) => { const created = await store.create(input); if (extra) await extra(created.id); await store.setEnabled(created.id, true); return created.id; };
  const ids = {
    stdio: await make({ name: 'Fixture stdio', kind: 'stdio', command: process.execPath, args: [fixture, '--log', stdioLog], env: [{ key: 'API_TOKEN', value: SECRETS.env }] }),
    header: await make({ name: 'Fixture header', kind: 'stdio', command: process.execPath, args: [fixture, '--log', headerLog] }, (id) => store.recordTest(id, { ok: true, tools: ['echo'], framing: 'header' })),
    crashy: await make({ name: 'Crashy', kind: 'stdio', command: process.execPath, args: [fixture, '--log', crashyLog, '--exit-on-start'] }),
    missingUv: await make({ name: 'Missing uv', kind: 'stdio', command: '/nonexistent/squad-check/uvx', args: ['some-mcp==1.0.0'] }),
    missingTool: await make({ name: 'Missing tool', kind: 'stdio', command: 'squad-check-missing-tool', args: [] }),
    remote: await make({ name: 'Fixture remote', kind: 'url', url: `${mcpOrigin}/mcp` }, (id) => store.setOAuth(id, {}, (next, tokens) => { next.status = 'signed-in'; tokens.accessToken = 'stored-token-not-used'; })),
    down: await make({ name: 'Down', kind: 'url', url: `http://127.0.0.1:${closedPort}/mcp`, headers: [{ name: 'X-Api-Key', value: 'down-key-123456' }] }),
    legacy: await make({ name: 'Legacy SSE', kind: 'url', url: `${mcpOrigin}/sse`, transport: 'sse', headers: [{ name: 'X-Api-Key', value: SECRETS.header }] }),
    other: await make({ name: 'Other member only', kind: 'stdio', command: process.execPath, args: [fixture, '--log', join(directory, 'other.jsonl')] }),
  };
  assert.equal((await store.get(ids.header)).framing, 'header');
  const summaries = await store.enabledSummaries();
  const memberA = runtime.launchers('member-a', summaries.filter((item) => item.id !== ids.other));
  const memberB = runtime.launchers('member-b', summaries.filter((item) => item.id === ids.other));
  const launcherFor = (id, list = memberA) => { const found = list.find((entry) => entry.id === id); assert.ok(found, `launcher for ${id}`); return found; };
  assert.equal(memberA.length, 8);
  for (const launcher of [...memberA, ...memberB]) {
    assert.deepEqual([launcher.command, launcher.args, launcher.kind], [process.execPath, [join(root, 'server', 'connectors', 'runtime-proxy.mjs')], 'stdio']);
    assert.deepEqual(Object.keys(launcher.env).sort(), ['AUTOHAND_SQUAD_CONNECTOR_ID', 'AUTOHAND_SQUAD_CONNECTOR_TOKEN', 'AUTOHAND_SQUAD_CONNECTOR_URL']);
    assert.equal(launcher.env.AUTOHAND_SQUAD_CONNECTOR_URL, `http://127.0.0.1:${bridgePort}/api/connectors/runtime`);
  }
  const launcherText = JSON.stringify([memberA, memberB]);
  for (const [label, secret] of Object.entries({ ...SECRETS, stored: 'stored-token-not-used', down: 'down-key-123456' })) assert.ok(!launcherText.includes(secret), `no ${label} secret in a launcher`);
  assert.equal(memberA[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN, runtime.launchers('member-a', summaries.filter((item) => item.id !== ids.other))[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN, 'a member keeps its token while the bridge runs');
  assert.notEqual(memberA[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN, memberB[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN);

  // The give-up case takes ~25 s of backoff (0.25 + 1 + 3 + 10 + 10): run it alongside the rest.
  const crashy = engine(launcherFor(ids.crashy));
  const crashyDone = (async () => {
    const firstAnswer = await initialize(crashy);
    assert.match(firstAnswer.message.error.message, /Crashy stopped unexpectedly \(exit code 2\)\. fixture refused to start Squad is restarting it; try the call again\./);
    const gaveUp = await crashy.request(2, 'tools/list', {}, 40_000);
    assert.equal(gaveUp.message.error.message, 'Crashy keeps stopping. Open Settings › Connectors to test it.');
    const starts = (await logLines(crashyLog)).filter((line) => line.start).length;
    assert.equal(starts, 6, 'the first start plus five restarts, then no more');
    const after = await crashy.request(3, 'tools/list');
    assert.match(after.message.error.message, /keeps stopping/);
    const record = await eventually(async () => { const item = await store.get(ids.crashy); return item.runtime?.crashesLastHour === 6 ? item : null; }, 'six crashes recorded');
    assert.match(record.runtime.lastError, /Crashy stopped unexpectedly/);
    await sleep(1000);
    assert.equal((await logLines(crashyLog)).filter((line) => line.start).length, 6, 'nothing restarts after giving up');
  })();

  // ------------------------------------------------------------------ stdio
  const stdio = engine(launcherFor(ids.stdio));
  const init = await initialize(stdio);
  assert.equal(init.message.result.serverInfo.name, 'fixture-stdio');
  assert.equal(init.framing, 'newline');
  stdio.notify('notifications/initialized');
  assert.deepEqual((await stdio.request(2, 'tools/list')).message.result.tools.map((tool) => tool.name), ['echo', 'crash']);
  assert.match((await stdio.request(3, 'tools/call', { name: 'echo', arguments: { a: 1 } })).message.result.content[0].text, /echo \{"a":1\}/);
  const crashed = await stdio.request(4, 'tools/call', { name: 'crash', arguments: {} });
  assert.match(crashed.message.error.message, /^Fixture stdio stopped unexpectedly \(exit code 1\)\. Squad is restarting it; try the call again\.$/, 'the call in flight gets a plain error');
  const listed = await stdio.request(5, 'tools/list');
  assert.deepEqual(listed.message.result.tools.map((tool) => tool.name), ['echo', 'crash'], 'the next call works without the engine re-initializing');
  const lines = await logLines(stdioLog);
  const inits = lines.filter((line) => line.method === 'initialize');
  assert.equal(inits.length, 2, 'the handshake was replayed once');
  assert.match(String(inits[1].id), /^squad-replay-/);
  assert.equal(lines.filter((line) => line.method === 'notifications/initialized').length, 2, 'and its initialized notification');
  assert.equal(new Set(inits.map((line) => line.pid)).size, 2, 'by a new process');
  assert.ok(!stdio.received.some((entry) => String(entry.message.id).startsWith('squad-')), 'the replayed answer never reaches the engine');
  assert.ok(lines.every((line) => line.apiToken === SECRETS.env), 'the child gets the sealed env value');
  assert.ok(lines.every((line) => line.connectorToken === ''), 'but never the launcher token');
  const crashRecord = await eventually(async () => { const item = await store.get(ids.stdio); return item.runtime?.crashesLastHour === 1 && !item.runtime.lastError ? item : null; }, 'crash then recovery recorded');
  assert.ok(crashRecord.runtime.lastStartAt);
  assert.ok(bridgeCalls.some((call) => call.path.endsWith('/report') && call.body.id === ids.stdio && call.body.type === 'crash' && /stopped unexpectedly/.test(call.body.detail)));
  assert.ok(bridgeCalls.some((call) => call.path.endsWith('/report') && call.body.id === ids.stdio && call.body.type === 'recovered'));
  await stdio.close();
  assert.equal(stdio.child.exitCode, 0, 'the proxy exits when the engine closes stdin');
  // Content-Length framing on both sides: the engine's and the child's (from the connector test).
  const header = engine(launcherFor(ids.header), 'header');
  const headerInit = await initialize(header);
  assert.equal(headerInit.framing, 'header', 'the engine is answered in its framing');
  header.notify('notifications/initialized');
  assert.equal((await header.request(2, 'tools/list')).framing, 'header');
  assert.ok((await logLines(headerLog)).every((line) => line.framing === 'header'), 'the child is spoken to in the framing its test detected');
  await header.close();
  // Newline engine to a header child, and a header engine to a newline child.
  const mixed = engine(launcherFor(ids.header), 'newline');
  assert.equal((await initialize(mixed)).framing, 'newline');
  await mixed.close();
  const mixed2 = engine(launcherFor(ids.stdio), 'header');
  assert.equal((await initialize(mixed2)).framing, 'header');
  await mixed2.close();
  // A command that isn't there.
  const missingUv = engine(launcherFor(ids.missingUv));
  assert.equal((await initialize(missingUv)).message.error.message, 'uvx isn\'t installed on this computer. Install uv (docs.astral.sh/uv), then test the connector again in Settings › Connectors.');
  assert.match((await missingUv.request(2, 'tools/list')).message.error.message, /uvx isn't installed/);
  await missingUv.close();
  const missingTool = engine(launcherFor(ids.missingTool));
  assert.equal((await initialize(missingTool)).message.error.message, 'Squad couldn\'t find squad-check-missing-tool on this computer. Check the command in Settings › Connectors.');
  await missingTool.close();
  assert.match((await eventually(() => store.get(ids.missingUv).then((item) => item.runtime?.lastError), 'missing runtime reported')), /uvx isn't installed/);
  covered.push('stdio supervision');

  // ------------------------------------------------------------ remote HTTP
  const remote = engine(launcherFor(ids.remote));
  assert.equal((await initialize(remote)).message.result.serverInfo.name, 'fixture-http');
  assert.deepEqual(freshCalls.at(-1), { id: ids.remote, stale: false });
  assert.equal(http.auth.at(-1), 'Bearer tok-1', 'the bridge\'s fresh token, not the stored one');
  remote.notify('notifications/initialized');
  assert.equal((await remote.request(2, 'tools/list')).message.result.tools.length, 2);
  // The server stops accepting tok-1: one renewal, transparent to the engine.
  http.rejectTokOne = true; http.accepted.add('Bearer tok-2');
  const authBefore = http.auth.length;
  const renewedCall = await remote.request(3, 'tools/call', { name: 'echo', arguments: { renewed: true } });
  assert.match(renewedCall.message.result.content[0].text, /renewed/);
  assert.deepEqual(http.auth.slice(authBefore), ['Bearer tok-1', 'Bearer tok-2']);
  assert.deepEqual(freshCalls.at(-1), { id: ids.remote, stale: true }, 'the proxy asked the bridge with stale');
  // The server forgets the session: a new one is started and the call resent.
  const initsBefore = http.initializes;
  http.sessions.clear();
  const resent = await remote.request(4, 'tools/list');
  assert.equal(resent.message.result.tools.length, 2);
  assert.equal(http.initializes, initsBefore + 1, 'one re-initialize');
  assert.ok(!remote.received.some((entry) => String(entry.message.id).startsWith('squad-')), 'the re-initialize answer stays inside the proxy');
  // An event-stream body: the notification arrives before the answer.
  const streamed = await remote.request(5, 'tools/call', { name: 'notify', arguments: {} });
  assert.equal(streamed.message.result.content[0].text, 'streamed');
  const progressAt = remote.received.findIndex((entry) => entry.message.method === 'notifications/progress');
  assert.ok(progressAt >= 0 && progressAt < remote.received.indexOf(streamed), 'notification forwarded before the response');
  // Signed out on the server's side: tok-2 refused too, renewal can't help.
  http.accepted.delete('Bearer tok-2');
  const refused = await remote.request(6, 'tools/list');
  assert.equal(refused.message.error.message, 'Fixture remote needs you to sign in again. Open Settings › Connectors.');
  http.accepted.add('Bearer tok-2');
  const lastSession = `session-${http.initializes}`;
  assert.ok(http.sessions.has(lastSession));
  await remote.close();
  await eventually(() => !http.sessions.has(lastSession), 'the session is closed with DELETE when the engine leaves');
  covered.push('streamable HTTP');

  const down = engine(launcherFor(ids.down));
  const started = Date.now();
  const downAnswer = await initialize(down);
  assert.equal(downAnswer.message.error.message, `Can't reach 127.0.0.1:${closedPort}. Check this computer's internet connection, then try again.`);
  assert.ok(Date.now() - started >= 1900, 'after retries with backoff');
  await down.close();
  assert.match(await eventually(() => store.get(ids.down).then((item) => item.runtime?.lastError), 'down reported'), /Can't reach/);
  covered.push('down server');

  const legacy = engine(launcherFor(ids.legacy));
  assert.equal((await initialize(legacy)).message.result.serverInfo.name, 'fixture-sse');
  legacy.notify('notifications/initialized');
  assert.equal((await legacy.request(2, 'tools/list')).message.result.tools.length, 2);
  assert.ok(http.sseAuth.every((value) => value === SECRETS.header), 'the sealed header reaches the server');
  await legacy.close();
  covered.push('legacy SSE');

  // Revoking member A below would refuse crashy's reports: finish it first.
  await crashyDone;
  await crashy.close();
  covered.push('give-up after 5 restarts');

  // ------------------------------------------------------------- security
  const tokenA = memberA[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN, tokenB = memberB[0].env.AUTOHAND_SQUAD_CONNECTOR_TOKEN;
  let answer = await bridgeAsk(tokenA, { id: ids.other, want: 'launch' });
  assert.deepEqual([answer.status, answer.success], [403, false], 'member A can\'t fetch a connector not granted to A');
  assert.match(answer.error, /isn't allowed/);
  answer = await bridgeAsk(tokenB, { id: ids.other, want: 'launch' });
  assert.equal(answer.status, 200);
  assert.equal(answer.data.command, process.execPath);
  answer = await bridgeAsk(tokenA, { id: ids.other, type: 'crash', detail: 'x' }, '/api/connectors/runtime/report');
  assert.equal(answer.status, 403, 'nor report on it');
  answer = await bridgeAsk('not-a-token', { id: ids.stdio, want: 'launch' });
  assert.equal(answer.status, 401);
  answer = await bridgeAsk('', { id: ids.stdio, want: 'launch' });
  assert.equal(answer.status, 401);
  answer = await bridgeAsk(tokenA, { id: ids.stdio, want: 'something' });
  assert.equal(answer.status, 400);
  answer = await bridgeAsk(tokenA, { id: ids.stdio, want: 'launch' });
  assert.equal(answer.data.env.API_TOKEN, SECRETS.env, 'the definition with secrets goes only to a granted token');
  assert.ok(answer.data.env.PATH, 'with a GUI-safe PATH');
  await store.setEnabled(ids.stdio, false);
  answer = await bridgeAsk(tokenA, { id: ids.stdio, want: 'launch' });
  assert.deepEqual([answer.status, answer.error], [403, 'This connector was turned off in Settings › Connectors.']);
  const off = engine(launcherFor(ids.stdio));
  assert.equal((await initialize(off)).message.error.message, 'This connector was turned off in Settings › Connectors.');
  await off.close();
  await store.setEnabled(ids.stdio, true);
  runtime.revokeMember('member-a');
  answer = await bridgeAsk(tokenA, { id: ids.stdio, want: 'launch' });
  assert.equal(answer.status, 401, 'a revoked member token is refused');
  const revoked = engine(launcherFor(ids.stdio));
  assert.match((await initialize(revoked)).message.error.message, /This connector session ended/);
  await revoked.close();
  assert.equal(runtime.launchers('member-b', []).length, 0);
  assert.equal((await bridgeAsk(tokenB, { id: ids.other, want: 'launch' })).status, 401, 'a member left with no connectors loses its token');
  const outside = engine({ ...launcherFor(ids.stdio), env: { ...launcherFor(ids.stdio).env, AUTOHAND_SQUAD_CONNECTOR_URL: 'http://example.com/api/connectors/runtime' } });
  assert.match((await initialize(outside)).message.error.message, /needs Squad running on this computer/, 'the proxy only talks to a loopback bridge');
  await outside.close();
  covered.push('tokens');

  console.log(`check-connector-runtime passed: ${covered.join(', ')} (${bridgeCalls.length} bridge calls, ${http.initializes} HTTP sessions).`);
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
  for (const server of servers) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  await rm(directory, { recursive: true, force: true });
}
