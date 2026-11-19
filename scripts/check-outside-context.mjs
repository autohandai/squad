#!/usr/bin/env node
// A warm member session hears about what its automations posted in the chat
// (ADR-0268). On 20 Nov 2026 an email arrived, Chief of Staff's email
// automation summarised it in the chat from a session of its own, the person
// wrote "reply", and the warm chat session answered "I'm here. What would you
// like to work on?" because it had never seen the summary. Real bridge,
// fixture SDK that records every prompt.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge } from './lib/reliability-browser.mjs';
import { conversationContextMessages } from '../src/lib/chat-sessions.js';

const bridge = await startBridge({ prepare: async directory => {
  const entry = join(directory, 'outside-sdk.mjs');
  await writeFile(entry, `import { appendFileSync } from 'node:fs';
  const file = ${JSON.stringify(join(directory, 'sdk.jsonl'))};
  export class AutohandSDK {
    constructor(options) { this.options = options; }
    async start() { appendFileSync(file, JSON.stringify({ kind: 'launch' }) + '\\n'); }
    async *streamPrompt({ message: prompt }) { appendFileSync(file, JSON.stringify({ kind: 'prompt', prompt }) + '\\n'); yield { type: 'message_end', content: 'Fixture answer.' }; }
    async interrupt() {} async close() {}
  }`);
  return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
} });
const records = async () => { try { return (await readFile(join(bridge.directory, 'sdk.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const prompts = async () => (await records()).filter(row => row.kind === 'prompt').map(row => row.prompt);
try {
  const workspace = process.cwd();
  const agent = { id: 'outside-fixture', name: 'Chief of Staff', role: 'Chief of Staff', skills: [], workspace, projects: [{ path: workspace }], permissions: { permissionMode: 'unrestricted' } };
  const base = { agentId: agent.id, agent, workspace, profile: 'Profile' };
  assert.equal((await bridge.api('/api/agents/provision', 'POST', base)).success, true);

  // What the browser sends, built by the app's own function.
  const chat = [
    { id: 'u1', role: 'user', body: 'hey', status: 'complete' },
    { id: 'a1', role: 'agent', body: 'Fixture answer.', status: 'complete' },
  ];
  let context = conversationContextMessages(chat);
  assert.equal((await bridge.api('/api/chat', 'POST', { ...base, prompt: 'hey', requestId: 'outside-1', conversationContext: [] }, 20000)).success, true);

  chat.push({ id: 'automation-result-run-1', role: 'agent', status: 'complete', source: 'automation', routineId: 'routine-email', routineTitle: 'Emails to charlie@code.autohandai.com',
    body: 'Who wrote it: Igor Costa. What they want: he is testing the email pipeline.' });
  chat.push({ id: 'u2', role: 'user', body: 'reply', status: 'complete' });
  context = conversationContextMessages(chat.slice(0, -1));
  const marked = context.find(row => row.outside);
  assert.ok(marked, 'the app marks an automation message as from outside the session');
  assert.equal(marked.source, 'Emails to charlie@code.autohandai.com');

  assert.equal((await bridge.api('/api/chat', 'POST', { ...base, prompt: 'reply', requestId: 'outside-2', conversationContext: context }, 20000)).success, true);
  const rows = await records();
  assert.equal(rows.filter(row => row.kind === 'launch').length, 1, 'the same warm session answers');
  const second = (await prompts()).at(-1);
  assert.match(second, /<squad_posted_in_this_chat>/, 'the warm session is told what its automation posted');
  assert.match(second, /Igor Costa/); assert.match(second, /Emails to charlie@code\.autohandai\.com/);
  assert.ok(second.indexOf('<squad_posted_in_this_chat>') < second.lastIndexOf('reply'), 'before the person\'s message');

  assert.equal((await bridge.api('/api/chat', 'POST', { ...base, prompt: 'thanks', requestId: 'outside-3', conversationContext: context }, 20000)).success, true);
  assert.doesNotMatch((await prompts()).at(-1), /<squad_posted_in_this_chat>/, 'told once, not every turn');
  console.log('PASS outside context: an automation message posted in the chat reaches the warm session once, before the person\'s next message; the session is not restarted.');
} finally { await bridge.close(); }
