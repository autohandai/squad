// One startup surface (ADR-0288). The owner's case, against a real bridge:
// macOS in dark mode, Squad set to light in Settings. Before, a cold start
// showed three screens: index.html's centred dark splash, ownership's
// left-aligned dark "Loading your Squad…", then a light checklist. Now one
// surface stays from the first frame to the app: the same theme throughout
// (the person's, not the system's), the logo never moves, and only the status
// line changes as ownership and the bridge answer. Both answers are held back
// 1.2 s here so every phase is sampled (every 100 ms) and photographed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const shots = process.env.BOOT_SHOTS || '.codex-artifacts/boot';
const bridge = await startBridge({ prepare: prepareModelRoutingFixture });
let browser;
try {
  const members = Array.from({ length: 3 }, (_, i) => ({ id: `asq_boot_${i}`, name: `Boot Member ${i}`, role: 'Reviewer', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, permissions: {} }));
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members, storage: {} });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 1, mobile: false });
  // Before any page script: the saved theme is light; ownership and the
  // bridge answer 1.2 s late; a sampler records the startup surface.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(bridge.origin)}) {
    localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: 'light' }));
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => { const url = String(input && input.url || input); if (/\\/api\\/(ownership\\/context|runtime)(\\?|$)/.test(new URL(url, location.href).pathname + '?')) await new Promise(r => setTimeout(r, 1200)); return realFetch(input, init); };
    window.__boot = [];
    const sample = () => {
      const surfaces = document.querySelectorAll('[data-startup]');
      const surface = surfaces[surfaces.length - 1];
      const mark = surface && surface.querySelector('.boot-mark');
      const r = mark && mark.getBoundingClientRect();
      const app = document.querySelector('.app-sidebar');
      const marks = [...surfaces].map(node => { const m = node.querySelector('.boot-mark'); if (!m) return ''; const b = m.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y)].join(','); });
      window.__boot.push({ t: Math.round(performance.now()), surfaces: surfaces.length, staticBoot: Boolean(document.getElementById('boot')), sameMarks: new Set(marks).size === 1, bg: surface ? getComputedStyle(surface).backgroundColor : '', status: surface ? (surface.querySelector('.boot-status') || {}).textContent : '', mark: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width)] : null, birds: surface ? surface.querySelectorAll('.boot-flock > span').length : 0, app: Boolean(app), appBg: app ? getComputedStyle(document.body).backgroundColor : '' });
      if (!app) setTimeout(sample, 100);
    };
    sample();
  }` });
  await browser.navigate(bridge.origin + '/');
  // Photograph the boot every 150 ms until the app is up.
  await mkdir(shots, { recursive: true });
  const frames = [];
  for (let i = 0; i < 60; i++) {
    // A frame taken while the page commits a navigation is skipped, not fatal.
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (shot) frames.push(shot.data);
    if (await browser.evaluate("Boolean(document.querySelector('.app-sidebar')) && !document.querySelector('[data-startup]')").catch(() => false)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  for (const [i, data] of frames.entries()) await writeFile(`${shots}/frame-${String(i).padStart(2, '0')}.png`, Buffer.from(data, 'base64'));
  await until(() => browser.evaluate("Boolean(document.querySelector('.app-sidebar'))"), 'the app is up', 30000);
  const samples = await browser.evaluate('window.__boot');
  const boot = samples.filter(s => s.surfaces);
  const statuses = [...new Set(boot.map(s => s.status))];
  await writeFile(`${shots}/samples.json`, JSON.stringify({ statuses, samples }, null, 2));
  assert.ok(boot.length >= 10, `the startup surface was sampled through the start (${boot.length} samples)`);
  // For a frame React's copy lies over index.html's identical one until the
  // static one is removed: the swap of identical pixels the design relies on.
  assert.ok(boot.every(s => s.surfaces === 1 || (s.surfaces === 2 && s.staticBoot && s.sameMarks)), 'one startup surface; at most the identical static copy beneath it during the swap');
  assert.deepEqual([...new Set(boot.map(s => s.bg))], ['rgb(255, 255, 255)'], 'the saved light theme from the first sample to the last, though the system is dark');
  const marks = [...new Set(boot.map(s => JSON.stringify(s.mark)))];
  assert.equal(marks.length, 1, `the logo never moves (${marks.join(' ')})`);
  assert.ok(boot.every(s => s.birds === 3), 'the same three birds on their perch throughout');
  assert.ok(statuses.length >= 2, `the status line advances (${statuses.join(' → ')})`);
  assert.ok(statuses.includes('Verifying your Squad…') || statuses.includes('Loading your Squad…'), 'ownership speaks on the same surface');
  assert.ok(statuses.some(s => /Reading your squad|Starting the local bridge/.test(s)), 'the bridge wait speaks on the same surface');
  const handover = samples.findIndex(s => s.app);
  const first = samples.findIndex(s => s.surfaces); // before #boot is parsed there is no body yet
  assert.ok(first >= 0 && handover > first && samples.slice(first, handover).every(s => s.surfaces >= 1), 'no blank frame between the startup surface and the app');
  const appBg = samples[handover].appBg.match(/\d+/g).map(Number);
  assert.ok(appBg.slice(0, 3).every(v => v > 200), `the app opens light too, no flash (${samples[handover].appBg})`);
  assert.deepEqual(browser.errors, [], 'no page errors during startup');
  console.log(`One startup surface: ${boot.length} samples, one surface, light throughout on a dark system, logo fixed at ${marks[0]}, status ${statuses.join(' → ')}, then the app with no blank frame. ${frames.length} frames in ${shots}.`);
} finally {
  await browser?.close();
  await bridge.close?.();
}
process.exit(0);
