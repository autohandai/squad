import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatStore, buildChatRecord } from '../server/chats/store.mjs';
import { initialAgents } from '../src/data.js';
import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';

for (const [theme, width] of [['light', 1440], ['dark', 380]]) {
  let browser;
  const member = { id: 'history-eva', name: 'Eva', role: 'Engineer', workspace: process.cwd(), projects: [{ path: process.cwd() }], permissions: {}, harness: { id: 'claude' }, skills: [], memory: [], status: 'online', avatar: '/avatars/birds/kiwi.webp' };
  const bridge = await startBridge({ development: false, prepare: async directory => {
    const store = new ChatStore({ squadStateDir: join(directory, 'squad') });
    for (const [id, title] of [['chat-one', 'First release discussion'], ['chat-two', 'Second release discussion']]) await store.save(buildChatRecord(member.id, { title, messages: [{ id: `${id}-u`, role: 'user', body: title, status: 'complete' }, { id: `${id}-a`, role: 'agent', body: `Full answer for ${id}`, status: 'complete' }] }, { id }));
    await writeFile(join(directory, 'squad', 'member-threads.json'), JSON.stringify({ version: 1, threads: [{ id: 'dm-ready', memberId: member.id, parentMessageId: 'root', root: { id: 'root', role: 'agent', body: 'Inspect the release artifact' }, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }));
    return {};
  } });
  try {
    browser = await startBrowser();
    const fixtures = { agents: [member], removedAgents: initialAgents.map(agent => agent.id), tasks: [], messages: {}, channels: [], channelMessages: {}, channelThreads: {}, automations: [], memoryInbox: [], onboarding: { version: 1, status: 'skipped', lastStep: 'skipped' }, theme: { mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' } };
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!localStorage.getItem('history-fixture')) { for (const [key,value] of Object.entries(${JSON.stringify(fixtures)})) localStorage.setItem('autohandSquad.v1.'+key, JSON.stringify(value)); localStorage.setItem('history-fixture','true'); }` });
    await browser.navigate(`${bridge.origin}/conversations/new?member=${member.id}`);
    await until(() => browser.evaluate(`!!document.querySelector('[data-testid="previous-chats"]')`), 'history control');
    await browser.click('History');
    await until(() => browser.evaluate(`document.querySelectorAll('[data-history-kind]').length === 3`), 'saved chats and threads in the same view');
    await browser.click('Select First release discussion'); await browser.click('Select Inspect the release artifact');
    await browser.fill('input[aria-label="Merged conversation name"]', 'Release decisions');
    await until(() => browser.evaluate(`(() => { const r = document.querySelector('[aria-label="Conversation history"]').getBoundingClientRect(); return r.x >= -1 && r.right <= innerWidth + 1; })()`), 'history sheet finishes its slide and fits the viewport');
    await browser.screenshot(`.codex-artifacts/agent-work/history-${theme}-selected.png`);
    await browser.click('Merge selected');
    await until(() => browser.evaluate(`document.querySelector('[data-testid="conversation-history"]').innerText.includes('Release decisions')`), 'merged transcript added');
    const listed = (await bridge.api(`/api/members/${member.id}/history`)).data.items;
    assert.equal(listed.length, 4, 'the rendered merge retains originals');
    const merged = listed.find(item => item.title === 'Release decisions');
    assert.equal((await bridge.api(`/api/members/${member.id}/chats/${merged.id}`)).data.messages.length, 3);
    await browser.evaluate(`document.querySelector('[data-history-kind="thread"] div button').click()`);
    await until(() => browser.evaluate(`!!document.querySelector('[data-testid="member-reply-thread"]') && !document.querySelector('[data-testid="conversation-history"]')`), 'history opens the existing independent thread');
    await browser.click('Close'); await browser.click('History');
    await until(() => browser.evaluate(`document.querySelectorAll('[data-history-kind]').length === 4`), 'history can be reopened after visiting a thread');
    await browser.click('Select Second release discussion');
    await browser.click('Delete selected');
    assert.equal((await bridge.api(`/api/members/${member.id}/history`)).data.items.length, 4, 'first click only asks for confirmation');
    await browser.click('Delete 1 for good?');
    await until(async () => (await bridge.api(`/api/members/${member.id}/history`)).data.items.length === 3, 'selected conversation deleted');
    await until(() => browser.evaluate(`!document.querySelector('button[aria-label="Select Inspect the release artifact"]').disabled`), 'history deletion finishes saving');
    await browser.click('Select Inspect the release artifact');
    await browser.click('Delete selected'); await browser.click('Delete 1 for good?');
    await until(() => browser.evaluate(`!document.querySelector('[data-history-kind="thread"]')`), 'reply thread deleted from unified history');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    assert.deepEqual(browser.errors, []);
    await browser.screenshot(`.codex-artifacts/agent-work/history-${theme}-merged.png`);
    console.log(`PASS history ${theme} ${width}px: unified list, select and merge, originals retained, confirmed chat/thread deletion, no page overflow.`);
  } finally { await browser?.close(); await bridge.close(); }
}
