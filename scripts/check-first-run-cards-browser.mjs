#!/usr/bin/env node
// The two chat cards ADR-0161 adds, rendered by the real chat component from
// fixture messages, no model: a permission request under a running reply
// (answered from the card, posted to /api/chat/permission) and a proposed
// team under a finished reply (Create team / Not now). Screenshots at desktop
// and phone widths land in .codex-artifacts/first-run-cards/.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const artifact = '.codex-artifacts/first-run-cards';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge();
let browser;
try {
  const member = { ...initialAgents[0], id: 'first-run-cards-fixture', name: 'Chief of Staff', role: 'Chief of Staff', workspace: bridge.directory, projects: [{ path: bridge.directory }] };
  const start = '2026-11-02T05:00:00.000Z';
  const running = [
    { type: 'status', status: 'agent_start', timestamp: start },
    { type: 'tool_start', tool: { id: 'w1', name: 'write_file', args: { path: 'docs/plan.md' } }, timestamp: start },
    { type: 'permission_request', requestId: 'perm-fixture-1', tool: 'write_file', title: 'Write to this file? docs/plan.md', description: 'Write to this file? docs/plan.md', context: { path: 'docs/plan.md' }, options: ['allow_once', 'deny_once'], timestamp: start },
  ];
  const proposal = { kind: 'member', name: 'Pie shop site', objective: 'Build the pie shop website.', leadKey: 'frontend-developer-1', channel: { name: 'pie-shop-site', section: 'Teams' }, routines: [], members: [
    { key: 'frontend-developer-1', name: 'Frontend Developer', role: 'Frontend Developer', purpose: 'Builds the pages.', skills: [], instructions: '', templateId: '', selected: true },
    { key: 'qa-engineer-2', name: 'QA Engineer', role: 'QA Engineer', purpose: 'Tests every page on phone and desktop.', skills: [], instructions: '', templateId: '', selected: true },
  ] };
  const messages = [
    { id: 'ask-user', role: 'user', body: 'Write the plan and propose a team.', status: 'complete' },
    { id: 'proposal-answer', role: 'agent', body: 'Here is the team I suggest.', status: 'complete', startedAt: start, completedAt: start, durationMs: 1200, streamEvents: [], teamProposal: { id: 'team-action-1', type: 'team', status: 'proposed', proposal, message: 'Chief of Staff proposes the Pie shop site team.' } },
  ];
  // The running reply comes from a fake /api/chat/stream: the real client
  // path renders the card from the stream, then the fake engine finishes
  // once the decision has been posted, like the bridge does.
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  browser = await startBrowser();
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('autohandSquad.v1.agents', ${JSON.stringify(JSON.stringify([member]))});
    localStorage.setItem('autohandSquad.v1.removedAgents', ${JSON.stringify(JSON.stringify(initialAgents.filter(a => a.id !== member.id).map(a => a.id)))});
    localStorage.setItem('autohandSquad.v1.onboarding', '{"version":1,"status":"skipped"}');
    localStorage.setItem('autohandSquad.v1.messages', ${JSON.stringify(JSON.stringify({ [member.id]: messages }))});
    window.permissionPosts = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/warm') return Promise.resolve(new Response('{"success":true,"data":{}}', { headers: { 'content-type': 'application/json' } }));
      if (path === '/api/chat/permission') {
        window.permissionPosts.push(JSON.parse(options.body));
        window.releaseStream?.();
        return Promise.resolve(new Response('{"success":true,"data":{"decision":"allow_once"}}', { headers: { 'content-type': 'application/json' } }));
      }
      if (path === '/api/chat/stream') {
        const encoder = new TextEncoder();
        const body = new ReadableStream({ start(controller) {
          controller.enqueue(encoder.encode(${JSON.stringify(frame('start', { startedAt: start, workspace: bridge.directory }))}));
          for (const event of ${JSON.stringify(running)}) controller.enqueue(encoder.encode('event: sdk\\ndata: ' + JSON.stringify(event) + '\\n\\n'));
          window.releaseStream = () => {
            controller.enqueue(encoder.encode(${JSON.stringify(frame('sdk', { type: 'permission_resolved', requestId: 'perm-fixture-1', tool: 'write_file', decision: 'allow_once', source: 'person', timestamp: start }))}));
            controller.enqueue(encoder.encode(${JSON.stringify(frame('sdk', { type: 'message_end', content: 'Wrote docs/plan.md.', timestamp: start }))}));
            controller.enqueue(encoder.encode(${JSON.stringify(frame('done', { reply: 'Wrote docs/plan.md.', workspace: bridge.directory, transport: 'sdk', startedAt: start, completedAt: start, durationMs: 3000, trace: { events: [], toolCalls: [] } }))}));
            controller.close();
          };
        } });
        return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
      }
      return originalFetch(input, options);
    };
  ` });
  await browser.navigate(bridge.origin + '/conversations/new?member=' + member.id);
  await until(() => browser.evaluate("!!document.querySelector('main textarea') && !document.getElementById('boot')"), 'conversation');
  await browser.fill('main textarea', 'Create docs/plan.md with the build plan.');
  await new Promise(resolve => setTimeout(resolve, 300));
  await browser.click('Send chat message');
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=\"permission-request\"]')"), 'permission card rendered');
  const card = await browser.evaluate("document.querySelector('[data-testid=\"permission-approval\"]').textContent");
  assert.match(card, /Chief of Staff asks: Write to this file\? docs\/plan\.md/);
  for (const label of ['Allow once', 'Allow for this reply', 'Deny']) assert.ok(card.includes(label), `${label} is offered`);
  assert.ok(card.includes('Permissions'), 'the card says where lasting changes live');
  await browser.screenshot(artifact + '/permission-desktop.png');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await browser.screenshot(artifact + '/permission-phone.png');
  const phoneHeader = await browser.evaluate("(() => { const h = document.querySelector('main header') || document.querySelector('header'); const r = [...h.querySelectorAll('button')].map(b => b.getBoundingClientRect()); const name = h.querySelector('span.truncate'); return { overflow: r.some(b => b.right > window.innerWidth + 1), nameWidth: name ? name.getBoundingClientRect().width : 0 }; })()");
  assert.equal(phoneHeader.overflow, false, 'no header control runs off a phone screen');
  assert.ok(phoneHeader.nameWidth > 90, `the member's name keeps room on a phone (${phoneHeader.nameWidth}px)`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.click('Allow once');
  await until(() => browser.evaluate("!document.querySelector('[data-testid=\"permission-request\"]')"), 'card leaves once answered');
  assert.deepEqual(await browser.evaluate('window.permissionPosts'), [{ requestId: 'perm-fixture-1', decision: 'allow_once' }], 'the decision is posted once with the request id');
  await until(() => browser.evaluate("document.querySelector('main').textContent.includes('Wrote docs/plan.md.')"), 'the reply finishes after the decision');
  await browser.evaluate("document.querySelector('[data-message-id] details summary')?.click()");
  const work = await browser.evaluate("[...document.querySelectorAll('main article')].map(a => a.textContent).join('\\n')");
  assert.ok(/allowed/i.test(work), `Work details records the decision: ${work.slice(-300)}`);

  const team = await browser.evaluate("document.querySelector('[data-testid=\"team-proposal\"]').textContent");
  assert.match(team, /Chief of Staff proposes a team: Pie shop site/);
  assert.ok(team.includes('Frontend Developer') && team.includes('QA Engineer') && team.includes('leads'), 'the roster and lead render');
  assert.ok(team.includes('Create team · 2 members'), 'Create team names the count');
  assert.ok(!(await browser.evaluate("document.querySelector('[data-message-id=proposal-answer]').textContent")).includes('proposes the Pie shop site team.'), 'the receipt line does not repeat in the reply body');
  await browser.screenshot(artifact + '/team-proposal-desktop.png');
  await browser.evaluate("[...document.querySelectorAll('[data-testid=\"team-proposal\"] button')].find(b => b.textContent === 'Not now').click()");
  await until(() => browser.evaluate("document.querySelector('[data-testid=\"team-proposal\"]').textContent.includes('Not created.')"), 'Not now keeps the roster and says so');
  assert.deepEqual(browser.errors, []);
  console.log('PASS permission and team proposal cards render from the real chat component and answer through the bridge routes');
} finally { await browser?.close(); await bridge.close(); }
