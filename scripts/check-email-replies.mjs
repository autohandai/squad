#!/usr/bin/env node
// Email replies under the member's rules (ADR-0267), through the real team
// tool with stand-ins for the person and for Squad API. Proves: "Reply on its
// own" sends; "Ask me first" sends only after Send; "Just tell me" refuses;
// a declined or unanswered approval sends nothing; a refusal from Squad API
// reaches the member as "Not sent".
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamService } from '../server/team/service.mjs';
import { DEFAULT_EMAIL_POLICY, emailPolicyLines, normalizeEmailPolicy } from '../src/lib/email-policy.js';

assert.deepEqual(normalizeEmailPolicy({}), DEFAULT_EMAIL_POLICY, 'nothing goes out until the person chooses');
assert.deepEqual(normalizeEmailPolicy({ urgent: 'reply', normal: 'nonsense' }), { urgent: 'reply', normal: 'tell', low: 'tell' });
assert.match(emailPolicyLines({ urgent: 'reply' }).join('\n'), /- urgent .*reply to the sender yourself/);

const directory = await mkdtemp(join(tmpdir(), 'squad-email-replies-'));
const id = '11111111-1111-4111-8111-111111111111';
let policy = { urgent: 'reply', normal: 'approve', low: 'tell' };
let answer = { status: 'answered', answer: 'Send' };
const sent = [], asked = [];
let refuse = false;
try {
  const team = createTeamService({ stateDir: directory, rootDir: process.cwd(), bridgeUrl: 'http://127.0.0.1:12345',
    members: async () => [{ id: 'mia', name: 'Mia' }], isBusy: async () => false, deliver: async () => ({ reply: '' }),
    emailPolicyFor: async () => policy,
    askPerson: async (question) => { asked.push(question); return answer; },
    replyEmail: async (input) => { if (refuse) throw new Error('This email already has a reply.'); sent.push(input); return { sent: true, to: 'ana@customer.example', from: 'mia@code.autohandai.com' }; },
  });
  const work = await team.openWork({ memberId: 'mia', runId: 'email-run' });
  const token = work.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN;
  await team.dispatch(token, { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
  let n = 0;
  const reply = (urgency, text = 'Hi Ana, attached. Mia') => team.dispatch(token, { jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: 'squad_reply_email', arguments: { email_id: id, urgency, text } } });

  let result = await reply('urgent');
  assert.equal(result.structuredContent?.status, 'sent', JSON.stringify(result));
  assert.equal(asked.length, 0, '"Reply on its own" does not ask');
  assert.deepEqual(sent.at(-1), { memberId: 'mia', emailId: id, text: 'Hi Ana, attached. Mia' });

  result = await reply('normal');
  assert.equal(result.structuredContent?.status, 'sent');
  assert.equal(asked.length, 1, '"Ask me first" asks');
  assert.match(asked[0].question, /Send this normal email reply\?/); assert.deepEqual(asked[0].options, ['Send', "Don't send"]);

  answer = { status: 'answered', answer: "Don't send" };
  const before = sent.length;
  result = await reply('normal');
  assert.equal(result.structuredContent?.status, 'not_sent'); assert.equal(sent.length, before, 'declined: nothing sent');
  answer = { status: 'timeout', reason: 'no answer' };
  result = await reply('normal');
  assert.equal(result.structuredContent?.status, 'not_sent'); assert.equal(sent.length, before, 'unanswered: nothing sent');

  result = await reply('low');
  assert.equal(result.isError, true); assert.match(result.content[0].text, /Just tell me/); assert.equal(sent.length, before, '"Just tell me" refuses');

  refuse = true;
  result = await reply('urgent');
  assert.equal(result.isError, true); assert.match(result.content[0].text, /Not sent: This email already has a reply/);

  policy = {};
  answer = { status: 'answered', answer: 'Send' };
  asked.length = 0; refuse = false;
  await reply('urgent');
  assert.equal(asked.length, 1, 'with no rules set, an urgent reply is asked first');
  assert.equal((await reply('normal')).isError, true, 'with no rules set, a normal email only tells');
  console.log('check-email-replies: ok');
} finally { await rm(directory, { recursive: true, force: true }); }
