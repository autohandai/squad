import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';

// ADR-0233: Minified is a layout, not a skin. It works with every skin in
// light and dark, keeps the essentials reachable and leaves Quick Chat alone.
let fixture, group;
const team = [
  { id: 'fixture-noah', name: 'Noah', role: 'Product Designer', employeeType: 'ux-ui-designer', avatar: '/avatars/birds/tui.webp' },
  { id: 'fixture-iris', name: 'Iris', role: 'Code Reviewer', employeeType: 'security-engineer', avatar: '/avatars/birds/ruru.webp' },
  { id: 'fixture-kai', name: 'Kai', role: 'DevOps Engineer', employeeType: 'devops-engineer', avatar: '/avatars/birds/kakapo.webp' },
];
test.beforeAll(async () => {
  fixture = await startMobileFixture();
  const { bridge, member } = fixture;
  const eva = { ...member, employeeType: 'common-qa-engineer', avatar: '/avatars/birds/kea.webp' };
  expect((await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', { agent: eva, profile: '', profilePatch: {} })).success).toBe(true);
  for (const other of team) {
    const saved = await bridge.api(`/api/members/${other.id}/channel-access`, 'PUT', { agent: { ...member, ...other }, profile: '', profilePatch: {} });
    expect(saved.success, saved.error).toBe(true);
  }
  const created = await bridge.api('/api/group-chats', 'POST', { requestId: 'minified-launch', name: 'Launch crew', memberIds: [member.id, 'fixture-noah'] });
  expect(created.success, created.error).toBe(true); group = created.data;
  const current = (await bridge.api('/api/owned/browser-state')).data;
  const now = Date.now();
  const clock = at => new Date(at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const turn = (id, role, body, ago) => ({ id, role, body, status: 'complete', startedAt: new Date(now - ago).toISOString(), time: clock(now - ago) });
  const saved = await bridge.api('/api/owned/browser-state', 'PUT', { baseRevision: current.revision || 0, messagesByAgent: {
    [member.id]: [
      turn('min-user', 'user', 'Can you check the release checklist before Friday?', 90000),
      turn('min-answer', 'agent', 'Yes. The checklist is ready.\n\n- Setup keeps the saved team.\n- The release notes mention the new layout.', 60000),
      turn('min-user-2', 'user', 'Great, thank you.', 30000),
    ],
    'fixture-noah': [turn('min-noah', 'agent', 'The onboarding previews are in Figma.', 300000)],
    'fixture-iris': [turn('min-iris', 'agent', 'Two comments on the sidebar PR.', 900000)],
  } }); expect(saved.success, saved.error).toBe(true);
});
test.afterAll(async () => { await fixture?.bridge.close(); });

async function prepare(page, { theme, skin, layout = 'minified' }) {
  await page.addInitScript(({ theme, skin, layout }) => {
    if (window !== window.top || sessionStorage.getItem('minified.seeded')) return;
    localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' }));
    localStorage.setItem('autohandSquad.v1.skin', skin);
    if (layout) localStorage.setItem('autohandSquad.v1.layout', layout); else localStorage.removeItem('autohandSquad.v1.layout');
    sessionStorage.setItem('minified.seeded', '1');
  }, { theme, skin, layout });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
}

async function shoot(page, info, name) {
  await page.waitForTimeout(300);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  if (process.env.MINIFIED_SHOTS) { await mkdir(process.env.MINIFIED_SHOTS, { recursive: true }); await copyFile(path, join(process.env.MINIFIED_SHOTS, `${info.project.name}-${name}.png`)); }
}

for (const [skin, theme] of [['default', 'light'], ['default', 'dark'], ['paper', 'light'], ['blueprint', 'dark'], ['grut', 'light'], ['slate', 'dark']]) {
  test(`Minified with ${skin} in ${theme}`, async ({ page }, info) => {
    const { bridge, member } = fixture;
    const phone = info.project.name === 'phone';
    test.skip(phone && !['default', 'paper'].includes(skin), 'Two skins are enough at phone width.');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await prepare(page, { theme, skin });
    await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'minified');
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
    await expect(page.locator('main')).toContainText('The checklist is ready.');
    if (phone) await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
    const sidebar = page.locator('.app-sidebar[data-sidebar-layout="minified"]:visible');
    await expect(sidebar).toBeVisible();

    // Pinned members feed the faces at the top; with none pinned, the most recent.
    const top = sidebar.getByTestId('minified-top-members');
    await expect(top).toHaveAttribute('aria-label', 'Recent members');
    await sidebar.getByRole('button', { name: 'Actions for Noah', exact: true }).click();
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(top).toHaveAttribute('aria-label', 'Pinned members');
    await expect(top.getByRole('button', { name: /^Noah/ })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Actions for Eva', exact: true }).click();
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(top.getByRole('listitem')).toHaveCount(2);

    // Essentials: Needs you, one list of conversations with previews, search, new, settings.
    await expect(sidebar.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: /Needs you/ })).toBeVisible();
    const conversations = sidebar.getByRole('navigation', { name: 'Conversations', exact: true });
    await expect(conversations.getByRole('button', { name: /^Iris,/ })).toContainText('Two comments on the sidebar PR.');
    await expect(conversations.getByRole('button', { name: 'Group chat: Launch crew', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'New message', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Search everything/ })).toBeVisible();
    await page.mouse.move(0, 0);
    if (phone) await shoot(page, info, `${skin}-${theme}-drawer`);
    await sidebar.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByTestId('minified-more');
    for (const label of ['Squad', 'Memory', 'Create channel', 'New member']) await expect(more.getByRole('button', { name: label, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    if (phone) await page.getByRole('dialog', { name: 'Navigation', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();

    // The conversation: bubbles in every skin; the header keeps the Full layout's left alignment.
    const answer = page.locator('main .chat-agent-answer').filter({ hasText: 'The checklist is ready.' });
    await expect(answer).toBeVisible();
    const bubble = await answer.evaluate(element => ({ fill: getComputedStyle(element).backgroundColor, page: getComputedStyle(document.body).backgroundColor }));
    expect(bubble.fill).not.toBe(bubble.page);
    const contrast = await page.locator('main .chat-user-bubble').first().evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const sample = colour => { context.fillStyle = colour; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data.slice(0, 3); };
      const luminance = rgb => [...rgb].map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
      const a = luminance(sample(getComputedStyle(element).backgroundColor)), b = luminance(sample(getComputedStyle(element.querySelector('p') || element).color));
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    const header = page.locator('main .chat-header');
    if (!phone) {
      // Member on the left edge, status line starting under the name (owner, 2026-11-17).
      const place = await header.evaluate(element => {
        const own = element.getBoundingClientRect(), avatar = element.querySelector('.chat-header-identity button > :first-child').getBoundingClientRect();
        const name = element.querySelector('.chat-header-identity .truncate').getBoundingClientRect(), meta = element.querySelector('.chat-header-meta').getBoundingClientRect();
        return { inset: avatar.left - own.left, underName: Math.abs(meta.left - name.left), below: meta.top - name.top };
      });
      expect(place.inset).toBeLessThan(40);
      expect(place.underName).toBeLessThan(2);
      expect(place.below).toBeGreaterThan(0);
      await expect(header.locator('.chat-header-detail')).toBeHidden();
      await expect(header.getByTestId('chat-engine-label')).toBeVisible();
    }
    await page.mouse.move(0, 0);
    await shoot(page, info, `${skin}-${theme}-chat`);

    // A group conversation reads the same way.
    await page.goto(bridge.origin + `/channels/${group.id}`);
    await expect(page.locator('main')).toBeVisible();
    if (!phone && skin === 'default') await shoot(page, info, `${skin}-${theme}-group`);

    // ⌘K still reaches everything the Full sidebar names.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a Grut user gets Minified once, and a later choice of Full stays', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Storage behaviour does not depend on width.');
  const { bridge, member } = fixture;
  await prepare(page, { theme: 'light', skin: 'grut', layout: null });
  await page.goto(bridge.origin + `/conversations/new?member=${member.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'minified');
  expect(await page.evaluate(() => localStorage.getItem('autohandSquad.v1.layout'))).toBe('minified');
  await page.goto(bridge.origin + '/settings/appearance');
  await expect(page.locator('[data-layout-option="minified"]')).toHaveAttribute('data-state', 'on');
  await page.locator('[data-layout-option="full"]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'full');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'grut');
  await expect(page.locator('[data-layout-option="full"]')).toHaveAttribute('data-state', 'on');
  await page.mouse.move(0, 0);
  await shoot(page, info, 'settings-appearance');
});

test('Quick Chat ignores the layout', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Quick Chat is a desktop popover.');
  const { bridge, member } = fixture;
  await prepare(page, { theme: 'light', skin: 'default' });
  await page.goto(bridge.origin + `/quick-chat?member=${member.id}`);
  await expect(page.getByText('The checklist is ready.')).toBeVisible();
  expect(await page.locator('.app-sidebar').count()).toBe(0);
  const answer = page.locator('.chat-agent-answer').filter({ hasText: 'The checklist is ready.' });
  if (await answer.count()) {
    const fill = await answer.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(fill).toBe('rgba(0, 0, 0, 0)');
  }
});
