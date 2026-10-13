#!/usr/bin/env node
// Previous chats and chat runs (ADR-0113): a real bridge in an isolated state
// dir with a disposable fake Claude Code harness. No vendor, credentials,
// installed app, or provider requests are used.
//
// Proves: a chat turn appears in GET /api/runs with its engine, status and
// reply; the harness resume id is captured when a chat is put away and the
// next turn starts without --resume; opening the chat brings the id back and
// the following turn resumes it; /api/chat/reset forgets the id; finished runs
// are still listed after the bridge restarts; the list, one record, open and
// delete routes answer as documented. Plus pure checks for the record bounds,
// the restore event and the meta line.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { boundMessages, buildChatRecord, chatSummary, chatTitleFrom, MAX_MESSAGES_PER_CHAT } from '../server/chats/store.mjs';
import { countHarnessSessions, normalizeHarnessSessions } from '../server/chats/sessions.mjs';
import { buildRecall, turnTitle } from '../server/chats/recall.mjs';
import { historyRecord, runFromRecord } from '../server/runs/history.mjs';
import { archivePayload, chatMetaLine, conversationHasWork, messagesForTransfer, restoreConversationEvent, sortChats } from '../src/lib/chat-sessions.js';
import { applySharedConversationEvent } from '../src/lib/shared-conversations.js';
import { continuationPrompt, deniedFolders, folderFromDeniedPath, folderNeedsYouRows, foldersNeedingAccess, mentionedPaths, pendingFolderRequests, projectsWithFolder } from '../src/lib/folder-access.js';
import { effortLevelsFor } from '../src/lib/harness.js';

// ---------- pure checks ----------
const msg = (i, role, body, extra = {}) => ({ id: `m${i}`, role, body, startedAt: `2026-10-13T0${i % 10}:00:00.000Z`, ...extra });
assert.equal(conversationHasWork([msg(1, 'agent', 'Hi')]), false, 'an untouched conversation is not worth keeping');
assert.equal(conversationHasWork([msg(1, 'agent', 'Hi'), msg(2, 'user', 'Check the build')]), true);
assert.equal(chatTitleFrom([msg(1, 'agent', 'Hi'), msg(2, 'user', '  Check   the build\nplease ')]), 'Check the build please');
assert.equal(chatTitleFrom([msg(1, 'user', 'x'.repeat(200))]).length, 96, 'titles are cut at 96 characters');
const many = Array.from({ length: MAX_MESSAGES_PER_CHAT + 20 }, (_, i) => msg(i, i % 2 ? 'agent' : 'user', `message ${i}`));
assert.equal(boundMessages(many).messages.length, MAX_MESSAGES_PER_CHAT, 'older messages beyond the cap are dropped');
assert.equal(boundMessages(many).messages[0].body, 'message 20', 'the newest messages are the ones kept');
const heavy = [msg(1, 'user', 'q'), msg(2, 'agent', 'a', { streamEvents: [{ type: 'x', blob: 'y'.repeat(5 * 1024 * 1024) }], trace: { events: [] } })];
const bounded = boundMessages(heavy);
assert.equal(bounded.limited, true); assert.equal(bounded.messages[1].streamEvents, undefined, 'stream events go first when the record is too big');
assert.equal(bounded.messages[1].workDetailsLimited, true); assert.ok(bounded.messages[1].trace, 'the trace stays');
assert.throws(() => buildChatRecord('alex', { messages: [] }, { id: 'chat-1' }), /at least one message/);
const record = buildChatRecord('alex', { messages: [msg(1, 'user', 'Plan the week'), msg(2, 'agent', 'Done')], harness: 'claude', workspace: '/w', startedAt: '2026-10-13T01:00:00.000Z' }, { id: 'chat-1', now: '2026-10-13T02:00:00.000Z', sessions: { claude: { '/w': { resumeId: 's1', updatedAt: 't' } } } });
assert.equal(record.title, 'Plan the week'); assert.equal(record.turns, 1); assert.equal(record.messageCount, 2);
assert.deepEqual(chatSummary(record), { digest: { firstQuestion: 'Plan the week', lastReply: 'Done' }, id: 'chat-1', memberId: 'alex', title: 'Plan the week', startedAt: '2026-10-13T01:00:00.000Z', endedAt: '2026-10-13T02:00:00.000Z', createdAt: '2026-10-13T02:00:00.000Z', harness: 'claude', workspace: '/w', messageCount: 2, turns: 1, limited: false, resumable: true });
assert.deepEqual(normalizeHarnessSessions({ claude: { '/w': { resumeId: 's1', updatedAt: 't' }, '/x': { resumeId: '' } }, 'bad id!': { '/w': { resumeId: 'z' } }, codex: 'nope' }), { claude: { '/w': { resumeId: 's1', updatedAt: 't' } } });
assert.equal(countHarnessSessions({ claude: { '/w': { resumeId: 's1' }, '/v': { resumeId: 's2' } }, codex: { '/w': { resumeId: 't1' } } }), 3);
assert.equal(historyRecord({ id: 'r', status: 'running', logs: [] }), null, 'live runs are never recorded');
const stored = historyRecord({ id: 'r', agentId: 'alex', title: 'T', mode: 'chat', kind: 'chat', harness: 'claude', status: 'completed', startedAt: 's', finishedAt: 'f', logs: Array.from({ length: 300 }, (_, i) => ({ source: 'stdout', line: `l${i}`, at: 't' })), reply: 'ok', exitCode: 0 });
assert.equal(stored.logs.length, 120, 'only the log tail is stored'); assert.equal(stored.logs.at(-1).line, 'l299');
const back = runFromRecord(stored);
assert.equal(back.restored, true); assert.equal(back.status, 'completed'); assert.equal(back.abortController, null); assert.deepEqual(back.channelActions, []);
const wasLive = runFromRecord({ ...stored, status: 'running' }, { bootAt: '2026-10-14T00:28:00.000Z' });
assert.equal(wasLive.status, 'interrupted', 'a record that was live when written belongs to a dead process: it comes back interrupted (ADR-0123)');
assert.equal(wasLive.finishedAt, '2026-10-14T00:28:00.000Z');
const agent = { id: 'alex', harness: { id: 'claude' }, workspace: '/w', conversationStartedAt: '2026-10-13T01:00:00.000Z' };
const payloadOut = archivePayload(agent, [msg(1, 'user', 'Plan the week')], { endedAt: '2026-10-13T02:00:00.000Z' });
assert.equal(payloadOut.harness, 'claude'); assert.equal(payloadOut.startedAt, '2026-10-13T01:00:00.000Z'); assert.equal(payloadOut.title, 'Plan the week'); assert.equal(payloadOut.workspace, '/w');
const bulky = [msg(1, 'user', 'q'), msg(2, 'agent', 'a', { streamEvents: Array.from({ length: 800 }, (_, i) => ({ type: 'tool_update', output: 'x'.repeat(5000), i })), trace: { events: [{ type: 'x' }] } })];
const transfer = messagesForTransfer(bulky);
assert.equal(transfer.limited, true); assert.equal(transfer.messages[1].streamEvents, undefined, 'the browser drops stream events above its transfer budget'); assert.ok(transfer.messages[1].trace.events, 'the trace stays');
assert.equal(messagesForTransfer([msg(1, 'user', 'q')]).limited, false);
assert.equal(archivePayload(agent, bulky).messages[1].workDetailsLimited, true, 'archivePayload sends the trimmed form');
const restoreAt = '2026-10-13T05:00:00.000Z';
const big = Array.from({ length: 150 }, (_, i) => msg(i, i % 2 ? 'agent' : 'user', `m${i}`, i === 149 ? { status: 'loading' } : {}));
const event = restoreConversationEvent('alex', { messages: big }, restoreAt);
const restored = applySharedConversationEvent({ alex: [msg(1, 'user', 'old')] }, event);
assert.equal(restored.alex.length, 150, 'a 150-message chat comes back whole (the old 100 cap is gone)');
assert.equal(restored.alex[149].status, 'stopped', 'a reply that was still loading when the chat was put away comes back stopped');
assert.equal(restored.alex[0].startedAt, restoreAt, 'restored messages sit at the restore time');
const later = applySharedConversationEvent(restored, { type: 'message.append', memberId: 'alex', at: '2026-10-13T05:00:01.000Z', message: { id: 'n1', role: 'user', body: 'next', startedAt: '2026-10-13T05:00:01.000Z' } });
assert.equal(later.alex.length, 151, 'the conversation continues after a restore');
assert.equal(chatMetaLine({ turns: 1, harness: 'claude', endedAt: 't' }, { harnessName: (id) => id.toUpperCase(), relative: () => '2h ago' }), '1 turn · CLAUDE · 2h ago');
assert.deepEqual(sortChats([{ id: 'a', endedAt: '2026-10-13T01:00:00.000Z' }, { id: 'b', endedAt: '2026-10-13T03:00:00.000Z' }]).map((c) => c.id), ['b', 'a']);
assert.equal(turnTitle('Pursue this explicit goal until it is achieved or you need a human decision:\nShip the release\n\nWork in the currently assigned harness'), 'goal: Ship the release', 'goal turns recall the goal, not the preamble');
assert.equal(turnTitle('Plain question'), 'Plain question');
const recallSources = { memberId: 'alex', members: [{ id: 'alex', name: 'Alex' }, { id: 'noah', name: 'Noah' }],
  ownChats: [{ memberId: 'alex', title: 'Plan the week', turns: 2, endedAt: '2026-10-13T01:00:00.000Z', digest: { lastReply: 'Here is the plan, api_key=sk-abcdef123456 kept' } }],
  otherChats: [{ memberId: 'noah', title: 'Fix the build', turns: 1, endedAt: '2026-10-13T00:00:00.000Z', digest: { lastReply: 'Green.' } }],
  otherTurns: [{ agentId: 'noah', title: 'Check CI', reply: 'CI is green.', finishedAt: '2026-10-13T02:00:00.000Z' }, { agentId: 'alex', title: 'mine', reply: 'x', finishedAt: '2026-10-13T02:00:00.000Z' }],
  channels: [{ id: 'c1', name: 'leads', memberIds: ['alex', 'noah'] }, { id: 'c2', name: 'private', memberIds: ['noah'] }],
  messages: [{ channelId: 'c1', role: 'user', authorName: 'Igor', body: 'Any update?', createdAt: '2026-10-13T02:30:00.000Z' }, { channelId: 'c1', role: 'agent', agentId: 'noah', body: 'Working on it', createdAt: '2026-10-13T02:31:00.000Z' }, { channelId: 'c2', role: 'user', authorName: 'Igor', body: 'secret channel', createdAt: '2026-10-13T02:32:00.000Z' }] };
const built = buildRecall(recallSources, { now: Date.parse('2026-10-13T03:00:00.000Z') });
assert.deepEqual(built.counts, { ownChats: 1, otherChats: 1, otherTurns: 1, channels: 1 });
assert.ok(built.text.includes('"Plan the week" (2 turns)') && built.text.includes('2 h ago'), built.text);
assert.ok(built.text.includes('api_key=[redacted]'), 'secrets in digests are redacted');
assert.ok(built.text.includes('Noah, 1 h ago: asked "Check CI", replied "CI is green."'), built.text);
assert.ok(!built.text.includes('"mine"'), 'the member\'s own live turns are not listed as other members\' work');
assert.ok(built.text.includes('#leads') && built.text.includes('Igor: "Any update?" · Noah: "Working on it"'), built.text);
assert.ok(!built.text.includes('secret channel'), 'channels the member is not in are left out');
assert.equal(buildRecall({ memberId: 'alex' }).text, '', 'nothing earlier: no block');
assert.ok(buildRecall(recallSources, { budget: 300 }).text.length <= 300, 'the block respects its budget');
const denial = '{\n  "pattern": "/Users/igor/.claude/plans/*"\n}\n/Users/igor/.claude/plans is outside /Users/igor/Documents/leads, /Users/igor/.autohand/squad/web-state/agents/x/profile; --restricted confines the file tools to the working directory.';
const denied = { id: 'a9', role: 'agent', body: 'Blocked.', streamEvents: [{ type: 'tool_end', toolName: 'Glob', success: false, output: denial }, { type: 'tool_end', toolName: 'Read', success: true, output: 'fine' }, { type: 'tool_end', toolName: 'Read', success: false, output: '/Users/igor/notes/todo.md is outside /w; --restricted confines the file tools to the working directory.' }] };
assert.deepEqual(deniedFolders(denied), ['/Users/igor/.claude/plans', '/Users/igor/notes'], 'denied folders come from the refusal text; a file becomes its folder');
assert.equal(folderFromDeniedPath('/Users/igor/.claude/plans/**'), '/Users/igor/.claude/plans');
assert.equal(folderFromDeniedPath('C:\\Users\\igor\\notes\\todo.md'), 'C:\\Users\\igor\\notes');
assert.deepEqual(deniedFolders({ streamEvents: [{ type: 'tool_end', success: false, output: 'some other error' }] }), [], 'other failures are not folder requests');
const memberWithFolder = { projects: projectsWithFolder({ projects: [{ path: '/w' }] }, '/Users/igor/notes') };
assert.equal(memberWithFolder.projects.length, 2); assert.equal(memberWithFolder.projects[1].kind, 'folder'); assert.equal(memberWithFolder.projects[1].name, 'notes');
assert.equal(projectsWithFolder(memberWithFolder, '/Users/igor/notes'), memberWithFolder.projects, 'granting twice is a no-op');
assert.deepEqual(pendingFolderRequests(memberWithFolder, denied), ['/Users/igor/.claude/plans'], 'a granted folder is no longer asked about');
assert.deepEqual(pendingFolderRequests(memberWithFolder, { ...denied, folderAccessDismissed: ['/Users/igor/.claude/plans'] }), [], 'nor a dismissed one');
assert.ok(continuationPrompt('/x').includes('/x'));
assert.deepEqual(effortLevelsFor('claude', { efforts: ['low', 'high'] }), ['low', 'high'], 'Claude Code levels come from the binary');
assert.deepEqual(effortLevelsFor('autohand', {}, 'moa'), ['none', 'normal', 'extended'], 'Autohand: moa takes --thinking levels');
assert.deepEqual(effortLevelsFor('autohand', {}, 'fantail'), [], 'Autohand: other models have no reasoning level');
assert.deepEqual(effortLevelsFor('autohand', {}, ''), [], 'Autohand: no model, no slider');
assert.deepEqual(mentionedPaths('we had a plan ~/.claude/plan/* you can access there, and /Users/igor/Documents/leads/icp.md. Also C:\\work\\x'), ['~/.claude/plan', '/Users/igor/Documents/leads/icp.md', 'C:\\work\\x'], 'paths named in plain English are found, globs and punctuation trimmed');
assert.deepEqual(mentionedPaths('no paths here, just words and a URL https://x.y/z'), []);
const checked = [{ given: '~/.claude/plan', folder: '/Users/igor/.claude/plan', allowed: true }, { given: '/Users/igor/Documents/leads/icp.md', folder: '/Users/igor/Documents/leads', allowed: true }, { given: '/etc', folder: '/etc', allowed: false }];
assert.deepEqual(foldersNeedingAccess({ projects: [{ path: '/Users/igor/Documents/leads' }] }, '/w', checked), ['/Users/igor/.claude/plan'], 'covered folders and disallowed ones are left out');
assert.deepEqual(pendingFolderRequests({ projects: [] }, { folderRequests: ['/a', '/b'], folderAccessDismissed: ['/b'] }), ['/a'], 'held requests on a message are pending until decided');
const rows = folderNeedsYouRows([{ id: '1', memberId: 'alex', folder: '/a', prompt: 'read it', createdAt: 't', status: 'pending' }, { id: '2', memberId: 'alex', folder: '/b', status: 'allowed' }], [{ id: 'alex', name: 'Alex' }]);
assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Alex needs /a'); assert.equal(rows[0].detail, 'For: read it');
console.log('Chat pure checks passed: bounds, record, sessions, history, restore event, recall, folder access, effort levels, folder mentions.');

// ---------- bridge ----------
const directory = await mkdtemp(join(tmpdir(), 'squad-chats-'));
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
const member = (id) => ({ id, name: id, harness: { id: 'claude', executablePath: fake }, projects: [{ path: rootDir }] });
const payload = (id, prompt) => ({ agentId: id, agent: member(id), workspace: rootDir, prompt, profile: 'Use the chosen permission rules.' });
const chat = async (id, prompt) => (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id, prompt)) })).text();
const sessionsFile = join(directory, 'app', 'agents', 'alex', 'harness-sessions.json');
const sessions = async () => JSON.parse(await readFile(sessionsFile, 'utf8').catch(() => '{}'));
const resumeIdOnDisk = async () => Object.values((await sessions()).claude || {})[0]?.resumeId || '';
async function startBridge() {
  bridge = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: rootDir,
    env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, 'squad'), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, 'app'), AUTOHAND_HOME: join(directory, 'autohand'), AUTOHAND_USER_CONFIG_PATH: join(directory, 'config.json'), CLAUDE_CONFIG_DIR: join(directory, 'claude'), ANTHROPIC_API_KEY: 'fixture-only-no-provider' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (d) => { logs += d; }); bridge.stderr.on('data', (d) => { logs += d; });
  await until(async () => (await api('/api/members/alex/chats')).success, 'bridge start', 30000);
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
fs.appendFileSync(file,JSON.stringify({kind:'start',member,resume:resumeAt>=0?args[resumeAt+1]:'',prompt:String(args[1]||'').slice(0,80),args})+'\\n');
const emit=x=>console.log(JSON.stringify(x));
emit({type:'system',subtype:'init',session_id:session,model:'claude-fixture'});
emit({type:'assistant',message:{id:'reply',content:[{type:'tool_use',id:'t1',name:'Read',input:{file_path:'README.md'}}]}});
emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'ok'}]}});
emit({type:'assistant',message:{id:'reply',content:[{type:'text',text:'Inspected the readme.'}]}});
emit({type:'result',subtype:'success',result:'Inspected the readme.',session_id:session,usage:{input_tokens:400,output_tokens:10}});
process.exit(0);
`);
  await chmod(fake, 0o700);
  await startBridge();

  // 1. A chat turn is a run with its engine, status and reply.
  const first = await chat('alex', 'Look at the readme');
  assert.ok(first.includes('"reply":"Inspected the readme."'), `first turn replied: ${first.slice(-400)}`);
  const runsAfterFirst = (await api('/api/runs')).data;
  const chatRun = runsAfterFirst.find((run) => run.agentId === 'alex');
  assert.ok(chatRun, 'the chat turn is listed in /api/runs');
  assert.equal(chatRun.mode, 'chat'); assert.equal(chatRun.harness, 'claude'); assert.equal(chatRun.status, 'completed');
  assert.equal(chatRun.title, 'Look at the readme'); assert.equal(chatRun.reply, 'Inspected the readme.');
  assert.ok(chatRun.logs.some((entry) => entry.source === 'tool' && entry.line.includes('Read')), 'the run log carries the tool rows');
  assert.ok(chatRun.command.includes('claude'), 'the command names the engine');
  const firstSession = await resumeIdOnDisk();
  assert.ok(firstSession.startsWith('fixture-alex-'), 'the resume id is on disk after the first turn');
  assert.equal((await calls()).at(-1).resume, '', 'the first turn starts a fresh session');

  // 2. Putting the chat away captures and forgets the resume id.
  const conversation = [
    { id: 'u1', role: 'user', body: 'Look at the readme', startedAt: '2026-10-13T01:00:00.000Z' },
    { id: 'a1', role: 'agent', body: 'Inspected the readme.', status: 'complete', startedAt: '2026-10-13T01:00:01.000Z', streamEvents: [{ type: 'tool_start', tool: { name: 'Read' } }] },
  ];
  const archived = await api('/api/members/alex/chats', { messages: conversation, startedAt: '2026-10-13T01:00:00.000Z', harness: 'claude', workspace: rootDir });
  assert.equal(archived.status, 201); assert.equal(archived.data.resumable, true); assert.equal(archived.data.turns, 1); assert.equal(archived.data.title, 'Look at the readme');
  assert.equal(await resumeIdOnDisk(), '', 'the id left the member with the chat');
  const list = (await api('/api/members/alex/chats')).data.chats;
  assert.equal(list.length, 1); assert.equal(list[0].id, archived.data.id);
  const one = (await api(`/api/members/alex/chats/${archived.data.id}`)).data;
  assert.equal(one.messages.length, 2); assert.equal(one.messages[1].streamEvents.length, 1, 'the record keeps the work details');
  assert.equal(one.sessions.claude[rootDir].resumeId, firstSession, 'the record holds the engine session');

  // 2b. A real conversation is megabytes of JSON: the route must take it
  //     (the bridge default is 1 MB and refused every real chat with a 413).
  const heavyEvents = Array.from({ length: 1000 }, (_, i) => ({ type: 'tool_update', toolId: `t${i}`, output: 'x'.repeat(5000) }));
  const heavy = await api('/api/members/heavy/chats', { messages: [{ id: 'u1', role: 'user', body: 'Big one', startedAt: '2026-10-13T01:00:00.000Z' }, { id: 'a1', role: 'agent', body: 'Done', status: 'complete', startedAt: '2026-10-13T01:00:01.000Z', streamEvents: heavyEvents }], harness: 'claude' });
  assert.equal(heavy.status, 201, `a 5 MB conversation is accepted: ${JSON.stringify(heavy).slice(0, 200)}`);
  assert.equal(heavy.data.limited, true, 'and trimmed to the store bound');
  assert.equal((await api(`/api/members/heavy/chats/${heavy.data.id}`)).data.messages[1].body, 'Done', 'the reply text survives the trim');

  // 3. The next turn starts a new session; opening the chat brings the old one back.
  await chat('alex', 'Something new');
  assert.equal((await calls()).at(-1).resume, '', 'after New chat the engine is not resumed');

  // 3a. Recall (ADR-0115): the new turn is told about the chat that was put away,
  //     and another member is told what Alex was asked.
  const newTurnArgs = (await calls()).at(-1).args;
  const systemPrompt = newTurnArgs[newTurnArgs.indexOf('--append-system-prompt') + 1] || '';
  assert.ok(systemPrompt.includes('Earlier conversations'), 'the turn after New chat carries the recall block');
  assert.ok(systemPrompt.includes('Look at the readme'), 'it names the chat that was put away');
  assert.ok(systemPrompt.includes('Inspected the readme.'), 'with its last reply');
  const recall = (await api('/api/members/alex/recall')).data;
  assert.equal(recall.counts.ownChats, 1, 'GET recall shows one previous chat for alex');
  assert.ok(recall.text.startsWith('Earlier conversations'), recall.text.slice(0, 80));
  const latestRun = (await api('/api/runs')).data.find((run) => run.agentId === 'alex');
  const layer = latestRun.contextLayers.layers.find((item) => item.name === 'recentConversations');
  assert.equal(layer?.included, true, 'the context manifest records that recall was included');
  await chat('bob', 'Hello from bob');
  const bobArgs = (await calls()).at(-1).args;
  const bobPrompt = bobArgs[bobArgs.indexOf('--append-system-prompt') + 1] || '';
  assert.ok(bobPrompt.includes('What other members were asked recently'), 'another member hears what Alex was asked');
  assert.ok(bobPrompt.includes('Something new'), 'including the live turn that never left the browser');
  const bobRecall = (await api('/api/members/bob/recall')).data;
  assert.equal(bobRecall.counts.ownChats, 0); assert.ok(bobRecall.counts.otherTurns >= 1); assert.equal(bobRecall.counts.otherChats, 2, 'alex\'s put-away chat and the heavy member\'s');
  const chatOnlyRun = (await api('/api/runs')).data.find((run) => run.agentId === 'bob');
  assert.equal(chatOnlyRun.status, 'completed');
  const secondSession = await resumeIdOnDisk();
  assert.notEqual(secondSession, firstSession);
  const opened = await api(`/api/members/alex/chats/${archived.data.id}/open`, { current: { messages: [{ id: 'u2', role: 'user', body: 'Something new', startedAt: '2026-10-13T02:00:00.000Z' }], harness: 'claude', workspace: rootDir } });
  assert.equal(opened.status, 200); assert.equal(opened.data.chat.id, archived.data.id); assert.equal(opened.data.chat.messages.length, 2);
  assert.equal(opened.data.sessionsRestored, 1); assert.equal(opened.data.archived.title, 'Something new', 'the current chat was put away in the same request');
  assert.equal(await resumeIdOnDisk(), firstSession, 'the opened chat\'s session is back on disk');
  const listAfterOpen = (await api('/api/members/alex/chats')).data.chats;
  assert.deepEqual(listAfterOpen.map((c) => c.title), ['Something new'], 'the opened chat left the list; the one put away joined it');
  await chat('alex', 'Carry on');
  assert.equal((await calls()).at(-1).resume, firstSession, 'the next turn resumes the reopened session');
  const openedTwice = await api(`/api/members/alex/chats/${archived.data.id}/open`, {});
  assert.equal(openedTwice.status, 404, 'a chat can only be opened once');

  // 3b. Access and effort from the composer reach the CLI (ADR-0114): a member
  //     whose permission level means plan mode can be given edits for one turn.
  const restrictedMember = { ...member('alex'), permissions: { permissionMode: 'restricted' } };
  await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload('alex', 'Plan this'), agent: restrictedMember }) })).text();
  let seen = (await calls()).at(-1).args;
  assert.equal(seen[seen.indexOf('--permission-mode') + 1], 'bypassPermissions', 'full access by default, whatever the permission level (ADR-0120)');
  assert.ok(!seen.includes('--effort'), 'no effort unless chosen');
  await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload('alex', 'Now do it'), agent: restrictedMember, access: 'write', effort: 'high', model: 'opus' }) })).text();
  seen = (await calls()).at(-1).args;
  assert.equal(seen[seen.indexOf('--permission-mode') + 1], 'acceptEdits', 'Access: Accept edits switches plan mode off for this turn');
  assert.equal(seen[seen.indexOf('--effort') + 1], 'high', 'the chosen reasoning effort is passed');
  assert.equal(seen[seen.indexOf('--model') + 1], 'opus', 'the chosen model is passed');
  await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload('alex', 'Default again'), agent: { ...restrictedMember, harness: { ...restrictedMember.harness, effort: 'low', access: 'full' } } }) })).text();
  seen = (await calls()).at(-1).args;
  assert.equal(seen[seen.indexOf('--permission-mode') + 1], 'bypassPermissions', 'the member\'s engine settings apply when the turn chooses nothing');
  assert.equal(seen[seen.indexOf('--effort') + 1], 'low');
  // 3c. Personality and durable memory reach the engine inline (ADR-0115).
  await (await fetch(origin + '/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload('alex', 'What do you remember?'), agent: { ...member('alex'), profileFiles: [{ section: 'persona', fileName: 'PERSONALITY.md', content: 'Dry, direct, no filler.' }, { section: 'memory', fileName: 'MEMORY.md', content: 'The NZ shortlist is built by scripts/nz_shortlist.py.' }] } }) })).text();
  const profiled = (await calls()).at(-1).args;
  const profileText = profiled[profiled.indexOf('--append-system-prompt') + 1] || '';
  assert.ok(profileText.includes('Personality:\nDry, direct, no filler.'), 'PERSONALITY.md content is inline');
  assert.ok(profileText.includes('Durable memory (MEMORY.md):\nThe NZ shortlist is built by scripts/nz_shortlist.py.'), 'MEMORY.md content is inline');
  assert.ok(profileText.includes('Profile map:'), 'and the profile map still points at the files');
  // 3d. Claude Code's own plans folder is always an --add-dir (ADR-0116).
  const plansDir = join(directory, 'claude', 'plans');
  assert.ok(profiled.includes('--add-dir') && profiled[profiled.indexOf('--add-dir') + 1] !== undefined);
  assert.ok(profiled.some((value, index) => profiled[index - 1] === '--add-dir' && value === plansDir), `plans dir is added: ${JSON.stringify(profiled.filter((v, i) => profiled[i - 1] === '--add-dir'))}`);
  assert.ok(await readFile(join(plansDir, '..', 'plans', '.keep')).catch(() => true), 'the folder exists (created by the bridge)');
  const readiness = (await api('/api/harnesses')).data.harnesses.find((h) => h.id === 'claude');
  assert.ok(Array.isArray(readiness.accessModes) && readiness.accessModes.includes('plan'), 'readiness lists access modes');
  assert.ok(Array.isArray(readiness.efforts), 'readiness carries an effort list (the global listing probes the machine\'s own claude, not the member fixture)');

  // 3e. Folder mentions (ADR-0120): the bridge says what a path is, and a
  //     request reaches the notification feed like a vault request.
  const checkedFolders = (await api('/api/folders/check', { paths: ['~/x/y.md', rootDir, '/etc'] })).data.folders;
  assert.equal(checkedFolders[0].folder, join(process.env.HOME, 'x'), 'a file under ~ resolves to its folder');
  assert.equal(checkedFolders[0].allowed, true);
  assert.equal(checkedFolders[1].directory, true); assert.equal(checkedFolders[1].folder, rootDir);
  assert.equal(checkedFolders[2].allowed, false, 'outside the home directory is never allowed');
  const requested = await api('/api/folders/request', { memberId: 'alex', memberName: 'Alex', folder: join(process.env.HOME, 'x'), prompt: 'look at ~/x/y.md' });
  assert.equal(requested.status, 200);
  const feed = await until(async () => { const r = await api('/api/notifications'); const items = r.data?.items || r.data || []; return (Array.isArray(items) ? items : []).find((item) => item.kind === 'folder.request.pending') || null; }, 'folder request in the notification feed');
  assert.ok(feed.title.includes('needs a folder'), feed.title);

  // 4. /api/chat/reset forgets the engine session as well.
  const reset = await api('/api/chat/reset', { agentId: 'alex' });
  assert.equal(reset.data.forgotten, 1); assert.equal(await resumeIdOnDisk(), '');

  // 5. Finished runs survive a restart.
  const before = (await api('/api/runs')).data.filter((run) => run.agentId === 'alex');
  assert.equal(before.length, 7);
  await delay(700); // the history write is debounced
  await stopBridge();
  await startBridge();
  const after = (await api('/api/runs')).data.filter((run) => run.agentId === 'alex');
  assert.deepEqual(after.map((run) => run.id), before.map((run) => run.id), 'the same runs in the same order after a restart');
  assert.ok(after.every((run) => run.status === 'completed' && run.harness === 'claude'));
  assert.equal(after[0].reply, 'Inspected the readme.');
  const activity = await api(`/api/runs/${after.at(-1).id}/activity`);
  assert.equal(activity.status, 200, 'a restored run still answers for its activity');

  // 6. Delete and validation.
  const removed = await api(`/api/members/alex/chats/${listAfterOpen[0].id}`, undefined, 'DELETE');
  assert.equal(removed.data.removed, true);
  assert.equal((await api('/api/members/alex/chats')).data.chats.length, 0);
  assert.equal((await api('/api/members/Bad%20Id!/chats')).status, 400);
  assert.equal((await api('/api/members/alex/chats', { messages: [] })).status, 400);
  console.log('Chat bridge checks passed: chat runs, put away, open, reset, restart, delete.');
} finally {
  await stopBridge();
  await rm(directory, { recursive: true, force: true });
}
