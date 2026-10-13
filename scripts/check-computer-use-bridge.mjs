#!/usr/bin/env node
// Real Squad HTTP server and MCP proxy; fake desktop host and fake Codex only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(new URL('..', import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), 'squad-computer-http-'));
const state = join(directory, 'state'), app = join(directory, 'app'), runtime = join(directory, 'runtime');
const vendor = join(runtime, 'vendor', 'computer-use'), host = join(vendor, 'mock-host'), driver = join(vendor, 'mock-driver');
const harness = join(directory, 'mock-codex'), config = join(directory, 'user.json'), calls = join(directory, 'calls.jsonl');
const nativeKey = 'a'.repeat(64), keyPath = join(state, 'native-grant-token');
const member = { id: 'computer-fixture', name: 'Eva', role: 'QA', status: 'online', harness: { id: 'codex', executablePath: harness }, permissions: { permissionMode: 'restricted' } };
const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
let bridge, logs = '';
async function api(path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') { const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, ...await response.json() }; }
async function until(operation) { const end = Date.now() + 12000; while (Date.now() < end) { const value = await operation().catch(() => null); if (value) return value; await new Promise(r => setTimeout(r, 30)); } throw Error(`Bridge fixture timed out: ${logs.slice(-1500)}`); }
function start() { bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: '', AUTOHAND_SQUAD_HOME: state, AUTOHAND_SQUAD_APP_STATE_DIR: app, AUTOHAND_HOME: join(directory, 'home'), AUTOHAND_USER_CONFIG_PATH: config, AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: runtime, CODEX_HOME: join(directory, 'codex'), OPENAI_API_KEY: 'fixture-no-provider' }, stdio: ['ignore', 'pipe', 'pipe'] }); bridge.stdout.on('data', b => logs += b); bridge.stderr.on('data', b => logs += b); }
async function stop() { if (!bridge || bridge.exitCode !== null) return; const closed = new Promise(r => bridge.once('close', r)); bridge.kill('SIGTERM'); await closed; }
const sha = value => createHash('sha256').update(value).digest('hex');
try {
  await Promise.all([mkdir(state, { recursive: true }), mkdir(vendor, { recursive: true }), mkdir(join(directory, 'codex'), { recursive: true })]);
  await writeFile(config, JSON.stringify({ provider: 'autohandai', autohandai: { model: 'auto' }, mcp: { enabled: true, servers: [{ name: 'user-sentinel', command: '/mock/unstarted' }] } }));
  await writeFile(join(state, 'notifications.json'), JSON.stringify({ version: 1, settings: { runFinished: false, runFailed: false, handoffPending: false, approvalPending: false, mention: false }, items: [] }));
  await writeFile(join(directory, 'codex', 'auth.json'), '{}');
  const hostBytes = `#!${process.execPath}
const fs=require('node:fs'),rl=require('node:readline');rl.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.id===undefined)return;let result={};if(request.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(request.method==='tools/list')result={tools:[{name:'get_window_state',inputSchema:{type:'object'}},{name:'click',inputSchema:{type:'object'}}]};else if(request.params.name==='check_permissions')result={structuredContent:{accessibility:true,screen_recording:true}};else {fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({native:request.params.name,privateKeyInherited:!!process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN})+'\\n');if(request.params.name==='get_window_state')fs.writeFileSync(request.params.arguments.screenshot_out_file,Buffer.from([137,80,78,71]));result={content:[{type:'text',text:'mock action'}]};}console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));});
`;
  await writeFile(host, hostBytes); await chmod(host, 0o700); await writeFile(driver, 'mock engine never executed');
  await writeFile(join(vendor, 'BUILD_INFO.json'), JSON.stringify({ version: '0.28.2', repository: 'autohandai/computer-use', driver: { path: 'mock-driver', sha256: sha('mock engine never executed') }, host: { path: 'mock-host', bundleId: 'ai.autohand.squad.computer-use', sha256: sha(hostBytes) } }));
  await writeFile(harness, `#!${process.execPath}
const fs=require('node:fs'),child=require('node:child_process'),readline=require('node:readline'),toml=require(${JSON.stringify(join(root, 'node_modules', 'toml'))});const args=process.argv.slice(2);if(args[0]==='--version'){console.log('codex 1.0.0');process.exit(0);}if(args[0]==='login'){console.log('Logged in using fixture');process.exit(0);}
(async()=>{const values=args.flatMap((value,index)=>value==='-c'?[args[index+1]]:[]),merged=values.map(value=>toml.parse(value));const field=suffix=>merged.find(value=>value.mcp_servers?.['autohand-computer-use']?.[suffix])?.mcp_servers['autohand-computer-use'][suffix];const command=field('command');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({kind:'harness',managed:!!command,privateKeyInherited:!!process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN})+'\\n');if(command){const proxy=child.spawn(command,field('args'),{env:{...process.env,...field('env')},stdio:['pipe','pipe','pipe']});const pending=new Map();readline.createInterface({input:proxy.stdout}).on('line',line=>{const response=JSON.parse(line);pending.get(response.id)?.(response);});const rpc=(id,method,params)=>new Promise(resolve=>{pending.set(id,resolve);proxy.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});try{const init=await rpc(1,'initialize',{protocolVersion:'2025-06-18'});if(init.error)throw Error(init.error.message);const observed=await rpc(2,'tools/call',{name:'get_window_state',arguments:{pid:5,window_id:8}});if(observed.error)throw Error(observed.error.message);const controlled=await rpc(3,'tools/call',{name:'click',arguments:{pid:5,window_id:8}});if(controlled.error)throw Error(controlled.error.message);}finally{proxy.kill();}}console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Verified mock Computer Use.'}}));console.log(JSON.stringify({type:'turn.completed'}));})().catch(error=>{console.error(error.message);process.exit(1);});
`); await chmod(harness, 0o700);
  start(); await until(async () => (await api('/api/computer-use/status')).success);
  const status = (await api('/api/computer-use/status?memberId=' + member.id)).data; assert.equal(status.bundled, true); assert.equal(status.accessibility, true);
  await api('/api/status/snapshot', { members: [member], jobs: [] });
  const grant = { memberId: member.id, scope: 'control' };
  assert.equal((await api('/api/computer-use/grant', grant)).status, 403);
  await writeFile(keyPath, nativeKey, { mode: 0o600 }); // CLI-first bridge: key arrives after startup.
  const headers = { 'x-squad-native-grant': nativeKey };
  for (const body of [{ ...grant, memberId: 'unknown' }, { ...grant, scope: 'unrestricted' }, { ...grant, approved: true }]) assert.equal((await api('/api/computer-use/grant', body, headers)).status, 403);
  await chmod(keyPath, 0o644); assert.equal((await api('/api/computer-use/grant', grant, headers)).status, 403); await chmod(keyPath, 0o600);
  assert.equal((await api('/api/computer-use/grant', grant, headers)).status, 200);
  const chat = await api('/api/chat', { agentId: member.id, agent: member, workspace: root, prompt: 'Verify mock desktop', resumeSession: false }); assert.equal(chat.success, true, JSON.stringify(chat)); assert.equal(chat.data.computerUse.files.length, 1);
  const sessionId = chat.data.computerUse.sessionId;
  const listing = (await api('/api/computer-use/evidence?memberId=' + member.id)).data; assert.equal(listing.sessions[0].id, sessionId); assert.equal(listing.sessions[0].files.length, 1);
  const entries = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse); assert.ok(entries.some(entry => entry.kind === 'harness' && entry.managed)); assert.ok(entries.some(entry => entry.native === 'click')); assert.ok(entries.every(entry => entry.privateKeyInherited === false));
  const shadow = join(app, 'agents', member.id, 'computer-use-configs', sessionId + '.json'); await assert.rejects(stat(shadow), { code: 'ENOENT' });
  const savedConfig = JSON.parse(await readFile(join(app, 'agents', member.id, 'config.json'), 'utf8')); assert.ok(!savedConfig.mcp?.servers?.some(entry => entry.name === 'autohand-computer-use'));
  assert.equal((await api('/api/computer-use/grant', { memberId: member.id }, {}, 'DELETE')).status, 200);
  const ungranted = await api('/api/chat', { agentId: member.id, agent: member, workspace: root, prompt: 'Do ordinary mock work', resumeSession: false }); assert.equal(ungranted.success, true); assert.equal(ungranted.data.computerUse, undefined);
  await stop(); start(); await until(async () => (await api('/api/computer-use/status')).success); const restored = (await api('/api/computer-use/evidence?memberId=' + member.id)).data; assert.equal(restored.sessions[0].id, sessionId); assert.equal(restored.sessions[0].files.length, 1);
  console.log('Computer Use HTTP bridge passed: CLI-first private key, exact member/body authorization, unsafe file denial, real Codex MCP proxy framing/config, observe/control actions, no native secret inheritance, per-work cleanup, revoke and durable restart. Desktop/OS/provider were mocked.');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
