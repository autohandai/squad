import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const bridge = await startBridge({ development: false, prepare: prepareModelRoutingFixture });
let browser;
try {
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members: [{ id: 'existing', name: 'Existing', role: 'Reviewer', harness: { id: 'codex' }, projects: [{ path: process.cwd() }] }] });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original = window.fetch.bind(window);
    window.creationRequests = [];
    window.fetch = (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/harnesses') return Promise.resolve(new Response(JSON.stringify({ success: true, data: { harnesses: [
        { id: 'autohand', label: 'Autohand Code', isDefault: true, status: 'setup-required' },
        { id: 'codex', label: 'Codex', status: 'ready', defaults: { model: 'codex-default', effort: 'high' } }
      ] } }), { headers: { 'content-type': 'application/json' } }));
      if (path === '/api/agents/provision' && options?.method === 'POST') {
        window.creationRequests.push(JSON.parse(options.body));
        return Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Controlled preparation refusal; no engine started.' }), { status: 503, headers: { 'content-type': 'application/json' } }));
      }
      return original(input, options);
    };` });
  await browser.navigate(bridge.origin + '/squad-members/new?workspace=' + encodeURIComponent(process.cwd()));
  await until(() => browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Or start from a ready-made role'))"), 'new member role entry', 30000);
  await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Or start from a ready-made role')).click()");
  await until(() => browser.evaluate("[...document.querySelectorAll('[role=radio]')].some(button=>button.textContent.includes('Frontend Developer'))"), 'role picker');
  await browser.evaluate("[...document.querySelectorAll('[role=radio]')].find(button=>button.textContent.includes('Frontend Developer')).click()");
  await until(() => browser.evaluate("!!document.querySelector('#member-harness')"), 'execution chooser');
  assert.match(await browser.evaluate("document.querySelector('#member-harness').textContent"), /Codex/, 'untouched draft shows the ready engine rather than unavailable Autohand');
  await browser.fill('#member-name', 'Automatic primary');
  await browser.evaluate("document.querySelector('#member-name').form.requestSubmit()");
  await until(() => browser.evaluate('window.creationRequests.length === 1'), 'automatic creation request');
  assert.equal(await browser.evaluate('window.creationRequests[0].agent.harness.id'), 'codex');
  assert.equal(await browser.evaluate('window.creationRequests[0].agent.harness.model'), 'codex-default');
  await until(() => browser.evaluate("document.body.textContent.includes('Controlled preparation refusal')"), 'preparation refusal retains editable draft');
  await browser.evaluate("document.querySelector('#member-harness').click()");
  await until(() => browser.evaluate("[...document.querySelectorAll('[role=option]')].some(option=>option.textContent.includes('Autohand Code'))"), 'explicit engine choices');
  await browser.evaluate("[...document.querySelectorAll('[role=option]')].find(option=>option.textContent.includes('Autohand Code')&&!option.textContent.includes('ACP')).click()");
  await browser.evaluate("document.querySelector('#member-name').form.requestSubmit()");
  await until(() => browser.evaluate('window.creationRequests.length === 2'), 'explicit creation request');
  assert.equal(await browser.evaluate('window.creationRequests[1].agent.harness.id'), 'autohand', 'an explicit unavailable primary remains the user choice');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: actual New member shows/selects a ready automatic primary, submits it, preserves explicit engine choice and retains the draft after a controlled refusal. Provisioning is intercepted; no engine executes.');
} finally { await browser?.close(); await bridge.close(); }
