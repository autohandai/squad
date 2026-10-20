#!/usr/bin/env node
// ACP registry and agents (ADR-0122): pure checks for the registry
// normaliser, launch resolution, permission decisions and the update → event
// mapping, then a real bridge in an isolated state dir with a fake ACP agent
// (a node script that speaks the protocol over stdio). No vendor, network,
// credentials or installed app is used; the registry URL points at a closed
// port so the bundled snapshot has to answer.
//
// Proves: GET /api/acp/registry serves the bundled snapshot offline and the
// cached registry when one exists; a member on `acp:<id>` replies through
// the bridge with the tool rows in the run log; plan access refuses the
// agent's permission request and its file write, full access allows both,
// edit access refuses a write outside the member's folders; the session id
// is kept and reused with session/load on the next turn; New chat forgets
// it; Stop sends session/cancel; and a DM handoff from a Claude Code member
// reaches an ACP member through the same bridge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access as fsAccess, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { agentIdFromHarnessId, harnessIdFor, isAcpHarnessId, launchFor, normalizeAgent, normalizeRegistry, platformTarget } from '../server/acp/registry.mjs';
import { acpMcpServers, contentText, decidePermission, eventsFromUpdate, isInsideDirs, newAcpState } from '../server/harness/acp.mjs';
import { getAdapter, normalizeHarnessAssignment, normalizeHarnessId } from '../server/harness/index.mjs';
import { normalizeHarnessSessions } from '../server/chats/sessions.mjs';
import { accessOption, harnessLabel, harnessOption, harnessTakesModel, isAcpHarnessId as clientIsAcp, normalizeHarnessId as clientNormalize, registerAcpAgents } from '../src/lib/harness.js';

// ---------- pure checks ----------
assert.deepEqual(acpMcpServers([{ name: 'squad', command: '/node', args: ['proxy.mjs'], env: { TOKEN: 'fixture' } }]), [{ name: 'squad', command: '/node', args: ['proxy.mjs'], env: [{ name: 'TOKEN', value: 'fixture' }] }]);
assert.throws(() => acpMcpServers([{ name: 'remote', url: 'https://example.test/mcp' }]), /does not support http/);
assert.deepEqual(acpMcpServers([{ name: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'fixture' } }], { http: true })[0].headers, [{ name: 'Authorization', value: 'fixture' }]);
assert.equal(harnessIdFor('codex-acp'), 'acp:codex-acp'); assert.equal(harnessIdFor('pi'), 'pi');
assert.equal(agentIdFromHarnessId('acp:codex-acp'), 'codex-acp'); assert.equal(agentIdFromHarnessId('pi-acp'), 'pi'); assert.equal(agentIdFromHarnessId('claude'), '');
assert.ok(isAcpHarnessId('acp:gemini') && isAcpHarnessId('pi') && isAcpHarnessId('autohand-acp') && !isAcpHarnessId('acp:bad id') && !isAcpHarnessId('claude'));
assert.equal(normalizeHarnessId('acp:gemini'), 'acp:gemini'); assert.equal(normalizeHarnessId('pi-acp'), 'pi'); assert.equal(normalizeHarnessId('acp:no spaces'), 'autohand');
assert.equal(normalizeHarnessAssignment({ id: 'acp:cursor', access: 'plan' }).id, 'acp:cursor');
assert.equal(getAdapter('acp:codex-acp').id, 'acp:codex-acp'); assert.equal(getAdapter('acp:codex-acp').transport, 'acp'); assert.equal(getAdapter('pi').label, 'Pi');
assert.equal(getAdapter('acp:codex-acp').label, 'Codex', 'the bundled snapshot names the agent before any fetch');
assert.equal(clientNormalize('acp:opencode'), 'acp:opencode'); assert.equal(clientNormalize('PI-ACP'), 'pi'); assert.ok(clientIsAcp('autohand-acp'));
assert.equal(harnessLabel('acp:github-copilot-cli'), 'Copilot', 'bundled names reach the chip before the registry is fetched');
assert.equal(harnessLabel('acp:unknown-agent'), 'unknown-agent', 'an unknown id still has a name');
registerAcpAgents([{ harnessId: 'acp:unknown-agent', name: 'Unknown Agent', description: 'x', installed: true }]);
assert.equal(harnessLabel('acp:unknown-agent'), 'Unknown Agent', 'the registry listing renames it');
assert.equal(harnessOption('pi').acp, true); assert.equal(harnessTakesModel('pi'), false); assert.equal(harnessTakesModel('claude'), true);
assert.equal(accessOption('acp:gemini', 'plan').label, 'Plan only'); assert.equal(accessOption('acp:gemini', 'write').label, 'Edit in folders');
assert.deepEqual(Object.keys(normalizeHarnessSessions({ 'acp:codex-acp': { '/w': { resumeId: 's' } }, pi: { '/w': { resumeId: 't' } }, 'bad id!': { '/w': { resumeId: 'z' } } })), ['acp:codex-acp', 'pi'], 'ACP ids survive the session store');

const registry = normalizeRegistry({ version: '1.0.0', agents: [
  { id: 'pi-acp', name: 'pi ACP', version: '0.0.34', description: 'adapter', distribution: { npx: { package: 'pi-acp@0.0.34' } } },
  { id: 'gemini', name: 'Gemini CLI', version: '1', description: '  Google\'s   CLI ', distribution: { npx: { package: '@google/gemini-cli@1', args: ['--acp'] } } },
  { id: 'opencode', name: 'OpenCode', distribution: { binary: { 'darwin-aarch64': { archive: 'https://x/a.zip', cmd: './opencode', args: ['acp'] } } }, website: 'https://opencode.ai' },
  { id: 'Bad Id', name: 'nope' },
] });
assert.deepEqual(registry.agents.map((a) => a.id), ['pi', 'autohand-acp', 'gemini', 'opencode'], 'built-ins first, pi-acp folded into pi, bad ids dropped');
assert.equal(registry.agents[2].description, "Google's CLI", 'descriptions are one line');
assert.equal(normalizeAgent({ id: 'x', description: 'y'.repeat(300) }).description.length, 200);
const found = { pi: '/bin/pi', npx: '/bin/npx', gemini: '/bin/gemini', opencode: '', autohand: '/bin/autohand', uvx: '' };
const find = (name, { explicitPath = '' } = {}) => (explicitPath ? (explicitPath === '/fake/agent' ? explicitPath : '') : found[name] || '');
const byId = Object.fromEntries(registry.agents.map((a) => [a.id, a]));
let launch = launchFor(byId.pi, { find, platform: 'darwin-aarch64' });
assert.deepEqual([launch.command, launch.args, launch.installed, launch.fetchOnUse], ['/bin/npx', ['-y', 'pi-acp@0.0.34'], false, true], 'Pi runs the adapter through npx when pi-acp is not installed');
launch = launchFor(byId.pi, { find: (n, o) => (n === 'pi' ? '' : find(n, o)), platform: 'darwin-aarch64' });
assert.equal(launch.available, false, 'Pi needs pi itself'); assert.match(launch.detail, /pi is not installed/);
launch = launchFor(byId.gemini, { find });
assert.deepEqual([launch.command, launch.args, launch.installed], ['/bin/gemini', ['--acp'], true], 'an installed CLI is launched directly with the registry args');
launch = launchFor(byId.opencode, { find, platform: 'darwin-aarch64' });
assert.equal(launch.available, false); assert.match(launch.setup, /opencode.ai/, 'a binary that is not installed says where to get it');
launch = launchFor(byId.opencode, { find: (n) => (n === 'opencode' ? '/bin/opencode' : ''), platform: 'darwin-aarch64' });
assert.deepEqual([launch.command, launch.args], ['/bin/opencode', ['acp']]);
assert.equal(launchFor(byId.opencode, { find, platform: 'linux-x86_64' }).detail, 'OpenCode has no build for linux-x86_64.');
launch = launchFor(byId['autohand-acp'], { find, context: { autohandPath: '/app/autohand' } });
assert.deepEqual([launch.command, launch.args], ['/app/autohand', ['--acp']], 'Autohand Code (ACP) runs the bundled CLI with --acp');
launch = launchFor(byId.gemini, { find, explicitPath: '/fake/agent' });
assert.deepEqual([launch.command, launch.kind, launch.installed], ['/fake/agent', 'explicit', true], 'an explicit executable path wins');
assert.match(platformTarget('darwin', 'arm64'), /^darwin-aarch64$/); assert.equal(platformTarget('win32', 'x64'), 'windows-x86_64');

// Permission decisions (plan refuses writes, write keeps edits in the folders, full allows all).
const options = [{ optionId: 'o', name: 'Allow', kind: 'allow_once' }, { optionId: 'a', name: 'Always', kind: 'allow_always' }, { optionId: 'r', name: 'Reject', kind: 'reject_once' }];
const edit = { toolCallId: 't', kind: 'edit', locations: [{ path: '/w/src/a.js' }] };
assert.deepEqual([decidePermission({ access: 'plan', toolCall: edit, options, allowedDirs: ['/w'] }).allowed, decidePermission({ access: 'plan', toolCall: edit, options }).optionId], [false, 'r']);
assert.equal(decidePermission({ access: 'plan', toolCall: { kind: 'read' }, options }).optionId, 'o', 'plan allows reads');
assert.equal(decidePermission({ access: 'plan', toolCall: { kind: 'execute' }, options }).allowed, false, 'plan refuses commands');
assert.equal(decidePermission({ access: 'write', toolCall: edit, options, allowedDirs: ['/w'] }).optionId, 'o', 'write allows edits inside the folders');
assert.equal(decidePermission({ access: 'write', toolCall: { kind: 'edit', locations: [{ path: '/elsewhere/x' }] }, options, allowedDirs: ['/w'] }).allowed, false, 'write refuses edits outside');
assert.equal(decidePermission({ access: 'write', toolCall: { kind: 'execute' }, options, allowedDirs: ['/w'] }).allowed, true, 'write allows commands');
assert.equal(decidePermission({ access: 'full', toolCall: { kind: 'delete', locations: [{ path: '/elsewhere' }] }, options }).optionId, 'a', 'full picks allow_always');
assert.equal(decidePermission({ access: 'plan', toolCall: edit, options: [{ optionId: 'o', kind: 'allow_once' }] }).optionId, '', 'no reject option means cancelled');
assert.ok(isInsideDirs('/w/a/b', ['/w']) && !isInsideDirs('/w2/a', ['/w']) && isInsideDirs('/w', ['/w']));

// Update mapping.
const state = newAcpState(() => 't');
const updates = [
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } },
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } },
  { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } },
  { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read a.js', kind: 'read', status: 'pending', rawInput: { path: 'a.js' } },
  { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: 'partial' } }] },
  { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'done' } }] },
  { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'failed', title: 'Run tests', kind: 'execute', content: [{ type: 'content', content: { type: 'text', text: 'exit 1' } }] },
  { sessionUpdate: 'plan', entries: [{ content: 'step one', status: 'in_progress', priority: 'high' }] },
  { sessionUpdate: 'usage_update', used: 10, size: 100 },
  { sessionUpdate: 'available_commands_update', availableCommands: [] },
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Bye' } },
];
const events = updates.flatMap((u) => eventsFromUpdate(u, state));
assert.deepEqual(events.map((e) => e.type), ['message_update', 'message_update', 'message_update', 'message_end', 'tool_start', 'tool_update', 'tool_end', 'tool_start', 'tool_end', 'plan_update', 'usage', 'status', 'message_update']);
assert.equal(events[3].content, 'Hello', 'text before a tool call is one message'); assert.equal(events[2].thought, 'hmm');
assert.equal(events[4].toolName, 'read'); assert.deepEqual(events[4].args, { path: 'a.js' }); assert.equal(events[6].output, 'done');
assert.equal(events[8].success, false); assert.equal(events[8].error, 'exit 1'); assert.equal(events[7].toolName, 'execute', 'an update for an unknown call starts it first');
assert.deepEqual(events[9].plan, [{ step: 'step one', status: 'in_progress', priority: 'high' }]);
assert.equal(events[10].usage.modelUsage.acp.contextWindow, 100);
assert.equal(contentText([{ type: 'diff', path: '/w/a', oldText: null, newText: 'a\nb' }]), '/w/a\nnew file, 2 lines');
console.log('ACP pure checks passed: ids, registry, launch, permissions, events.');

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-acp-'));
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-acp');
const fakeClaude = join(directory, 'fixture-claude');
const outsideFile = join(directory, 'outside', 'written-by-agent.txt');
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
const member = (id, harness = {}) => ({ id, name: id, harness: { id: 'acp:fake-agent', executablePath: fake, ...harness }, projects: [{ path: rootDir }] });
const payload = (id, prompt, extra = {}) => ({ agentId: id, agent: member(id, extra.harness), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.', ...extra });
const chat = async (id, prompt, extra) => (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt, extra)) })).text();
const sessionsFile = (id) => join(directory, 'app', 'agents', id, 'harness-sessions.json');
const resumeIdOnDisk = async (id = 'pim') => Object.values(JSON.parse(await readFile(sessionsFile(id), 'utf8').catch(() => '{}'))['acp:fake-agent'] || {})[0]?.resumeId || '';
const exists = (path) => fsAccess(path).then(() => true, () => false);
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider', AUTOHAND_ACP_REGISTRY_URL: 'http://127.0.0.1:9/registry.json' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/members/pim/chats')).success, 'bridge start', 30000);
}
async function stopBridge(signal = 'SIGTERM') {
  if (!bridge || bridge.exitCode !== null) return;
  const exited = new Promise((r) => bridge.once('exit', r));
  bridge.kill(signal);
  await Promise.race([exited, delay(4000)]);
  if (bridge.exitCode === null && bridge.signalCode === null) { bridge.kill('SIGKILL'); await exited; }
}
try {
  await mkdir(join(directory, 'claude'), { recursive: true });
  await mkdir(join(directory, 'outside'), { recursive: true });
  // The fake ACP agent: initialize, session/new or session/load, two message
  // chunks, one tool call with an update, one permission request, one read
  // and one write through the client's file system, a usage update, end.
  await writeFile(fake, `#!${process.execPath}
const fs=require('node:fs');const readline=require('node:readline');
const file=${JSON.stringify(callsFile)};const outside=${JSON.stringify(outsideFile)};
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const log=(x)=>fs.appendFileSync(file,JSON.stringify({member,...x})+'\\n');
if(process.argv[2]==='--version'){console.log('fake-acp 1.0.0');process.exit(0);}
const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');
const pending=new Map();let nextId=100;
const request=(method,params)=>new Promise((res,rej)=>{const id=nextId++;pending.set(id,{res,rej});send({jsonrpc:'2.0',id,method,params});});
const notify=(method,params)=>send({jsonrpc:'2.0',method,params});
let sessionId='';let cancelled=false;let hangResolve=null;
const rl=readline.createInterface({input:process.stdin});
rl.on('line',async(line)=>{
  let m;try{m=JSON.parse(line);}catch{return;}
  if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.rej(Object.assign(new Error(m.error.message),{code:m.error.code})):p.res(m.result);}return;}
  log({kind:m.method,params:m.params});
  const reply=(result)=>send({jsonrpc:'2.0',id:m.id,result});
  if(m.method==='initialize'){reply({protocolVersion:1,agentInfo:{name:'fake-acp',version:'1.0.0'},agentCapabilities:{loadSession:true,promptCapabilities:{image:false}},authMethods:[]});return;}
  if(m.method==='session/new'){sessionId='fake-session-'+member+'-'+Date.now().toString(36);reply({sessionId,modes:{currentModeId:'default',availableModes:[{id:'default',name:'Default'},{id:'plan',name:'Plan'}]}});return;}
  if(m.method==='session/load'){sessionId=m.params.sessionId;notify('session/update',{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'REPLAYED HISTORY'}}});reply({});return;}
  if(m.method==='session/set_mode'){reply({});return;}
  if(m.method==='session/cancel'){cancelled=true;if(hangResolve)hangResolve();return;}
  if(m.method==='session/prompt'){
    const text=m.params.prompt.map(b=>b.text||'').join('');
    const upd=(update)=>notify('session/update',{sessionId,update});
    upd({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Looking at '}});
    upd({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'the readme.'}});
    if(text.includes('HANG')){await new Promise(r=>{hangResolve=r;});reply({stopReason:'cancelled'});return;}
    upd({sessionUpdate:'tool_call',toolCallId:'call-1',title:'Read README.md',kind:'read',status:'pending',locations:[{path:process.cwd()+'/README.md'}],rawInput:{path:'README.md'}});
    upd({sessionUpdate:'tool_call_update',toolCallId:'call-1',status:'completed',content:[{type:'content',content:{type:'text',text:'read 12 lines'}}]});
    const perm=await request('session/request_permission',{sessionId,toolCall:{toolCallId:'call-2',title:'Edit notes.md',kind:'edit',status:'pending',locations:[{path:process.cwd()+'/notes.md'}]},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'always',name:'Always allow',kind:'allow_always'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
    log({kind:'permission',outcome:perm.outcome});
    const allowed=perm.outcome&&perm.outcome.outcome==='selected'&&['allow','always'].includes(perm.outcome.optionId);
    upd({sessionUpdate:'tool_call_update',toolCallId:'call-2',status:allowed?'completed':'failed',content:allowed?[{type:'diff',path:process.cwd()+'/notes.md',oldText:null,newText:'hi'}]:[{type:'content',content:{type:'text',text:'refused by the client'}}]});
    let read='none';try{const r=await request('fs/read_text_file',{sessionId,path:process.cwd()+'/package.json',line:1,limit:1});read=r.content.trim()==='{'?'ok':'odd:'+r.content.slice(0,20);}catch(e){read='refused';}
    let wrote='none';try{await request('fs/write_text_file',{sessionId,path:outside,content:'written by '+member});wrote='ok';}catch(e){wrote='refused';}
    log({kind:'fs',read,write:wrote});
    upd({sessionUpdate:'usage_update',used:1200,size:200000});
    upd({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Done. permission='+(allowed?'allowed':'refused')+' option='+(perm.outcome&&perm.outcome.optionId||'none')+' fsread='+read+' fswrite='+wrote+' session='+sessionId+' prompt='+(text.includes('<operating_instructions>')?'with-instructions':'plain')+' saw='+(text.includes('Inspected the readme.')?'handoff':'none')}});
    reply({stopReason:'end_turn'});return;
  }
  send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'method not found'}});
});
rl.on('close',()=>process.exit(0));
`);
  await chmod(fake, 0o700);
  // The same disposable Claude Code fixture scripts/check-chats.mjs uses, for the handoff.
  await writeFile(fakeClaude, `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:'fixture-claude-session',model:'claude-fixture'});
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text:'Inspected the readme.'}]}});
emit({type:'result',subtype:'success',result:'Inspected the readme.',session_id:'fixture-claude-session',usage:{input_tokens:400,output_tokens:10}});
process.exit(0);
`);
  await chmod(fakeClaude, 0o700);
  await startBridge();

  // 1. Offline: the bundled snapshot answers, named by its source.
  const offline = await api('/api/acp/registry');
  assert.equal(offline.status, 200); assert.equal(offline.data.source, 'bundled', `no cache and no network: ${JSON.stringify(offline.data).slice(0, 200)}`);
  assert.match(offline.data.error, /Could not fetch/);
  const ids = offline.data.agents.map((a) => a.harnessId);
  for (const id of ['pi', 'autohand-acp', 'acp:claude-acp', 'acp:codex-acp', 'acp:gemini', 'acp:github-copilot-cli', 'acp:opencode', 'acp:cursor', 'acp:grok-build']) assert.ok(ids.includes(id), `${id} is in the bundled snapshot`);
  const codex = offline.data.agents.find((a) => a.harnessId === 'acp:codex-acp');
  assert.equal(codex.name, 'Codex'); assert.ok(codex.description.length > 0); assert.ok(['boolean'].includes(typeof codex.installed));
  assert.ok(!JSON.stringify(offline.data).includes(process.env.HOME), 'launch commands are shown without the home directory');

  // 2. A cached registry (what a successful fetch leaves behind) is served and lists its agents.
  const cacheDir = join(directory, 'squad', 'acp');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'registry.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), url: 'fixture', registry: { version: '1.0.0', agents: [
    { id: 'fake-agent', name: 'Fake Agent', version: '1.0.0', description: 'A fake ACP agent used by the checks.', distribution: { npx: { package: 'fake-agent-acp@1.0.0' } }, license_url: 'x' },
  ] } }));
  const cached = await api('/api/acp/registry');
  assert.equal(cached.data.source, 'cache'); assert.ok(cached.data.agents.some((a) => a.harnessId === 'acp:fake-agent' && a.fetchOnUse === true), 'an npx agent that is not installed is fetched on first use');
  const forced = await api('/api/acp/registry?refresh=1');
  assert.equal(forced.data.source, 'cache', 'a forced refresh that fails keeps the cache'); assert.match(forced.data.error, /Could not refresh/);
  const harnesses = (await api('/api/harnesses?refresh=1')).data.harnesses;
  const fakeReadiness = harnesses.find((h) => h.id === 'acp:fake-agent');
  assert.ok(fakeReadiness, '/api/harnesses lists ACP agents next to the built-in engines'); assert.equal(fakeReadiness.status, 'ready'); assert.equal(fakeReadiness.fetchOnUse, true);
  assert.ok(harnesses.some((h) => h.id === 'pi') && harnesses.some((h) => h.id === 'autohand-acp'));
  assert.ok(!harnesses.some((h) => h.executablePath), 'readiness never leaks executable paths');

  // 3. Plan access: the reply streams, the tool rows land in the run log, the edit and the write are refused.
  const first = await chat('pim', 'Look at the readme', { harness: { access: 'plan' } });
  assert.ok(first.includes('permission=refused option=reject'), `plan refuses the agent's edit: ${first.slice(-600)}`);
  assert.ok(first.includes('fsread=ok'), 'reading inside the workspace is allowed in plan mode');
  assert.ok(first.includes('fswrite=refused'), 'plan refuses fs/write_text_file');
  assert.ok(first.includes('prompt=with-instructions'), 'the member profile goes in as operating instructions on a new session');
  assert.ok(first.includes('"harness":"acp:fake-agent"'), 'the stream names the engine');
  const run = (await api('/api/runs')).data.find((r) => r.agentId === 'pim');
  assert.ok(run, 'the turn is a run'); assert.equal(run.status, 'completed'); assert.equal(run.harness, 'acp:fake-agent');
  assert.ok(run.reply.startsWith('Done. permission=refused'), run.reply);
  assert.ok(run.logs.some((entry) => entry.source === 'tool' && entry.line.includes('started read')), 'the tool call is a tool row');
  assert.ok(run.logs.some((entry) => entry.source === 'tool' && /read completed/.test(entry.line)), 'and its update ends it');
  assert.ok(run.logs.some((entry) => entry.source === 'permission' && /refused/.test(entry.line)), 'the permission decision is a permission row');
  assert.ok(run.logs.some((entry) => entry.source === 'tool' && /edit failed|Edit notes\.md failed/.test(entry.line)), 'the refused edit is a failed tool row');
  assert.ok(run.command.includes('fixture-acp'), 'the command names the launch');
  assert.ok(!(await exists(outsideFile)), 'nothing was written');
  const sessionCalls = (await calls()).filter((c) => c.member === 'pim');
  assert.deepEqual(sessionCalls.map((c) => c.kind).slice(0, 4), ['initialize', 'session/new', 'session/set_mode', 'session/prompt'], 'plan mode is requested when the agent offers it');
  assert.equal(sessionCalls.find((c) => c.kind === 'initialize').params.protocolVersion, 1);
  assert.equal(sessionCalls.find((c) => c.kind === 'session/new').params.cwd, rootDir);
  const managedMcp = sessionCalls.find((c) => c.kind === 'session/new').params.mcpServers.find(server => server.name === 'autohand-squad');
  assert.ok(managedMcp?.command && managedMcp.args.includes('--mcp'), 'any ACP v1 agent receives Squad through mandatory stdio MCP');
  assert.ok(managedMcp.env.some(variable => variable.name === 'AUTOHAND_SQUAD_TEAM_TOKEN' && variable.value.length === 64), 'the MCP connection is scoped to the member');
  const firstSession = await resumeIdOnDisk();
  assert.ok(firstSession.startsWith('fake-session-pim-'), 'the session id is the resume id on disk');

  // 4. The next turn loads the same session with fresh context; replayed history is not a new reply.
  const second = await chat('pim', 'Carry on', { harness: { access: 'plan' } });
  const loadCall = (await calls()).filter((c) => c.member === 'pim' && c.kind === 'session/load').at(-1);
  assert.ok(loadCall, 'the second turn calls session/load'); assert.equal(loadCall.params.sessionId, firstSession);
  assert.ok(second.includes(`session=${firstSession}`) && second.includes('prompt=with-instructions'), 'resumed ACP turns refresh current profile, tools and memory');
  assert.deepEqual(loadCall.params.mcpServers.find(server => server.name === 'autohand-squad'), managedMcp, 'MCP reaches session/load with the same stable member connection');
  assert.ok(!second.includes('"reply":"REPLAYED HISTORY'), 'replayed history is not the reply');
  assert.equal(await resumeIdOnDisk(), firstSession, 'the resume id is kept');

  // 5. Full access allows the edit (allow_always) and the write outside the folders.
  const full = await chat('pim', 'Now do it', { harness: { access: 'full' } });
  assert.ok(full.includes('permission=allowed option=always'), `full access allows: ${full.slice(-500)}`);
  assert.ok(full.includes('fswrite=ok'));
  assert.equal(await readFile(outsideFile, 'utf8'), 'written by pim');
  await rm(outsideFile, { force: true });
  // Per-message access wins over the member's engine settings (ADR-0114).
  const perTurn = await chat('pim', 'Plan this one', { harness: { access: 'full' }, access: 'plan' });
  assert.ok(perTurn.includes('permission=refused'), 'the turn\'s access overrides the member\'s');
  const write = await chat('pim', 'Edit here', { harness: { access: 'write' } });
  assert.ok(write.includes('permission=allowed option=allow'), 'edit access allows an edit inside the workspace');
  assert.ok(write.includes('fswrite=refused'), 'edit access refuses a write outside the member\'s folders');
  assert.ok(!(await exists(outsideFile)));

  // 6. New chat forgets the session.
  const reset = await api('/api/chat/reset', { agentId: 'pim' });
  assert.equal(reset.data.forgotten, 1); assert.equal(await resumeIdOnDisk(), '');
  const after = await chat('pim', 'Fresh start', { harness: { access: 'full' } });
  assert.ok(after.includes('prompt=with-instructions') && !after.includes(`session=${firstSession}`), 'a new chat is a new session with the instructions again');

  // 7. Stop sends session/cancel.
  const started = await api('/api/runs', { ...payload('pim', 'HANG until cancelled', { harness: { access: 'full' } }), mode: 'prompt' });
  assert.equal(started.status, 201, JSON.stringify(started).slice(0, 300));
  await until(async () => (await calls()).some((c) => c.member === 'pim' && c.kind === 'session/prompt' && String(c.params?.prompt?.[0]?.text || '').includes('HANG')), 'the hanging prompt reached the agent');
  const stopped = await api(`/api/runs/${started.data.id}/stop`, {});
  assert.equal(stopped.status, 200);
  await until(async () => (await calls()).some((c) => c.member === 'pim' && c.kind === 'session/cancel'), 'session/cancel reached the agent');
  const stoppedRun = await until(async () => { const r = (await api(`/api/runs/${started.data.id}`)).data; return r && r.status !== 'running' ? r : null; }, 'the run settles');
  assert.ok(['stopped', 'failed'].includes(stoppedRun.status), stoppedRun.status);

  // 8. Mixing engines: a Claude Code member's reply is handed to the ACP member as a DM handoff.
  const claudeMember = { id: 'alex', name: 'Alex', harness: { id: 'claude', executablePath: fakeClaude }, projects: [{ path: rootDir }] };
  const alex = await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'alex', agent: claudeMember, workspace: rootDir, prompt: 'Look at the readme', profile: 'x' }) })).text();
  assert.ok(alex.includes('"reply":"Inspected the readme."'), 'the Claude Code member answered');
  const handoff = await chat('pim', 'Review what Alex did. Alex said: "Inspected the readme."', {
    harness: { access: 'plan' },
    collaboration: { role: 'receiver', sourceAgentId: 'alex', targetAgentId: 'pim', task: { id: 'task-1', title: 'Review the readme pass' }, handoff: { id: 'handoff-1', reason: 'review', requiredContext: 'Alex inspected the readme.' } },
  });
  assert.ok(handoff.includes('saw=handoff'), 'the ACP member received the Claude member\'s result in its prompt');
  const handoffRun = (await api('/api/runs')).data.find((r) => r.agentId === 'pim' && r.title.startsWith('Review what Alex did'));
  assert.ok(handoffRun && handoffRun.status === 'completed', 'the handoff turn is a completed run on the ACP engine');
  assert.ok(JSON.stringify(handoffRun.contextLayers || {}).includes('collaboration'), 'the context manifest records the collaboration');
  console.log('ACP bridge checks passed: registry offline and cached, plan/write/full access, session kept and reused, reset, stop, handoff from Claude Code.');
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
