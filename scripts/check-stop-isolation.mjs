// Exercise the real stop path with two isolated bridges and an unrelated
// member-looking process. Never use the installed CLI: it may predate this fix.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { startBridge, stop, until } from './lib/reliability-browser.mjs';

const candidate = resolve(process.env.SQUAD_TEST_CLI || join('daemon', 'target', 'debug', process.platform === 'win32' ? 'squad.exe' : 'squad'));
const binaryDir = await mkdtemp(join(tmpdir(), 'squad-stop-binary-'));
const cli = join(binaryDir, process.platform === 'win32' ? 'squad.exe' : 'squad');
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stopFixture(fixture) {
  const health=await fixture.api('/api/health');
  const state=join(fixture.directory,'squad');
  await writeFile(join(state,'config.json'),JSON.stringify({host:'127.0.0.1',port:await freePort(),openUrl:fixture.origin,telemetryPolicy:'disabled'}));
  await writeFile(join(state,'web-server.json'),JSON.stringify({pid:health.pid,host:'127.0.0.1',port:Number(new URL(fixture.origin).port),url:fixture.origin,serverPath:join(process.cwd(),'server.mjs'),dev:false,startedAt:health.startedAt}));
  const child = spawn(cli, ['stop'], { cwd: process.cwd(), env: { ...process.env, AUTOHAND_SQUAD_HOME: state, AUTOHAND_HOME: join(fixture.directory, 'autohand'), AUTOHAND_SQUAD_APP_STATE_DIR: join(fixture.directory, 'app'), AUTOHAND_USER_CONFIG_PATH: join(fixture.directory, 'config.json'), AUTOHAND_SQUAD_WEB_SERVER: join(process.cwd(), 'server.mjs'), AUTOHAND_SQUAD_NODE: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 0, output);
  return output;
}
let a, b, member, ownedChild, held;
try {
  // Tauri may replace its shared debug output. Probe and execute one private
  // copy, never a mutable build pathname. Fresh mtimes cannot identify code.
  await copyFile(candidate, cli);
  await chmod(cli, 0o500);
  const probe = spawnSync(cli, ['stop', '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.ok(probe.status === 0 && probe.stdout.includes('Stop only services owned by the selected Squad state root'),
    'Build the current source CLI before running isolation checks; this binary lacks instance-scoped stop.');
  a = await startBridge({ development: false });
  let harness;
  b = await startBridge({ development: false,prepare:async directory=>{
    harness=join(directory,'hold-codex');
    const ready=join(directory,'owned-child.pid');
    await writeFile(harness,`#!${process.execPath}\nconst fs=require('node:fs'),{spawn}=require('node:child_process');if(process.argv.includes('--version')){console.log('codex 1.0.0');process.exit(0);}if(['login','auth'].includes(process.argv[2])){console.log('Logged in using fixture');process.exit(0);}const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"],{stdio:'ignore'});child.once('spawn',()=>fs.writeFileSync(${JSON.stringify(ready)},String(child.pid)));process.on('SIGTERM',()=>{});console.log(JSON.stringify({type:'thread.started',thread_id:'stop-fixture'}));setInterval(()=>{},1000);`,{mode:0o700});
    return {CODEX_HOME:join(directory,'codex'),OPENAI_API_KEY:'fixture-no-provider'};
  }});
  const original = (await a.api('/api/health')).pid;
  const target = await b.api('/api/health');
  const daemonPort = await freePort();
  const state = join(b.directory, 'squad');
  await mkdir(state, { recursive: true });
  await writeFile(join(state, 'config.json'), JSON.stringify({ host: '127.0.0.1', port: daemonPort, openUrl: b.origin, telemetryPolicy: 'disabled' }));
  await writeFile(join(state, 'web-server.json'), JSON.stringify({ pid: target.pid, host: '127.0.0.1', port: new URL(b.origin).port * 1, url: b.origin, serverPath: join(process.cwd(), 'server.mjs'), dev: false, startedAt: target.startedAt }));
  const control=JSON.parse(await readFile(join(state,'ownership-control.json'),'utf8'));
  const shutdown={version:1,brokerId:control.brokerId,pid:target.pid,startedAt:target.startedAt};
  for(const [headers,body]of [
    [{},shutdown],
    [{'x-squad-ownership-control':control.token},{...shutdown,brokerId:crypto.randomUUID()}],
    [{'x-squad-ownership-control':control.token,origin:b.origin},shutdown],
  ]) {
    const denied=await fetch(b.origin+'/api/shutdown',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.ok([403,409].includes(denied.status),'shutdown refuses missing/stale capability and browser callers');
  }
  assert.equal((await b.api('/api/health')).pid,target.pid);
  const agent={id:'owned-stop-fixture',name:'Owned stop fixture',harness:{id:'codex',executablePath:harness},workspace:process.cwd(),projects:[{path:process.cwd()}]};
  assert.equal((await b.api(`/api/members/${agent.id}/channel-access`,'PUT',{agent,profile:'',profilePatch:{}})).success,true);
  held=fetch(b.origin+'/api/chat/stream',{method:'POST',headers:await b.headers(),body:JSON.stringify({agentId:agent.id,agent,workspace:process.cwd(),prompt:'Hold fixture work.'})}).then(response=>response.text()).catch(()=>null);
  ownedChild=await until(async()=>Number(await readFile(join(b.directory,'owned-child.pid'),'utf8'))||false,'stubborn owned grandchild starts').catch(async failure=>{
    const reply=await Promise.race([held,new Promise(resolve=>setTimeout(()=>resolve('stream pending'),100))]);
    throw Error(`${failure.message}; stream: ${reply}; bridge: ${b.logs.slice(-2000)}`);
  });
  const lookalike = join(a.directory, 'node_modules', '@autohandai', 'cli', 'fixture.cjs');
  await mkdir(join(lookalike, '..'), { recursive: true });
  await writeFile(lookalike, 'setInterval(() => {}, 1000);');
  member = spawn(process.execPath, [lookalike, '--config', join(a.directory, '.autohand', 'agents', 'example', 'config.json')], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { member.once('spawn', resolve); member.once('error', reject); });
  const output=await stopFixture(b);
  assert.match(output,/service drained and stopped/,'the authenticated broker acknowledged its whole-tree drain; no PID fallback');
  await held;
  await until(async () => { try { await b.api('/api/health', 'GET', undefined, 500); return false; } catch { return true; } }, 'selected bridge stopped');
  assert.equal((await a.api('/api/health')).pid, original, 'stopping B must preserve sibling bridge A');
  assert.equal(member.exitCode, null, 'unrelated member-like processes must remain alive');
  assert.equal(member.signalCode, null);
  assert.throws(()=>process.kill(ownedChild,0),error=>error.code==='ESRCH','stubborn owned grandchild is gone');
  ownedChild=null;
  await writeFile(join(a.directory,'config.json'),'{}');
  await until(async()=>(await a.api('/api/ownership/context')).data.state==='signed_out','first fixture signs out');
  assert.match(await stopFixture(a),/service drained and stopped/,'machine shutdown also works while signed out');
  console.log('PASS real CLI stop: machine capability and broker identity checked, signed-out shutdown, stubborn owned tree drained, selected bridge stopped; sibling bridge and unrelated member process stayed alive. Isolated fixtures only.');
} finally {
  await stop(member);
  await b?.close();
  if(ownedChild){try{process.kill(ownedChild,'SIGKILL');}catch{}}
  await a?.close();
  await rm(binaryDir, { recursive: true, force: true });
}
