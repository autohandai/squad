// The sidebar's workspace menu (the "Local ⌄" switcher) offers Pair iPhone…,
// which opens the same QR + six-digit flow as onboarding against the real
// bridge's /api/mobile endpoints. No phone connects; the offer is made only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const artifact = '.codex-artifacts/pair-phone-menu';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge();
let browser;
try {
  const member = { id: 'asq_pair_fixture', name: 'Pair Verify', role: 'Reviewer', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, permissions: {} };
  // A free phone port, so the check never collides with an installed Squad
  // already hosting a real phone on the default 29323.
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const configured = await bridge.api('/api/mobile/config', 'PUT', { enabled: false, local: true, relay: false, tunnel: false, endpoint: '', port });
  assert.equal(configured.success, true, configured.error);
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members: [member] });
  await browser.navigate(`${bridge.origin}/squad`);
  await until(() => browser.evaluate(`!!document.querySelector('[aria-label="Switch workspace"]')`), 'workspace menu in the sidebar', 20000);
  await browser.evaluate(`document.querySelector('[aria-label="Switch workspace"]').click()`);
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Pair iPhone…')`), 'Pair iPhone… in the workspace menu');
  await browser.click('Pair iPhone…');
  await until(() => browser.evaluate(`document.querySelector('[data-testid=pair-phone-dialog]')?.textContent.includes('Take your squad with you')`), 'pairing dialog opens');
  await browser.click('Pair an iPhone');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=pair-phone-dialog] svg, [data-testid=pair-phone-dialog] canvas, [data-testid=pair-phone-dialog] img[alt*="QR" i]') && document.querySelector('[data-testid=pair-phone-dialog]').textContent.includes('Scan this code')`), 'QR code shown in the dialog', 30000);
  const status = await bridge.api('/api/mobile/status');
  assert.equal(status.success, true, status.error);
  await browser.screenshot(`${artifact}/pair-phone-dialog.png`);
  await browser.click('Close');
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=pair-phone-dialog]')`), 'Close dismisses the dialog');
  // Paired phones are listed in the menu and can be unpaired there, after a
  // confirm. The phone list is stubbed in the page (pairing a real phone needs
  // the iPhone); DELETE /api/mobile/devices/:id itself is covered by check-mobile.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const phones = [{ id: 'phone-a', name: 'iPhone', pairedAt: '2026-11-15T21:18:48.658Z' }, { id: 'phone-b', name: 'iPhone', pairedAt: '2026-11-15T21:23:05.486Z', lastSeenAt: new Date().toISOString(), lastSeenVia: 'local' }];
    window.__unpaired = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const json = data => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } }));
      if (url.pathname === '/api/mobile/status') return json({ computerID: 'fixture', computerName: 'Fixture Mac', devices: phones.filter(p => !window.__unpaired.includes(p.id)), routes: [] });
      if (url.pathname.startsWith('/api/mobile/devices/') && (init.method || 'GET') === 'DELETE') { window.__unpaired.push(decodeURIComponent(url.pathname.split('/').pop())); return json({ removed: true }); }
      return real(input, init);
    };
  })();` });
  await browser.navigate(`${bridge.origin}/squad`);
  await until(() => browser.evaluate(`!!document.querySelector('[aria-label="Switch workspace"]')`), 'workspace menu after reload', 20000);
  await browser.evaluate(`document.querySelector('[aria-label="Switch workspace"]').click()`);
  await until(() => browser.evaluate(`document.querySelectorAll('[data-testid=switcher-phones] li').length === 2`), 'both paired phones listed');
  const rows = await browser.evaluate(`[...document.querySelectorAll('[data-testid=switcher-phones] li')].map(li => li.innerText)`);
  assert.ok(rows[0].includes('Active now on this Wi-Fi') && rows[0].includes('paired'), `newest phone first, with presence and pairing date: ${rows[0]}`);
  await browser.screenshot(`${artifact}/phones-in-menu.png`);
  await browser.evaluate(`document.querySelectorAll('[data-testid=switcher-unpair]')[1].click()`);
  await until(() => browser.evaluate(`document.querySelectorAll('[data-testid=switcher-unpair]')[1].textContent.trim() === 'Confirm'`), 'Unpair asks for a confirm first');
  assert.deepEqual(await browser.evaluate('window.__unpaired'), [], 'one click does not unpair');
  await browser.evaluate(`document.querySelectorAll('[data-testid=switcher-unpair]')[1].click()`);
  await until(() => browser.evaluate(`document.querySelectorAll('[data-testid=switcher-phones] li').length === 1`), 'the unpaired phone leaves the list');
  assert.deepEqual(await browser.evaluate('window.__unpaired'), ['phone-a']);
  assert.deepEqual(browser.errors, []);
  console.log('PASS: the workspace menu offers Pair iPhone…, which shows a live pairing QR from the real bridge and closes cleanly; it lists paired phones with presence and pairing date, and unpairs one after a confirm.');
} finally { await browser?.close(); await bridge.close(); }
