#!/usr/bin/env node
// Always-on members (ADR-0125): a real bridge in an isolated state dir with
// the disposable fake Claude Code harness from check-chats. No vendor,
// credentials, installed app or provider requests are used.
//
// Pure: the chat header's engine model label, the repeated-work signal and
// the next-turn nudge line, the agenda picker, the settings normaliser.
//
// Bridge:
//   (i)   the repeat-work instruction is in a DM turn's system prompt, once;
//   (ii)  "every weekday morning …" with a reply lacking a schedule action
//         keeps the "Schedule this?" offer AND carries the nudge into the
//         next turn's prompt, once; "again" and a near-identical second ask
//         do too; a reply that proposed a schedule leaves none;
//   (iii) POST /api/routines/draft returns the member's proposal, a
//         question, the answer round-trip and the read-from-words fallback,
//         and never touches the member's saved session;
//   (iv)  with "Keep working between messages" on, the bridge starts one
//         open task as a visible run, stops it when the person types, waits
//         for the idle period, starts the next, stops at the daily cap,
//         resumes a goal a restart paused, and does nothing with it off.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { engineModelSummary, replyModelLabel } from '../src/lib/harness.js';
import { REPEAT_WORK_MARKER, scheduleActionInstruction } from '../src/lib/routines.js';
import { automationNudgeLine, detectRecurringWork, detectRepeatRequest, goalIsResumable, nextAgendaItem, repeatedWorkSignal, similarRequest } from '../src/lib/work-plans.js';
import { DEFAULT_DAILY_CAP, normalizeDailyCap, normalizeSettings } from '../server/agenda/store.mjs';

let checks = 0;
const check = (label, ok, detail = '') => { checks += 1; assert.ok(ok, `${label}${detail ? `: ${detail}` : ''}`); };

// ---------- pure: the header label ----------
const claudeReady = { id: 'claude', status: 'ready', defaults: { model: 'fable', effort: '' } };
const codexReady = { id: 'codex', status: 'ready', defaults: { model: 'gpt-6.1-sol', effort: 'xhigh' } };
check('an Autohand member keeps the provider label (null)', engineModelSummary({ harness: { id: 'autohand' }, readiness: claudeReady }) === null);
check('a Claude Code member names Claude and the engine default, not Autohand AI / moa', engineModelSummary({ harness: { id: 'claude' }, readiness: claudeReady })?.label === 'Claude · fable');
check('a Codex member names Codex and its default', engineModelSummary({ harness: { id: 'codex' }, readiness: codexReady })?.label === 'Codex · gpt-6.1-sol');
check('the member\'s own model wins', engineModelSummary({ harness: { id: 'claude', model: 'opus' }, readiness: claudeReady, lastEffectiveModel: { provider: 'anthropic', model: 'haiku' } })?.label === 'Claude · opus');
check('the last reply\'s model beats the engine default', engineModelSummary({ harness: { id: 'claude' }, readiness: claudeReady, lastEffectiveModel: { provider: 'anthropic', model: 'haiku' } })?.label === 'Claude · haiku');
check('a last reply from the Autohand provider is ignored after a switch to Claude Code', engineModelSummary({ harness: { id: 'claude' }, readiness: claudeReady, lastEffectiveModel: { provider: 'autohandai', model: 'moa' } })?.label === 'Claude · fable');
check('no readiness and no model reads "<engine> default"', engineModelSummary({ harness: { id: 'claude' } })?.label === 'Claude default' && engineModelSummary({ harness: { id: 'codex' } })?.label === 'Codex default');
check('an ACP member is named by its agent', engineModelSummary({ harness: { id: 'pi' } })?.label === 'Pi default', engineModelSummary({ harness: { id: 'pi' } })?.label);
check('a recorded Claude reply reads "Claude default", an Autohand one keeps the provider', replyModelLabel({ provider: 'anthropic', model: '' }) === 'Claude default' && replyModelLabel({ provider: 'openai', model: 'gpt-6.1-sol' }) === 'Codex · gpt-6.1-sol' && replyModelLabel({ provider: 'autohandai', label: 'Autohand AI', model: 'moa' }, (m) => `${m.label} / ${m.model}`) === 'Autohand AI / moa');

// ---------- pure: instruction, signal, nudge ----------
const instruction = scheduleActionInstruction('Pacific/Auckland');
check('the schedule instruction opens with the repeat-work rule', instruction.startsWith(REPEAT_WORK_MARKER));
check('it asks exactly one short question when a detail is missing, and repeats the action on yes', /ask exactly one short question/.test(instruction) && /"yes", "do it"/.test(instruction) && /time, the days, the time zone, where the result should go or which folder/.test(instruction));
check('it carries two examples and the action format exactly once', (instruction.match(/Example:/g) || []).length === 2 && instruction.split('"type":"schedule","title"').length === 2);
check('"again" is a repeat, "try again" and a question are not', detectRepeatRequest('pull the signups again')?.phrase === 'pull the signups again' && detectRepeatRequest('try again please') === null && detectRepeatRequest('what did you do again?') === null);
check('"as usual", "like yesterday", "keep doing" are repeats', detectRepeatRequest('as usual, draft the update') && detectRepeatRequest('send me the report like yesterday') && detectRepeatRequest('keep doing the outreach'));
check('repeat words never invent a schedule offer', detectRecurringWork('pull the signups again') === null && detectRecurringWork('as usual, draft the update') === null);
check('a near-identical earlier ask is found; short chatter is not', similarRequest('Pull yesterday signups and summarise them for the growth channel', ['pull yesterday signups and summarise them for growth channel please']) && similarRequest('thanks a lot', ['thanks a lot']) === null);
check('the signal prefers a schedule in words, then a repeat word, then a same ask', repeatedWorkSignal('every weekday morning send the batch again')?.kind === 'recurring' && repeatedWorkSignal('send the batch again')?.kind === 'repeat' && repeatedWorkSignal('Summarise overnight support tickets for APAC team', ['Summarise the overnight support tickets for the APAC team'])?.kind === 'same-ask' && repeatedWorkSignal('Draft the partner email.') === null);
const nudge = automationNudgeLine({ kind: 'recurring', phrase: 'every weekday morning' });
check('the nudge is one line naming the phrase, asking to propose or ask one question', !nudge.includes('\n') && nudge.includes('"every weekday morning"') && /propose it with the schedule action now, or ask them one short question/.test(nudge) && automationNudgeLine(null) === '');

// ---------- pure: the agenda picker ----------
const goals = [
  { id: 'g-person', status: 'paused', pauseReason: 'Paused by you.', prompt: 'mine' },
  { id: 'g-review', status: 'paused', pauseReason: 'Three turns reported no new checklist or evidence. Review the result before resuming.', prompt: 'review' },
  { id: 'g-restart', status: 'paused', pauseReason: 'The bridge restarted. Resume when you are ready to continue.', prompt: 'Keep the sheet in sync' },
];
check('only goals paused by a restart, the runtime boundary or a person message are resumable', goalIsResumable(goals[2]) && !goalIsResumable(goals[0]) && !goalIsResumable(goals[1]) && goalIsResumable({ status: 'paused', pauseReason: 'Paused because you sent a message. Keep working between messages resumes it once the member is idle again.' }));
const tasks = [
  { id: 't_late', status: 'open', due: '2026-10-20', createdAt: '2026-10-01' },
  { id: 't_soon', status: 'open', due: '2026-10-15', createdAt: '2026-10-10', title: 'Soon' },
  { id: 't_rec', status: 'open', due: '2026-10-01', recurring: 'r1' },
  { id: 't_doing', status: 'doing', due: '2026-10-01' },
  { id: 't_blocked', status: 'blocked', due: '2026-10-01' },
];
check('a resumable goal comes first', nextAgendaItem({ tasks, goals })?.key === 'goal:g-restart');
check('then the open task due soonest; recurring, doing and blocked tasks are never picked', nextAgendaItem({ tasks, goals: [] })?.key === 'task:t_soon');
check('an item tried today is not tried again', nextAgendaItem({ tasks, goals, attempted: new Set(['goal:g-restart', 'task:t_soon']) })?.key === 'task:t_late' && nextAgendaItem({ tasks: [], goals: [], attempted: [] }) === null);
check('settings default off with a cap of 6, bounded 1..24', normalizeSettings({}).enabled === false && normalizeSettings({}).dailyCap === DEFAULT_DAILY_CAP && normalizeDailyCap(0) === 6 && normalizeDailyCap(99) === 24 && normalizeDailyCap('3') === 3);
console.log(`Always-on pure checks passed (${checks}): header label, instruction, repeat signal, nudge, agenda picker, settings.`);

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-always-on-'));
const callsFile = join(directory, 'calls.jsonl');
const fake = join(directory, 'fixture-claude');
const rootDir = resolve(new URL('..', import.meta.url).pathname);
const socket = createServer();
await new Promise((r) => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
const IDLE_MS = 1500;
let bridge;
let logs = '';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn().catch(() => null); if (value) return value; await delay(100); }
  throw new Error(`${label} timed out; bridge: ${logs.slice(-3000)}`);
}
const api = async (path, body, method) => {
  const response = await fetch(origin + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); return { status: response.status, ...data };
};
const calls = async () => (await readFile(callsFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const callsFor = async (member) => (await calls()).filter((call) => call.member === member);
const argAfter = (call, flag) => { const args = call?.args || []; const at = args.indexOf(flag); return at >= 0 ? String(args[at + 1] || '') : ''; };
const lastPrompt = async (member) => String((await callsFor(member)).at(-1)?.args?.[1] || '');
const member = (id) => ({ id, name: id, harness: { id: 'claude', executablePath: fake }, projects: [{ path: rootDir }], workspace: rootDir });
const payload = (id, prompt, extra = {}) => ({ agentId: id, agent: member(id), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.', requestId: extra.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...extra });
const reply = (text) => `REPLY<<${text}>>`;
async function chat(id, prompt, extra) {
  const raw = await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt, extra)) })).text();
  const events = raw.split('\n\n').map((chunk) => { const event = chunk.match(/^event: (.+)$/m)?.[1]; const data = chunk.match(/^data: (.+)$/m)?.[1]; return event && data ? { event, data: JSON.parse(data) } : null; }).filter(Boolean);
  return { raw, events, done: events.find((item) => item.event === 'done')?.data || null };
}
const agenda = async (id) => (await api(`/api/agenda/${id}`)).data;
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider', AUTOHAND_SQUAD_AGENDA_TICK_MS: '250', AUTOHAND_SQUAD_AGENDA_IDLE_MS: String(IDLE_MS), AUTOHAND_SQUAD_DRAFT_TIMEOUT_MS: '20000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/agenda')).success, 'bridge start', 30000);
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
  await mkdir(join(directory, 'squad'), { recursive: true });
  await writeFile(fake, `#!${process.execPath}
const fs=require('node:fs');
const file=${JSON.stringify(callsFile)};
const dir=${JSON.stringify(directory)};
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const resumeAt=args.indexOf('--resume');
const session=resumeAt>=0?args[resumeAt+1]:'fixture-'+member+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const prompt=String(args[1]||'');
fs.appendFileSync(file,JSON.stringify({kind:'start',member,resume:resumeAt>=0?args[resumeAt+1]:'',session,prompt:prompt.slice(0,200),args})+'\\n');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
const hold=prompt.match(/HOLD:([a-z0-9-]+)/);
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
  // A goal the last bridge was running: this bridge pauses it as "The bridge restarted", which the agenda may resume.
  const startedAt = new Date().toISOString();
  await writeFile(join(directory, 'squad', 'goals.json'), JSON.stringify({ version: 1, goals: [{ id: 'goal-gina-1', agentId: 'gina', workspace: rootDir, prompt: 'Keep the outreach sheet in sync', harness: 'claude', status: 'running', checklist: [], summary: '', latestReply: '', evidence: [], turnCount: 1, maxTurns: 4, maxRuntimeMs: 600000, startedAt, updatedAt: startedAt, finishedAt: null, pausedAt: null, pauseReason: '', error: null, launch: { agentId: 'gina', agent: member('gina'), workspace: rootDir, profile: 'Use the chosen permission rules.' } }] }));
  await startBridge();

  // (i) The instruction reaches a DM turn.
  const first = await chat('alex', 'Look at the readme');
  assert.equal(first.done?.reply, 'Inspected the readme.', `first turn replied: ${first.raw.slice(-400)}`);
  const system = argAfter((await callsFor('alex')).at(-1), '--append-system-prompt');
  check('(i) the repeat-work instruction is in --append-system-prompt, once', system.split(REPEAT_WORK_MARKER).length === 2, system.slice(0, 300));
  check('(i) a Claude Code reply records the vendor, which the chat labels "Claude …", not the Autohand provider', first.done?.effectiveModel?.provider === 'anthropic' && replyModelLabel(first.done.effectiveModel).startsWith('Claude'), JSON.stringify(first.done?.effectiveModel));

  // (ii) The next-turn nudge.
  const recurring = await chat('alex', 'Every weekday morning send the NZ batch to the new leads.');
  check('(ii) "Schedule this?" is unchanged for a reply with no schedule action', recurring.done?.scheduleOffer?.schedule?.kind === 'weekdays', JSON.stringify(recurring.done?.scheduleOffer));
  check('(ii) the reply\'s own turn did not carry a nudge', !(await lastPrompt('alex')).includes('(Squad note:'));
  await chat('alex', 'thanks');
  const nudged = await lastPrompt('alex');
  check('(ii) the next turn\'s prompt carries the nudge with the phrase', nudged.startsWith('thanks\n\n(Squad note:') && nudged.includes('said "Every weekday morning"') && /propose it with the schedule action now/.test(nudged), nudged);
  const thanksRun = (await api('/api/runs')).data.find((run) => run.agentId === 'alex' && run.title === 'thanks');
  check('(ii) the run keeps the person\'s words as its title', Boolean(thanksRun), JSON.stringify((await api('/api/runs')).data.filter((run) => run.agentId === 'alex').map((run) => run.title)));
  await chat('alex', 'ok');
  check('(ii) the nudge is used once', !(await lastPrompt('alex')).includes('(Squad note:'));
  await chat('alex', 'pull the signups again');
  await chat('alex', 'cheers');
  check('(ii) "again" leaves a nudge for the next turn', (await lastPrompt('alex')).includes('said "pull the signups again"'), await lastPrompt('alex'));
  await chat('alex', 'Summarise the overnight support tickets for the APAC team');
  await chat('alex', 'Summarise overnight support tickets for APAC team please');
  await chat('alex', 'and?');
  check('(ii) the same ask a second time leaves a nudge', (await lastPrompt('alex')).includes('asked for the same thing again'), await lastPrompt('alex'));
  await chat('alex', `Every weekday morning send the batch. ${reply('Sure.\nSQUAD_ACTION: {"type":"schedule","title":"NZ batch","instructions":"send the batch","schedule":{"kind":"weekdays","days":[1,2,3,4,5],"time":"09:00"},"timezone":"Pacific/Auckland"}')}`, { requestId: 'req-sched-1' });
  await chat('alex', 'great');
  check('(ii) a reply that proposed a schedule leaves no nudge', !(await lastPrompt('alex')).includes('(Squad note:'));

  // (iii) Plain-English automation drafts.
  const savedSession = (await callsFor('alex')).at(-1).session;
  const drafted = await api('/api/routines/draft', { memberId: 'alex', agent: member('alex'), workspace: rootDir, timeZone: 'Pacific/Auckland', text: `Every weekday at 8am pull yesterday's signups ${reply('SQUAD_ACTION: {"type":"schedule","title":"Signups summary","instructions":"Pull yesterday\'s signups and post a summary here","schedule":{"kind":"weekdays","days":[1,2,3,4,5],"time":"08:00"},"timezone":"Pacific/Auckland"}')}` });
  check('(iii) the draft route returns the member\'s proposal', drafted.status === 200 && drafted.data.status === 'proposed' && drafted.data.draft.title === 'Signups summary' && drafted.data.draft.schedule.time === '08:00' && drafted.data.draft.schedule.days.join() === '1,2,3,4,5' && drafted.data.draft.timeZone === 'Pacific/Auckland' && /Weekdays/.test(drafted.data.draft.description) && drafted.data.draft.next.length === 3, JSON.stringify(drafted).slice(0, 600));
  const draftCall = (await callsFor('alex')).at(-1);
  check('(iii) the draft ran as a one-off of the member: its own prompt, no --resume', draftCall.prompt.startsWith('Draft an automation: Every weekday at 8am') && draftCall.resume === '' && argAfter(draftCall, '--append-system-prompt').includes('"type":"schedule"'), JSON.stringify({ prompt: draftCall.prompt, resume: draftCall.resume }));
  const draftRun = (await api('/api/runs')).data.find((run) => run.id === drafted.data.runId);
  check('(iii) the draft is a visible run', draftRun?.status === 'completed' && draftRun.title.startsWith('Draft an automation:'), JSON.stringify(draftRun).slice(0, 300));
  const pending = (await api('/api/routines/proposals?memberId=alex&status=proposed')).data.proposals;
  check('(iii) the drafted proposal does not wait in Needs you', !pending.some((proposal) => proposal.title === 'Signups summary'), JSON.stringify(pending.map((proposal) => proposal.title)));
  await chat('alex', 'back to the chat');
  check('(iii) the member\'s conversation resumes its own session afterwards', (await callsFor('alex')).at(-1).resume === savedSession, JSON.stringify({ expected: savedSession, got: (await callsFor('alex')).at(-1).resume }));
  const asked = await api('/api/routines/draft', { memberId: 'alex', agent: member('alex'), workspace: rootDir, timeZone: 'UTC', text: `send me a digest ${reply('Happy to. What time should I send it, and where?')}` });
  check('(iii) a missing detail comes back as one question', asked.data.status === 'question' && asked.data.question === 'What time should I send it, and where?', JSON.stringify(asked.data));
  const answered = await api('/api/routines/draft', { memberId: 'alex', agent: member('alex'), workspace: rootDir, timeZone: 'UTC', question: asked.data.question, answer: '9am, here', text: `send me a digest ${reply('SQUAD_ACTION: {"type":"schedule","title":"Digest","instructions":"send the digest","schedule":{"kind":"weekdays","days":[0,1,2,3,4,5,6],"time":"09:00"},"timezone":"UTC"}')}` });
  check('(iii) the answer travels with the second draft and yields the proposal', answered.data.status === 'proposed' && (await callsFor('alex')).at(-1).args[1].includes('You asked: "What time should I send it, and where?". They answered: "9am, here".'), JSON.stringify(answered.data).slice(0, 300));
  const fallback = await api('/api/routines/draft', { memberId: 'alex', agent: member('alex'), workspace: rootDir, timeZone: 'UTC', text: 'every Monday at 7am post the metrics' });
  check('(iii) a reply without the action falls back to the schedule in the person\'s words, and says so', fallback.data.status === 'read-from-words' && fallback.data.draft.schedule.days.join() === '1' && fallback.data.draft.schedule.time === '07:00', JSON.stringify(fallback.data));
  check('(iii) the draft route refuses empty text and a missing folder', (await api('/api/routines/draft', { memberId: 'alex', workspace: rootDir, text: ' ' })).status === 400 && (await api('/api/routines/draft', { memberId: 'alex', text: 'daily' })).status === 400);

  // (iv) The agenda.
  await chat('quiet', 'hello');
  await api('/api/work', { memberId: 'quiet', title: 'Something open' });
  check('(iv) the switch is off by default', (await agenda('quiet')).enabled === false);
  await chat('ops', 'hello');
  const t1 = (await api('/api/work', { memberId: 'ops', title: 'HOLD:t1 Write the weekly report', due: '2026-10-15' })).data;
  const t2 = (await api('/api/work', { memberId: 'ops', title: 'Tidy the lead sheet', due: '2026-10-16' })).data;
  const enabled = await api('/api/agenda/ops', { enabled: true, dailyCap: 2 }, 'PUT');
  check('(iv) PUT turns it on with a cap', enabled.data.enabled === true && enabled.data.dailyCap === 2, JSON.stringify(enabled));
  const firstStart = await until(async () => (await agenda('ops')).current, 'the agenda started the first task');
  check('(iv) the soonest open task started on its own', firstStart.kind === 'task' && firstStart.title === t1.title, JSON.stringify(firstStart));
  const liveRun = (await api('/api/runs')).data.find((run) => run.id === firstStart.runId);
  check('(iv) it is a visible run of the member', liveRun?.agentId === 'ops' && liveRun.status === 'running' && liveRun.title === `On its own: ${t1.title}`, JSON.stringify(liveRun).slice(0, 300));
  const agendaCall = await until(async () => (await callsFor('ops')).find((call) => call.prompt.includes('This task is open on your plan')), 'the agenda call');
  check('(iv) the run\'s prompt names the task by id and how to report it', agendaCall.args[1].includes(`[${t1.id}] HOLD:t1 Write the weekly report`) && /mark it done with a task action/.test(agendaCall.args[1]));
  await delay(800);
  check('(iv) one item at a time: nothing else started while it runs', (await agenda('ops')).today.count === 1 && (await agenda('ops')).current?.runId === firstStart.runId);
  const personTurn = await chat('ops', `${reply('Here.')} how is it going?`);
  check('(iv) the person\'s message is answered', personTurn.done?.reply === 'Here.');
  const afterPerson = await agenda('ops');
  check('(iv) the person\'s message stopped the agenda run', afterPerson.current === null && afterPerson.last?.status === 'stopped' && afterPerson.last?.reason === 'You sent a message.', JSON.stringify(afterPerson));
  const stoppedRun = await until(async () => { const run = (await api('/api/runs')).data.find((item) => item.id === firstStart.runId); return run && run.status !== 'running' ? run : null; }, 'the stopped run');
  check('(iv) the run reads stopped', stoppedRun.status === 'stopped', stoppedRun.status);
  await delay(IDLE_MS / 2);
  check('(iv) nothing starts within the idle period after the person\'s message', (await agenda('ops')).today.count === 1);
  const secondStart = await until(async () => { const state = await agenda('ops'); return state.today.count === 2 ? state : null; }, 'the second start');
  check('(iv) after the idle period the next task starts', (secondStart.current?.title || secondStart.last?.title) === t2.title, JSON.stringify(secondStart));
  const secondDone = await until(async () => { const state = await agenda('ops'); return state.current === null && state.last?.title === t2.title ? state : null; }, 'the second item finished');
  check('(iv) it finished and the line can say so', secondDone.last.status === 'completed', JSON.stringify(secondDone.last));
  await api('/api/work', { memberId: 'ops', title: 'A third thing' });
  await delay(1500);
  const capped = await agenda('ops');
  check('(iv) the daily cap holds', capped.today.count === 2 && capped.current === null && /limit of 2/.test(capped.waiting), JSON.stringify(capped));
  check('(iv) a member with the switch off was never started', !(await api('/api/runs')).data.some((run) => run.agentId === 'quiet' && run.title.startsWith('On its own')));
  await chat('gina', 'hello');
  await api('/api/agenda/gina', { enabled: true }, 'PUT');
  const goalStart = await until(async () => { const state = await agenda('gina'); return state.current || state.last; }, 'the agenda resumed the goal');
  check('(iv) a goal the restart paused is resumed', goalStart.kind === 'goal' && goalStart.goalId === 'goal-gina-1', JSON.stringify(goalStart));
  const goalTurn = await until(async () => (await callsFor('gina')).find((call) => !call.prompt.startsWith('hello')), 'a goal turn');
  check('(iv) the goal took a turn on the bridge', Boolean(goalTurn));
  const off = await api('/api/agenda/ops', { enabled: false }, 'PUT');
  check('(iv) PUT turns it off', off.data.enabled === false && off.data.waiting === '');

  // Settings survive a restart.
  await writeFile(join(directory, 'release-t1'), 'go');
  await stopBridge();
  await startBridge();
  const reloaded = await agenda('ops');
  check('restart keeps the settings and today\'s count', reloaded.enabled === false && reloaded.dailyCap === 2 && reloaded.today.count === 2, JSON.stringify(reloaded));

  console.log(`\ncheck-always-on: ok (${checks} checks). Header label, the repeat-work instruction in the DM prompt, the next-turn nudge (schedule phrase, "again", same ask) used once and absent after a proposal, plain-English drafts (proposal, question, answer, fallback) without touching the member's session, and the agenda: off by default, one visible run at a time, stopped by the person, idle period, daily cap, goal resume, restart. Not provider execution.`);
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-2500)}`);
  throw error;
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
