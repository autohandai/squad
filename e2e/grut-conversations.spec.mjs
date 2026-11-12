import { test, expect } from '@playwright/test';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';

let fixture, other, group;
test.beforeAll(async () => {
  fixture = await startMobileFixture();
  const { bridge, member } = fixture;
  other = { ...member, id: 'fixture-noah', name: 'Noah', role: 'Product Designer' };
  expect((await bridge.api(`/api/members/${other.id}/channel-access`, 'PUT', { agent: other, profile: '', profilePatch: {} })).success).toBe(true);
  const created = await bridge.api('/api/group-chats', 'POST', { requestId: 'grut-reviewers', name: 'Release reviewers', memberIds: [member.id, other.id] });
  expect(created.success, created.error).toBe(true); group = created.data;
  const current = (await bridge.api('/api/owned/browser-state')).data;
  const now = Date.now();
  const clock = at => new Date(at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const saved = await bridge.api('/api/owned/browser-state', 'PUT', { baseRevision: current.revision || 0, messagesByAgent: {
    [member.id]: [
      { id: 'grut-user', role: 'user', body: 'Review the release plan and [checklist](https://example.test).', status: 'complete', startedAt: new Date(now - 60000).toISOString(), time: clock(now - 60000) },
      { id: 'grut-answer', role: 'agent', body: 'The checklist is ready.\n\n- Setup keeps the saved team.\n- The next release includes the updated MCP tools.', status: 'complete', startedAt: new Date(now).toISOString(), time: clock(now) },
      { id: 'grut-backfill', role: 'agent', body: 'Recovered older history.', status: 'complete', startedAt: new Date(now - 3600000).toISOString(), time: clock(now - 3600000) },
    ],
    [other.id]: [{ id: 'grut-noah', role: 'agent', body: 'The design review is ready.', status: 'complete', startedAt: new Date(now - 120000).toISOString(), time: clock(now - 120000) }],
  } }); expect(saved.success, saved.error).toBe(true);
  const channelState = (await bridge.api('/api/channels')).data;
  const threadId = 'grut-group-thread';
  const channelSaved = await bridge.api('/api/channels', 'PUT', { ...channelState, messages: [
    { id: 'grut-group-answer-2', channelId: group.id, threadId, parentMessageId: 'grut-group-user', role: 'agent', agentId: member.id, body: 'The group review includes the final notes.', status: 'complete', createdAt: new Date(now - 20000).toISOString() },
    { id: 'grut-group-answer', channelId: group.id, threadId, parentMessageId: 'grut-group-user', role: 'agent', agentId: member.id, body: 'The group review is ready.', status: 'complete', createdAt: new Date(now - 30000).toISOString() },
    { id: 'grut-group-followup', channelId: group.id, threadId: 'grut-group-followup-thread', role: 'user', body: 'Keep the notes here.', status: 'complete', createdAt: new Date(now - 140000).toISOString() },
    { id: 'grut-group-user', channelId: group.id, threadId, role: 'user', body: 'Review this together.', status: 'complete', createdAt: new Date(now - 150000).toISOString() },
  ] }); expect(channelSaved.success, channelSaved.error).toBe(true);
});
test.afterAll(async () => { await fixture?.bridge.close(); });

test('Grut selects a persistent conversation layout with real previews and existing group actions', async ({ page }, info) => {
  const { bridge, member } = fixture;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(bridge.origin + '/settings/appearance');
  await page.locator('[data-skin-option="grut"]').click();
  await page.getByRole('radio', { name: info.project.name.endsWith('light') ? 'Light' : 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'grut');
  await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'grut');
  await expect(page.locator('main')).toContainText('The checklist is ready.');
  const compact = info.project.name.startsWith('compact');
  if (compact) await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
  const sidebar = page.locator('.app-sidebar[data-sidebar-layout="conversations"]:visible');
  await expect(sidebar).toBeVisible();
  const conversations = sidebar.getByRole('navigation', { name: 'Conversations', exact: true });
  const eva = conversations.getByRole('button', { name: /^Eva,/ });
  await expect(eva).toContainText('The checklist is ready.');
  expect(await eva.locator('time').getAttribute('dateTime')).toBeTruthy();
  await expect(eva.locator('time')).toBeInViewport();
  const noah = conversations.getByRole('button', { name: /^Noah,/ });
  await expect(noah).toContainText('The design review is ready.');
  await sidebar.getByRole('button', { name: 'Actions for Noah', exact: true }).click();
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(noah.getByLabel('Pinned', { exact: true })).toBeVisible();
  await expect(conversations.getByRole('button', { name: 'Group chat: Release reviewers', exact: true })).toContainText('The group review includes the final notes.');
  const rowNames = await conversations.getByRole('button').filter({ has: page.locator('time') }).allTextContents();
  expect(rowNames[0]).toContain('Noah');
  expect(rowNames[1]).toContain('Eva');
  await page.screenshot({ path: info.outputPath('conversation-list.png'), fullPage: true, animations: 'disabled' });
  // Both the existing overflow and right-click action definitions remain live.
  await conversations.getByRole('button', { name: `Group chat: ${group.name}`, exact: true }).click({ button: compact ? 'left' : 'right' });
  if (compact) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Sidebar', exact: true }).tap();
    await sidebar.getByRole('button', { name: `Channel actions: ${group.name}`, exact: true }).tap();
  }
  await expect(page.getByRole('menuitem', { name: 'Rename group chat', exact: true })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Mute and hide', exact: true }).click();
  await expect(conversations.getByRole('button', { name: `Group chat: ${group.name}`, exact: true })).toHaveCount(0);
  const hidden = sidebar.getByRole('region', { name: 'Hidden channels', exact: true });
  await sidebar.getByRole('button', { name: 'Hidden channels · 1', exact: true }).click();
  await hidden.getByRole('button', { name: `Channel actions: ${group.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show in sidebar', exact: true }).click();
  await expect(conversations.getByRole('button', { name: `Group chat: ${group.name}`, exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'New message', exact: true }).click();
  await expect(page.getByTestId('conversation-composer')).toBeVisible();
  await page.goto(bridge.origin + `/channels/${group.id}`);
  const groupUser = page.locator('main [data-channel-message-id="grut-group-user"]');
  await expect(groupUser.locator('.chat-user-bubble')).toContainText('Review this together.');
  const groupPosition = await groupUser.evaluate(element => ({ left: element.getBoundingClientRect().left, parent: element.parentElement.getBoundingClientRect().left }));
  expect(groupPosition.left).toBeGreaterThan(groupPosition.parent);
  await groupUser.getByRole('button', { name: /^Thread:/ }).click();
  const groupAnswer = page.locator('main [data-channel-message-id="grut-group-answer"]');
  await expect(groupAnswer.locator('.chat-agent-answer')).toContainText('The group review is ready.');
  expect(await groupAnswer.locator('.chat-reply-avatar').evaluate(element => getComputedStyle(element).display)).toBe('none');
  for (const id of ['grut-group-answer-2', 'grut-group-followup']) {
    const consecutive = page.locator(`main [data-channel-message-id="${id}"]`);
    await expect(consecutive).toHaveAttribute('data-message-compact', 'true');
    const clock = consecutive.locator('.chat-channel-compact-time');
    await clock.scrollIntoViewIfNeeded();
    await expect(clock).toBeInViewport();
    expect(await clock.getAttribute('dateTime')).toBeTruthy();
  }
  await page.screenshot({ path: info.outputPath('group-thread.png'), fullPage: true, animations: 'disabled' });
  await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
  await expect(page.locator('main')).toContainText('The checklist is ready.');
  const answer = page.locator('main .chat-agent-answer').filter({ hasText: 'The checklist is ready.' });
  await expect(answer).toBeVisible();
  const surface = await answer.evaluate(element => ({ bubble: getComputedStyle(element).backgroundColor, page: getComputedStyle(document.body).backgroundColor }));
  expect(surface.bubble).not.toBe(surface.page);
  const user = page.locator('main .chat-user-bubble');
  const contrast = await user.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1);
    const background = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
    context.fillStyle = getComputedStyle(element.querySelector('p')).color; context.fillRect(0, 0, 1, 1);
    const foreground = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
    const luminance = rgb => [...rgb].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(background), b = luminance(foreground); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath('conversation.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(bridge.origin + '/settings/appearance');
  await page.locator('[data-skin-option="default"]').click();
  await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'default');
  if (compact) await page.getByRole('button', { name: 'Sidebar', exact: true }).tap();
  await expect(page.locator('.app-sidebar[data-sidebar-layout="workspace"]:visible')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Direct messages', exact: true })).toBeVisible();
  expect(Object.keys((await bridge.api('/api/channels')).data.agentChannelAccess)).toEqual([member.id, other.id]);
  expect(errors).toEqual([]);
});
