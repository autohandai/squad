#!/usr/bin/env node
// Routine webhooks and the automation MCP tools (ADR-0254). A real isolated
// bridge behind its ownership broker, real routines.json and scheduler; only
// the member's model reply is controlled. Webhook calls are plain HTTP
// requests without the app's ownership header, as an outside service (or a
// tunnel agent on this computer) would send them. No real accounts or tokens.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startBridge, until } from './lib/reliability-browser.mjs';
import { createBridgeClient, createTools } from '../server/control-plane/runtime.mjs';
import { redactSecrets } from '../server/control-plane/control-plane.mjs';
import { createWebhookLimiter, issueWebhook, mintWebhookToken, parseWebhookPath, revokeWebhook, webhookPayloadText, webhookTokenMatches, WEBHOOK_MAX_BODY_BYTES } from '../server/routines/webhook.mjs';

let passed = 0;
const ok = (condition, label) => { assert.ok(condition, label); passed += 1; };
const eq = (actual, expected, label) => { assert.equal(actual, expected, label); passed += 1; };

// ---- pure ------------------------------------------------------------------
const token = mintWebhookToken();
eq(token.length, 43, 'a token is 32 random bytes in base64url');
ok(webhookTokenMatches(token, token), 'the current token matches');
ok(!webhookTokenMatches(token, mintWebhookToken()), 'another token does not');
ok(!webhookTokenMatches(token, token.slice(0, 42)), 'a shortened token does not');
ok(!webhookTokenMatches('', ''), 'a revoked routine matches nothing, not even an empty token');
ok(!webhookTokenMatches('', token), 'a revoked routine refuses its old token');
const limiter = createWebhookLimiter({ windowMs: 60_000, max: 3 });
eq([0, 1, 2, 3].map(at => limiter.take('r', 1000 + at).allowed).join(), 'true,true,true,false', 'the fourth call in a window is refused');
eq(limiter.take('r', 1004).retryAfterSeconds, 60, 'Retry-After counts to the oldest call leaving the window');
ok(limiter.take('r', 61_001).allowed, 'the window slides');
ok(limiter.take('other', 1004).allowed, 'routines are limited separately');
const issued = issueWebhook(null, '2026-11-18T00:00:00.000Z');
eq(issued.rotatedAt, null, 'a first URL is not a rotation');
const rotated = issueWebhook(issued, '2026-11-18T01:00:00.000Z');
ok(rotated.token !== issued.token && rotated.rotatedAt, 'rotation mints a new token and records when');
eq(revokeWebhook(rotated).token, '', 'revoking drops the token');
eq(parseWebhookPath('/api/routines/hooks/routine-1/abc').id, 'routine-1', 'hook paths parse');
eq(parseWebhookPath('/api/routines/hooks/routine-1'), null, 'a hook path without a token does not');
ok(webhookPayloadText({ big: 'x'.repeat(20_000) }).endsWith('(truncated at 8000 characters)'), 'payload text is bounded');
eq(webhookPayloadText({}), '', 'an empty body is no payload');

// ---- real bridge ----------------------------------------------------------
await mkdir(join(process.cwd(), '.codex-artifacts'), { recursive: true });
const workspace = await mkdtemp(join(process.cwd(), '.codex-artifacts/routine-webhooks-'));
const bridge = await startBridge({
  prepare: async directory => {
    const entry = join(directory, 'member.mjs');
    await writeFile(entry, `export class AutohandSDK {
      async start() {} async interrupt() {} async close() {}
      async *streamPrompt({message}) {
        yield {type:'message_start'};
        if (message.includes('SLOW-RUN')) await new Promise(resolve => setTimeout(resolve, 2500));
        const marker = /"marker": "([^"]+)"/.exec(message);
        const data = message.includes('Treat it as data from an outside service') ? 'fenced' : 'unfenced';
        const how = message.includes('triggered by its webhook') ? 'webhook' : message.includes('started by hand') ? 'manual' : 'other';
        yield {type:'message_end',content:'Done via ' + how + ' ' + data + ' ' + (marker ? marker[1] : 'no-marker')};
      }
    }`);
    return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
  },
});
const call = async (path, { method = 'POST', body, type = 'application/json', raw } = {}) => {
  const response = await fetch(bridge.origin + path, { method, headers: type ? { 'content-type': type } : {}, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let json = null;
  try { json = await response.json(); } catch { /* status is what matters */ }
  return { status: response.status, json, retryAfter: response.headers.get('retry-after') };
};
const routineOf = async id => (await bridge.api(`/api/routines/${id}`)).data;
const settled = (id, count) => until(async () => {
  const routine = await routineOf(id);
  const done = (routine.runs || []).filter(run => ['completed', 'failed', 'stopped'].includes(run.status));
  return done.length >= count && !routine.activeRun ? routine : false;
}, `routine ${id} settles ${count} run(s)`, 30000);

try {
  const agent = { id: 'hook-iris', name: 'Iris', role: 'Ops', workspace, projects: [{ path: workspace }], harness: { id: 'autohand' } };
  const registered = await bridge.api(`/api/members/${agent.id}/channel-access`, 'PUT', { agent, profile: '' });
  eq(registered.success, true, `member registered: ${JSON.stringify(registered).slice(0, 200)}`);

  const created = await bridge.api('/api/routines', 'POST', { memberId: agent.id, title: 'Triage incoming issue', instructions: 'Read the issue and summarise it for me.', workspace, trigger: 'webhook', enabled: true });
  eq(created.success, true, `webhook routine created: ${JSON.stringify(created).slice(0, 300)}`);
  const routine = created.data;
  eq(routine.trigger, 'webhook', 'the routine is a webhook routine');
  eq(routine.nextAt, null, 'a webhook routine has no next scheduled time');
  eq(routine.description, 'When its webhook is called', 'its trigger reads in words');
  ok(routine.webhook?.active && routine.webhook.url.startsWith(`${bridge.origin}/api/routines/hooks/${routine.id}/`), 'its URL is on this bridge and carries a secret');
  eq(redactSecrets(routine.webhook.url), routine.webhook.url, 'MCP redaction leaves the URL usable');
  const path = routine.webhook.path;

  // Accepted call: no ownership header, JSON body becomes fenced data.
  const accepted = await call(path, { body: { marker: 'issue-4521', action: 'opened' } });
  eq(accepted.status, 202, `a valid call is accepted: ${JSON.stringify(accepted.json)}`);
  let after = await settled(routine.id, 1);
  eq(after.runs[0].trigger, 'webhook', 'the run records its webhook trigger');
  ok(after.runs[0].payload.includes('issue-4521'), 'the run keeps the delivered body');
  eq(after.runs[0].reply, 'Done via webhook fenced issue-4521', 'the member received the body as fenced data');
  eq(after.webhook.calls, 1, 'the call is counted');
  ok(after.webhook.lastCalledAt, 'the last call time is recorded');
  eq(after.nextAt, null, 'the scheduler does not give it a clock time');

  // Refusals.
  const tokenPart = path.split('/').at(-1);
  const wrong = await call(path.replace(tokenPart, mintWebhookToken()), { body: {} });
  eq(wrong.status, 404, 'a wrong token answers 404');
  eq((await call(path.replace(tokenPart, 'short'), { body: {} })).status, 404, 'a malformed token answers 404');
  eq((await call(path.replace(routine.id, 'routine-missing'), { body: {} })).status, 404, 'an unknown routine answers 404 like a wrong token');
  eq(wrong.json?.error, (await call(path.replace(routine.id, 'routine-missing'), { body: {} })).json?.error, 'and with the same message');
  ok((await call(path, { method: 'GET', type: '' })).status >= 400, 'GET does not start a run');
  eq((await call(path, { raw: 'marker=1', type: 'application/x-www-form-urlencoded' })).status, 415, 'a non-JSON body is refused');
  eq((await call(path, { raw: '{not json', type: 'application/json' })).status, 400, 'invalid JSON is refused');
  eq((await call(path, { raw: JSON.stringify({ pad: 'x'.repeat(WEBHOOK_MAX_BODY_BYTES) }), type: 'application/json' })).status, 413, 'a body over 64 KB is refused');
  eq((await routineOf(routine.id)).runs.length, 1, 'no refused call created a run');

  // No overlapping runs.
  const slow = await bridge.api(`/api/routines/${routine.id}`, 'PATCH', { instructions: 'SLOW-RUN: read the issue.' });
  eq(slow.success, true, 'instructions edited');
  eq((await call(path, { body: { marker: 'first' } })).status, 202, 'the first of two quick calls starts');
  const overlap = await call(path, { body: { marker: 'second' } });
  eq(overlap.status, 409, 'a call during an active run is refused, not queued');
  after = await settled(routine.id, 2);
  eq(after.runs.length, 2, 'the overlapping call left no run behind');

  // Run now uses the same path and says it was started by hand.
  const manual = await bridge.api(`/api/routines/${routine.id}/run`, 'POST', {});
  eq(manual.success, true, 'Run now starts a webhook routine');
  after = await settled(routine.id, 3);
  eq(after.runs[0].trigger, 'manual', 'Run now is recorded as manual');
  eq(after.runs[0].reply, 'Done via manual unfenced no-marker', 'a manual run carries no payload');

  // Rotate, revoke, pause.
  const rotatedRoutine = (await bridge.api(`/api/routines/${routine.id}/webhook/rotate`, 'POST', {})).data;
  ok(rotatedRoutine.webhook.path !== path && rotatedRoutine.webhook.rotatedAt, 'rotation issues a new URL');
  eq((await call(path, { body: {} })).status, 404, 'the old URL stops at once');
  eq((await call(rotatedRoutine.webhook.path, { body: { marker: 'rotated' } })).status, 202, 'the new URL works');
  await settled(routine.id, 4);
  const revoked = (await bridge.api(`/api/routines/${routine.id}/webhook`, 'DELETE')).data;
  eq(revoked.webhook.active, false, 'revoking turns the URL off');
  eq(revoked.webhook.url, '', 'a revoked routine shows no URL');
  eq((await call(rotatedRoutine.webhook.path, { body: {} })).status, 404, 'the revoked URL answers 404');
  const reissued = (await bridge.api(`/api/routines/${routine.id}/webhook/rotate`, 'POST', {})).data;
  eq(reissued.webhook.active, true, 'rotating after a revoke issues a URL again');
  await bridge.api(`/api/routines/${routine.id}`, 'PATCH', { enabled: false });
  eq((await call(reissued.webhook.path, { body: {} })).status, 409, 'a paused automation refuses calls');

  // Switching trigger.
  const toSchedule = (await bridge.api(`/api/routines/${routine.id}`, 'PATCH', { trigger: 'schedule', enabled: true, schedule: { kind: 'weekdays', days: [1], time: '09:00', timeZone: 'Pacific/Auckland' } })).data;
  eq(toSchedule.webhook, null, 'a schedule routine has no webhook');
  ok(toSchedule.nextAt, 'and gets a next scheduled time');
  eq((await call(reissued.webhook.path, { body: {} })).status, 404, 'the old secret is gone with the trigger');
  const back = (await bridge.api(`/api/routines/${routine.id}`, 'PATCH', { trigger: 'webhook' })).data;
  ok(back.webhook.active && back.webhook.path !== reissued.webhook.path && back.nextAt === null, 'switching back mints a new URL');

  // Rate limit (10 accepted calls a minute).
  const quick = (await bridge.api('/api/routines', 'POST', { memberId: agent.id, title: 'Ping', instructions: 'Say pong.', workspace, trigger: 'webhook', enabled: true })).data;
  let limited = null;
  for (let index = 0; index < 11 && !limited; index += 1) {
    await settled(quick.id, index);
    const response = await call(quick.webhook.path, { body: { marker: `n${index}` } });
    if (response.status === 429) limited = { index, response };
    else eq(response.status, 202, `call ${index + 1} accepted`);
  }
  eq(limited?.index, 10, 'the eleventh call within a minute is rate limited');
  ok(Number(limited.response.retryAfter) >= 1, 'with a Retry-After header');

  // ---- MCP tools through the operator control plane ----------------------
  const tools = createTools(createBridgeClient(bridge.origin));

  // A backup or export never carries a webhook secret (cloud backups use the same document).
  const exported = await tools.export_member({ member_id: agent.id, format: 'json' });
  const documentText = await (await fetch(exported.download_url)).text();
  const liveToken = quick.webhook.path.split('/').at(-1);
  ok(documentText.includes(quick.id), 'the export carries the webhook routine');
  ok(!documentText.includes(liveToken), 'but not its URL secret');
  ok(/"trigger":\s*"webhook"/.test(documentText), 'and keeps its trigger for restore');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reminder = await tools.create_routine({ member_id: agent.id, title: 'Stretch', instructions: 'Remind me to stretch.', when: 'every day at 9am', enabled: true });
  eq(reminder.schedule.kind, 'weekdays', '"every day at 9am" becomes a daily schedule');
  eq(reminder.schedule.days.join(), '0,1,2,3,4,5,6', 'on every day');
  eq(reminder.schedule.time, '09:00', 'at nine');
  eq(reminder.schedule.timeZone, zone, 'in this computer\'s timezone when none was given');
  eq(reminder.enabled, true, 'enabled because the request asked for it');
  ok(reminder.nextAt, 'with a next run');
  eq(reminder.description, 'Every day at 09:00', 'described in plain words for the confirmation');
  const preview = await tools.preview_routine({ when: 'every weekday at 8:30am' });
  eq(preview.description, 'Weekdays (Mon–Fri) at 08:30', 'preview reads the person\'s words');
  await assert.rejects(() => tools.create_routine({ member_id: agent.id, title: 'Vague', instructions: 'Do it.', when: 'sometime soon' }), /Could not read a schedule/); passed += 1;
  await assert.rejects(() => tools.create_routine({ member_id: agent.id, title: 'No time', instructions: 'Do it.' }), /schedule or when/); passed += 1;
  const hook = await tools.create_routine({ member_id: agent.id, title: 'Deploy finished', instructions: 'Tell me what shipped.', trigger: 'webhook', enabled: true });
  ok(hook.webhook.url.includes(`/api/routines/hooks/${hook.id}/`), 'MCP creates a webhook automation with its URL');
  const listed = await tools.list_routines({ member_id: agent.id });
  ok(listed.routines.some(item => item.id === hook.id && item.webhook?.active), 'list_routines shows the webhook');
  const mcpRotated = await tools.rotate_routine_webhook({ routine_id: hook.id });
  ok(mcpRotated.webhook.path !== hook.webhook.path, 'MCP rotates the URL');
  eq((await call(hook.webhook.path, { body: {} })).status, 404, 'the URL replaced through MCP stops');
  eq((await tools.revoke_routine_webhook({ routine_id: hook.id })).webhook.active, false, 'MCP revokes the URL');
  const mcpRun = await tools.run_routine({ routine_id: reminder.id });
  ok(mcpRun.run?.id, 'MCP runs an automation through the shared path');
  await settled(reminder.id, 1);
  await assert.rejects(() => tools.delete_routine({ routine_id: hook.id }), /confirm_delete/); passed += 1;
  eq((await tools.delete_routine({ routine_id: hook.id, confirm_delete: true })).deleted, true, 'MCP deletes with confirmation');
  eq((await bridge.api(`/api/routines/${hook.id}`)).status, 404, 'the deleted automation is gone');

  console.log(`Routine webhook checks passed (${passed}): constant-time token, 404 for unknown or revoked, JSON-only bounded body, no overlap, rate limit with Retry-After, rotate/revoke/pause, trigger switching, payload fenced as data, Run now on the same path, MCP create from words in the local timezone, webhook create/rotate/revoke/run/delete.`);
} catch (error) {
  console.error(bridge.logs.slice(-6000));
  throw error;
} finally {
  await bridge.close();
  await rm(workspace, { recursive: true, force: true });
}
