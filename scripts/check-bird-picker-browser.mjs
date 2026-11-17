// The bird picker and changing a member's avatar, in the built app against a
// real bridge (ADR-0243):
// - the profile card's face opens the picker; it lists all 300 birds with the
//   current one first, draws faces lazily, searches by name without changing
//   its own height, and moves by keyboard;
// - Save changes the member everywhere it is drawn in this window and posts
//   the status snapshot the menu bar and phone read, at once;
// - every member menu offers Change avatar;
// - a member changing its own avatar with squad_set_avatar (a real bridge turn
//   on the fixture engine) reaches the same places without a reload.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { prepareModelRoutingFixture } from './lib/model-routing-fixtures.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';

const artifact = '.codex-artifacts/bird-picker';
await mkdir(artifact, { recursive: true });
const bridge = await startBridge({ prepare: prepareModelRoutingFixture });
let browser;
try {
  const member = { id: 'asq_bird_fixture', name: 'Wren Tester', role: 'Reviewer', avatar: '/avatars/birds/tui.webp', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, modelAssignment: { mode: 'override', provider: 'autohandai', model: 'fixture-moa' }, permissions: {} };
  await bridge.api('/api/members/' + member.id + '/channel-access', 'PUT', { agent: member, profile: '' });
  browser = await startBrowser();
  const context = await seedOwnedBrowserFixture(bridge, browser);
  const membersKey = `autohandSquad.owner.v1.${context.storageKey}.${encodeURIComponent('autohandSquad.v1.agents')}`;
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__membersKey=${JSON.stringify(membersKey)};` });
  const storedAvatar = () => browser.evaluate(`JSON.parse(localStorage.getItem(window.__membersKey)||'[]').find(agent=>agent.id===${JSON.stringify(member.id)})?.avatar||''`);
  const drawnBirds = () => browser.evaluate(`[...document.querySelectorAll('[data-bird]')].filter(node=>!node.closest('[role=radiogroup]')&&node.getBoundingClientRect().width).map(node=>node.dataset.bird)`);
  const statusAvatar = async () => ((await bridge.api('/api/status/snapshot')).data?.members || []).find(row => row.id === member.id)?.avatar || '';

  // The profile card: the face is the way in.
  await browser.navigate(bridge.origin + '/squad-members/' + member.id + '/home');
  await until(() => browser.evaluate(`Boolean(document.querySelector('[data-testid=profile-avatar-button]'))`), 'profile card avatar button', 60000);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=profile-avatar-button]').getAttribute('aria-label')`), 'Change Wren Tester’s avatar');
  await until(async () => (await drawnBirds()).includes('tui'), 'the member is drawn as its Tūī');
  // Edit profile uses the same picker, without country headings.
  await browser.click('Edit');
  await until(() => browser.evaluate(`document.querySelectorAll('[role=dialog] [role=radiogroup] [role=radio]').length===300`), 'Edit profile lists 300 birds');
  assert.equal(await browser.evaluate(`/New Zealand|Brazil|United States/.test(document.querySelector('[role=dialog]').innerText)`), false, 'Edit profile has no country headings');
  await new Promise(done => setTimeout(done, 400));
  await browser.screenshot(artifact + '/edit-profile.png');
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => browser.evaluate(`!document.querySelector('[role=dialog]')`), 'Edit profile closes');
  await browser.evaluate(`document.querySelector('[data-testid=profile-avatar-button]').click()`);
  await until(() => browser.evaluate(`Boolean(document.querySelector('[data-testid=member-avatar-dialog] [role=radiogroup]'))`), 'picker dialog');
  const grid = await browser.evaluate(`(()=>{const radios=[...document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]')];return{count:radios.length,first:radios[0].dataset.bird,checked:radios.filter(r=>r.getAttribute('aria-checked')==='true').map(r=>r.dataset.bird),drawn:radios.filter(r=>r.querySelector('svg')).length,tabbable:radios.filter(r=>r.tabIndex===0).length,focusInSearch:document.activeElement?.dataset?.testid==='bird-search',countries:/New Zealand|Brazil|United States/.test(document.querySelector('[data-testid=member-avatar-dialog]').innerText)}})()`);
  assert.equal(grid.count, 300, 'all 300 birds are offered');
  assert.equal(grid.first, 'tui', 'the current bird leads');
  assert.deepEqual(grid.checked, ['tui']);
  // Faces arrive for the cells in and near view, not for all 300.
  const drawnCount = () => browser.evaluate(`[...document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]')].filter(r=>r.querySelector('svg')).length`);
  await until(async () => (await drawnCount()) >= 30, 'faces in view are drawn');
  await new Promise(done => setTimeout(done, 500));
  grid.drawn = await drawnCount();
  assert.ok(grid.drawn < 150, `only faces near view are drawn (${grid.drawn} of 300)`);
  assert.equal(grid.tabbable, 1, 'the grid is one keyboard stop');
  assert.ok(grid.focusInSearch, 'search has focus when the picker opens');
  assert.equal(grid.countries, false, 'no country headings');
  await new Promise(done => setTimeout(done, 400));
  await browser.screenshot(artifact + '/picker-open.png');

  // Search by name; the grid keeps its height while the results change.
  const heightBefore = await browser.evaluate(`document.querySelector('[data-testid=bird-grid-scroll]').getBoundingClientRect().height`);
  await browser.fill('[data-testid=bird-search]', 'owl');
  await until(() => browser.evaluate(`document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]').length<20`), 'search narrows the grid');
  const owls = await browser.evaluate(`[...document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]')].map(r=>r.getAttribute('aria-label'))`);
  assert.ok(owls.length >= 8 && owls.every(label => /owl|Ruru/i.test(label)), `owl search: ${owls.join(', ')}`);
  assert.ok(!owls.includes('Indian peafowl'), 'search matches word starts');
  const heightAfter = await browser.evaluate(`document.querySelector('[data-testid=bird-grid-scroll]').getBoundingClientRect().height`);
  assert.ok(Math.abs(heightAfter - heightBefore) < 1, `no layout jump while searching (${heightBefore} -> ${heightAfter})`);
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]')].every(r=>r.querySelector('svg'))`), 'visible results are drawn');
  // Keyboard: ArrowDown from search enters the grid, arrows move, Enter picks.
  await browser.evaluate(`document.querySelector('[data-testid=bird-search]').focus()`);
  const key = async (name, code = name, keyCode = 0) => { await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode }); };
  await key('ArrowDown', 'ArrowDown', 40);
  await until(() => browser.evaluate(`document.activeElement?.getAttribute('role')==='radio'&&document.activeElement.dataset.index==='0'`), 'focus moves into the grid');
  await key('ArrowRight', 'ArrowRight', 39);
  await until(() => browser.evaluate(`document.activeElement?.dataset.index==='1'`), 'ArrowRight moves one bird');
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=member-avatar-dialog] [role=radio]')].find(r=>r.dataset.bird==='barnowl').click()`);
  await until(() => browser.evaluate(`document.querySelector('[data-testid=member-avatar-save]')?.disabled===false`), 'Save enabled for a new bird');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=member-avatar-dialog] [role=radio]').dataset.bird`), 'ruru', 'a clicked bird stays where it was (the Ruru still leads the owls)');
  assert.ok(await browser.evaluate(`document.querySelector('[data-testid=member-avatar-dialog]').innerText.includes('Barn owl')`), 'the dialog names the chosen bird');
  await new Promise(done => setTimeout(done, 200));
  await browser.screenshot(artifact + '/picker-search.png');
  const posted = Date.now();
  await browser.evaluate(`document.querySelector('[data-testid=member-avatar-save]').click()`);

  // Everywhere in this window, and the snapshot the menu bar and phone read.
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=member-avatar-dialog]')`), 'dialog closes on save');
  await until(async () => (await storedAvatar()) === '/avatars/birds/barnowl.webp', 'member saved with its new bird');
  await until(async () => { const birds = await drawnBirds(); return birds.length > 1 && birds.every(bird => bird !== 'tui') && birds.includes('barnowl'); }, 'every face of the member is the barn owl');
  await until(async () => (await statusAvatar()) === '/avatars/birds/barnowl.webp', 'status snapshot carries the new bird', 5000);
  const reachedMenuBar = Date.now() - posted;
  assert.ok(reachedMenuBar < 5000, `the menu bar's snapshot updated in ${reachedMenuBar} ms, not at the 15 s post`);
  await browser.screenshot(artifact + '/profile-after-save.png');
  // The bridge copy is the roster each launch starts from, so the bird is
  // saved there too and survives a reload.
  await until(async () => (await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent.avatar === '/avatars/birds/barnowl.webp', 'the bird is saved on the bridge copy');

  // Every member menu offers it.
  await browser.navigate(bridge.origin + '/conversations/new?member=' + member.id);
  await until(() => browser.evaluate(`Boolean(document.querySelector('textarea[placeholder="Talk to Wren Tester..."]'))`), 'chat composer', 20000);
  await until(async () => (await drawnBirds()).length && (await drawnBirds()).every(bird => bird === 'barnowl'), 'the barn owl survives a reload');
  await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Actions for Wren Tester'&&b.getBoundingClientRect().width).click()`);
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Change avatar…')`), 'member menu offers Change avatar');
  await browser.click('Change avatar…');
  await until(() => browser.evaluate(`document.querySelector('[data-testid=member-avatar-dialog] [role=radio]')?.dataset.bird==='barnowl'`), 'menu opens the picker on the current bird');
  await key('Escape', 'Escape', 27);
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=member-avatar-dialog]')`), 'Escape closes the picker');

  // The member changes its own avatar through the team MCP server.
  await browser.fill('textarea[placeholder="Talk to Wren Tester..."]', 'Pick a new bird for yourself: MCP_AVATAR_kea');
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Send chat message'&&!b.disabled)`), 'message ready');
  await browser.click('Send chat message');
  await until(async () => (await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent.avatar === '/avatars/birds/kea.webp', 'squad_set_avatar saved on the bridge', 60000);
  await until(async () => (await storedAvatar()) === '/avatars/birds/kea.webp', 'the receipt reached this window without a reload', 15000);
  await until(async () => { const birds = await drawnBirds(); return birds.length && birds.every(bird => bird === 'kea'); }, 'sidebar, header and chat draw the kea', 10000);
  await until(async () => (await statusAvatar()) === '/avatars/birds/kea.webp', 'status snapshot follows the member tool', 5000);
  assert.ok(await browser.evaluate(`document.body.innerText.includes('Wren Tester is now the Kea')`), 'the chat shows the receipt line');
  const toolRow = (await readFile(join(bridge.directory, 'model-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).findLast(row => row.kind === 'avatar-tool');
  assert.ok(toolRow && !toolRow.response.result?.isError, 'the tool call succeeded');
  await browser.screenshot(artifact + '/after-member-tool.png');
  assert.deepEqual(browser.errors, []);
  console.log(`PASS picker (300 birds, current first, ${grid.drawn} of 300 faces drawn once settled, word-start search, steady height, keyboard), Save reaches every face and the menu-bar snapshot in ${reachedMenuBar} ms and survives a reload, member menu entry, squad_set_avatar reaches the window live.`);
} catch (error) {
  if (browser) {
    await browser.screenshot(artifact + '/failure.png').catch(() => {});
    console.error(await browser.evaluate(`document.body.innerText.slice(-2500)`).catch(() => ''));
    console.error('page errors', browser.errors);
  }
  console.error(bridge.logs.slice(-2000));
  throw error;
} finally {
  await browser?.close();
  await bridge.close();
}
