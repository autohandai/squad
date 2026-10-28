import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const artifact = '.codex-artifacts/local-0.1.6/timeout-review';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge();
let browser;
try {
  const member = { ...initialAgents[0], id: 'chat-timing-fixture', name: 'Alex', role: 'Assistant', workspace: process.cwd(), projects: [{ path: process.cwd() }], skills: [] };
  browser = await startBrowser();
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!sessionStorage.getItem('timing.seeded')) {
      localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
      localStorage.setItem('autohandSquad.v1.removedAgents', ${JSON.stringify(JSON.stringify(initialAgents.slice(1).map(agent => agent.id)))});
      localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
      sessionStorage.setItem('timing.seeded','true');
    }
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/warm') return new Response('{"success":true,"data":{}}',{headers:{'content-type':'application/json'}});
      if (path === '/api/chat/stream') {
        const attempt = Number(sessionStorage.getItem('timing.attempt') || 0) + 1;
        sessionStorage.setItem('timing.attempt', String(attempt));
        sessionStorage.setItem('timing.request', options.body);
        const durationMs = attempt === 1 ? 300000 : 5714000;
        const completedAt = new Date().toISOString();
        const startedAt = new Date(Date.now() - durationMs).toISOString();
        const trace = { events: [], raw: { stdout: 'diagnostic '.repeat(60000), stderr: '' } };
        const events = [
          ['start',{startedAt, effectiveModel:{provider:'anthropic',model:''}}],
          ['sdk',{type:'message_delta',delta:'Preparing the plan.',timestamp:completedAt}],
          [attempt === 1 ? 'error' : 'done',{
            startedAt,completedAt,durationMs,trace,
            ...(attempt === 1 ? {error:'Claude Code stopped after 5 min without activity. Retry to continue.'} : {reply:'The plan is complete.'})
          }]
        ];
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({start(controller) {
          for (const [event,data] of events) controller.enqueue(encoder.encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n'));
          controller.close();
        }}),{headers:{'content-type':'text/event-stream'}});
      }
      return original(input,options);
    }
  ` });
  const route = bridge.origin + '/conversations/new?member=' + member.id;
  await browser.navigate(route);
  await until(() => browser.evaluate(`!!document.querySelector('textarea')`), 'chat composer');
  await browser.fill('textarea', 'Write the plan');
  await browser.evaluate(`document.querySelector('textarea').closest('form').requestSubmit()`);
  const readMessages = () => browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.messages') || '{}')[${JSON.stringify(member.id)}] || []`);
  await until(async () => (await readMessages()).some(message => message.status === 'error'), 'large error result saved as terminal');
  const failed = (await readMessages()).find(message => message.status === 'error');
  assert.equal(failed.durationMs, 300000);
  assert.equal(failed.workDetailsLimited, true);
  assert.ok(failed.streamEvents.length, 'Streamed work details survive oversized final diagnostics');
  const row = `[data-message-id="${failed.id}"]`;
  await until(() => browser.evaluate(`document.querySelector(${JSON.stringify(row)})?.textContent.includes('Could not answer')`), 'visible failure');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-live')`), null, 'The failed row is no longer marked live');
  assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(row)}).textContent.includes('5 min')`));
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(row)}).querySelector('.animate-pulse') !== null`), false, 'The working timer dot stops');
  await browser.screenshot(artifact + '/timeout-browser.png');
  console.log('PASS oversized final error shows its cause, Retry and frozen 5 min timing; received work details remain visible.');

  await browser.click('Retry');
  await until(async () => (await readMessages()).some(message => message.body === 'The plan is complete.'), 'controlled retry completes');
  const completed = (await readMessages()).find(message => message.body === 'The plan is complete.');
  assert.equal(completed.status, 'complete');
  assert.equal(completed.durationMs, 5714000);
  assert.ok(await browser.evaluate(`document.querySelector('[data-message-id="${completed.id}"]').textContent.includes('1 hour 35 min')`));
  assert.equal(await browser.evaluate(`document.querySelectorAll('article[aria-live="polite"]').length`), 0);
  await browser.screenshot(artifact + '/duration-browser.png');
  await browser.navigate(route);
  await until(() => browser.evaluate(`document.body.textContent.includes('The plan is complete.') && document.body.textContent.includes('1 hour 35 min')`), 'terminal timing survives reopen');
  assert.ok((await readMessages()).some(message => message.id === failed.id && message.status === 'error'));
  assert.deepEqual(browser.errors, []);
  console.log('PASS controlled retry uses a new reply, preserves the failed reply, formats hours and survives reopening; no provider invoked.');
} finally { await browser?.close(); await bridge.close(); }
