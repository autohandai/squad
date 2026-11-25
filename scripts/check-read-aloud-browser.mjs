#!/usr/bin/env node
// Read aloud with kale-tts-1 (ADR-0276), against a real isolated bridge and a
// real browser: the bridge serves the engine and the worker speaks through it
// (real model, real samples, measured); each member gets a default voice of its
// gender that fits its role, saved once to the bridge; the profile's voice
// picker plays a sample through the page's reader and saves a new choice;
// Settings > Voice lists the squad's voices without any ElevenLabs field; Edit
// profile offers the voice. Screenshots land in .codex-artifacts/read-aloud/.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const shots = join(process.cwd(), '.codex-artifacts/read-aloud');
await mkdir(shots, { recursive: true });
const bridge = await startBridge();
let browser;
try {
  const members = [
    { id: 'voice-eva', name: 'Eva', role: 'Research analyst', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'voice-thiago', name: 'Thiago', role: 'Growth marketer', createdAt: '2026-01-02T00:00:00Z' },
  ].map(member => ({ ...member, status: 'online', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, permissions: {} }));
  browser = await startBrowser();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await seedOwnedBrowserFixture(bridge, browser, { members });
  const settle = () => new Promise(resolve => setTimeout(resolve, 450));
  const shoot = async name => { await settle(); await browser.screenshot(join(shots, `${name}.png`)); };
  const saved = async id => (await bridge.api('/api/channels')).data.agentChannelAccess[id]?.agent || {};

  // Home names the voice and leads to the member's Voice page, where it is
  // changed (24 Nov: "per agent i want a voice control").
  await browser.navigate(`${bridge.origin}/squad-members/voice-eva`);
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=profile-voice-summary]')"), 'the voice on Home', 30000);
  assert.ok(await browser.evaluate("[...document.querySelectorAll('aside a, aside button, nav a, nav button')].some(item => item.innerText.trim() === 'Voice')"), 'Voice in the member sidebar');
  await browser.click('Change voice');
  await until(() => browser.evaluate("location.pathname === '/squad-members/voice-eva/voice' && !!document.querySelector('[data-testid=voice-picker]')"), 'the member Voice page', 30000);

  // 1. The engine, through the bridge: a real sentence from the real model.
  const served = await browser.evaluate(`Promise.all(['/voice-engine/squad-worker.mjs', '/voice-engine/js/kale-tts.mjs', '/voice-engine/ort/ort.wasm.min.mjs', '/voice-engine/models/kale-tts-1-tiny/voices.json'].map(async (path) => { const r = await fetch(path); return path + ' ' + r.status + ' ' + r.headers.get('content-type'); }))`);
  console.log(served.join('\n'));
  const engine = await browser.evaluate(`new Promise((resolve, reject) => {
    const worker = new Worker('/voice-engine/squad-worker.mjs', { type: 'module' });
    const started = performance.now(); let first = 0, samples = 0, chunks = 0;
    worker.onerror = (event) => reject(new Error(event.message || 'worker failed'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'chunk') { chunks += 1; samples += data.audio.length; if (!first) first = performance.now() - started; }
      if (data.type === 'error') reject(new Error(data.message));
      if (data.type === 'end') { worker.terminate(); resolve({ chunks, samples, firstMs: Math.round(first), totalMs: Math.round(performance.now() - started) }); }
    };
    worker.postMessage({ type: 'speak', id: 'probe', voice: 'd03', text: 'I checked the build. The cache key changed, so I fixed the workflow.' });
  })`);
  assert.ok(engine.chunks >= 2 && engine.samples > 24000 * 2, `the model spoke both sentences: ${JSON.stringify(engine)}`);
  console.log(`engine through the bridge (tiny, first load included): ${JSON.stringify(engine)}`);

  // 2. Default voices: Eva a woman's voice that fits research, Thiago a man's, saved once.
  await until(async () => (await saved('voice-eva')).voice && (await saved('voice-thiago')).voice, 'default voices saved to the bridge', 30000);
  assert.equal((await saved('voice-eva')).voice, 'd03', 'Eva, a research analyst, reads as Amy');
  assert.equal((await saved('voice-thiago')).voice, 'm3', 'Thiago, a growth marketer, reads as Owen');
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=voice-picker] [role=radio][aria-checked=true]')?.dataset.voice"), 'd03');
  await shoot('profile-voice');

  // 3. A sample through the page's reader: audio is scheduled in Amy's voice.
  await browser.evaluate(`(() => { window.__started = 0; const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...args) { window.__started += 1; return start.apply(this, args); }; })()`);
  await browser.evaluate("document.querySelector('[data-voice-sample=d03]').click()");
  await until(() => browser.evaluate('window.__started > 0'), 'the sample is played through the reader', 60000);
  await until(() => browser.evaluate("document.querySelector('[data-voice-sample=d03]').getAttribute('aria-label').startsWith('Stop')"), 'the sample button offers Stop while it plays', 10000);
  await shoot('profile-voice-playing');
  await browser.evaluate("document.querySelector('[data-voice-sample=d03]').click()");

  // 4. Choosing another voice saves it on the member.
  await browser.evaluate("document.querySelector('[data-testid=voice-picker] [data-voice=f06]').click()");
  await until(async () => (await saved('voice-eva')).voice === 'f06', 'Simone saved for Eva', 20000);

  // 4b. The member card (chat header avatar) names the voice with a sample, and
  //     its actions are a pen and an eye in the top-right corner (24 Nov).
  await browser.navigate(`${bridge.origin}/conversations/new?member=voice-eva`);
  await until(() => browser.evaluate("!!document.querySelector('header [data-slot=avatar]')"), 'the chat header', 30000);
  await browser.evaluate("document.querySelector('header [data-slot=avatar]').closest('button').click()");
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-preview-voice]')"), 'the voice in the member card', 20000);
  assert.match(await browser.evaluate("document.querySelector('[data-testid=member-preview-voice]').innerText"), /Simone/);
  assert.ok(await browser.evaluate("!!document.querySelector('[data-testid=member-preview-edit]') && !!document.querySelector('[data-testid=member-preview-view]')"), 'pen and eye in the card');
  assert.ok(!(await browser.evaluate("[...document.querySelectorAll('[data-slot=popover-content] button')].some(b => /View profile|Change avatar/.test(b.innerText))")), 'no text buttons left in the card');
  await browser.evaluate(`(() => { window.__started = 0; const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...args) { window.__started += 1; return start.apply(this, args); }; })()`);
  await browser.evaluate("document.querySelector('[data-testid=member-preview-voice] button').click()");
  await until(() => browser.evaluate('window.__started > 0'), 'the card plays the voice', 60000);
  await shoot('member-card');
  await browser.evaluate("document.querySelector('[data-testid=member-preview-view]').click()");
  await until(() => browser.evaluate("location.pathname === '/squad-members/voice-eva/home'"), 'the eye opens the profile', 20000);
  // 4c. The pen opens the profile with Edit Profile open; hovering the face
  //     in the card shows a pen over it (owner, 26 Nov).
  await browser.navigate(`${bridge.origin}/conversations/new?member=voice-eva`);
  await until(() => browser.evaluate("!!document.querySelector('header [data-slot=avatar]')"), 'the chat header again', 30000);
  await browser.evaluate("document.querySelector('header [data-slot=avatar]').closest('button').click()");
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-preview-avatar] [data-testid=avatar-edit-mark] svg')"), 'a pen over the face in the card', 20000);
  await browser.evaluate("document.querySelector('[data-testid=member-preview-edit]').click()");
  await until(() => browser.evaluate("location.pathname === '/squad-members/voice-eva/home' && !location.search.includes('edit') && [...document.querySelectorAll('[role=dialog] h2')].some(h => h.textContent.trim() === 'Edit Profile')"), 'the pen opens the profile with Edit Profile open', 20000);
  await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  // 5. Settings > Voice: the squad's voices, no key field.
  await browser.navigate(`${bridge.origin}/settings/voice`);
  await until(() => browser.evaluate("document.querySelectorAll('[data-testid=voice-settings-member]').length === 2"), 'the squad listed in Settings > Voice', 30000);
  const settingsText = await browser.evaluate("document.querySelector('[data-testid=voice-settings]').innerText");
  assert.match(settingsText, /Eva\s+Simone/); assert.match(settingsText, /Thiago\s+Owen/);
  assert.ok(!(await browser.evaluate("document.body.innerText.includes('ElevenLabs')")), 'no ElevenLabs anywhere');
  await shoot('settings-voice');

  // 6. Edit profile offers the voice.
  await browser.navigate(`${bridge.origin}/squad-members/voice-thiago`);
  await until(() => browser.evaluate("[...document.querySelectorAll('button')].some(button => button.innerText.trim() === 'Edit')"), 'profile Edit', 30000);
  await browser.click('Edit');
  await until(() => browser.evaluate("!!document.querySelector('[role=dialog] [data-testid=voice-picker]')"), 'the voice in Edit profile', 20000);
  assert.equal(await browser.evaluate("document.querySelector('[role=dialog] [data-testid=voice-picker] [aria-checked=true]')?.dataset.voice"), 'm3');
  await shoot('edit-profile-voice');
  assert.deepEqual(browser.errors, []);
  console.log('PASS read aloud: the bridge serves kale-tts-1 and the worker speaks real sentences; Eva and Thiago get fitting voices saved once; each member\'s Voice page (from its sidebar and Home) plays a sample through the reader; a new choice is saved; the member card names the voice with a sample and offers pen and eye icons; Settings > Voice lists the voices with no ElevenLabs; Edit profile offers the voice.');
} finally {
  await browser?.close();
  await bridge.close();
}
