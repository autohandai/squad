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

  for (const clearFallbacks of [false, true]) {
    await browser.close();
    browser = await startBrowser();
    await seedOwnedBrowserFixture(bridge, browser);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const original = window.fetch.bind(window);
      window.creationRequests = [];
      window.discoveryChanged = false;
      window.blockRegistryRead = false;
      window.creationId = null;
      let droppedAcknowledgement = false;
      window.fetch = async (input, options) => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
        const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
        if (path === '/api/channels' && window.blockRegistryRead) return new Response(JSON.stringify({ success: false, error: 'Controlled registry read refusal.' }), { status: 503, headers: { 'content-type': 'application/json' } });
        if (path === '/api/harnesses') return json({ success: true, data: { harnesses: window.discoveryChanged ? [
          { id: 'autohand', label: 'Autohand Code', isDefault: true, status: 'ready', defaults: { model: 'changed-model' } },
          { id: 'codex', label: 'Codex', status: 'setup-required' }
        ] : [
          { id: 'autohand', label: 'Autohand Code', isDefault: true, status: 'setup-required' },
          { id: 'codex', label: 'Codex', status: 'ready', defaults: { model: 'codex-default', effort: 'high' } },
          { id: 'claude', label: 'Claude Code', status: 'ready', defaults: { model: 'claude-fixture' } }
        ] } });
        if (path === '/api/agents/provision' && options?.method === 'POST') {
          const body = JSON.parse(options.body);
          window.creationRequests.push(body);
          window.creationId = body.agentId;
          return json({ success: true, data: { skillInstall: { installed: [], failed: [] }, profileDocs: [] } });
        }
        if (path === '/api/members/' + window.creationId + '/channel-access' && options?.method === 'PUT' && !droppedAcknowledgement) {
          const response = await original(input, options);
          const saved = await response.json();
          if (!response.ok || !saved.success) throw Error('Fixture canonical save failed: ' + JSON.stringify(saved));
          droppedAcknowledgement = true;
          // The real registry committed; the browser receives an error instead of its acknowledgement.
          return new Response(JSON.stringify({ success: false, error: 'Controlled lost save acknowledgement.' }), { status: 503, headers: { 'content-type': 'application/json' } });
        }
        return original(input, options);
      };` });
    await browser.navigate(bridge.origin + '/squad-members/new?workspace=' + encodeURIComponent(process.cwd()));
    await until(() => browser.evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Or start from a ready-made role'))"), 'retry role entry', 30000);
    await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Or start from a ready-made role')).click()");
    await until(() => browser.evaluate("[...document.querySelectorAll('[role=radio]')].some(button=>button.textContent.includes('Frontend Developer'))"), 'retry role picker');
    await browser.evaluate("[...document.querySelectorAll('[role=radio]')].find(button=>button.textContent.includes('Frontend Developer')).click()");
    await until(() => browser.evaluate("!!document.querySelector('#member-name')"), 'retry creation form');
    await browser.fill('#member-name', clearFallbacks ? 'Cleared fallback retry' : 'Saved execution retry');
    await browser.evaluate("document.querySelector('#member-name').form.requestSubmit()");
    await until(() => browser.evaluate("document.body.textContent.includes('Controlled lost save acknowledgement.')"), 'save committed but acknowledgement lost');
    const id = await browser.evaluate('window.creationId');
    const snapshot = await bridge.api('/api/channels');
    const access = snapshot.data.agentChannelAccess[id];
    assert.equal(access.agent.harness.id, 'codex');
    assert.ok(access.agent.modelRouting.fallbacks.length, 'first save has a connected fallback');
    const expected = structuredClone(access.agent);
    if (clearFallbacks) {
      expected.modelRouting.fallbacks = [];
      const edited = await bridge.api('/api/members/' + id + '/channel-access', 'PUT', { agent: expected, profile: access.profile });
      assert.equal(edited.success, true);
    }
    await browser.evaluate('window.discoveryChanged = true; window.blockRegistryRead = true');
    await browser.evaluate("document.querySelector('#member-name').form.requestSubmit()");
    await until(() => browser.evaluate("document.body.textContent.includes('Controlled registry read refusal.')"), 'failed registry read retains draft');
    assert.equal(await browser.evaluate('window.creationRequests.length'), 1, 'an unreadable registry does not trigger another preparation');
    await browser.evaluate('window.blockRegistryRead = false');
    await browser.evaluate("document.querySelector('#member-name').form.requestSubmit()");
    await until(() => browser.evaluate("!document.querySelector('#member-name')"), 'saved creation retry completes');
    const after = (await bridge.api('/api/channels')).data.agentChannelAccess[id].agent;
    assert.deepEqual(after.harness, expected.harness, 'retry preserves the saved primary/defaults after discovery changes');
    assert.deepEqual(after.modelRouting, expected.modelRouting, 'retry preserves the saved fallback chain, including an explicitly cleared list');
    assert.equal(await browser.evaluate('window.creationRequests.length'), 1, 'already saved creation is not provisioned again');
    assert.deepEqual(browser.errors, []);
  }
  console.log('PASS: canonical member save survives a lost acknowledgement and changed discovery without reprovisioning or rewriting saved/cleared routing. Only preparation and the lost response are intercepted; registry writes/reads use the real owned bridge.');
} finally { await browser?.close(); await bridge.close(); }
