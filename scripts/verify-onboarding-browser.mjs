import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

// Original account-gate, route, skip, resume and provider assertions, adapted
// to FirstRun and Settings with real isolated APIs. See ADR-0073.
async function check(signedIn, run) {
  const bridge = await startBridge({ signedIn });
  let browser;
  try {
    browser = await startBrowser(); await run(bridge, browser);
    assert.deepEqual(browser.errors, [], 'no browser exceptions');
  } finally { await browser?.close(); await bridge.close(); }
}
const hasText = (browser, text) => browser.evaluate(`document.body.textContent.includes(${JSON.stringify(text)})`);
const pathIs = (browser, path) => until(() => browser.evaluate(`location.pathname === ${JSON.stringify(path)}`), `route ${path}`);

await check(false, async (bridge, browser) => {
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid="sign-in-gate"]')`), 'signed-out gate');
  await pathIs(browser, '/welcome');
  for (const text of ['Sign in to your squad', 'autohand login', 'Check again']) assert.ok(await hasText(browser, text));
  assert.equal(await browser.evaluate(`!![...document.querySelectorAll('button')].find(button => button.innerText.includes('Skip for now') && !button.disabled)`), false, 'signed-out setup cannot be skipped');
  await browser.navigate(bridge.origin + '/squad');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid="sign-in-gate"]')`), 'protected workspace');
  assert.equal(await browser.evaluate(`!!document.querySelector('main textarea')`), false, 'direct product routes remain behind the sign-in gate');
  const runtime = (await bridge.api('/api/runtime')).data;
  assert.equal(runtime.account.signedIn, false);
  assert.ok(!('token' in runtime.account));
  await browser.screenshot('.codex-artifacts/onboarding-browser-signed-out-gate.png');
  console.log('ok signed-out routing, mandatory account gate and terminal alternative');
});

await check(true, async (bridge, browser) => {
  // Force the missing-provider recovery action; use actual Settings APIs.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (new URL(typeof input === 'string' ? input : input.url, location.origin).pathname !== '/api/provider-settings') return response;
      const payload = await response.json(); for (const provider of Object.values(payload.data.providers)) provider.enabled = false;
      return new Response(JSON.stringify(payload), { headers: {'content-type':'application/json'} });
    };` });
  await browser.navigate(bridge.origin + '/'); await pathIs(browser, '/welcome');
  await until(() => hasText(browser, 'Point at a folder.'), 'first run');
  for (const text of ['Meet your first teammate', 'Start talking', 'No model provider is configured']) assert.ok(await hasText(browser, text));
  await browser.screenshot('.codex-artifacts/onboarding-browser-welcome.png');
  await browser.click('Skip for now'); await pathIs(browser, '/squad');
  await until(() => browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.onboarding'))?.status === 'skipped'`), 'saved skip');
  await browser.screenshot('.codex-artifacts/onboarding-browser-squad.png');
  await browser.navigate(bridge.origin + '/'); await pathIs(browser, '/squad');
  const account = await browser.evaluate(`(() => { const rect = [...document.querySelectorAll('button[aria-label="Open account menu"]')].find(item=>item.getBoundingClientRect().width).getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...account, button: 'left', clickCount: 1 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...account, button: 'left', clickCount: 1 });
  await until(() => browser.evaluate(`!![...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()==='Settings')`), 'Settings menu item');
  await browser.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.trim()==='Settings').click()`);
  await pathIs(browser, '/settings');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid="settings-sections"] a[data-section="setup"]')`), 'Settings sections');
  await browser.evaluate(`document.querySelector('[data-testid="settings-sections"] a[data-section="setup"]').click()`);
  await pathIs(browser, '/settings/setup');
  await until(() => browser.evaluate(`!!document.querySelector('#settings-setup button')`), 'Settings setup');
  await browser.evaluate(`document.querySelector('#settings-setup button').click()`); await pathIs(browser, '/welcome');
  await until(() => hasText(browser, 'No model provider is configured'), 'provider blocker');
  await browser.click('Open providers'); await pathIs(browser, '/settings');
  await until(() => browser.evaluate(`new URLSearchParams(location.search).get('section') === 'providers' && !!document.querySelector('#settings-providers')`), 'provider deep link');
  await until(() => hasText(browser, 'Workspace default'), 'provider controls');
  assert.ok(await hasText(browser, 'Default model'));
  await until(() => browser.evaluate(`(() => { const rect = document.querySelector('#settings-providers')?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < 220; })()`), 'focused provider section');
  await browser.screenshot('.codex-artifacts/onboarding-browser-settings.png');
  console.log('ok clean first run, persisted skip, Settings resume and provider controls/deep link');
});
console.log('Browser onboarding verification passed (real bridge/browser with fixture account and provider readiness; no live login or provider execution).');
