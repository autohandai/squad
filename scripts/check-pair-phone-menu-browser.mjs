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
  assert.deepEqual(browser.errors, []);
  console.log('PASS: the workspace menu offers Pair iPhone…, which shows a live pairing QR from the real bridge and closes cleanly.');
} finally { await browser?.close(); await bridge.close(); }
