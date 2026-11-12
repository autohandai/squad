import assert from 'node:assert/strict';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

for (const [theme, width] of [['light', 1440], ['dark', 380]]) {
  let home, browser;
  const bridge = await startBridge({ development: false, prepare: async directory => {
    home = join(directory, 'home'); await mkdir(home);
    return { HOME: home, USERPROFILE: home };
  } });
  try {
    browser = await startBrowser({ disableBackForwardCache: true });
    const member = { id: 'folder-eva', name: 'Eva', role: 'Engineer', workspace: '', projects: [], permissions: {}, harness: { id: 'claude' }, skills: [], memory: [], status: 'online', avatar: '/avatars/birds/kiwi.webp' };
    const fixtures = { agents: [member], removedAgents: initialAgents.map(agent => agent.id), tasks: [], messages: {}, channels: [], channelMessages: {}, channelThreads: {}, automations: [], memoryInbox: [], onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' }, theme: { mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' } };
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await seedOwnedBrowserFixture(bridge,browser,{members:[member],messages:{},storage:Object.fromEntries(Object.entries(fixtures).filter(([key])=>!['agents','messages','theme'].includes(key)).map(([key,value])=>['autohandSquad.v1.'+key,JSON.stringify(value)]))});
    await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('autohandSquad.v1.theme',${JSON.stringify(JSON.stringify({mode:theme,lightTheme:'autohand-light',darkTheme:'autohand-dark'}))});`});
    await browser.navigate(`${bridge.origin}/squad-members/new`);
    await until(() => browser.evaluate(`!!document.querySelector('[data-testid="default-workspace-consent"]')`), 'New member asks for its work folder');
    await browser.fill('#member-description', 'Keep this role draft while choosing where to work');
    await browser.navigate(`${bridge.origin}/squad-members/new?start=chat`);
    await until(() => browser.evaluate(`document.body.innerText.includes('Choose where your new member works') && !!document.querySelector('[data-testid="default-workspace-consent"]')`), 'Chat with a new member asks before creating its folder');
    await assert.rejects(access(join(home, 'Documents', 'autohand-desktop')));
    await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
    await until(() => browser.evaluate(`location.pathname === "/conversations/new" && document.readyState === "complete" && !!document.querySelector('[data-testid="default-workspace-consent"]')`), 'default folder consent appears');
    const folder = join(home, 'Documents', 'autohand-desktop');
    await assert.rejects(access(folder));
    await browser.fill('textarea', 'Keep this draft while I choose a folder');
    await browser.screenshot(`.codex-artifacts/agent-work/default-folder-${theme}-consent.png`);
    await browser.click('Create folder');
    await until(() => browser.evaluate(`!document.querySelector('[data-testid="default-workspace-consent"]')`), 'consent creates and selects default folder', 20000).catch(async error => { throw new Error(`${error.message}; page: ${await browser.evaluate('document.body.innerText')}; profile: ${JSON.stringify(await bridge.api(`/api/control-plane/members/${member.id}`))}`); });
    await access(folder); await assert.rejects(access(join(folder, '.git')));
    assert.equal(await browser.evaluate(`document.querySelector('textarea').value`), 'Keep this draft while I choose a folder');
    await until(async () => (await bridge.api(`/api/control-plane/members/${member.id}`)).data?.workspace === folder,
      'chosen folder belongs to the saved member profile');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'consent fits the viewport');
    assert.deepEqual(browser.errors, []);
    await browser.screenshot(`.codex-artifacts/agent-work/default-folder-${theme}-selected.png`);
    console.log(`PASS ${theme} ${width}px: creation consent, saved folder, draft retention, no Git initialization or page overflow.`);
  } finally { await browser?.close(); await bridge.close(); }
}

// The unassigned draft moves into the new default-folder scope on refresh.
{
  let home, browser;
  const bridge = await startBridge({ development: false, prepare: async directory => {
    home = join(directory, 'home'); await mkdir(home); return { HOME: home, USERPROFILE: home };
  } });
  try {
    browser = await startBrowser({ disableBackForwardCache: true });
    await seedOwnedBrowserFixture(bridge,browser);
    await browser.navigate(bridge.origin + '/squad-members/new');
    await until(() => browser.evaluate(`!!document.querySelector('[data-testid="default-workspace-consent"]')`), 'blank member draft folder choice');
    await browser.fill('#member-description', 'A release engineer who verifies every signed build');
    await until(() => browser.evaluate(`Object.keys(localStorage).some(key => key.includes('memberCreation') && (localStorage.getItem(key) || '').includes('A release engineer'))`), 'role draft saved before folder choice');
    await browser.click('Create folder');
    await until(() => browser.evaluate(`!document.querySelector('[data-testid="default-workspace-consent"]')`), 'member draft selects the default folder');
    await browser.send('Page.reload');
    await until(() => browser.evaluate(`document.querySelector('#member-description')?.value === 'A release engineer who verifies every signed build'`), 'role draft survives the default folder becoming available on reload');
    await assert.rejects(access(join(home, 'Documents', 'autohand-desktop', '.git')));
    console.log('PASS New member: consented default-folder selection retains the role draft across reload.');
  } finally { await browser?.close(); await bridge.close(); }
}
