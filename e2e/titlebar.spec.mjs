import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const script = await readFile(new URL('../src-tauri/src/titlebar.js', import.meta.url), 'utf8');
test('native titlebar gestures exclude controls and cancel when the pointer moves', async ({ page }) => {
  await page.setContent(`<div data-tauri-drag-region="deep" style="padding:40px">
    <div id="blank" style="height:40px">Empty titlebar space <span id="label">label</span></div>
    <button id="button">Button</button><a href="#link" id="link">Link</a>
    <input id="input" value="Editable"><span role="button" tabindex="0" id="role">Role button</span>
    <span contenteditable="true" id="editable">Editable label</span>
    <div data-tauri-drag-region="false" id="blocked">Disabled drag region</div>
  </div><div data-tauri-drag-region id="self">Self only <span id="child">Child</span></div>`);
  await page.evaluate(() => {
    window.calls = []; window.bubbled = 0;
    window.__TAURI_INTERNALS__ = { invoke: async command => { window.calls.push(command); } };
    document.addEventListener('mouseup', () => { window.bubbled++; });
  });
  await page.addScriptTag({ content: script });
  await page.locator('#blank').click();
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  for (const target of ['#blank', '#label', '#self']) {
    await page.evaluate(() => { window.calls = []; window.bubbled = 0; });
    await page.locator(target).dblclick();
    expect(await page.evaluate(() => window.calls)).toEqual(['squad_titlebar_double_click']);
    expect(await page.evaluate(() => window.bubbled)).toBe(1); // First mouseup only.
  }
  for (const target of ['#button', '#link', '#input', '#role', '#editable', '#blocked', '#child']) {
    await page.evaluate(() => { window.calls = []; window.bubbled = 0; });
    await page.locator(target).dblclick();
    expect(await page.evaluate(() => window.calls), target).toEqual([]);
    expect(await page.evaluate(() => window.bubbled), target).toBe(2);
  }
  await page.evaluate(() => { window.calls = []; });
  const bounds = await page.locator('#blank').boundingBox();
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down({ button: 'left', clickCount: 2 });
  await page.mouse.move(bounds.x + 15, bounds.y + 10);
  await page.mouse.up({ button: 'left', clickCount: 2 });
  expect(await page.evaluate(() => window.calls)).toEqual([]);
  // A script cannot synthesize a trusted native chrome gesture.
  await page.locator('#blank').dispatchEvent('mousedown', { button: 0, detail: 2 });
  await page.locator('#blank').dispatchEvent('mouseup', { button: 0, detail: 2 });
  expect(await page.evaluate(() => window.calls)).toEqual([]);
});
