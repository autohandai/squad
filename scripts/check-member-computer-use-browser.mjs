import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

// Real owner/member/grant APIs; browser-native dialog and OS readiness are
// deliberately simulated. No installed app or operating-system grant changes.
const bridge = await startBridge({ development: process.env.AUTOHAND_CHECK_PRODUCTION !== '1', prepare: async directory => {
  const runtime = join(directory, 'no-native-engine'); await mkdir(runtime);
  return { AUTOHAND_SQUAD_COMPUTER_USE: 'bundled', AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: runtime };
} });
const member = { id: 'computer-toggle-eva', name: 'Eva', role: 'Reviewer', status: 'online' };
const fixtureKey = 'b'.repeat(64);
let browser;
try {
  await writeFile(join(bridge.directory, 'squad', 'native-grant-token'), fixtureKey, { mode: 0o600 });
  browser = await startBrowser();
  const other = { id: 'computer-toggle-iris', name: 'Iris', role: 'Engineer', status: 'online' };
  await seedOwnedBrowserFixture(bridge, browser, { members: [member, other] });
  await browser.navigate(bridge.origin + '/conversations/new?member=' + member.id);
  await until(() => browser.evaluate("!!document.querySelector('textarea')"), 'ordinary app mounted');
  await bridge.api('/api/status/snapshot', 'POST', { members: [member, other], jobs: [] });
  const observed = await fetch(bridge.origin + '/api/computer-use/grant', { method:'POST', headers:{...await bridge.headers(), 'x-squad-native-grant':fixtureKey}, body:JSON.stringify({memberId:other.id,scope:'observe'}) });
  assert.equal(observed.status, 200);
  await browser.evaluate(`(() => {
    const original = window.fetch.bind(window);
    window.__computerToggle = { cancel: true, calls: [] };
    Object.defineProperty(navigator, 'userAgent', { configurable:true, value:'AutohandSquadDesktop/0.1.22 (macos)' });
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin);
      if (url.pathname !== '/api/computer-use/status' || !response.ok) return response;
      const payload = await response.json();
      payload.data = { ...payload.data, available:true, accessibility:true, screenRecording:true, readinessError:null };
      if (window.__computerToggle.holdNextStatus) {
        window.__computerToggle.holdNextStatus = false; window.__computerToggle.heldStatus = true;
        await new Promise(resolve => { window.__computerToggle.releaseStatus = resolve; });
        window.__computerToggle.delayedDelivered = true;
      }
      return new Response(JSON.stringify(payload), {status:200, headers:{'content-type':'application/json'}});
    };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.__computerToggle.calls.push({command, memberId:args.memberId});
      if (window.__computerToggle.failNext) { window.__computerToggle.failNext = false; throw Error('Fixture native grant unavailable'); }
      if (command === 'squad_confirm_computer_use' && window.__computerToggle.cancel) return {confirmed:false};
      if (command === 'squad_confirm_computer_use' && window.__computerToggle.holdNextConfirmation) {
        window.__computerToggle.holdNextConfirmation = false; window.__computerToggle.heldConfirmation = true;
        await new Promise(resolve => { window.__computerToggle.releaseConfirmation = resolve; });
      }
      if (!['squad_confirm_computer_use','squad_revoke_computer_use'].includes(command)) throw Error('Fixture native command unavailable');
      const revoke = command === 'squad_revoke_computer_use';
      const response = await original('/api/computer-use/grant', {method:revoke?'DELETE':'POST', headers:{'content-type':'application/json','x-squad-context':args.contextGeneration,'x-squad-native-grant':${JSON.stringify(fixtureKey)}}, body:JSON.stringify({memberId:args.memberId,...(revoke?{}:{scope:args.scope})})});
      const payload = await response.json(); if(!response.ok || !payload.success) throw Error(payload.error);
      return revoke ? {revoked:true} : {confirmed:true};
    } };
  })()`);
  const navigate = async path => browser.evaluate(`history.pushState({},'',${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
  await navigate('/squad-members/' + member.id + '/model');
  await until(() => browser.evaluate("!!document.querySelector('[role=switch][aria-label=\"Use the computer\"]')"), 'per-member Computer Use switch in Model settings');
  assert.equal(await browser.evaluate("document.querySelector('[role=switch][aria-label=\"Use the computer\"]').getAttribute('aria-checked')"), 'false');
  const toggle = async () => {
    await until(() => browser.evaluate("!document.querySelector('[role=switch][aria-label=\"Use the computer\"]').disabled"), 'Computer Use toggle available');
    await browser.click('Use the computer');
  };
  await toggle();
  await until(() => browser.evaluate("window.__computerToggle.calls.some(call => call.command === 'squad_confirm_computer_use')"), 'native confirmation requested');
  assert.equal((await bridge.api('/api/computer-use/status?memberId=' + member.id)).data.grant.scope, 'none', 'cancelled confirmation never grants access');
  await browser.evaluate('window.__computerToggle.cancel = false; window.__computerToggle.failNext = true');
  await toggle();
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-computer-use] [role=alert]')?.textContent.includes('Fixture native grant unavailable')"), 'native failure is visible');
  assert.equal((await bridge.api('/api/computer-use/status?memberId=' + member.id)).data.grant.scope, 'none', 'failed native confirmation keeps the switch off');
  await toggle();
  await until(async () => (await bridge.api('/api/computer-use/status?memberId=' + member.id)).data.grant.scope === 'control', 'confirmed grant saved');
  await until(() => browser.evaluate("document.querySelector('[role=switch][aria-label=\"Use the computer\"]').getAttribute('aria-checked') === 'true'"), 'confirmed switch state');
  await navigate('/squad-members/' + member.id + '/permissions');
  await until(() => browser.evaluate("document.querySelector('[data-testid=computer-use-permissions] [role=switch]')?.getAttribute('aria-checked') === 'true'"), 'Permissions uses the same saved grant');
  await browser.evaluate('window.__computerToggle.holdNextStatus = true');
  await browser.click('Check again');
  await until(() => browser.evaluate('window.__computerToggle.heldStatus === true'), 'pre-revoke status held in flight');
  await toggle();
  await until(async () => (await bridge.api('/api/computer-use/status?memberId=' + member.id)).data.grant.scope === 'none', 'turning off revokes access');
  await until(() => browser.evaluate("document.querySelector('[data-testid=computer-use-permissions] [role=switch]')?.getAttribute('aria-checked') === 'false'"), 'acknowledged revoke displayed');
  await browser.evaluate('window.__computerToggle.releaseStatus()');
  await until(() => browser.evaluate('window.__computerToggle.delayedDelivered === true'), 'earlier status response delivered');
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=computer-use-permissions] [role=switch]').getAttribute('aria-checked')"), 'false', 'a delayed pre-revoke read cannot undo acknowledged Off');
  assert.equal((await bridge.api('/api/computer-use/status?memberId=' + other.id)).data.grant.scope, 'observe', 'another member retains their separate observe grant');
  await navigate('/squad-members/' + member.id + '/model');
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-computer-use] [role=switch]')?.getAttribute('aria-checked') === 'false'"), 'reopening Model settings preserves off');
  await until(() => browser.evaluate("!document.querySelector('[data-testid=member-computer-use] [role=switch]').disabled"), 'reopened Model readiness resolved');
  await browser.evaluate('window.__computerToggle.holdNextConfirmation = true');
  await toggle();
  await until(() => browser.evaluate('window.__computerToggle.heldConfirmation === true'), 'Eva confirmation held pending');
  await navigate('/squad-members/' + other.id + '/model');
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-computer-use]')?.textContent.includes('Iris may inspect')"), 'Iris own observe scope loaded');
  await browser.evaluate('window.__computerToggle.releaseConfirmation()');
  await until(async () => (await bridge.api('/api/computer-use/status?memberId=' + member.id)).data.grant.scope === 'control', 'late confirmation still targets Eva');
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=member-computer-use]').textContent.includes('Iris may inspect') && !document.querySelector('[data-testid=member-computer-use] [role=switch]').disabled"), true, 'late Eva confirmation cannot replace Iris state or errors');
  await bridge.api('/api/computer-use/grant', 'DELETE', {memberId:member.id});
  await navigate('/squad-members/' + member.id + '/model');
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-computer-use] [role=switch]')?.getAttribute('aria-checked') === 'false' && !document.querySelector('[data-testid=member-computer-use] [role=switch]').disabled"), 'Eva off restored after member transition');
  await browser.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.evaluate("document.querySelector('[data-testid=member-computer-use]').scrollIntoView({block:'center'})");
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Computer Use controls fit on a phone');
  await browser.evaluate("Promise.all(document.querySelector('[data-testid=member-computer-use] [role=switch]').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))");
  await browser.screenshot('.codex-artifacts/group-chats/computer-toggle-phone.png');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: per-member Model/Permissions Computer Use switch, native cancellation/failure/retry, confirmed on, persisted off and independent member grants at390px. Simulated native/OS; no real computer operation.');
} catch (failure) { await browser?.screenshot('.codex-artifacts/group-chats/computer-toggle-failed.png').catch(() => {}); throw failure; }
finally { await browser?.close(); await bridge.close(); }
