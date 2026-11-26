// Squad's loading states (ADR-0284). Builds the six patterns with the app's
// own components and stylesheet, then checks them in light, dark and reduced
// motion: roles and values for assistive technology, the sweep/slide/spin
// running only when motion is allowed, the checklist's marks per step, and
// "Saving" turning into "Saved". Then a real chat: a reply that is still
// coming shows its stage as shimmering words, not a spinner.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { build } from 'vite';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const shots = process.env.LOADING_SHOTS || resolve('.codex-artifacts/loading-states');
await mkdir(shots, { recursive: true });
const out = await mkdtemp(join(tmpdir(), 'squad-loading-'));
await build({ configFile: resolve('vite.config.js'), root: resolve('scripts/fixtures/loading-gallery'), logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(out, path === '/' ? 'index.html' : path);
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(body);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser; let bridge;
const animated = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const style = getComputedStyle(el); return style.animationName !== 'none' && style.animationPlayState === 'running'; })()`;
const pseudoAnimated = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el, '::after').animationName !== 'none' : null; })()`;
try {
  browser = await startBrowser();
  for (const theme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await browser.navigate(`${origin}/?theme=${theme}&step=2`);
    await until(() => browser.evaluate("document.querySelectorAll('[data-pattern]').length === 7"), 'gallery renders');
    const roles = await browser.evaluate(`({
      progress: (() => { const bar = document.querySelector('[data-pattern="Progress bar"] [role=progressbar]'); return bar && { now: bar.getAttribute('aria-valuenow'), text: bar.getAttribute('aria-valuetext') }; })(),
      save: document.querySelector('[data-pattern="Spinner"] [role=status]')?.textContent,
      shimmer: document.querySelector('[data-slot=text-shimmer]')?.textContent,
      indeterminate: document.querySelector('[data-slot=indeterminate-bar]')?.getAttribute('aria-busy'),
      steps: [...document.querySelectorAll('[data-slot=progress-checklist] li')].map(li => li.dataset.stepStatus),
      task: [...document.querySelectorAll('[data-testid=agent-task-checklist] li')].map(li => ({ status: li.dataset.taskStatus, ring: Boolean(li.querySelector('[data-slot=spinner]')), crossed: Boolean(li.querySelector('.line-through')) })),
      lonely: document.querySelector('[data-slot=spinner][role=status]')?.getAttribute('aria-label'),
    })`);
    assert.deepEqual(roles.progress, { now: '18', text: '18%' }, 'the progress bar reports its value');
    assert.equal(roles.save, 'Saving…');
    assert.equal(roles.shimmer, 'Thinking…', 'shimmering words stay readable text');
    assert.equal(roles.indeterminate, 'true');
    assert.deepEqual(roles.steps, ['completed', 'in_progress', 'pending'], 'checklist marks per step');
    assert.deepEqual(roles.task.map(row => [row.status, row.ring, row.crossed]), [['completed', false, true], ['in_progress', true, false], ['pending', false, false]], 'member tasks: a ring only on the live step, completed still crossed out');
    assert.equal(roles.lonely, 'Working', 'a spinner standing alone is announced');
    for (const [name, check] of [['ring', animated('.loading-ring')], ['shimmer', animated('.loading-text-shimmer')], ['skeleton sweep', pseudoAnimated('.loading-skeleton')], ['indeterminate slide', pseudoAnimated('.loading-indeterminate')]]) assert.equal(await browser.evaluate(check), true, `${name} moves when motion is allowed (${theme})`);
    await browser.screenshot(join(shots, `loading-gallery-${theme}.png`));
  }
  // Saving turns into Saved with its check.
  await browser.navigate(`${origin}/?step=12`);
  await until(() => browser.evaluate("document.querySelector('[data-pattern=Spinner] [role=status]')?.textContent === 'Saved'"), 'Saved with its check');
  assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-slot=save-status][data-state=saved] .bg-emerald-500'))"), true);
  // Reduced motion: nothing sweeps or slides; the words and bars still read.
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.navigate(`${origin}/?step=2`);
  await until(() => browser.evaluate("document.querySelectorAll('[data-pattern]').length === 7"), 'gallery renders reduced');
  assert.equal(await browser.evaluate(animated('.loading-text-shimmer')), false, 'no shimmer under reduced motion');
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.loading-text-shimmer')).color !== 'rgba(0, 0, 0, 0)'"), true, 'the words are drawn plainly');
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.loading-skeleton'), '::after').display"), 'none', 'no skeleton sweep');
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.loading-indeterminate'), '::after').animationName"), 'none', 'no sliding segment');
  await browser.screenshot(join(shots, 'loading-gallery-reduced.png'));
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // A real chat: the reply is still coming, so its stage shimmers.
  bridge = await startBridge();
  const member = { ...initialAgents[0], id: 'loading-fixture', name: 'Alex', role: 'Assistant', workspace: process.cwd(), projects: [{ path: process.cwd() }], skills: [] };
  await seedOwnedBrowserFixture(bridge, browser, { members: [member] });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      if (path === '/api/chat/warm') return new Response('{"success":true,"data":{}}', { headers: { 'content-type': 'application/json' } });
      if (path === '/api/chat/stream') {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('event: start\\ndata: ' + JSON.stringify({ startedAt: new Date().toISOString() }) + '\\n\\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
      }
      return original(input, options);
    };
  ` });
  for (const theme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
    await until(() => browser.evaluate("!!document.querySelector('textarea')"), 'chat composer').catch(async error => { console.error((await browser.evaluate('document.body.innerText')).slice(0, 600)); throw error; });
    await browser.fill('textarea', 'Plan the release');
    await browser.evaluate("document.querySelector('textarea').closest('form').requestSubmit()");
    await until(() => browser.evaluate("!!document.querySelector('[data-testid=reply-progress] [data-slot=text-shimmer]')"), 'the reply in progress shimmers', 20000);
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=reply-progress] [data-slot=spinner]')"), null, 'no spinner beside it');
    assert.equal(await browser.evaluate("document.querySelector('[data-testid=reply-progress]').getAttribute('role')"), 'status');
    await browser.screenshot(join(shots, `loading-chat-${theme}.png`));
  }
  console.log(`Loading states: six patterns with roles and values, motion only when allowed (light, dark, reduced), Saving → Saved, member task marks; a real reply in progress shimmers. Screenshots in ${shots}.`);
} finally {
  await browser?.close?.();
  await bridge?.close?.();
  server.close();
  await rm(out, { recursive: true, force: true });
}
