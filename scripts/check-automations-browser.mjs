#!/usr/bin/env node
// The redesigned Automations editor and the Execution panel's Automations
// tab (ADR-0254), rendered against a real isolated bridge, in light and dark.
// Only the member's model reply is controlled. Proves: the empty tab offers
// New automation; plain words draft a readable preview; Edit details turns
// the same rows into controls; Create saves a bridge routine; a webhook
// automation shows its URL after Save and that URL starts a run; Run now in
// the tab starts the routine through the bridge and switches to Runs.
// Screenshots land in .codex-artifacts/automations/.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';
import { initialAgents } from '../src/data.js';

const shots = join(process.cwd(), '.codex-artifacts/automations');
await mkdir(shots, { recursive: true });

for (const theme of ['light', 'dark']) {
  const workspace = await mkdtemp(join(process.cwd(), `.codex-artifacts/automations-${theme}-`));
  const bridge = await startBridge({
    prepare: async directory => {
      const entry = join(directory, 'member.mjs');
      const action = { type: 'schedule', title: 'Morning signups summary', instructions: 'Pull yesterday\'s signups and post a three-line summary here.', schedule: { kind: 'weekdays', days: [1, 2, 3, 4, 5], time: '09:00' }, timezone: 'Pacific/Auckland' };
      await writeFile(entry, `export class AutohandSDK {
        async start() {} async interrupt() {} async close() {}
        async *streamPrompt({message}) {
          yield {type:'message_start'};
          yield {type:'message_end',content:/Draft an automation:/.test(message) ? ${JSON.stringify(`SQUAD_ACTION: ${JSON.stringify(action)}`)} : 'Here is the summary you asked for.'};
        }
      }`);
      return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory };
    },
  });
  let browser;
  try {
    const member = { id: `auto-eva-${theme}`, name: 'Eva', role: 'Growth analyst', workspace, projects: [{ path: workspace }], harness: { id: 'autohand' }, status: 'online', memory: [], skills: [], stats: {}, permissions: {}, modelAssignment: { mode: 'inherit' }, avatar: '/avatars/birds/kiwi.webp' };
    browser = await startBrowser();
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    const fixtures = { removedAgents: initialAgents.map(agent => agent.id), automations: [], tasks: [], channels: [], channelMessages: {}, channelThreads: {}, onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' }, sidebarCollapsed: false };
    await seedOwnedBrowserFixture(bridge, browser, { members: [member], messages: {}, storage: Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [`autohandSquad.v1.${key}`, JSON.stringify(value)])) });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('autohandSquad.v1.theme',${JSON.stringify(JSON.stringify({ mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' }))});` });
    const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
    const exists = selector => browser.evaluate(`!!${q(selector)}`);
    const text = selector => browser.evaluate(`${q(selector)}?.innerText || ''`);
    const press = selector => browser.evaluate(`(() => { const element = ${q(selector)}; if (!element) throw new Error('Missing ' + ${JSON.stringify(selector)}); element.click(); })()`);
    // Dialogs and sheets fade in; a screenshot waits for the motion to end.
    const settle = () => new Promise(resolve => setTimeout(resolve, 450));
    const shoot = async name => { await settle(); await browser.screenshot(join(shots, `${name}-${theme}.png`)); };
    const pressText = (scope, label) => browser.evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} label`)})].find(item => item.innerText.trim().startsWith(${JSON.stringify(label)})); if (!element) throw new Error('Missing ' + ${JSON.stringify(label)}); element.click(); })()`);

    await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}&panel=automations`);
    await until(() => exists('[data-testid="execution-automations-empty"]'), `${theme}: empty Automations tab`, 30000);
    const empty = await text('[data-testid="execution-automations-empty"]');
    assert.match(empty, /Nothing runs on its own for Eva yet/);
    assert.match(empty, /remind me every weekday at 9am/);
    await shoot('execution-empty');

    // New automation from plain words.
    await press('[data-testid="execution-new-automation"]');
    await until(() => exists('[data-testid="automation-dialog"] #automation-plain-english'), `${theme}: dialog opens on the question`);
    assert.equal(await browser.evaluate(`document.activeElement?.id`), 'automation-plain-english', 'the question has focus');
    assert.equal(await exists('[data-testid="automation-fields"]'), false, 'no form before drafting or choosing to fill in');
    await shoot('dialog-question');
    await browser.fill('#automation-plain-english', 'Every weekday at 9am, pull yesterday\'s signups and post a three-line summary here.');
    await press('[data-testid="automation-draft-button"]');
    await until(() => browser.evaluate(`(${q('[data-testid="automation-draft-when"]')}?.innerText || '').includes('Weekdays (Mon–Fri) at 09:00')`), `${theme}: draft reads back in words`, 30000);
    const preview = await text('[data-testid="automation-draft"]');
    assert.match(preview, /Morning signups summary/);
    assert.match(preview, /Pacific\/Auckland/);
    assert.match(preview, /Runs as\s+Eva/);
    assert.match(preview, /Next: /);
    await until(() => browser.evaluate(`(${q('[data-testid="automation-draft-when"]')}?.innerText || '').includes('Next:')`), 'next run shown');
    await shoot('dialog-draft');
    await press('[data-testid="automation-draft-edit"]');
    await until(() => exists('[data-testid="automation-fields"] #automation-name'), `${theme}: Edit details shows the same rows as controls`);
    assert.equal(await browser.evaluate(`${q('#automation-name')}.value`), 'Morning signups summary');
    await shoot('dialog-edit');
    await press('[data-testid="automation-save"]');
    await until(() => browser.evaluate(`!${q('[data-testid="automation-dialog"]')}`), `${theme}: Create closes the dialog`);
    const scheduled = await until(async () => (await bridge.api(`/api/routines?memberId=${member.id}`)).data.routines.find(item => item.title === 'Morning signups summary'), 'scheduled routine saved on the bridge');
    assert.equal(scheduled.trigger, 'schedule');
    assert.equal(scheduled.schedule.timeZone, 'Pacific/Auckland');

    // A webhook automation by hand.
    await until(() => exists('[data-testid="execution-automations"] [data-testid="execution-new-automation"]'), 'header New automation');
    await press('[data-testid="execution-automations"] [data-testid="execution-new-automation"]');
    await until(() => exists('[data-testid="automation-manual"]'), 'set it up yourself link');
    await press('[data-testid="automation-manual"]');
    await until(() => exists('#automation-name'), 'manual rows');
    await browser.fill('#automation-name', 'Triage new issue');
    await browser.fill('#automation-description', 'Read the issue in the payload and tell me whether it needs me today.');
    await press('[data-testid="automation-trigger"] button[value="webhook"]');
    await until(() => exists('[data-testid="automation-webhook-pending"]'), 'webhook explains its URL before saving');
    await shoot('dialog-webhook-new');
    await press('[data-testid="automation-save"]');
    await until(() => exists('[data-testid="automation-webhook-url"]'), `${theme}: the dialog stays open with the URL`, 20000);
    const url = await text('[data-testid="automation-webhook-url"]');
    assert.ok(url.startsWith(`${bridge.origin}/api/routines/hooks/`), url);
    assert.match(await text('[data-testid="automation-webhook-curl"]'), /curl -X POST/);
    await shoot('dialog-webhook-ready');
    const call = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issue: 4521 }) });
    assert.equal(call.status, 202, 'the URL shown starts a run');
    await pressText('[data-testid="automation-dialog"]', 'Done');
    await until(() => browser.evaluate(`!${q('[data-testid="automation-dialog"]')}`), 'Done closes');

    // Rows and Run now.
    await until(() => browser.evaluate(`document.querySelectorAll('[data-testid="execution-automation-row"]').length === 2`), `${theme}: two rows`, 20000);
    const rows = await text('[data-testid="execution-automations"]');
    assert.match(rows, /When its webhook is called/);
    assert.match(rows, /Weekdays \(Mon–Fri\) at 09:00/);
    await until(async () => (await bridge.api(`/api/routines?memberId=${member.id}`)).data.routines.every(item => !item.activeRun), 'webhook run settles');
    await shoot('execution-list');
    await browser.evaluate(`(() => { const row = [...document.querySelectorAll('[data-testid="execution-automation-row"]')].find(item => item.innerText.includes('Morning signups summary')); [...row.querySelectorAll('button')].find(item => item.innerText.includes('Run now')).click(); })()`);
    await until(() => browser.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(tab => tab.getAttribute('aria-selected') === 'true')?.innerText === 'Runs'`), `${theme}: Run now shows Runs`);
    const ran = await until(async () => {
      const routine = (await bridge.api(`/api/routines/${scheduled.id}`)).data;
      return routine.runs.find(run => run.trigger === 'manual' && run.status === 'completed') ? routine : false;
    }, 'Run now completes through the bridge routine', 30000);
    assert.equal(ran.runs[0].reply, 'Here is the summary you asked for.');
    await until(() => browser.evaluate(`document.querySelector('[data-testid="execution-panel"]').innerText.includes('Here is the summary') || document.querySelector('[data-testid="execution-panel"]').innerText.includes('Morning signups summary')`), 'the run is visible in Runs', 20000);
    await shoot('execution-runs');

    // Editing an existing webhook automation from its row shows the live URL.
    await pressText('[role="tablist"]', 'Automations');
    await until(() => exists('[data-testid="execution-automation-row"]'), 'back on Automations');
    await browser.evaluate(`[...document.querySelectorAll('[data-testid="execution-automation-row"] button')].find(item => item.innerText.trim() === 'Triage new issue').click()`);
    await until(() => exists('[data-testid="automation-fields"] [data-testid="automation-webhook-url"]'), `${theme}: edit shows the saved URL`, 20000);
    assert.equal(await text('[data-testid="automation-webhook-url"]'), url);
    await shoot('dialog-webhook-edit');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'no horizontal scroll');
    assert.deepEqual(browser.errors, []);
    console.log(`${theme}: automations editor and Execution tab passed`);
  } catch (error) {
    if (browser) {
      console.error(JSON.stringify({ errors: browser.errors, page: await browser.evaluate('document.body.innerText').catch(() => null) }).slice(0, 6000));
      await browser.screenshot(join(shots, `failure-${theme}.png`)).catch(() => {});
    }
    console.error(bridge.logs.slice(-4000));
    throw error;
  } finally {
    await browser?.close();
    await bridge.close();
    await rm(workspace, { recursive: true, force: true });
  }
}
console.log('Automations browser check passed in light and dark: empty tab with New automation, plain-words draft preview, Edit details, Create, webhook URL after Save that starts a run, Run now through the bridge into Runs, and the saved URL in Edit.');
