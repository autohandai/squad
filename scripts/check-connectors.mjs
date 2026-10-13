#!/usr/bin/env node
// Connectors (ADR-0107) against the real bridge in an isolated state dir.
// Fakes: a stdio MCP server (both framings), an HTTP MCP endpoint (Streamable
// HTTP and legacy SSE), a Firecrawl endpoint, and Codex/Claude executables
// that record the MCP configuration they were handed. Nothing reaches the
// network and nothing touches the person's real ~/.autohand.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createFrameReader, encodeMessage } from '../server/connectors/framing.mjs';
import { claudeMcpConfig, codexConfigArgs, connectorsPolicy, mergeAutohandMcp } from '../server/connectors/inject.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-connectors-'));
const state = join(directory, 'state'), app = join(directory, 'app'), config = join(directory, 'user.json');
const fakeMcp = join(directory, 'fake-mcp.cjs'), calls = join(directory, 'calls.jsonl'), harnessCalls = join(directory, 'harness.jsonl');
const fakeCodex = join(directory, 'codex'), fakeClaude = join(directory, 'claude');
const SECRETS = { envToken: 'secret-value-1234', header: 'Bearer t0ken-abcd', firecrawl: 'fc-live-key-9f3c' };
const PLAIN = 'plain-value';
let bridge, logs = '';

async function freePort() { const socket = createNetServer(); await new Promise((r) => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise((r) => socket.close(r)); return port; }
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;

/** Every bridge response is scanned for the secrets: none may ever reach a client. */
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  for (const [label, secret] of Object.entries(SECRETS)) assert.ok(!text.includes(secret), `${method} ${path} leaked the ${label} secret`);
  return { status: response.status, ...JSON.parse(text) };
}
async function until(operation) { const end = Date.now() + 15000; while (Date.now() < end) { const value = await operation().catch(() => null); if (value) return value; await new Promise((r) => setTimeout(r, 40)); } throw Error(`Bridge fixture timed out: ${logs.slice(-1500)}`); }
function start() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: '', AUTOHAND_SQUAD_HOME: state, AUTOHAND_SQUAD_APP_STATE_DIR: app, AUTOHAND_HOME: join(directory, 'home'), AUTOHAND_USER_CONFIG_PATH: config, FIRECRAWL_API_URL: `http://127.0.0.1:${fixturePort}`, CODEX_HOME: join(directory, 'codex-home'), OPENAI_API_KEY: 'fixture-no-provider', ANTHROPIC_API_KEY: 'fixture-no-provider' }, stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.on('data', (b) => { logs += b; }); bridge.stderr.on('data', (b) => { logs += b; });
}
async function stop() { if (!bridge || bridge.exitCode !== null) return; const closed = new Promise((r) => bridge.once('close', r)); bridge.kill('SIGTERM'); await closed; }

// --- fixture HTTP server: MCP over Streamable HTTP, legacy SSE, and Firecrawl ---
const seen = { firecrawlAuth: [], mcpAuth: [], scrapeBodies: [] };
const fixtureTools = { tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }, { name: 'time', inputSchema: { type: 'object' } }] };
function rpcResult(request) {
  if (request.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-http', version: '1' } };
  if (request.method === 'tools/list') return fixtureTools;
  return {};
}
const readBody = (req) => new Promise((r) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => r(data)); });
const sseClients = new Map();
const fixture = createHttpServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const json = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/mcp') {
    seen.mcpAuth.push(req.headers.authorization || '');
    if (req.headers.authorization !== SECRETS.header) return json(401, { error: 'unauthorized' });
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    const request = JSON.parse(await readBody(req));
    if (request.id === undefined) { res.writeHead(202); return res.end(); }
    const headers = request.method === 'initialize' ? { 'mcp-session-id': 'fixture-session' } : {};
    if (request.method !== 'initialize' && req.headers['mcp-session-id'] !== 'fixture-session') return json(400, { error: 'missing session' });
    if (url.searchParams.get('stream') === '1') { res.writeHead(200, { 'content-type': 'text/event-stream', ...headers }); return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: rpcResult(request) })}\n\n`); }
    return json(200, { jsonrpc: '2.0', id: request.id, result: rpcResult(request) }, headers);
  }
  if (url.pathname === '/sse' && req.method === 'GET') {
    const id = String(sseClients.size + 1);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`event: endpoint\ndata: /messages?sid=${id}\n\n`);
    sseClients.set(id, res); req.on('close', () => sseClients.delete(id)); return undefined;
  }
  if (url.pathname === '/messages' && req.method === 'POST') {
    const request = JSON.parse(await readBody(req)); const client = sseClients.get(url.searchParams.get('sid'));
    res.writeHead(202); res.end();
    if (client && request.id !== undefined) client.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: rpcResult(request) })}\n\n`);
    return undefined;
  }
  if (url.pathname.startsWith('/v2/')) {
    seen.firecrawlAuth.push(req.headers.authorization || '');
    if (req.headers.authorization !== `Bearer ${SECRETS.firecrawl}`) return json(401, { success: false, error: 'Unauthorized: Invalid token' });
    if (url.pathname === '/v2/team/credit-usage') return json(200, { success: true, data: { remainingCredits: 4321, planCredits: 5000 } });
    if (url.pathname === '/v2/search') return json(200, { success: true, data: { web: [{ url: 'https://example.com/a', title: 'Result A', description: 'First hit' }, { url: 'https://example.com/b', title: 'Result B', description: 'Second hit' }] } });
    if (url.pathname === '/v2/scrape') { seen.scrapeBodies.push(JSON.parse(await readBody(req))); return json(200, { success: true, data: { markdown: 'lorem '.repeat(4000), metadata: { title: 'Example Doc', sourceURL: 'https://example.com/doc', statusCode: 200 } } }); }
  }
  return json(404, { error: 'fixture route not found' });
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const fixturePort = fixture.address().port;

/** Drive a stdio MCP child over JSON-RPC in one framing. */
async function rpcSession(command, args, env, framing, steps) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const reader = createFrameReader((message, seenFraming) => { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); waiter({ message, framing: seenFraming }); } });
  child.stdout.on('data', (chunk) => reader.feed(chunk));
  let stderr = ''; child.stderr.on('data', (c) => { stderr += c; });
  const request = (id, method, params) => new Promise((r, reject) => { const timer = setTimeout(() => reject(Error(`rpc ${method} timed out: ${stderr}`)), 10000); pending.set(id, (value) => { clearTimeout(timer); r(value); }); child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method, params }, framing)); });
  try { return await steps(request, (message) => child.stdin.write(encodeMessage(message, framing))); }
  finally { child.kill(); }
}

try {
  await Promise.all([mkdir(state, { recursive: true }), mkdir(join(directory, 'codex-home'), { recursive: true }), mkdir(join(directory, 'home'), { recursive: true })]);
  await writeFile(config, JSON.stringify({ provider: 'autohandai', autohandai: { model: 'auto', apiKey: 'fixture-provider-key' }, mcp: { enabled: true, servers: [{ name: 'user-sentinel', transport: 'stdio', command: '/mock/unstarted' }] } }));
  await writeFile(join(directory, 'codex-home', 'auth.json'), '{}');
  await writeFile(join(state, 'notifications.json'), JSON.stringify({ version: 1, settings: { runFinished: false, runFailed: false, handoffPending: false, approvalPending: false, mention: false }, items: [] }));
  // A tiny MCP server: --framing newline|header, --fail exits early, records its env on tools/list.
  await writeFile(fakeMcp, `const fs=require('node:fs');const framing=process.argv.includes('--framing')?process.argv[process.argv.indexOf('--framing')+1]:'newline';
if(process.argv.includes('--fail')){process.stderr.write('fixture refused to start: missing FOO\\n');process.exit(3);}
let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk.toString();for(;;){let body;if(buffer.startsWith('Content-Length:')){const end=buffer.indexOf('\\r\\n\\r\\n');if(end<0)return;const size=Number(buffer.slice(15,end));if(buffer.length<end+4+size)return;body=buffer.slice(end+4,end+4+size);buffer=buffer.slice(end+4+size);if(framing!=='header')continue;}else{const end=buffer.indexOf('\\n');if(end<0)return;body=buffer.slice(0,end);buffer=buffer.slice(end+1);if(framing!=='newline')continue;}
let request;try{request=JSON.parse(body);}catch{continue;}if(request.id===undefined)continue;let result={};if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture-'+framing,version:'1'}};else if(request.method==='tools/list'){fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({framing,apiToken:process.env.API_TOKEN||'',plain:process.env.PLAIN||''})+'\\n');result={tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object'}},{name:'time',inputSchema:{type:'object'}}]};}
const encoded=JSON.stringify({jsonrpc:'2.0',id:request.id,result});process.stdout.write(framing==='header'?'Content-Length: '+Buffer.byteLength(encoded)+'\\r\\n\\r\\n'+encoded:encoded+'\\n');}});`);
  // Fake Codex: records every -c override; fake Claude: records --mcp-config and the file it names.
  await writeFile(fakeCodex, `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
fs.appendFileSync(${JSON.stringify(harnessCalls)},JSON.stringify({harness:'codex',overrides:args.flatMap((v,i)=>v==='-c'?[args[i+1]]:[])})+'\\n');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture codex reply'}}));console.log(JSON.stringify({type:'turn.completed'}));`);
  await writeFile(fakeClaude, `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('2.0.0 (Claude Code)');process.exit(0);}if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'fixture',email:'fixture@example.com'}));process.exit(0);}
const configs=args.flatMap((v,i)=>v==='--mcp-config'?[args[i+1]]:[]);fs.appendFileSync(${JSON.stringify(harnessCalls)},JSON.stringify({harness:'claude',configs,contents:configs.map(p=>JSON.parse(fs.readFileSync(p,'utf8')))})+'\\n');
console.log(JSON.stringify({type:'result',subtype:'success',result:'fixture claude reply',session_id:'fixture-session'}));`);
  await chmod(fakeCodex, 0o700); await chmod(fakeClaude, 0o700);

  start(); await until(async () => (await api('/api/connectors')).success);

  // --- list: the built-in row comes first, off, without a key ---
  let listed = (await api('/api/connectors')).data.connectors;
  assert.equal(listed[0].id, 'web-research'); assert.equal(listed[0].builtin, true); assert.equal(listed[0].enabled, false); assert.equal(listed[0].hasKey, false);
  assert.equal(listed.length, 1);
  const stateFile = await stat(join(state, 'connectors.json')).catch(() => null);
  assert.ok(!stateFile, 'nothing is written until something is saved');

  // --- create a stdio connector: saved off, secrets masked, plain values shown ---
  const created = await api('/api/connectors', { name: 'Fixture newline', kind: 'stdio', command: process.execPath, args: [fakeMcp, '--framing', 'newline'], env: [{ key: 'API_TOKEN', value: SECRETS.envToken }, { key: 'PLAIN', value: PLAIN }] });
  assert.equal(created.status, 201); const newline = created.data;
  assert.equal(newline.enabled, false); assert.equal(newline.kind, 'stdio'); assert.equal(newline.serverName, `squad-connector-${newline.id}`);
  const token = newline.env.find((pair) => pair.key === 'API_TOKEN'); assert.deepEqual({ ...token }, { key: 'API_TOKEN', value: '', secret: true, configured: true, hint: '…1234' });
  assert.deepEqual(newline.env.find((pair) => pair.key === 'PLAIN'), { key: 'PLAIN', value: PLAIN, secret: false, configured: true, hint: '' });
  assert.equal(((await stat(join(state, 'connectors.json'))).mode & 0o777), 0o600, 'connectors.json is private');
  assert.equal((await api('/api/connectors', { name: 'Bad', kind: 'url', url: 'ftp://x' })).status, 400);
  assert.equal((await api('/api/connectors', { name: 'Bad', kind: 'url', url: 'https://user:pw@x.example/mcp' })).status, 400, 'credentials in the address are refused');

  // --- Test: newline framing, header framing, failing command, missing command ---
  let test = (await api(`/api/connectors/${newline.id}/test`, {})).data;
  assert.equal(test.ok, true, test.error); assert.deepEqual(test.tools, ['echo', 'time']); assert.equal(test.framing, 'newline'); assert.equal(test.serverName, 'fixture-newline');
  assert.equal(test.connector.framing, 'newline'); assert.equal(test.connector.lastTest.ok, true);
  const header = (await api('/api/connectors', { name: 'Fixture header', kind: 'stdio', command: process.execPath, args: [fakeMcp, '--framing', 'header'] })).data;
  test = (await api(`/api/connectors/${header.id}/test`, {})).data;
  assert.equal(test.ok, true, test.error); assert.equal(test.framing, 'header'); assert.deepEqual(test.tools, ['echo', 'time']);
  assert.equal((await api(`/api/connectors/${header.id}`)).data.framing, 'header', 'the detected framing is remembered for the member config');
  const failing = (await api('/api/connectors', { name: 'Fixture failing', kind: 'stdio', command: process.execPath, args: [fakeMcp, '--fail'] })).data;
  test = (await api(`/api/connectors/${failing.id}/test`, {})).data;
  assert.equal(test.ok, false); assert.ok(test.error.includes('code 3') && test.error.includes('missing FOO'), test.error); assert.ok(test.error.length <= 240);
  const missing = (await api('/api/connectors', { name: 'Fixture missing', kind: 'stdio', command: join(directory, 'does-not-exist') })).data;
  test = (await api(`/api/connectors/${missing.id}/test`, {})).data;
  assert.equal(test.ok, false); assert.ok(test.error.startsWith('Could not start'), test.error);
  assert.equal((await api(`/api/connectors/${missing.id}`)).data.lastTest.ok, false);

  // --- URL connectors: Streamable HTTP (JSON and SSE bodies), legacy SSE, headers reach the server masked to the browser ---
  const http = (await api('/api/connectors', { name: 'Fixture HTTP', kind: 'url', url: `http://127.0.0.1:${fixturePort}/mcp`, transport: 'http', headers: [{ key: 'Authorization', value: SECRETS.header }, { key: 'X-Plain', value: 'visible' }] })).data;
  assert.deepEqual(http.headers.find((pair) => pair.name === 'Authorization'), { name: 'Authorization', value: '', secret: true, configured: true, hint: '…abcd' });
  assert.equal(http.headers.find((pair) => pair.name === 'X-Plain').value, 'visible');
  test = (await api(`/api/connectors/${http.id}/test`, {})).data;
  assert.equal(test.ok, true, test.error); assert.deepEqual(test.tools, ['echo', 'time']); assert.equal(test.transport, 'http'); assert.equal(test.serverName, 'fixture-http');
  assert.ok(seen.mcpAuth.includes(SECRETS.header), 'the stored Authorization header was sent');
  const streamed = (await api('/api/connectors', { name: 'Fixture HTTP stream', kind: 'url', url: `http://127.0.0.1:${fixturePort}/mcp?stream=1`, headers: [{ key: 'Authorization', value: SECRETS.header }] })).data;
  test = (await api(`/api/connectors/${streamed.id}/test`, {})).data; assert.equal(test.ok, true, test.error); assert.deepEqual(test.tools, ['echo', 'time']);
  const noAuth = (await api('/api/connectors', { name: 'Fixture HTTP no auth', kind: 'url', url: `http://127.0.0.1:${fixturePort}/mcp` })).data;
  test = (await api(`/api/connectors/${noAuth.id}/test`, {})).data; assert.equal(test.ok, false); assert.ok(test.error.startsWith('HTTP 401'), test.error);
  const sse = (await api('/api/connectors', { name: 'Fixture SSE', kind: 'url', url: `http://127.0.0.1:${fixturePort}/sse`, transport: 'sse' })).data;
  test = (await api(`/api/connectors/${sse.id}/test`, {})).data;
  assert.equal(test.ok, true, test.error); assert.equal(test.transport, 'sse'); assert.deepEqual(test.tools, ['echo', 'time']);
  const closedPort = await freePort();
  const unreachable = (await api('/api/connectors', { name: 'Fixture unreachable', kind: 'url', url: `http://127.0.0.1:${closedPort}/mcp` })).data;
  test = (await api(`/api/connectors/${unreachable.id}/test`, {})).data; assert.equal(test.ok, false); assert.ok(test.error.length > 0 && test.error.length <= 240);

  // --- update keeps a secret sent back blank, replaces one sent with a value, drops one left out ---
  const updated = (await api(`/api/connectors/${newline.id}`, { name: 'Fixture newline', kind: 'stdio', command: process.execPath, args: [fakeMcp, '--framing', 'newline'], env: [{ key: 'API_TOKEN', value: '' }, { key: 'PLAIN', value: 'changed' }] }, 'PUT')).data;
  assert.equal(updated.env.find((pair) => pair.key === 'API_TOKEN').hint, '…1234');
  assert.equal(updated.env.find((pair) => pair.key === 'PLAIN').value, 'changed');
  await api(`/api/connectors/${newline.id}/test`, {});
  const envSeen = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(envSeen.some((entry) => entry.framing === 'newline' && entry.apiToken === SECRETS.envToken && entry.plain === 'changed'), 'the kept secret and the changed plain value reached the child');
  const dropped = (await api(`/api/connectors/${newline.id}`, { env: [{ key: 'API_TOKEN', value: '' }] }, 'PUT')).data;
  assert.ok(!dropped.env.some((pair) => pair.key === 'PLAIN'), 'an entry left out is removed');

  // --- built-in Web research: handshake only without a key; a real Firecrawl call with one ---
  test = (await api('/api/connectors/web-research/test', {})).data;
  assert.equal(test.ok, true, test.error); assert.deepEqual(test.tools, ['web_search', 'web_fetch']); assert.equal(test.keyChecked, false); assert.equal(seen.firecrawlAuth.length, 0);
  let builtin = (await api('/api/connectors/web-research', { apiKey: 'wrong-key' }, 'PUT')).data; assert.equal(builtin.hasKey, true);
  test = (await api('/api/connectors/web-research/test', {})).data;
  assert.equal(test.ok, false); assert.ok(test.error.includes('Firecrawl rejected the key'), test.error); assert.equal(test.keyChecked, true);
  builtin = (await api('/api/connectors/web-research', { apiKey: SECRETS.firecrawl }, 'PUT')).data; assert.equal(builtin.keyHint, '…9f3c');
  test = (await api('/api/connectors/web-research/test', {})).data;
  assert.equal(test.ok, true, test.error); assert.equal(test.keyChecked, true); assert.equal(test.credits, 4321);
  assert.equal((await api('/api/connectors/web-research', {}, 'PUT')).data.hasKey, true, 'an update without apiKey keeps the key');
  assert.equal((await api('/api/connectors/web-research', undefined, 'DELETE')).status, 400, 'the built-in cannot be removed');

  // --- the research server itself: initialize/tools/list/web_fetch in both framings, source URL and the 12,000-character cap ---
  const serverPath = join(root, 'server', 'connectors', 'web-research-mcp.mjs');
  const researchEnv = { FIRECRAWL_API_KEY: SECRETS.firecrawl, FIRECRAWL_API_URL: `http://127.0.0.1:${fixturePort}` };
  for (const framing of ['header', 'newline']) {
    await rpcSession(process.execPath, [serverPath], researchEnv, framing, async (request, notify) => {
      const init = await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
      assert.equal(init.framing, framing); assert.equal(init.message.result.protocolVersion, '2024-11-05'); assert.equal(init.message.result.serverInfo.name, 'squad-web-research');
      notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const tools = await request(2, 'tools/list', {}); assert.deepEqual(tools.message.result.tools.map((tool) => tool.name), ['web_search', 'web_fetch']);
      const fetched = await request(3, 'tools/call', { name: 'web_fetch', arguments: { url: 'https://example.com/doc' } });
      const text = fetched.message.result.content[0].text;
      assert.ok(text.startsWith('Source: https://example.com/doc\nTitle: Example Doc\n'), text.slice(0, 80));
      assert.ok(text.includes('more characters not shown'), 'long pages are capped');
      assert.ok(text.length < 12300 && text.length > 12000, `capped near 12,000 characters, got ${text.length}`);
      assert.equal(fetched.message.result.structuredContent.url, 'https://example.com/doc'); assert.equal(fetched.message.result.structuredContent.truncated, true);
      const searched = await request(4, 'tools/call', { name: 'web_search', arguments: { query: 'squad', limit: 2 } });
      assert.ok(searched.message.result.content[0].text.includes('Source: https://example.com/a'), 'search results carry their URLs');
      assert.equal(searched.message.result.structuredContent.results.length, 2);
      const bad = await request(5, 'tools/call', { name: 'web_fetch', arguments: { url: 'file:///etc/passwd' } }); assert.equal(bad.message.result.isError, true);
      const unknown = await request(6, 'nope', {}); assert.equal(unknown.message.error.code, -32601);
    });
  }
  assert.ok(seen.scrapeBodies.every((body) => body.formats.includes('markdown') && body.onlyMainContent === true));
  await rpcSession(process.execPath, [serverPath], { FIRECRAWL_API_KEY: '', FIRECRAWL_API_URL: `http://127.0.0.1:${fixturePort}` }, 'newline', async (request) => {
    const result = await request(1, 'tools/call', { name: 'web_search', arguments: { query: 'x' } });
    assert.equal(result.message.result.isError, true); assert.ok(result.message.result.content[0].text.includes('Firecrawl API key'));
  });

  // --- enable, then provision members: allow gets the servers, block and ask get none, existing entries survive ---
  await api(`/api/connectors/${newline.id}/enable`, {}); await api('/api/connectors/web-research/enable', {});
  await api(`/api/connectors/${http.id}/enable`, {});
  const member = (id, mode, extra = {}) => ({ id, name: `Member ${id}`, role: 'Engineer', workspace: root, skills: [], permissions: { permissionMode: 'interactive', modes: { 'mcp.connectors': mode } }, ...extra });
  const provision = async (agent) => { const r = await api('/api/agents/provision', { agentId: agent.id, agent, workspace: root }); assert.equal(r.success, true, r.error); return JSON.parse(await readFile(join(app, 'agents', agent.id, 'config.json'), 'utf8')); };
  const allowed = await provision(member('allow-member', 'allow'));
  const names = (cfg) => (cfg.mcp?.servers || []).map((entry) => entry.name);
  assert.deepEqual(names(allowed), ['user-sentinel', 'squad-connector-web-research', `squad-connector-${newline.id}`, `squad-connector-${http.id}`], 'the person\'s entry first, then the built-in, then added connectors in order');
  assert.equal(allowed.mcp.enabled, true);
  const managed = allowed.mcp.servers.find((entry) => entry.name === `squad-connector-${newline.id}`);
  assert.equal(managed.transport, 'stdio'); assert.equal(managed.stdioFraming, 'newline'); assert.equal(managed.env.API_TOKEN, SECRETS.envToken); assert.equal(managed.autoConnect, true);
  const research = allowed.mcp.servers.find((entry) => entry.name === 'squad-connector-web-research');
  assert.equal(research.command, process.execPath); assert.equal(research.args[0], serverPath); assert.equal(research.env.FIRECRAWL_API_KEY, SECRETS.firecrawl); assert.equal(research.env.FIRECRAWL_API_URL, `http://127.0.0.1:${fixturePort}`);
  const remote = allowed.mcp.servers.find((entry) => entry.name === `squad-connector-${http.id}`);
  assert.equal(remote.transport, 'http'); assert.equal(remote.headers.Authorization, SECRETS.header);
  assert.equal((await stat(join(app, 'agents', 'allow-member', 'config.json'))).mode & 0o777, 0o600, 'the member config holding connector secrets is private');
  const blocked = await provision(member('block-member', 'block'));
  assert.deepEqual(names(blocked), ['user-sentinel']);
  const asked = await provision(member('ask-member', 'ask'));
  assert.deepEqual(names(asked), ['user-sentinel'], 'ask has no approval path for MCP tools, so it is treated as not enabled');
  const unspecified = await provision({ ...member('plain-member', 'allow'), permissions: { permissionMode: 'interactive' } });
  assert.deepEqual(names(unspecified), ['user-sentinel'], 'a member without a recorded mode falls back to the ladder default (ask)');
  assert.equal(connectorsPolicy({ permissions: { modes: { 'mcp.connectors': 'allow' } } }), 'allow'); assert.equal(connectorsPolicy({}), 'ask');
  // An agent-less call (chat warm) keeps the mode through the saved profile instead of silently dropping the servers.
  const profile = JSON.parse(await readFile(join(app, 'agents', 'allow-member', 'profile.json'), 'utf8'));
  assert.equal(profile.permissions.modes['mcp.connectors'], 'allow');
  const warmed = await api('/api/chat/warm', { agentId: 'allow-member', workspace: root }); assert.ok(warmed.success !== false);
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(names(JSON.parse(await readFile(join(app, 'agents', 'allow-member', 'config.json'), 'utf8'))), names(allowed), 'warming did not drop the servers');

  // --- disable one: the next provisioning removes exactly it ---
  await api(`/api/connectors/${http.id}/disable`, {});
  assert.deepEqual(names(await provision(member('allow-member', 'allow'))), ['user-sentinel', 'squad-connector-web-research', `squad-connector-${newline.id}`]);
  assert.deepEqual(mergeAutohandMcp({ servers: [{ name: 'mine' }, { name: 'squad-connector-stale' }] }, []), { servers: [{ name: 'mine' }] });

  // --- Codex and Claude receive the same servers through their native flags; a blocked member gets no flag ---
  const codexMember = member('codex-member', 'allow', { harness: { id: 'codex', executablePath: fakeCodex } });
  let chat = await api('/api/chat', { agentId: codexMember.id, agent: codexMember, workspace: root, prompt: 'hello', resumeSession: false }); assert.equal(chat.success, true, JSON.stringify(chat).slice(0, 400));
  const claudeMember = member('claude-member', 'allow', { harness: { id: 'claude', executablePath: fakeClaude } });
  chat = await api('/api/chat', { agentId: claudeMember.id, agent: claudeMember, workspace: root, prompt: 'hello', resumeSession: false }); assert.equal(chat.success, true, JSON.stringify(chat).slice(0, 400));
  const blockedClaude = member('claude-blocked', 'block', { harness: { id: 'claude', executablePath: fakeClaude } });
  chat = await api('/api/chat', { agentId: blockedClaude.id, agent: blockedClaude, workspace: root, prompt: 'hello', resumeSession: false }); assert.equal(chat.success, true);
  const harnessSeen = (await readFile(harnessCalls, 'utf8')).trim().split('\n').map(JSON.parse);
  const codexSeen = harnessSeen.find((entry) => entry.harness === 'codex');
  assert.ok(codexSeen.overrides.includes(`mcp_servers.squad-connector-${newline.id}.command=${JSON.stringify(process.execPath)}`), JSON.stringify(codexSeen.overrides));
  assert.ok(codexSeen.overrides.some((value) => value.startsWith('mcp_servers.squad-connector-web-research.env=') && value.includes(SECRETS.firecrawl)));
  const claudeSeen = harnessSeen.filter((entry) => entry.harness === 'claude');
  assert.equal(claudeSeen.length, 2);
  // Other managed servers (Computer Use, the vault, ADR-0104) travel in their own
  // --mcp-config file, so find the connectors file rather than expecting one file.
  const isConnectorConfig = (contents) => Object.keys(contents?.mcpServers || {}).some((key) => key.startsWith('squad-connector-'));
  const connectorConfig = claudeSeen[0].contents.find(isConnectorConfig);
  assert.ok(connectorConfig, 'connectors travel to Claude in a --mcp-config file');
  assert.deepEqual(Object.keys(connectorConfig.mcpServers), ['squad-connector-web-research', `squad-connector-${newline.id}`]);
  assert.equal(connectorConfig.mcpServers['squad-connector-web-research'].env.FIRECRAWL_API_KEY, SECRETS.firecrawl);
  assert.ok(!claudeSeen[1].contents.some(isConnectorConfig), 'a blocked member gets no connectors --mcp-config');
  assert.equal((await stat(claudeSeen[0].configs[0])).mode & 0o777, 0o600);
  assert.deepEqual(claudeMcpConfig([{ serverName: 'squad-connector-x', kind: 'url', transport: 'sse', url: 'https://x.example/sse', headers: { Authorization: 'Bearer t' } }]), { mcpServers: { 'squad-connector-x': { type: 'sse', url: 'https://x.example/sse', headers: { Authorization: 'Bearer t' } } } });
  assert.deepEqual(codexConfigArgs([{ serverName: 'squad-connector-x', kind: 'url', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer t' } }]), ['-c', 'mcp_servers.squad-connector-x.url="https://x.example/mcp"', '-c', 'mcp_servers.squad-connector-x.http_headers={"Authorization"="Bearer t"}']);

  // --- the state survives a bridge restart; delete removes a connector ---
  await stop(); start(); await until(async () => (await api('/api/connectors')).success);
  listed = (await api('/api/connectors')).data.connectors;
  assert.equal(listed[0].id, 'web-research'); assert.equal(listed[0].enabled, true); assert.equal(listed[0].hasKey, true); assert.equal(listed[0].lastTest.credits, 4321);
  const restored = listed.find((item) => item.id === newline.id); assert.equal(restored.enabled, true); assert.equal(restored.lastTest.ok, true); assert.equal(restored.env.find((pair) => pair.key === 'API_TOKEN').hint, '…1234');
  assert.equal(listed.find((item) => item.id === http.id).enabled, false);
  assert.equal((await api(`/api/connectors/${failing.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await api(`/api/connectors/${failing.id}`)).status, 404);
  assert.equal((await api('/api/connectors/../etc', undefined, 'DELETE')).status, 404);
  const final = JSON.parse(await readFile(join(state, 'connectors.json'), 'utf8'));
  assert.ok(final.connectors.every((item) => item.id !== failing.id));
  assert.ok(!logs.includes(SECRETS.firecrawl) && !logs.includes(SECRETS.envToken), 'bridge logs carry no secret');

  console.log('check-connectors passed: stdio (newline + Content-Length) and URL (Streamable HTTP + SSE) tests, bounded failures, masked secrets in every response, allow/ask/block injection for Autohand, Codex and Claude with existing MCP entries kept, built-in Web research handshake + Firecrawl key check + capped cited web_fetch, restart persistence. Fixtures only; no network.');
} finally {
  await stop();
  await new Promise((r) => fixture.close(r));
  for (const client of sseClients.values()) client.end();
  await rm(directory, { recursive: true, force: true });
}
