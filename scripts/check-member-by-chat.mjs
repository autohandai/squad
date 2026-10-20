#!/usr/bin/env node
// A member born in conversation (ADR-0126): pure checks for the shared rules
// in src/lib/member-shaping.js, then a real bridge in an isolated state dir
// with the disposable fake Claude Code harness from check-chats. No vendor,
// credentials, installed app or provider requests are used.
//
// Proves, against the bridge:
//   (i)   a blank member's direct-message turn carries the shaping
//         instruction in --append-system-prompt, once;
//   (ii)  a member with a role does not get it on an ordinary turn, and does
//         on a turn that asks for a role ("actually, be my release manager");
//   (iii) a `profile` SQUAD_ACTION in the reply is applied: the receipt
//         ("Alex is now your GTM Leader.") is appended to the reply, the done
//         event and the run carry it with the validated patch, and the
//         bridge's registered member copy records the new name, role,
//         instructions, skills and PERSONALITY.md;
//   (iv)  an action naming another member is refused with a reason and
//         changes nothing; so is one with a bad op or an unknown key.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BLANK_MEMBER_NAME, asksForRole, blankGreeting, blankMemberDraft, isBlankMember, isPlaceholderName, memberShapingInstruction, namesSelf, needsShapingInstruction, profileChangeLine, profileReceipts, replyWithoutReceipts, validateProfileAction, profileNoteFor, unappliedProfileReceipts } from '../src/lib/member-shaping.js';
import { queueItemMessagePatch } from '../src/lib/member-queue.js';
import { patchedMemberCopy, patchedProfileText } from '../server/routes/member-shaping.route.mjs';

let checks = 0;
const check = (label, condition, detail = '') => { checks += 1; assert.ok(condition, `${label}${detail ? `: ${detail}` : ''}`); };

// ---------- pure checks ----------
check('a member with no role is blank', isBlankMember({ name: 'New member', role: '' }) && isBlankMember({}) && !isBlankMember({ role: 'QA Engineer' }));
check('placeholder names are recognised, numbered ones too', isPlaceholderName('New member') && isPlaceholderName('new member 3') && !isPlaceholderName('Alex') && !isPlaceholderName('New member plan'));
const draft = blankMemberDraft({ existingNames: ['New member', 'Eva'], workspace: '/w' });
check('the blank draft is numbered like the team builder', draft.name === 'New member 2', draft.name);
check('the blank draft has every field createAgent reads, with no role', draft.role === '' && draft.description === '' && draft.instructions === '' && Array.isArray(draft.skills) && draft.workspace === '/w' && typeof draft.brainCard === 'object');
check('the first draft is plain "New member"', blankMemberDraft().name === BLANK_MEMBER_NAME);
check('the greeting is the one the person showed', blankGreeting({ name: 'New member' }) === "Hey! I'm New member. What can I help you with?");
for (const phrase of ["you're going to be my GTM Leader", 'you’re going to be my GTM Leader', 'be our release manager', 'actually, be my QA lead', 'act as a security reviewer', 'your new role is designer', 'I want you to be our PM', 'you are now our release manager', 'become our support lead']) check(`role request: "${phrase}"`, asksForRole(phrase));
for (const phrase of ['hey', 'can you be more concise', 'be quick please', 'Let it be the default', 'what is your role?', 'Look at the readme']) check(`not a role request: "${phrase}"`, !asksForRole(phrase));
check('a blank member always needs the instruction; a shaped one only when asked', needsShapingInstruction({ role: '' }, 'hey') && !needsShapingInstruction({ role: 'QA' }, 'hey') && needsShapingInstruction({ role: 'QA' }, 'actually, be my release manager'));
const blankText = memberShapingInstruction({ name: 'New member', role: '' });
check('the blank instruction says it is new, carries the format, the confirm line, the four questions and the receipt rule', blankText.includes('no role yet') && blankText.includes('SQUAD_ACTION: {"type":"profile","op":"set"') && blankText.includes("Done, I'm your GTM Leader from here on.") && /at most four numbered/.test(blankText) && blankText.includes('Send what you have, even rough.') && /receipt/.test(blankText), blankText);
check('a placeholder name is told to pick one', /placeholder/.test(blankText));
const changeText = memberShapingInstruction({ name: 'Alex', role: 'GTM Leader' });
check('the change instruction keeps the name and does not say it is new', !changeText.includes('no role yet') && changeText.includes('Keep your name') && changeText.includes('"type":"profile"'));
const valid = validateProfileAction({ type: 'profile', op: 'set', name: ' Alex ', role: 'GTM   Leader', instructions: 'Own the GTM plan.', personality: 'Direct.', skills: ['go-to-market strategy', 'Go-to-market strategy', ' market research '] });
check('a valid action yields only the fields, trimmed, skills de-duplicated', JSON.stringify(valid.patch) === JSON.stringify({ name: 'Alex', role: 'GTM Leader', instructions: 'Own the GTM plan.', personality: 'Direct.', skills: ['go-to-market strategy', 'market research'] }), JSON.stringify(valid.patch));
check('a placeholder name is dropped, not refused', validateProfileAction({ op: 'set', name: 'New member', role: 'QA Lead' }).patch.name === undefined);
for (const [label, raw, pattern] of [
  ['an unknown key', { op: 'set', role: 'x', memberId: 'bob' }, /may only contain/],
  ['a bad op', { op: 'delete', role: 'x' }, /op must be "set"/],
  ['no fields', { op: 'set' }, /at least one/],
  ['a long role', { op: 'set', role: 'x'.repeat(81) }, /longer than 80/],
  ['too many skills', { op: 'set', skills: Array.from({ length: 9 }, (_, i) => `s${i}`) }, /at most 8/],
  ['a non-text field', { op: 'set', role: 5 }, /must be text/],
]) check(`refused: ${label}`, (() => { try { validateProfileAction(raw); return false; } catch (error) { return pattern.test(error.message); } })());
check('namesSelf: empty, own id and own name pass; another member fails', namesSelf('', { id: 'a' }) && namesSelf('A1', { id: 'a1', name: 'Alex' }) && namesSelf('@alex', { id: 'a1', name: 'Alex' }) && !namesSelf('Bob', { id: 'a1', name: 'Alex' }));
check('the receipt line names the new identity', profileChangeLine({ name: 'Alex', role: 'GTM Leader' }, { name: 'New member' }) === 'Alex is now your GTM Leader.' && profileChangeLine({ name: 'Alex' }, { name: 'New member' }) === 'New member is now called Alex.' && profileChangeLine({ skills: ['x'] }, { name: 'Alex' }) === 'Alex updated its skills.');
const receipts = [{ type: 'profile', status: 'applied', message: 'Alex is now your GTM Leader.', patch: { role: 'GTM Leader' } }, { type: 'profile', status: 'failed', message: 'Profile not changed: x.' }, { type: 'task', status: 'added' }];
check('only applied profile receipts are applied by the browser', profileReceipts(receipts).length === 1 && profileReceipts(null).length === 0);
check('the receipt line is lifted out of the reply body', replyWithoutReceipts("Done, I'm your GTM Leader from here on.\n\nAlex is now your GTM Leader.", profileReceipts(receipts)) === "Done, I'm your GTM Leader from here on.");
const copied = patchedMemberCopy({ id: 'n', name: 'New member', role: '', profileFiles: [{ section: 'persona', content: 'old' }, { section: 'identity', content: 'keep' }] }, { name: 'Alex', role: 'GTM Leader', personality: 'Direct.' });
check('the bridge copy takes the patch, personality as PERSONALITY.md', copied.name === 'Alex' && copied.role === 'GTM Leader' && copied.profileFiles.length === 2 && copied.profileFiles.find((f) => f.section === 'persona').content.includes('Direct.') && copied.profileFiles.some((f) => f.content === 'keep'));
const header = 'Autohand Squad member profile\nAgent ID: asq_max\nName: Max\nRole: X Growth\nOperating instructions: Role: keep this.\nName: in a brain card stays';
check('the bridge profile text takes the new name and role in its header only', patchedProfileText(header, { name: 'Robert', role: 'QA $& Lead' }) === 'Autohand Squad member profile\nAgent ID: asq_max\nName: Robert\nRole: QA $& Lead\nOperating instructions: Role: keep this.\nName: in a brain card stays' && patchedProfileText(header, { skills: ['x'] }) === header && patchedProfileText('', { name: 'R' }) === '');
console.log(`Member-by-chat pure checks passed (${checks}): blank, names, greeting, role requests, instruction, validation, identity, receipt line, browser helpers.`);

// ---------- bridge ----------
// --- Receipts from turns this window did not stream (revision, 2026-10-14) ---
{
  const rename = { id: 'profile-action-r1', type: 'profile', actorId: 'asq_max', status: 'applied', message: 'Max is now called Robert.', patch: { name: 'Robert' } };
  const runs = [
    { id: 'run-old', agentId: 'asq_max', finishedAt: '2026-10-13T10:00:00.000Z', channelActions: [{ ...rename, id: 'profile-action-old', patch: { name: 'Old' } }] },
    { id: 'run-new', agentId: 'asq_max', finishedAt: '2026-10-14T19:50:32.000Z', channelActions: [rename, { id: 'x', type: 'create_channel', status: 'applied' }] },
  ];
  const pending = unappliedProfileReceipts(runs, { seen: new Set(), since: '2026-10-14T00:00:00.000Z' });
  assert.deepEqual(pending.map((entry) => [entry.agentId, entry.receipt.patch.name]), [['asq_max', 'Robert']], 'a rename from a queued turn is found; history from before the browser watched is not replayed');
  assert.deepEqual(unappliedProfileReceipts(runs, { seen: new Set(['profile-action-r1']), since: '2026-10-14T00:00:00.000Z' }), [], 'each receipt is applied once');
  const queued = queueItemMessagePatch({ id: 'q1', status: 'done', reply: "I'll go by Robert.\n\nMax is now called Robert.", result: { channelActions: [rename] }, updatedAt: 't' }, { name: 'Max' });
  assert.equal(queued.body, "I'll go by Robert.", 'a queued reply lifts the receipt line out of its text');
  assert.equal(queued.profileNote, 'Max is now called Robert', 'and shows it as the quiet note');
  assert.equal(profileNoteFor([rename, { message: 'Robert is now your X lead.' }]), 'Max is now called Robert · Robert is now your X lead');
}

const directory = await mkdtemp(join(tmpdir(), 'squad-member-by-chat-'));
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
const members = {
  nova: { id: 'nova', name: 'New member', role: '', harness: { id: 'claude', executablePath: fake }, projects: [{ path: rootDir }], workspace: rootDir },
  eva: { id: 'eva', name: 'Eva', role: 'QA Engineer', harness: { id: 'claude', executablePath: fake }, projects: [{ path: rootDir }], workspace: rootDir },
};
const payload = (id, prompt, extra = {}) => ({ agentId: id, agent: members[id], workspace: rootDir, prompt, profile: 'Use the chosen permission rules.', requestId: extra.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
// The fake replies "Inspected the readme." unless the prompt carries REPLY<<text>>.
const reply = (text) => `REPLY<<${text}>>`;
async function chat(id, prompt, extra) {
  const raw = await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt, extra)) })).text();
  const events = raw.split('\n\n').map((chunk) => { const event = chunk.match(/^event: (.+)$/m)?.[1]; const data = chunk.match(/^data: (.+)$/m)?.[1]; return event && data ? { event, data: JSON.parse(data) } : null; }).filter(Boolean);
  return { raw, done: events.find((item) => item.event === 'done')?.data || null };
}
const registered = async (id) => JSON.parse(await readFile(join(directory, 'squad', 'channels.json'), 'utf8')).agentChannelAccess?.[id]?.agent || null;
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/runs')).success, 'bridge start', 30000);
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
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('claude 1.0.0');process.exit(0);}
const member=process.env.AUTOHAND_SQUAD_MEMBER;
const resumeAt=args.indexOf('--resume');
const session=resumeAt>=0?args[resumeAt+1]:'fixture-'+member+'-'+Date.now().toString(36);
const prompt=String(args[1]||'');
fs.appendFileSync(file,JSON.stringify({kind:'start',member,prompt:prompt.slice(0,200),args})+'\\n');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
const custom=prompt.match(/REPLY<<([\\s\\S]*?)>>/);
const text=custom?custom[1]:'Inspected the readme.';
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text}]}});
emit({type:'result',subtype:'success',result:text,session_id:session,usage:{input_tokens:400,output_tokens:10}});
process.exit(0);
`);
  await chmod(fake, 0o700);
  await startBridge();

  // (i) A blank member's turn carries the instruction.
  const hey = await chat('nova', 'hey');
  assert.equal(hey.done?.reply, 'Inspected the readme.', `first turn replied: ${hey.raw.slice(-400)}`);
  const blankPrompt = await lastSystemPrompt();
  check('(i) the blank member gets the shaping instruction', blankPrompt.includes('no role yet') && blankPrompt.includes('SQUAD_ACTION: {"type":"profile","op":"set"'), blankPrompt.slice(-600));
  check('(i) once', blankPrompt.split('"type":"profile","op":"set"').length === 2);

  // (ii) A member with a role: not on an ordinary turn, yes when asked for a role.
  await chat('eva', 'Look at the readme');
  check('(ii) a member with a role does not get it on an ordinary turn', !(await lastSystemPrompt()).includes('"type":"profile"'));
  await chat('eva', 'actually, be my release manager');
  const changePrompt = await lastSystemPrompt();
  check('(ii) it gets the change form when the message asks for a role', changePrompt.includes('"type":"profile","op":"set"') && changePrompt.includes('Keep your name') && !changePrompt.includes('no role yet'));

  // (iii) The profile action is applied, receipted and recorded.
  const action = 'SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader","instructions":"You own the go-to-market plan.","personality":"Direct and practical.","skills":["go-to-market strategy","market research"]}';
  const shaped = await chat('nova', `you're going to be my GTM Leader ${reply(`Done, I'm your GTM Leader from here on. To start I need a few things:\n1. What's the product and who is it for?\n2. Stage?\n3. Existing assets?\n4. Main goal for the next 90 days?\nSend what you have, even rough.\n${action}`)}`, { requestId: 'req-shape-1' });
  const receipt = shaped.done?.channelActions?.[0];
  check('(iii) the receipt is applied with the validated patch', receipt?.type === 'profile' && receipt.status === 'applied' && receipt.patch?.role === 'GTM Leader' && receipt.patch?.name === 'Alex' && receipt.patch?.skills?.length === 2, JSON.stringify(shaped.done?.channelActions));
  check('(iii) the receipt line is appended to the reply, and the action line is not shown', shaped.done.reply.endsWith('Alex is now your GTM Leader.') && !shaped.done.reply.includes('SQUAD_ACTION') && shaped.done.reply.startsWith("Done, I'm your GTM Leader"), shaped.done.reply);
  const copy = await until(async () => { const agent = await registered('nova'); return agent?.role === 'GTM Leader' ? agent : null; }, 'the registered member copy');
  check('(iii) the bridge recorded the change on the member copy', copy.name === 'Alex' && copy.instructions === 'You own the go-to-market plan.' && copy.skills.join(',') === 'go-to-market strategy,market research' && copy.profileFiles.some((file) => file.section === 'persona' && file.content.includes('Direct and practical.')), JSON.stringify(copy).slice(0, 400));
  const run = (await api('/api/runs')).data.find((item) => item.agentId === 'nova' && item.channelActions?.length);
  check('(iii) the run carries the receipt', run?.channelActions?.[0]?.status === 'applied', JSON.stringify(run?.channelActions));
  const replayed = await chat('nova', `again ${reply(`Done.\n${action}`)}`, { requestId: 'req-shape-1' });
  check('(iii) replaying the same action is the same state', replayed.done?.channelActions?.[0]?.status === 'applied' && (await registered('nova')).role === 'GTM Leader');


  // (iv) Refusals change nothing.
  const forged = await chat('nova', `${reply('Sure.\nSQUAD_ACTION: {"type":"profile","op":"set","member":"Eva","role":"Intern"}')}`, { requestId: 'req-forge-1' });
  const forgedReceipt = forged.done?.channelActions?.[0];
  check('(iv) naming another member is refused with a reason', forgedReceipt?.status === 'failed' && /only change its own profile/.test(forgedReceipt.message) && forged.done.reply.includes('Profile not changed:'), JSON.stringify(forgedReceipt));
  check('(iv) and nothing changed', (await registered('nova')).role === 'GTM Leader' && (await registered('eva')).role === 'QA Engineer');
  const own = await chat('nova', `${reply('Sure.\nSQUAD_ACTION: {"type":"profile","op":"set","member":"Alex","personality":"Calm."}')}`, { requestId: 'req-own-1' });
  check('(iv) naming itself is fine', own.done?.channelActions?.[0]?.status === 'applied' && own.done.reply.endsWith('Alex updated its personality.'), JSON.stringify(own.done?.channelActions));
  const bad = await chat('nova', `${reply('Hm.\nSQUAD_ACTION: {"type":"profile","op":"delete"}\nSQUAD_ACTION: {"type":"profile","op":"set","role":"Boss","memberId":"alex"}')}`, { requestId: 'req-bad-1' });
  check('(iv) a bad op and an unknown key are refused', bad.done?.channelActions?.length === 2 && bad.done.channelActions.every((item) => item.status === 'failed') && /op must be "set"/.test(bad.done.channelActions[0].message) && /may only contain/.test(bad.done.channelActions[1].message), JSON.stringify(bad.done?.channelActions));
  check('(iv) and nothing changed', (await registered('nova')).role === 'GTM Leader');
  const byId = await chat('nova', `${reply('Sure.\nSQUAD_ACTION: {"type":"profile","op":"set","member":"eva","role":"Intern"}')}`, { requestId: 'req-forge-2' });
  check('(iv) naming another member by id is refused too', byId.done?.channelActions?.[0]?.status === 'failed' && (await registered('eva')).role === 'QA Engineer');

  // A chosen name another member has is numbered, like the team builder.
  const taken = await chat('nova', `${reply('Sure.\nSQUAD_ACTION: {"type":"profile","op":"set","name":"Eva"}')}`, { requestId: 'req-name-1' });
  check('a taken name is numbered', taken.done?.channelActions?.[0]?.patch?.name === 'Eva 2' && taken.done.reply.endsWith('Alex is now called Eva 2.') && (await registered('nova')).name === 'Eva 2', JSON.stringify(taken.done?.channelActions));

  // (vii) A rename sent as a queued follow-up keeps its receipt on the
  // queue item, so the app can lift the line and apply the rename
  // (revision 2026-10-14: "you will be called Robert" while Max was busy).
  const renameAction = 'SQUAD_ACTION: {"type":"profile","op":"set","name":"Robert"}';
  const queuedText = `you will be called Robert ${reply(`I'll go by Robert.\n${renameAction}`)}`;
  const enqueued = await api('/api/queues/nova/items', { ...payload('nova', queuedText), text: queuedText });
  check('(vii) the rename is queued', enqueued.success === true, JSON.stringify(enqueued).slice(0, 300));
  const doneItem = await until(async () => { const queue = (await api('/api/queues/nova')).data; const item = queue?.items?.find((entry) => entry.id === enqueued.data.id); return item?.status === 'done' ? item : null; }, 'the queued rename to finish', 30000);
  const queuedReceipt = doneItem.result?.channelActions?.[0];
  check('(vii) the queued turn keeps its profile receipt', queuedReceipt?.type === 'profile' && queuedReceipt.status === 'applied' && queuedReceipt.patch?.name === 'Robert', JSON.stringify(doneItem.result).slice(0, 400));
  const queuedRun = (await api('/api/runs')).data.find((item) => item.channelActions?.some((action) => action.id === queuedReceipt?.id));
  check('(vii) and the same receipt is on the run the app polls', Boolean(queuedRun), '');
  console.log(`\ncheck-member-by-chat: ok (${checks} checks). The shaping instruction on blank and role-change turns only, the profile action applied with a receipt and recorded on the bridge copy, replay, refusals for another member (by name and id), a bad op and an unknown key, and a taken name numbered. Not provider execution.`);
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-2500)}`);
  throw error;
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
