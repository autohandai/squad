// The owner's screen, reproduced in the app against a real bridge (ADR-0286):
// the window's localStorage is filled to the browser's quota with an old
// direct-message cache before Squad loads. Before the fix, boot's roster write
// threw QuotaExceededError and Squad stopped on "Your device's local storage
// is full". Now Squad opens, shows its members from the bridge, and the
// message history still reads back.
import assert from 'node:assert/strict';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const shots = process.env.STORAGE_SHOTS || '.codex-artifacts/storage-full';
const bridge = await startBridge({ prepare: prepareModelRoutingFixture });
let browser;
try {
  const members = Array.from({ length: 6 }, (_, i) => ({ id: `asq_full_${i}`, name: `Full Cache ${i}`, role: 'Reviewer', instructions: 'Keep the authored brief. '.repeat(1500), workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, modelAssignment: { mode: 'override', provider: 'autohandai', model: 'fixture-moa' }, permissions: {} }));
  const messages = { [members[0].id]: [{ id: 'm1', role: 'user', content: 'Before the cache filled up', createdAt: new Date().toISOString() }] };
  browser = await startBrowser();
  const context = await seedOwnedBrowserFixture(bridge, browser, { members, messages });
  // Fill the owner's message cache until the browser refuses one more byte,
  // once, before the app's first script runs.
  const key = `autohandSquad.owner.v1.${context.storageKey}.${encodeURIComponent('autohandSquad.v1.messages')}`;
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(bridge.origin)}&&!sessionStorage.getItem('filled')){sessionStorage.setItem('filled','1');
    let low=0,high=12*1024*1024;while(high-low>1024){const mid=(low+high)>>1;try{localStorage.setItem(${JSON.stringify(key)},'x'.repeat(mid));low=mid;}catch{high=mid;}}
    localStorage.setItem(${JSON.stringify(key)},'x'.repeat(low));try{localStorage.setItem('probe','y'.repeat(4096));localStorage.removeItem('probe');window.__notFull=true;}catch{window.__notFull=false;}}` });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(bridge.origin + '/');
  await until(() => browser.evaluate('window.__notFull === false'), 'the window cache starts full', 20000);
  const body = () => browser.evaluate('document.body.innerText');
  await until(async () => { const text = await body(); return /Full Cache 0/.test(text) || /storage is full|cache is full/.test(text); }, 'Squad loads or stops', 60000);
  const text = await body();
  await browser.screenshot(`${shots}/storage-full.png`);
  assert.doesNotMatch(text, /local storage is full|cache is full/, 'Squad never stops on a full window cache');
  assert.match(text, /Full Cache 0/, 'the members show from the bridge');
  const roster = await browser.evaluate(`localStorage.getItem(${JSON.stringify(`autohandSquad.owner.v1.${context.storageKey}.${encodeURIComponent('autohandSquad.v1.agents')}`)})`);
  assert.ok(roster && roster.includes('asq_full_0'), 'the roster reached disk: the old history gave way first');
  assert.ok(!(await browser.evaluate(`(localStorage.getItem(${JSON.stringify(key)})||'').startsWith('xxxx')`)), 'the stale filler history is gone from disk');
  console.log('Storage-full browser check passed: with the window cache filled to the browser quota, Squad opens, shows its members, and keeps the roster on disk.');
} finally {
  await browser?.close();
  await bridge.close?.();
}
process.exit(0);
