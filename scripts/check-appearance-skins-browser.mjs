#!/usr/bin/env node
// Exercise the actual Appearance controls in disposable browser/bridge state.
// --repro=grut and --repro=presets isolate the two reported regressions.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { SKINS } from '../src/lib/skins.js';
import { BLOB_SHAPES, BLOB_EXPRESSIONS, blobSvg } from '../src/lib/blob-avatar.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

const repro = process.argv.find(value => value.startsWith('--repro='))?.slice(8);
const desktop = process.argv.includes('--desktop');
const shots = `.codex-artifacts/appearance/${desktop ? 'desktop' : 'browser'}`;
await mkdir('.codex-artifacts/appearance', { recursive: true });
await mkdir(shots, { recursive: true });
const workspace = await mkdtemp(join(process.cwd(), '.codex-artifacts/appearance/project-'));
const bridge = await startBridge();
let browser;
try {
  browser = await startBrowser();
  if (desktop) await browser.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AutohandSquadDesktop/0.1.9' });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const member = { ...initialAgents[0], id: 'appearance-eva', name: 'Eva', workspace, projects: [{ path: workspace }], skills: [] };
  const members = [member, ...initialAgents.slice(1, 4).map(agent => ({ ...agent, workspace, projects: [{ path: workspace }], skills: [] }))];
  const messages = [
    { id: 'appearance-question', role: 'user', body: 'Can you review the release checklist before we ship?', status: 'complete', time: '9:41 AM' },
    { id: 'appearance-answer', role: 'agent', body: 'The release checklist is ready.\n\n## Ready for review\n\n- The onboarding flow keeps your workspace and member details.\n- Quick Chat follows your appearance settings.\n- The team can resume queued work after restarting.\n\nI recommend one final look at the download page before publishing.', status: 'complete', time: '9:42 AM' },
  ];
  const storage = { agents: members, removedAgents: initialAgents.map(agent => agent.id), tasks: [], channels: [], messages: { [member.id]: messages }, automations: [],
    onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' }, skin: 'grut', theme: { mode: 'dark', lightTheme: 'autohand-light', darkTheme: 'autohand-dark' } };
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if(!localStorage.getItem('appearanceProof.seeded')){localStorage.clear();for(const [key,value]of Object.entries(${JSON.stringify(storage)}))localStorage.setItem('autohandSquad.v1.'+key,key==='skin'?value:JSON.stringify(value));localStorage.setItem('appearanceProof.seeded','true');}` });
  await browser.navigate(bridge.origin + '/settings/appearance');
  await until(() => browser.evaluate(`!!document.querySelector('#skin-title') && document.documentElement.dataset.skin==='grut'`), 'Appearance ready', 30000);
  if (repro !== 'presets') {
    await browser.click('Light');
    await until(() => browser.evaluate(`document.documentElement.dataset.themeMode==='light'`), 'Light preference selected');
    const actual = await browser.evaluate(`({mode:document.documentElement.dataset.themeMode,surface:document.documentElement.dataset.themeSurface,background:getComputedStyle(document.documentElement).getPropertyValue('--background').trim()})`);
    await browser.screenshot('.codex-artifacts/appearance/grut-light.png');
    assert.equal(actual.surface, 'light', `Grut Light must render a light surface: ${JSON.stringify(actual)}`);
    assert.notEqual(actual.background, '#0d0d0f', 'Grut Light must not keep the dark palette');
  }
  if (repro !== 'grut') assert.equal(await browser.evaluate(`!!document.getElementById('theme-presets-title')`), false, 'Theme presets must be absent when Grut is selected');
  if (!repro) {
    const selectSkin = async id => {
      await browser.evaluate(`document.querySelector('[data-skin-option="${id}"]').click()`);
      await until(() => browser.evaluate(`document.documentElement.dataset.skin===${JSON.stringify(id)}`), `select ${id}`);
    };
    const selectMode = async mode => {
      await browser.click(mode[0].toUpperCase() + mode.slice(1));
      await until(() => browser.evaluate(`document.documentElement.dataset.themeMode===${JSON.stringify(mode)}`), `select ${mode}`);
    };
    const load = async path => {
      if (path.startsWith('/app-info')) await browser.navigate(bridge.origin + path);
      else await browser.evaluate(`history.pushState({},'',${JSON.stringify(path)});window.dispatchEvent(new PopStateEvent('popstate'))`);
      await until(() => browser.evaluate(`!document.getElementById('boot') && !!document.querySelector(${JSON.stringify(path.startsWith('/settings') ? '#skin-title' : path.startsWith('/app-info') ? 'h1' : 'textarea')})`), `load ${path}`, 30000);
      await browser.evaluate('document.fonts.ready');
    };
    const state = () => browser.evaluate(`(() => {
      const html=document.documentElement, css=getComputedStyle(html);
      const root=getComputedStyle(document.body), sidebar=document.querySelector('.app-sidebar'), input=document.querySelector('textarea');
      return {skin:html.dataset.skin,mode:html.dataset.themeMode,surface:html.dataset.themeSurface,
        background:css.getPropertyValue('--background').trim(),card:css.getPropertyValue('--card').trim(),
        bodyBackground:root.backgroundColor,font:root.fontFamily,stretch:css.fontStretch,fontSize:css.fontSize,
        radius:css.getPropertyValue('--radius').trim(),avatarRadius:css.getPropertyValue('--skin-avatar-radius').trim(),
        headingFont:document.querySelector('h3')?getComputedStyle(document.querySelector('h3')).fontFamily:'',
        sidebar:sidebar?getComputedStyle(sidebar).backgroundColor:null,input:input?getComputedStyle(input).color:null,
        meta:document.querySelector('meta[name="theme-color"]')?.content,
        presets:!!document.querySelector('[data-testid="theme-presets"]'),
        overflow:document.documentElement.scrollWidth-innerWidth,shell:html.dataset.shell,
        titleInset:css.getPropertyValue('--titlebar-inset').trim()}; })()`);
    const rgb = hex => `rgb(${[1,3,5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
    const report = [];
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-skin-option]').length`), 8);
    assert.equal(await browser.evaluate(`document.querySelector('[data-skin-option="grut"]').getAttribute('role')`), 'radio');
    // The picker is a real roving-focus radio group, with visible keyboard focus.
    await browser.evaluate(`document.querySelector('[data-skin-option="grut"]').focus()`);
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown' });
    await until(() => browser.evaluate(`document.activeElement.dataset.skinOption==='paper'`), 'roving focus moves to Paper');
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await until(() => browser.evaluate(`document.documentElement.dataset.skin==='paper'`), 'keyboard selection');
    assert.equal(await browser.evaluate(`document.querySelector('[data-skin-option="paper"]').getAttribute('aria-checked')`), 'true');

    // Keep non-default Autohand presets while custom skins own their palette.
    await selectSkin('default');
    const choosePreset = async (label, option) => {
      await browser.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
      await until(() => browser.evaluate(`!![...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(option)})`), `open ${label}`);
      const point = await browser.evaluate(`(() => {const el=[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(option)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      await until(() => browser.evaluate(`!document.querySelector('[role="listbox"]')`), `choose ${option}`);
    };
    await choosePreset('Light theme Theme presets', 'Xcode');
    await choosePreset('Dark theme Theme presets', 'Terminal');
    const preference = () => browser.evaluate(`JSON.parse(localStorage.getItem('autohandSquad.v1.theme'))`);
    assert.equal((await preference()).lightTheme, 'xcode-light');
    assert.equal((await preference()).darkTheme, 'terminal-green');

    for (const skin of SKINS) {
      await selectSkin(skin.id);
      for (const mode of ['light', 'dark']) {
        await selectMode(mode);
        const settings = await state();
        assert.equal(settings.surface, mode, `${skin.id}: Mode controls the surface`);
        assert.equal(settings.presets, skin.id === 'default', `${skin.id}: preset visibility`);
        const expected = skin.id === 'default' ? mode === 'light' ? '#ffffff' : '#050806' : skin.tokens[mode].background;
        assert.equal(settings.background, expected);
        assert.equal(settings.bodyBackground, desktop && skin.id === 'default' ? 'rgba(0, 0, 0, 0)' : rgb(expected), `${skin.id}/${mode}: body paint (Autohand desktop preserves native vibrancy)`);
        assert.equal(settings.meta, expected, 'browser chrome follows the skin');
        assert.ok(settings.overflow <= 1, `${skin.id}/${mode}: no horizontal overflow`);
        assert.equal(settings.shell === 'desktop', desktop);
        if (desktop) assert.equal(settings.titleInset, '28px');
        if (skin.id === 'paper') assert.match(settings.headingFont, /Iowan Old Style|Georgia/);
        if (skin.id === 'blueprint') assert.match(settings.font, /Autohand Mono/);
        if (skin.id === 'slate') assert.equal(settings.stretch, '90%');
        await browser.evaluate('window.scrollTo(0,0)');
        await browser.screenshot(`${shots}/${skin.id}-${mode}-settings.png`);
        await load(`/conversations/new?member=${member.id}`);
        await until(() => browser.evaluate(`!!document.querySelector('[data-message-id="appearance-answer"]')`), 'saved conversation rendered');
        const chat = await state();
        assert.equal(chat.background, expected);
        assert.equal(chat.surface, mode);
        if (skin.id !== 'default') assert.equal(chat.sidebar, rgb(skin.tokens[mode].card), `${skin.id}/${mode}: sidebar follows the palette`);
        assert.ok(chat.input, 'composer rendered');
        assert.ok(chat.overflow <= 1, `${skin.id}/${mode}: conversation fits`);
        await browser.screenshot(`${shots}/${skin.id}-${mode}-chat.png`);
        report.push({ skin: skin.id, mode, ...chat });
        await load('/settings/appearance');
      }
      await selectMode('system');
      for (const system of ['light', 'dark']) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: system }] });
        await until(() => browser.evaluate(`document.documentElement.dataset.themeSurface===${JSON.stringify(system)}`), `${skin.id} follows System ${system}`);
      }
    }
    assert.equal((await preference()).lightTheme, 'xcode-light', 'skin switching preserves the light preset');
    assert.equal((await preference()).darkTheme, 'terminal-green', 'skin switching preserves the dark preset');
    await selectSkin('paper'); await selectMode('light');
    await browser.evaluate('window.appearanceProofBeforeReload=true');
    await browser.send('Page.reload');
    await until(() => browser.evaluate(`!window.appearanceProofBeforeReload&&document.documentElement.dataset.skin==='paper'&&document.documentElement.dataset.themeSurface==='light'&&!!document.querySelector('#skin-title')`), 'new document restores saved skin and mode after reload', 30000);
    for (const skin of SKINS) {
      await selectSkin(skin.id);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      assert.ok((await state()).overflow <= 1, `${skin.id}: narrow settings fit`);
      await browser.screenshot(`${shots}/${skin.id}-mobile-settings.png`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    }

    // About is a separate entry point. It must apply geometry with --vars and
    // resolve the same paired palette without writing preferences.
    await selectSkin('blueprint'); await selectMode('dark');
    const before = await preference();
    await load('/app-info/about');
    assert.equal((await state()).background, '#101c36');
    assert.match((await state()).font, /Autohand Mono/);
    assert.equal((await state()).radius, '0.125rem');
    assert.deepEqual(await preference(), before);

    // Raster proof: sibling ellipses looked plausible in markup but never
    // punched holes. Sample both eyes for every shape/expression on each mode.
    const blobs = BLOB_SHAPES.flatMap(shape => BLOB_EXPRESSIONS.map(expression => ({ shape, expression, svg: blobSvg({ shape, expression, colour: '#4d8df0' }) })));
    const pixels = await browser.evaluate(`(async () => {
      const result=[]; for(const blob of ${JSON.stringify(blobs)}) {
        const image=new Image(); image.src='data:image/svg+xml,'+encodeURIComponent(blob.svg); await image.decode();
        for(const background of ['#f7f7f8','#0d0d0f']) {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=100; const context=canvas.getContext('2d');
          context.fillStyle=background;context.fillRect(0,0,100,100);context.drawImage(image,0,0,100,100);
          const centres=blob.expression==='curious'?[[36,42],[64,50]]:blob.expression==='confused'?[[37,51],[63,41]]:blob.expression==='shy'?[[39,50],[61,50]]:blob.expression==='proud'?[[37,42],[63,42]]:['happy','laughing'].includes(blob.expression)?[[37,44],[63,44]]:blob.expression==='suspicious'?[[37,48],[63,48]]:blob.expression==='sleepy'?[[37,50],[63,50]]:[[37,46],[63,46]];
          result.push({shape:blob.shape,expression:blob.expression,background,eyes:centres.map(([x,y])=>Array.from(context.getImageData(x,y,1,1).data)),body:Array.from(context.getImageData(50,60,1,1).data)});
        }
      } return result;
    })()`);
    for (const sample of pixels) {
      const expected = [1,3,5].map(offset => parseInt(sample.background.slice(offset,offset+2),16));
      for (const eye of sample.eyes) assert.deepEqual(eye, [...expected,255], `${sample.shape}/${sample.expression}: transparent eyes on ${sample.background}`);
      assert.deepEqual(sample.body, [77,141,240,255]);
    }
    await writeFile(`${shots}/results.json`, JSON.stringify({ desktop, variants: report, blobSamples: pixels.length }, null, 2));
    console.log(`Appearance matrix passed (${desktop ? 'desktop CSS' : 'browser'}): 8 skins, 16 explicit surfaces, System changes, preset retention, reload, keyboard, narrow layout, About and ${pixels.length} blob raster samples.`);
  }
  assert.deepEqual(browser.errors, []);
  console.log('Appearance regression checks passed: Grut Light and skin-specific preset visibility.');
} catch (error) {
  if (browser) {
    await browser.screenshot(`${shots}/failure.png`).catch(() => {});
    console.error(await browser.evaluate(`JSON.stringify({path:location.pathname+location.search,body:document.body.innerText.slice(0,2000),errors:${JSON.stringify(browser.errors)}})`).catch(() => 'Browser state unavailable'));
  }
  throw error;
} finally { await browser?.close(); await bridge.close(); await rm(workspace, { recursive: true, force: true }); }
