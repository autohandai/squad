#!/usr/bin/env node
// Member work plans (ADR-0124): a real bridge in an isolated state dir with
// the disposable fake Claude Code harness from check-chats. No vendor,
// credentials, installed app or provider requests are used.
//
// Proves, against the bridge:
//   (i)   a direct-message turn carries the task instruction, the schedule
//         instruction and "Your work plan" in --append-system-prompt, even
//         when the caller's profile has none of them;
//   (ii)  a `task` SQUAD_ACTION in the reply creates the task, the receipt
//         is appended to the reply, and the run carries it in channelActions;
//   (iii) op done marks it done; op update changes it; a replayed request id
//         returns the same receipt instead of a second task; bad actions fail
//         with a reason and nothing is written;
//   (iv)  a task the person added shows up in the next turn's plan text, and
//         the plan says what the member is doing;
//   (v)   "every weekday morning …" with a reply that proposed no schedule
//         yields a "Schedule this?" offer on the done event; a reply that did
//         propose one yields none;
//   (vi)  a routine run creates the linked task, holds it as doing while the
//         run is live, settles it with the run's outcome, and the member
//         marking it done is noted in the routine's run history.
// Plus pure checks for the heuristic, the plan block and the store shapes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkPlanBlock, detectRecurringWork, dueLabel, replyProposedSchedule, workDotStatus } from '../src/lib/work-plans.js';
import { scheduleActionInstruction, taskActionInstruction } from '../src/lib/routines.js';
import { findByTitle, normalizeDue, normalizeTask, taskInputFrom, validateTask } from '../server/work/store.mjs';

let checks = 0;
const check = (label, ok, detail = '') => { checks += 1; assert.ok(ok, `${label}${detail ? `: ${detail}` : ''}`); };

// ---------- pure checks ----------
const weekday = detectRecurringWork('Every weekday morning send the NZ batch to the new leads, and keep the sheet in sync.');
check('every weekday morning → weekdays Mon–Fri at 09:00', weekday && weekday.schedule.kind === 'weekdays' && weekday.schedule.days.join() === '1,2,3,4,5' && weekday.schedule.time === '09:00', JSON.stringify(weekday));
check('the title is the sentence without the phrase, cut on a word at 60', weekday.title === 'Send the NZ batch to the new leads, and keep the sheet…', weekday.title);
const twice = detectRecurringWork('check replies twice a day please');
check('twice a day → a cron at 09:00 and 15:00', twice && twice.schedule.kind === 'cron' && twice.schedule.cron === '0 9,15 * * *', JSON.stringify(twice));
const monday = detectRecurringWork('Every Monday at 8am send the weekly digest.');
check('every Monday at 8am → weekdays [1] at 08:00', monday && monday.schedule.days.join() === '1' && monday.schedule.time === '08:00', JSON.stringify(monday));
const pm = detectRecurringWork('each day at 5:30pm post the summary');
check('each day at 5:30pm → every day at 17:30', pm && pm.schedule.days.length === 7 && pm.schedule.time === '17:30', JSON.stringify(pm));
const hours = detectRecurringWork('poll the inbox every 2 hours');
check('every 2 hours → interval 120 minutes', hours && hours.schedule.kind === 'interval' && hours.schedule.everyMinutes === 120, JSON.stringify(hours));
const monthly = detectRecurringWork('at the end of the month reconcile the invoices');
check('end of the month → monthly on the last day', monthly && monthly.schedule.kind === 'monthly' && monthly.schedule.day === 'last', JSON.stringify(monthly));
check('weekly → Monday', detectRecurringWork('send me a weekly summary')?.schedule.days.join() === '1');
check('a question is not an instruction', detectRecurringWork('Do you check replies every day?') === null);
check('a negation is not an instruction', detectRecurringWork("Don't send the batch every day, only once.") === null);
check('plain work has no schedule', detectRecurringWork('Draft the partner email and send it to me.') === null);
check('replyProposedSchedule sees a proposed schedule action', replyProposedSchedule([{ type: 'schedule', status: 'proposed' }]) && !replyProposedSchedule([{ type: 'schedule', status: 'failed' }]) && !replyProposedSchedule([{ type: 'task', status: 'added' }]));

const now = Date.parse('2026-10-14T03:00:00.000Z');
check('dueLabel today/tomorrow/date/overdue', dueLabel('2026-10-14', { now }) === 'due today' && dueLabel('2026-10-15', { now }) === 'due tomorrow' && dueLabel('2026-10-20', { now }) === 'due 20 Oct' && dueLabel('2026-10-12', { now }) === 'overdue 2 days' && dueLabel('', { now }) === '');
check('workDotStatus maps plan statuses to the presence vocabulary', workDotStatus('doing') === 'running' && workDotStatus('blocked') === 'blocked' && workDotStatus('done') === 'completed' && workDotStatus('open') === 'idle');
const block = buildWorkPlanBlock({
  memberName: 'Alex',
  tasks: [
    { id: 't_aaaaaa', memberId: 'alex', title: 'Send the NZ batch', detail: 'twenty leads', status: 'doing', due: '2026-10-14', recurring: 'routine-1', lastOutcome: { at: '2026-10-13T03:00:00.000Z', status: 'completed', preview: '18 sent' }, createdAt: '2026-10-13T00:00:00.000Z' },
    { id: 't_bbbbbb', memberId: 'alex', title: 'Research AU accounts', status: 'open', due: '2026-10-16', source: 'person', createdAt: '2026-10-13T00:00:00.000Z' },
    { id: 't_cccccc', memberId: 'alex', title: 'Old thing', status: 'done', createdAt: '2026-10-13T00:00:00.000Z' },
  ],
  routines: [{ id: 'routine-1', title: 'Morning NZ batch', enabled: true, schedule: { kind: 'weekdays', timeZone: 'Pacific/Auckland' }, description: 'Weekdays (Mon–Fri) at 09:00', next: ['2026-10-14T20:00:00.000Z'], lastRun: { status: 'completed', finishedAt: '2026-10-13T03:00:00.000Z' } }],
  goals: [{ id: 'g1', prompt: 'Keep the outreach sheet in sync', status: 'running', turnCount: 3 }, { id: 'g2', prompt: 'old', status: 'completed' }],
  queued: [{ text: 'Check replies', status: 'queued' }, { text: 'ran', status: 'done' }],
}, { now });
check('the plan block has a heading and the open tasks with ids, status and due', block.text.startsWith('Your work plan') && block.text.includes('[t_aaaaaa] Send the NZ batch — twenty leads (doing, due today, recurring: Weekdays (Mon–Fri) at 09:00, next') && block.text.includes('[t_bbbbbb] Research AU accounts (open, due 16 Oct, added by the person)'), block.text);
check('done tasks are left out, routines, goals and queued follow-ups are in', !block.text.includes('Old thing') && block.text.includes('Morning NZ batch: Weekdays (Mon–Fri) at 09:00, next') && block.text.includes('"Keep the outreach sheet in sync" (running)') && !block.text.includes('3 turns') && !block.text.includes('"old"') && block.text.includes('- "Check replies"') && !block.text.includes('"ran"'), block.text);
check('counts', JSON.stringify(block.counts) === JSON.stringify({ tasks: 2, routines: 1, goals: 1, queued: 1 }), JSON.stringify(block.counts));
const empty = buildWorkPlanBlock({ memberName: 'Alex' }, { now });
check('an empty plan still says so, so a sitrep is answered from facts', empty.text.includes('Nothing is planned') && empty.text.startsWith('Your work plan'), empty.text);
check('the block respects its budget', buildWorkPlanBlock({ tasks: Array.from({ length: 12 }, (_, i) => ({ id: `t_${i}`, memberId: 'a', title: 'x'.repeat(150), detail: 'y'.repeat(150), status: 'open' })) }, { budget: 900 }).text.length <= 900);

const added = taskInputFrom({ title: '  Send the NZ batch ', detail: 'd', due: '2026-10-15T09:00:00Z', status: 'bogus' }, null, { now: '2026-10-14T00:00:00.000Z', memberId: 'alex', source: 'member', by: 'member' });
check('taskInputFrom trims, normalises the due date and defaults the status', added.title === 'Send the NZ batch' && added.due === '2026-10-15' && added.status === 'open' && added.source === 'member' && added.history[0].event === 'added' && added.history[0].by === 'member', JSON.stringify(added));
const done = taskInputFrom({ status: 'done', outcome: '18 sent' }, added, { now: '2026-10-14T01:00:00.000Z', by: 'member' });
check('marking done stamps doneAt and the history', done.status === 'done' && done.doneAt === '2026-10-14T01:00:00.000Z' && done.history.at(-1).event === 'done' && done.history.at(-1).note.includes('outcome: 18 sent'), JSON.stringify(done.history));
const reopened = taskInputFrom({ status: 'open' }, done, { now: '2026-10-14T02:00:00.000Z', by: 'person' });
check('reopening clears doneAt and records it', reopened.doneAt === null && reopened.history.at(-1).event === 'reopened' && reopened.history.at(-1).by === 'person');
check('validateTask names the missing fields', validateTask(normalizeTask({})).join() === 'memberId,title');
check('normalizeDue drops rubbish', normalizeDue('tomorrow') === '' && normalizeDue('2026-10-15') === '2026-10-15');
const pool = [added, { ...added, id: 't_other', memberId: 'noah' }];
check('findByTitle matches the member\'s own open task, case-insensitively', findByTitle(pool, 'send the nz batch', 'alex')?.id === added.id && findByTitle(pool, 'send the nz batch', 'eve') === null);
check('the instructions carry the two formats and the sitrep rule', taskActionInstruction().includes('"type":"task","op":"add"') && taskActionInstruction().includes('"op":"done"') && /sitrep/.test(taskActionInstruction()) && scheduleActionInstruction('UTC').includes('"type":"schedule"'));
console.log(`Work plan pure checks passed (${checks}): heuristic, plan block, store shapes, instructions.`);

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-work-plans-'));
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
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn().catch(() => null); if (value) return value; await delay(50); }
  throw new Error(`${label} timed out; bridge: ${logs.slice(-3000)}`);
}
const api = async (path, body, method) => {
  const response = await fetch(origin + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); return { status: response.status, ...data };
};
const calls = async () => (await readFile(callsFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const lastSystemPrompt = async () => { const args = (await calls()).at(-1)?.args || []; const at = args.indexOf('--append-system-prompt'); return at >= 0 ? String(args[at + 1] || '') : ''; };
const member = (id) => ({ id, name: id, harness: { id: 'claude', executablePath: fake }, projects: [{ path: rootDir }], workspace: rootDir });
// The profile deliberately carries none of the instructions: the bridge must add them.
const payload = (id, prompt, extra = {}) => ({ agentId: id, agent: member(id), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.', requestId: extra.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...extra });
// The fake replies "Inspected the readme." unless the prompt carries REPLY<<text>>; HOLD:<name> keeps it running until release-<name> exists.
const reply = (text) => `REPLY<<${text}>>`;
async function chat(id, prompt, extra) {
  const raw = await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt, extra)) })).text();
  const events = raw.split('\n\n').map((chunk) => { const event = chunk.match(/^event: (.+)$/m)?.[1]; const data = chunk.match(/^data: (.+)$/m)?.[1]; return event && data ? { event, data: JSON.parse(data) } : null; }).filter(Boolean);
  const finished = events.find((item) => item.event === 'done');
  return { raw, events, done: finished?.data || null };
}
const tasksFor = async (id) => (await api(`/api/work?memberId=${id}`)).data.tasks;
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/work')).success, 'bridge start', 30000);
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
const fs=require('node:fs');
const file=${JSON.stringify(callsFile)};
const dir=${JSON.stringify(directory)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const resumeAt=args.indexOf('--resume');
const session=resumeAt>=0?args[resumeAt+1]:'fixture-'+member+'-'+Date.now().toString(36);
const prompt=String(args[1]||'');
fs.appendFileSync(file,JSON.stringify({kind:'start',member,resume:resumeAt>=0?args[resumeAt+1]:'',prompt:prompt.slice(0,200),args})+'\\n');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
const hold=prompt.match(/HOLD:([a-z-]+)/);
const wait=hold?new Promise(resolve=>{const tick=()=>{if(fs.existsSync(dir+'/release-'+hold[1]))resolve();else setTimeout(tick,100);};tick();}):Promise.resolve();
wait.then(()=>{
const custom=prompt.match(/REPLY<<([\\s\\S]*?)>>/);
const text=custom?custom[1]:'Inspected the readme.';
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
emit({type:'result',subtype:'success',result:text,session_id:session,usage:{input_tokens:400,output_tokens:10}});
process.exit(0);
});
`);
  await chmod(fake, 0o700);
  await startBridge();

  // (i) The instructions and the plan reach a DM turn whose profile had none of them.
  const first = await chat('alex', 'Look at the readme');
  assert.equal(first.done?.reply, 'Inspected the readme.', `first turn replied: ${first.raw.slice(-400)}`);
  const prompt1 = await lastSystemPrompt();
  check('(i) the task instruction is in --append-system-prompt', prompt1.includes('SQUAD_ACTION: {"type":"task","op":"add"'), prompt1.slice(0, 300));
  check('(i) the schedule instruction is in --append-system-prompt', prompt1.includes('SQUAD_ACTION: {"type":"schedule"'));
  check('(i) "Your work plan" is in --append-system-prompt, and says nothing is planned yet', prompt1.includes('Your work plan') && prompt1.includes('Nothing is planned'), prompt1.slice(-400));
  check('(i) each instruction appears once', prompt1.split('"type":"task","op":"add"').length === 2 && prompt1.split('"type":"schedule","title"').length === 2);
  const firstRun = (await api('/api/runs')).data.find((run) => run.agentId === 'alex');
  const planLayer = firstRun?.contextLayers?.layers?.find((layer) => layer.name === 'workPlan');
  check('(i) the run manifest records the workPlan layer as included', planLayer?.included === true, JSON.stringify(planLayer));
  const planRoute = await api('/api/work/plan/alex');
  check('(i) GET /api/work/plan/:member returns the same block', planRoute.success && planRoute.data.text.startsWith('Your work plan'), JSON.stringify(planRoute).slice(0, 200));

  // (ii) A task action in the reply creates the task and appends the receipt.
  await chat('alex', 'Send the NZ batch tomorrow', { requestId: 'req-add-1' }); // a plain turn with no action writes nothing
  const addTurn = await chat('alex', `${reply('On it.\nSQUAD_ACTION: {"type":"task","op":"add","title":"Send the NZ batch","detail":"20 ICP-matched leads","due":"2099-10-15"}')}`, { requestId: 'req-add-2' });
  check('(ii) the reply carries the receipt', /On it\.\n\nAdded to your plan: “Send the NZ batch” \[t_[a-z0-9]{6}\], due/.test(addTurn.done?.reply || ''), addTurn.done?.reply);
  const addReceipt = addTurn.done?.channelActions?.find((action) => action.type === 'task');
  check('(ii) the done event lists the task receipt', addReceipt?.status === 'added' && /^t_/.test(addReceipt.taskId), JSON.stringify(addTurn.done?.channelActions));
  let tasks = await tasksFor('alex');
  const nz = tasks.find((task) => task.title === 'Send the NZ batch');
  check('(ii) the task exists on the bridge with the member as its source', nz && nz.status === 'open' && nz.due === '2099-10-15' && nz.detail === '20 ICP-matched leads' && nz.source === 'member' && nz.id === addReceipt.taskId, JSON.stringify(nz));
  check('(ii) the stray marker turn did not create a task', tasks.length === 1, JSON.stringify(tasks.map((task) => task.title)));
  const addRun = (await api('/api/runs')).data.find((run) => run.agentId === 'alex' && run.title.includes('On it.'));
  check('(ii) the run record carries the receipt', addRun?.channelActions?.some((action) => action.type === 'task' && action.status === 'added'), JSON.stringify(addRun?.channelActions));
  check('(ii) the next turn\'s plan lists the task with its id', (await chat('alex', 'thanks')) && (await lastSystemPrompt()).includes(`[${nz.id}] Send the NZ batch — 20 ICP-matched leads (open, due`), (await lastSystemPrompt()).slice(-600));

  // (iii) done, update, replay and refusals.
  const replay = await chat('alex', `${reply('On it.\nSQUAD_ACTION: {"type":"task","op":"add","title":"Send the NZ batch","detail":"20 ICP-matched leads","due":"2099-10-15"}')}`, { requestId: 'req-add-2' });
  check('(iii) the same request id returns the same receipt and no second task', replay.done?.channelActions?.[0]?.taskId === nz.id && (await tasksFor('alex')).length === 1, JSON.stringify(replay.done?.channelActions));
  const duplicate = await chat('alex', `${reply('Again.\nSQUAD_ACTION: {"type":"task","op":"add","title":"send the nz batch"}')}`, { requestId: 'req-add-3' });
  check('(iii) an open task with the same title is not duplicated', duplicate.done?.channelActions?.[0]?.status === 'existing' && (await tasksFor('alex')).length === 1, JSON.stringify(duplicate.done?.channelActions));
  const update = await chat('alex', `${reply(`Started.\nSQUAD_ACTION: {"type":"task","op":"update","id":"${nz.id}","status":"doing","due":"2099-10-16"}`)}`, { requestId: 'req-upd-1' });
  check('(iii) op update changes status and due with a receipt', /Updated “Send the NZ batch”: due, status doing\./.test(update.done?.reply || '') && (await tasksFor('alex'))[0].status === 'doing' && (await tasksFor('alex'))[0].due === '2099-10-16', update.done?.reply);
  check('(iii) the plan now says doing', (await chat('alex', 'status?')) && (await lastSystemPrompt()).includes(`[${nz.id}] Send the NZ batch — 20 ICP-matched leads (doing,`));
  const finish = await chat('alex', `${reply(`Done.\nSQUAD_ACTION: {"type":"task","op":"done","title":"Send the NZ batch","outcome":"18 sent, 2 bounced"}`)}`, { requestId: 'req-done-1' });
  check('(iii) op done by title marks it done with the outcome', /Marked done: “Send the NZ batch” \(18 sent, 2 bounced\)\./.test(finish.done?.reply || ''), finish.done?.reply);
  tasks = await tasksFor('alex');
  check('(iii) the task is done on the bridge with doneAt and history', tasks[0].status === 'done' && tasks[0].doneAt && tasks[0].outcome === '18 sent, 2 bounced' && tasks[0].history.at(-1).event === 'done' && tasks[0].history.at(-1).by === 'member', JSON.stringify(tasks[0]));
  const bad = await chat('alex', `${reply('Hm.\nSQUAD_ACTION: {"type":"task","op":"delete","id":"x"}\nSQUAD_ACTION: {"type":"task","op":"done","id":"t_nothere"}\nSQUAD_ACTION: {"type":"task","op":"add","detail":"no title"}\nSQUAD_ACTION: {"type":"task","op":"add","title":"forged","memberId":"noah"}')}`, { requestId: 'req-bad-1' });
  const badReceipts = bad.done?.channelActions || [];
  check('(iii) a bad op, an unknown id, a missing title and a forged field are each refused with a reason', badReceipts.length === 4 && badReceipts.every((action) => action.status === 'failed') && /op must be/.test(badReceipts[0].message) && /no task of yours matches id t_nothere/.test(badReceipts[1].message) && /give the task a title/.test(badReceipts[2].message) && /not memberId/.test(badReceipts[3].message), JSON.stringify(badReceipts));
  check('(iii) refusals write nothing', (await tasksFor('alex')).length === 1);
  const forgedTurn = await chat('noah', `${reply(`Mine now.\nSQUAD_ACTION: {"type":"task","op":"done","id":"${nz.id}"}`)}`, { requestId: 'req-forge-1' });
  check('(iii) another member cannot touch Alex\'s task by id', forgedTurn.done?.channelActions?.[0]?.status === 'failed' && (await tasksFor('noah')).length === 0, JSON.stringify(forgedTurn.done?.channelActions));

  // (iv) The person adds a task; the next turn's plan carries it; the routes behave.
  const created = await api('/api/work', { memberId: 'alex', title: 'Research 20 AU accounts', detail: 'ICP tier 1', due: '2099-10-17' });
  check('(iv) POST /api/work creates a person task', created.status === 201 && created.data.source === 'person' && created.data.history[0].by === 'person', JSON.stringify(created));
  check('(iv) POST /api/work refuses a task without a title', (await api('/api/work', { memberId: 'alex' })).status === 400);
  const sitrep = await chat('alex', 'So give me a sitrep, what tasks are you working on?');
  const sitrepPrompt = await lastSystemPrompt();
  check('(iv) the sitrep turn\'s prompt carries the person\'s task and not the done one', sitrepPrompt.includes(`[${created.data.id}] Research 20 AU accounts — ICP tier 1 (open, due 17 Oct, added by the person)`) && !sitrepPrompt.includes('[' + nz.id + ']'), sitrepPrompt.slice(-700));
  check('(iv) the sitrep turn carries "Earlier conversations" too', sitrepPrompt.includes('Earlier conversations') || sitrep.done !== null);
  const patched = await api(`/api/work/${created.data.id}`, { title: 'Research 25 AU accounts', status: 'blocked' }, 'PATCH');
  check('(iv) PATCH edits title and status', patched.status === 200 && patched.data.title === 'Research 25 AU accounts' && patched.data.status === 'blocked');
  check('(iv) PATCH refuses a bad status', (await api(`/api/work/${created.data.id}`, { status: 'nope' }, 'PATCH')).status === 400);
  const personDone = await api(`/api/work/${created.data.id}/done`, { outcome: 'found 25' });
  check('(iv) POST /done marks it done for the person', personDone.data.status === 'done' && personDone.data.outcome === 'found 25' && personDone.data.history.at(-1).by === 'person');
  check('(iv) DELETE removes it; 404 after', (await api(`/api/work/${created.data.id}`, undefined, 'DELETE')).status === 200 && (await api(`/api/work/${created.data.id}`)).status === 404);
  const workflows = await fetch(origin + '/api/workflows?channelId=none').then((r) => r.text());
  check('(iv) /api/workflows is not swallowed by the work route', !/task not found/.test(workflows), workflows.slice(0, 200));

  // (v) The safety net: recurring work named, no schedule proposed.
  const recurring = await chat('alex', 'Every weekday morning send the NZ batch to the new leads.');
  const offer = recurring.done?.scheduleOffer;
  check('(v) a reply with no schedule action yields a "Schedule this?" offer', offer && offer.schedule.kind === 'weekdays' && offer.schedule.days.join() === '1,2,3,4,5' && offer.schedule.time === '09:00' && offer.title === 'Send the NZ batch to the new leads' && /Weekdays/.test(offer.description) && offer.timeZone, JSON.stringify(offer));
  check('(v) the offer carries the phrase and the instructions for the editor', offer.phrase === 'Every weekday morning' && offer.instructions.includes('send the NZ batch'), JSON.stringify(offer));
  const proposed = await chat('alex', `Every weekday morning send the batch. ${reply('Sure.\nSQUAD_ACTION: {"type":"schedule","title":"NZ batch","instructions":"send the batch","schedule":{"kind":"weekdays","days":[1,2,3,4,5],"time":"09:00"},"timezone":"Pacific/Auckland"}')}`, { requestId: 'req-sched-1' });
  check('(v) a reply that proposed a schedule gets no offer', proposed.done?.channelActions?.[0]?.type === 'schedule' && proposed.done?.channelActions?.[0]?.status === 'proposed' && !proposed.done?.scheduleOffer, JSON.stringify(proposed.done?.channelActions));
  check('(v) plain work yields no offer', !(await chat('alex', 'Draft the partner email.')).done?.scheduleOffer);
  const offeredRun = (await api('/api/runs')).data.find((run) => run.agentId === 'alex' && run.title.startsWith('Every weekday morning send the NZ batch'));
  check('(v) the offer is logged as an event on the bridge', /schedule offered for alex/.test(logs) || Boolean(offeredRun));

  // (vi) A routine run creates and settles the linked task; the member's done note reaches the routine's history.
  const routine = await api('/api/routines', { memberId: 'alex', title: 'Morning NZ batch', instructions: 'HOLD:batch do the recurring work', workspace: rootDir, schedule: { kind: 'cron', cron: '0 9 * * 1-5', timeZone: 'UTC' } });
  check('(vi) the routine runs on the bridge (member known, workspace set)', routine.status === 201 && routine.data.needsApp === false, JSON.stringify(routine).slice(0, 300));
  await rm(join(directory, 'release-batch'), { force: true });
  const started = await api(`/api/routines/${routine.data.id}/run`, {});
  check('(vi) the manual run started on the bridge', started.status === 202 && started.data.run.status === 'running', JSON.stringify(started).slice(0, 300));
  const doing = await until(async () => (await tasksFor('alex')).find((task) => task.recurring === routine.data.id), 'the recurring task');
  check('(vi) the run created the linked task as doing, sourced from the routine', doing.status === 'doing' && doing.source === 'routine' && doing.title === 'Morning NZ batch' && doing.history.some((entry) => entry.by === 'routine' && /run started/.test(entry.note)), JSON.stringify(doing));
  const livePlan = (await api('/api/work/plan/alex')).data.text;
  check('(vi) the plan shows the recurring task while the run is live, with the routine\'s rule and the next date', livePlan.includes(`[${doing.id}] Morning NZ batch`) && /\(doing, recurring: [^,]+, next /.test(livePlan) && livePlan.includes('Morning NZ batch: ') && livePlan.includes('running now'), livePlan);
  await writeFile(join(directory, 'release-batch'), 'go');
  const settled = await until(async () => { const task = (await tasksFor('alex')).find((item) => item.id === doing.id); return task?.status === 'done' ? task : null; }, 'the recurring task settled');
  check('(vi) the finished run marked it done with the run\'s outcome', settled.lastOutcome?.status === 'completed' && settled.history.at(-1).by === 'routine' && /run completed/.test(settled.history.at(-1).note), JSON.stringify(settled));
  const routineAfter = await api(`/api/routines/${routine.data.id}`);
  check('(vi) the routine recorded the run as completed', routineAfter.data.lastRun?.status === 'completed', JSON.stringify(routineAfter.data.runs));
  await rm(join(directory, 'release-batch'), { force: true });
  const second2 = await api(`/api/routines/${routine.data.id}/run`, {});
  check('(vi) a second run reopens the same task instead of adding one', second2.status === 202 && (await until(async () => { const task = (await tasksFor('alex')).find((item) => item.id === doing.id); return task?.status === 'doing' ? task : null; }, 'reopened')).history.at(-1).event === 'run' && (await tasksFor('alex')).filter((task) => task.recurring === routine.data.id).length === 1);
  const memberDone = await chat('alex', `${reply(`Batch sent.\nSQUAD_ACTION: {"type":"task","op":"done","id":"${doing.id}","outcome":"sent 12"}`)}`, { requestId: 'req-done-rec' });
  check('(vi) the member can mark the recurring task done', /Marked done: “Morning NZ batch” \(sent 12\)/.test(memberDone.done?.reply || ''), memberDone.done?.reply);
  const noted = await api(`/api/routines/${routine.data.id}`);
  check('(vi) the routine\'s run history shows the member\'s note', noted.data.runs.some((run) => run.note === 'Marked done by the member: sent 12'), JSON.stringify(noted.data.runs));
  await writeFile(join(directory, 'release-batch'), 'go');
  await until(async () => (await api(`/api/routines/${routine.data.id}`)).data.activeRun === null, 'the held run released');

  // Restart: tasks and receipts survive.
  await stopBridge();
  await startBridge();
  const afterRestart = await tasksFor('alex');
  check('restart keeps the tasks', afterRestart.length === 2 && afterRestart.some((task) => task.id === nz.id) && afterRestart.some((task) => task.id === doing.id), JSON.stringify(afterRestart.map((task) => task.id)));
  const replayAfter = await chat('alex', `${reply('On it.\nSQUAD_ACTION: {"type":"task","op":"add","title":"Send the NZ batch","detail":"20 ICP-matched leads","due":"2099-10-15"}')}`, { requestId: 'req-add-2' });
  check('restart keeps the receipts: the old request id still answers with the first task', replayAfter.done?.channelActions?.[0]?.taskId === nz.id && (await tasksFor('alex')).length === 2, JSON.stringify(replayAfter.done?.channelActions));

  console.log(`\ncheck-work-plans: ok (${checks} checks). Instructions and the plan on a DM turn, task actions with receipts and idempotent replay, refusals, person routes, the "Schedule this?" offer and its absence, a routine run creating, holding and settling its task with the member's note in the routine history, restart. Not provider execution.`);
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-2500)}`);
  throw error;
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
