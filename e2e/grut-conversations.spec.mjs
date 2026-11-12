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
    ],
    [other.id]: [{ id: 'grut-noah', role: 'agent', body: 'The design review is ready.', status: 'complete', startedAt: new Date(now - 120000).toISOString(), time: clock(now - 120000) }],
  } }); expect(saved.success, saved.error).toBe(true);
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
  await expect(conversations.getByRole('button', { name: /^Noah,/ })).toContainText('The design review is ready.');
  await expect(conversations.getByRole('button', { name: 'Group chat: Release reviewers', exact: true })).toBeVisible();
  expect((await conversations.getByRole('button').allTextContents())[0]).toContain('Eva');
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
