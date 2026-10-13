#!/usr/bin/env node
// Daemon and turn reliability (ADR-0123): a real bridge in an isolated state
// dir with a disposable fake Claude Code executable. No vendor, credentials,
// installed app, or provider requests are used.
//
// Proves: an engine that exits before saying anything is named for what it
// is (disk, missing binary, sign-in, rejected flag, runtime crash) in the
// reply and the run log; a transient start failure is retried once with the
// same session and the member's resume id is never wiped by it; a bridge
// killed mid-turn comes back with that turn listed as `interrupted`, the
// resume id intact, and Retry re-sends the prompt through the member's
// queue, which resumes the same engine session; finished runs survive. Plus
// pure checks for the classifier, the history record, the app's bridge-away
// line and the chief of staff's refusal to learn from
// a failed reply (the last one lives in check-chief-of-staff.mjs).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { COLD_START_WINDOW_MS, LOW_DISK_BYTES, classifyColdStart, engineHome, freeDiskBytes, looksLikeStaleSession, substantiveEvents } from '../server/harness/cold-start.mjs';
import { INTERRUPTED_REASON, historyRecord, runFromRecord } from '../server/runs/history.mjs';
import { bridgeReturned, bridgeStatusLine, presencePollInterval } from '../src/lib/bridge-status.js';
import { isErrorReply } from '../src/lib/chief-of-staff.js';

// ---------- pure checks ----------
const out = (over) => ({ events: [], rawStdout: '', rawStderr: '', exitCode: 1, error: 'x', stopped: false, timedOut: false, stalled: false, durationMs: 62, ...over });
const bun = 'error: An unknown error occurred (Unexpected)\nerror: An unknown error occurred (Unexpected)';
{
  // The run of 2026-10-14 00:27: exit 1 in 62 ms, no events, Bun's runtime error on stderr.
  const cold = classifyColdStart({ adapterLabel: 'Claude Code', output: out({ rawStderr: bun }), durationMs: 62, freeBytes: { home: 50 * 1024 ** 3, workspace: 50 * 1024 ** 3 } });
  assert.equal(cold.kind, 'engine-crash'); assert.equal(cold.transient, true);
  assert.match(cold.reason, /exited 62 ms after starting, before it read the request/); assert.match(cold.reason, /not a problem with the conversation/);
  assert.match(cold.detail, /An unknown error occurred/);
}
{
  // The same exit with 222 MiB free where the engine keeps its state: the disk is the reason.
  const cold = classifyColdStart({ adapterLabel: 'Claude Code', output: out({ rawStderr: bun }), durationMs: 62, freeBytes: { home: 222 * 1024 ** 2, workspace: 50 * 1024 ** 3 } });
  assert.equal(cold.kind, 'disk-space'); assert.equal(cold.transient, true);
  assert.match(cold.reason, /222 MiB free where Claude Code keeps its state/); assert.match(cold.reason, /Free some space and retry/);
  assert.equal(classifyColdStart({ output: out({ rawStderr: 'ENOSPC: no space left on device' }), durationMs: 900, freeBytes: {} }).kind, 'disk-space', 'the stderr alone names the disk');
  assert.equal(classifyColdStart({ output: out({ rawStderr: 'x' }), durationMs: 20, freeBytes: { home: -1, workspace: LOW_DISK_BYTES - 1 } }).kind, 'disk-space', 'a nearly full workspace counts too; an unreadable home does not');
}
assert.equal(classifyColdStart({ adapterLabel: 'Claude Code', output: out({ spawnError: 'ENOENT', rawStderr: 'spawn /x/claude ENOENT', exitCode: null }), durationMs: 3, executable: '~/x/claude' }).kind, 'binary-missing');
assert.match(classifyColdStart({ adapterLabel: 'Claude Code', output: out({ spawnError: 'ENOENT', exitCode: null }), durationMs: 3 }).reason, /could not be started.*ENOENT/);
{
  const cold = classifyColdStart({ adapterLabel: 'Claude Code', output: out({ rawStderr: 'Not logged in · Please run /login' }), durationMs: 1100, freeBytes: {} });
  assert.equal(cold.kind, 'not-signed-in'); assert.equal(cold.transient, false); assert.match(cold.reason, /not signed in/);
  assert.equal(classifyColdStart({ output: out({ rawStdout: '{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}' }), durationMs: 1100, freeBytes: {} }).kind, 'not-signed-in', 'sign-in asked for on stdout counts');
}
{
  const cold = classifyColdStart({ adapterLabel: 'Codex', output: out({ rawStderr: "error: unknown option '--restricted'" }), durationMs: 40, freeBytes: {} });
  assert.equal(cold.kind, 'bad-flag'); assert.equal(cold.transient, false); assert.match(cold.reason, /rejected the command.*--restricted/);
}
assert.equal(classifyColdStart({ output: out({ rawStderr: '', exitCode: 1 }), durationMs: 200, freeBytes: {} }).kind, 'engine-crash', 'a silent quick exit is still a start failure');
assert.equal(classifyColdStart({ output: out({ exitCode: 0, error: '' }), durationMs: 50 }), null, 'a clean exit is never a cold start');
assert.equal(classifyColdStart({ output: out({ events: [{ type: 'agent_start' }, { type: 'error', message: 'boom' }], rawStderr: bun }), durationMs: 62 }), null, 'an engine that started is judged on its events');
assert.equal(classifyColdStart({ output: out({ events: [{ type: 'tool_update', output: bun }], rawStderr: bun }), durationMs: 62 }).kind, 'engine-crash', 'the stderr echo is not an event');
assert.equal(classifyColdStart({ output: out({ rawStderr: 'error: An unknown error occurred (Unexpected)', exitCode: 1 }), durationMs: COLD_START_WINDOW_MS + 5000 }).kind, 'engine-crash', 'the runtime text counts whatever the timing');
assert.equal(classifyColdStart({ output: out({ rawStderr: 'something odd', exitCode: 1 }), durationMs: COLD_START_WINDOW_MS + 5000 }), null, 'a slow unexplained exit with no events is left to the ordinary message');
assert.equal(classifyColdStart({ output: out({ stopped: true }), durationMs: 10 }), null, 'stopped by the user');
assert.equal(classifyColdStart({ output: out({ timedOut: true }), durationMs: 10 }), null, 'timed out');
{
  // A stale resume id is not a cold start: the engine said which session is missing.
  const stale = out({ rawStderr: 'No conversation found with session ID: 0000', events: [{ type: 'error', message: 'Claude Code ended with error_during_execution' }] });
  assert.equal(classifyColdStart({ output: stale, durationMs: 300 }), null);
  assert.equal(looksLikeStaleSession(stale), true);
  assert.equal(looksLikeStaleSession(out({ rawStderr: bun })), false, 'the Bun crash never looks like a stale session');
  assert.equal(looksLikeStaleSession(out({ error: '' })), false);
}
assert.equal(substantiveEvents([{ type: 'raw' }, { type: 'tool_update' }, null, { type: 'usage' }]).length, 1);
{
  const stat = (free) => () => ({ bavail: free, bsize: 1 });
  assert.equal(freeDiskBytes('/some/where/deep', { statfs: stat(42) }), 42);
  let asked = [];
  const walking = (path) => { asked.push(path); if (path !== '/root') throw new Error('ENOENT'); return { bavail: 7, bsize: 2 }; };
  assert.equal(freeDiskBytes('/root/missing/dir', { statfs: walking }), 14, 'walks up to a path that exists');
  assert.deepEqual(asked, ['/root/missing/dir', '/root/missing', '/root']);
  assert.equal(freeDiskBytes('', { statfs: stat(1) }), -1);
  assert.equal(freeDiskBytes('/x', { statfs: () => { throw new Error('nope'); } }), -1);
}
assert.equal(engineHome('claude', { env: { CLAUDE_CONFIG_DIR: '/cfg' }, homeDir: '/h' }), '/cfg');
assert.equal(engineHome('claude', { env: {}, homeDir: '/h' }), join('/h', '.claude'));
assert.equal(engineHome('codex', { env: {}, homeDir: '/h' }), join('/h', '.codex'));
assert.equal(engineHome('autohand', { env: {}, homeDir: '/h', agentHome: '/a' }), '/a');
console.log('Cold-start classification passed: disk, binary, sign-in, flag, runtime crash; stale sessions and real runs left alone.');

{
  // Run history: a live chat turn is written, with its launch; it comes back interrupted.
  const live = { id: 'r1', agentId: 'alex', kind: 'chat', mode: 'chat', status: 'running', prompt: 'Check the build', launch: { agentId: 'alex', workspace: '/w' }, startedAt: '2026-10-14T00:27:00.000Z', logs: [{ source: 'system', line: 'Starting Claude Code...', at: 't' }] };
  const record = historyRecord(live);
  assert.equal(record.status, 'running'); assert.equal(record.prompt, 'Check the build'); assert.deepEqual(record.launch, live.launch);
  assert.equal(historyRecord({ ...live, kind: 'launch' }), null, 'a live launched run is still not recorded');
  const boot = '2026-10-14T00:28:00.000Z';
  const back = runFromRecord(record, { bootAt: boot });
  assert.equal(back.status, 'interrupted'); assert.equal(back.interrupted, true); assert.equal(back.finishedAt, boot); assert.equal(back.durationMs, 60000);
  assert.equal(back.logs.at(-1).line, INTERRUPTED_REASON); assert.equal(back.logs.length, 2); assert.deepEqual(back.launch, live.launch); assert.equal(back.restored, true);
  const again = historyRecord(back);
  assert.equal(again.status, 'interrupted'); assert.equal(again.interrupted, true); assert.deepEqual(again.launch, live.launch, 'an interrupted record keeps its launch for Retry');
  assert.equal(historyRecord({ ...back, status: 'completed', launch: null }).launch, null, 'a finished run carries no launch');
  assert.equal(runFromRecord(record, { bootAt: boot }).logs.length, 2, 'restore is pure: the record is not mutated');
}
assert.equal(bridgeStatusLine({ bridgeReachable: true }), '');
assert.equal(bridgeStatusLine({ bridgeReachable: false, awaySinceMs: 500 }), '', 'the first moment away is not worth a line');
assert.match(bridgeStatusLine({ bridgeReachable: false, awaySinceMs: 5000 }), /restarting/);
assert.match(bridgeStatusLine({ bridgeReachable: false, awaySinceMs: 90000 }), /not answered for a minute/);
assert.equal(presencePollInterval(true), 10000); assert.equal(presencePollInterval(false), 2000);
assert.equal(bridgeReturned(false, true), true); assert.equal(bridgeReturned(true, true), false);
assert.equal(isErrorReply({ status: 'failed', summary: 'Reply failed: error: An unknown error occurred (Unexpected)' }), true);
console.log('History record and bridge-away line passed.');

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-reliability-'));
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-claude');
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
const member = (id, executablePath = fake) => ({ id, name: id, harness: { id: 'claude', executablePath }, projects: [{ path: rootDir }] });
const payload = (id, prompt, executablePath) => ({ agentId: id, agent: member(id, executablePath), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.' });
const chat = async (id, prompt, executablePath) => (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt, executablePath)) })).text();
const streamError = (text) => { const match = text.match(/event: error\ndata: (\{.*\})/); return match ? JSON.parse(match[1]).error : ''; };
const sessionsFile = (id) => join(directory, 'app', 'agents', id, 'harness-sessions.json');
const resumeIdOnDisk = async (id) => Object.values(JSON.parse(await readFile(sessionsFile(id), 'utf8').catch(() => '{}')).claude || {})[0]?.resumeId || '';
const release = (token) => writeFile(join(directory, `release-${token}`), '');
const runsOf = async (id) => (await api('/api/runs')).data.filter((run) => run.agentId === id);
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider' },
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
  await mkdir(join(directory, 'claude'), { recursive: true });
  await writeFile(fake, `#!${process.execPath}
const fs=require('node:fs');const path=require('node:path');
const file=${JSON.stringify(callsFile)};const dir=${JSON.stringify(directory)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
if(args[0]==='--help'){console.log('--permission-mode <mode> (choices: "plan", "acceptEdits", "bypassPermissions")');process.exit(0);}
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const prompt=String(args[1]||'');
const resumeAt=args.indexOf('--resume');
const resume=resumeAt>=0?args[resumeAt+1]:'';
const append=x=>fs.appendFileSync(file,JSON.stringify(x)+'\\n');
append({kind:'start',member,resume,prompt:prompt.slice(0,80)});
// A cold start that never says anything: Bun's runtime error, exit 1 at once.
const crash=/COLDCRASH:([a-z]+)/.exec(prompt);
if(crash){
  const counter=path.join(dir,'crash-'+crash[1]);
  const seen=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0;
  fs.writeFileSync(counter,String(seen+1));
  if(crash[1]==='always'||seen===0){process.stderr.write('error: An unknown error occurred (Unexpected)\\nerror: An unknown error occurred (Unexpected)\\n');process.exit(1);}
}
if(/NOTSIGNEDIN/.test(prompt)){process.stderr.write('Not logged in · Please run /login\\n');process.exit(1);}
const session=resume||'fixture-'+member+'-'+Date.now().toString(36);
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
process.on('SIGTERM',()=>{append({kind:'abort',member});process.exit(143);});
const wait=/WAIT:([a-z0-9]+)/.exec(prompt);
const finish=()=>{
  const text=wait?'Done '+wait[1]:'Inspected.';
  emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
  emit({type:'result',subtype:'success',result:text,session_id:session,usage:{input_tokens:400,output_tokens:10}});
  append({kind:'finish',member});
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

  // 1. A normal turn: the resume id is on disk afterwards.
  const first = await chat('alex', 'Look around');
  assert.ok(first.includes('"reply":"Inspected."'), `first turn replied: ${first.slice(-300)}`);
  const session = await resumeIdOnDisk('alex');
  assert.ok(session.startsWith('fixture-alex-'), 'resume id saved');

  // 2. A transient cold start is retried once with the same session, quietly.
  const once = await chat('alex', 'COLDCRASH:once please');
  assert.ok(once.includes('"reply":"Inspected."'), `the second attempt answered: ${once.slice(-400)}`);
  assert.equal(streamError(once), '', 'no error reached the person');
  let alex = await starts('alex');
  assert.equal(alex.length, 3, 'one retry, not more');
  assert.equal(alex[1].resume, session); assert.equal(alex[2].resume, session, 'both attempts resumed the saved session');
  assert.equal(await resumeIdOnDisk('alex'), session, 'the id was not wiped by the start failure');
  let runs = await runsOf('alex');
  const retriedRun = runs.find((run) => run.title.startsWith('COLDCRASH:once'));
  assert.equal(retriedRun.status, 'completed');
  assert.ok(retriedRun.logs.some((entry) => entry.source === 'system' && /cold start: engine exited .* with code 1 \(error: An unknown error occurred \(Unexpected\)\); retrying once/.test(entry.line)), `the run log says what happened: ${JSON.stringify(retriedRun.logs.map((l) => l.line))}`);
  assert.ok(retriedRun.logs.some((entry) => /started on the second attempt/.test(entry.line)));

  // 3. A start failure that persists is named in the reply, once retried, session kept.
  const always = await chat('alex', 'COLDCRASH:always please');
  const reason = streamError(always);
  assert.match(reason, /Claude Code exited \d+ ms after starting, before it read the request: its runtime reported "error: An unknown error occurred \(Unexpected\)"/, reason);
  assert.match(reason, /not a problem with the conversation/);
  assert.equal((await starts('alex')).length, 5, 'exactly one automatic retry');
  assert.equal(await resumeIdOnDisk('alex'), session, 'still not wiped');
  runs = await runsOf('alex');
  const failedRun = runs.find((run) => run.title.startsWith('COLDCRASH:always'));
  assert.equal(failedRun.status, 'failed');
  assert.ok(failedRun.logs.some((entry) => entry.source === 'system' && entry.line.startsWith('cold start: engine exited')), 'the run log carries the classification');
  assert.ok(failedRun.logs.some((entry) => entry.line === reason), 'and the reason the person saw');

  // 4. Not signed in: named, not retried.
  const signIn = streamError(await chat('alex', 'NOTSIGNEDIN now'));
  assert.match(signIn, /Claude Code is not signed in: Not logged in · Please run \/login/, signIn);
  assert.equal((await starts('alex')).length, 6, 'a sign-in failure is not transient');

  // 5. A missing executable: readiness says so before any spawn (the spawn
  //    ENOENT path is the pure check above); the route answers, not crashes.
  const missing = streamError(await chat('bob', 'Hello', join(directory, 'no-such-claude')));
  assert.match(missing, /not found on this machine|could not be started/, missing);

  // 6. The bridge dies mid-turn: the turn comes back as interrupted, with Retry.
  // The stream dies with the bridge; that rejection is expected, not a failure.
  const held = chat('alex', 'WAIT:hold1 then report').catch((error) => ({ error }));
  await until(async () => (await starts('alex')).length === 7, 'held turn running');
  await delay(600); // the history write is debounced
  const before = await runsOf('alex');
  assert.equal(before.find((run) => run.title.startsWith('WAIT:hold1')).status, 'running');
  await stopBridge('SIGKILL');
  await held;
  await release('hold1');
  await startBridge();
  const after = await runsOf('alex');
  const interrupted = after.find((run) => run.title.startsWith('WAIT:hold1'));
  assert.ok(interrupted, 'the turn that was running is listed after the restart');
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.interrupted, true); assert.equal(interrupted.retryable, true);
  assert.equal(interrupted.logs.at(-1).line, INTERRUPTED_REASON);
  assert.equal(interrupted.logs.at(-1).at, interrupted.finishedAt);
  assert.deepEqual(after.filter((run) => run.status === 'completed').map((run) => run.id).sort(), before.filter((run) => run.status === 'completed').map((run) => run.id).sort(), 'finished runs are still there');
  assert.equal(await resumeIdOnDisk('alex'), session, 'the engine session survived the crash');
  const otlp = await readFile(join(directory, 'app', 'logs', 'web.otlp.jsonl'), 'utf8').catch(() => '');
  assert.ok(otlp.includes('interrupted by the restart'), 'the bridge logged the recovery in its structured log');
  assert.equal((await api('/api/queues/alex')).data.paused, false, 'no queue was running, so the member is not paused');

  // 7. Retry re-sends the same prompt through the queue; the queue resumes the engine session.
  const retried = await api(`/api/runs/${interrupted.id}/retry`, {});
  assert.equal(retried.status, 201, JSON.stringify(retried));
  assert.equal(retried.data.item.text, 'WAIT:hold1 then report'); assert.equal(retried.data.item.status, 'queued'); assert.equal(retried.data.paused, false);
  const again = await api(`/api/runs/${interrupted.id}/retry`, {});
  assert.equal(again.status, 409, 'a second retry is refused');
  const item = await until(async () => { const q = (await api('/api/queues/alex')).data; const found = q.items.find((entry) => entry.id === retried.data.item.id); return found?.status === 'done' ? found : null; }, 'the retried follow-up ran');
  assert.equal(item.reply, 'Done hold1');
  const retryStart = (await starts('alex')).at(-1);
  assert.equal(retryStart.resume, session, 'the retried turn resumed the same engine session');
  assert.match(retryStart.prompt, /^WAIT:hold1 then report/);
  const settled = (await runsOf('alex')).find((run) => run.id === interrupted.id);
  assert.equal(settled.retryable, false); assert.equal(settled.retryItemId, retried.data.item.id);
  assert.equal((await api(`/api/runs/${interrupted.id}/retry`, {})).status, 409);
  const completedRun = (await runsOf('alex')).find((run) => run.status === 'completed' && run.title.startsWith('WAIT:hold1'));
  assert.ok(completedRun, 'the retry is its own run');
  assert.equal((await api(`/api/runs/${completedRun.id}/retry`, {})).status, 409, 'only an interrupted run can be retried');

  // 8. The interrupted run outlives one more restart, retried state included.
  await delay(600);
  await stopBridge();
  await startBridge();
  const kept = (await runsOf('alex')).find((run) => run.id === interrupted.id);
  assert.equal(kept.status, 'interrupted'); assert.equal(kept.retryItemId, retried.data.item.id); assert.equal(kept.retryable, false);
  console.log('Reliability bridge checks passed: cold start named and retried once, session ids kept, mid-turn crash listed as interrupted, Retry through the queue resumes the session.');
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
