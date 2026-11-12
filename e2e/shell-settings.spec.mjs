import { test, expect } from '@playwright/test';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';

let fixture;
test.beforeAll(async () => { fixture = await startMobileFixture(); });
test.afterAll(async () => { await fixture?.bridge.close(); });

test('account destinations and Settings keep their place and the unsent chat', async ({ page }, info) => {
  const { bridge, member } = fixture;
  const context = (await bridge.api('/api/ownership/context')).data;
  await page.addInitScript(prefix => {
    localStorage.setItem(prefix + encodeURIComponent('autohandSquad.v1.onboarding'), '{"version":1,"status":"skipped"}');
  }, `autohandSquad.owner.v1.${context.storageKey}.`);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `/conversations/new?member=${member.id}&workspace=${encodeURIComponent(member.workspace)}`;
  await page.goto(bridge.origin + origin);
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible(); await composer.fill('Keep my unsent message.');
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  const menu = page.getByRole('menu');
  const items = (await menu.getByRole('menuitem').allTextContents()).map(text => text.trim());
  expect(items.slice(0, 4)).toEqual(['Inbox', 'Settings', 'About', 'Licenses and agreements']);
  expect(items).not.toContain('Analytics'); expect(items).not.toContain('Memory');
  await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const sections = page.getByTestId('settings-sections');
  await sections.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page).toHaveURL(bridge.origin + '/settings/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(sections).toBeVisible();
  await expect(page.locator('section[aria-label="Analytics"]')).toBeVisible();
  await sections.getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page).toHaveURL(bridge.origin + '/settings/memory');
  await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back from Settings', exact: true }).click();
  await expect(page).toHaveURL(bridge.origin + origin);
  await expect(composer).toHaveValue('Keep my unsent message.');
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.screenshot({ path: info.outputPath('account-destinations.png'), fullPage: true });
  await page.getByRole('menuitem', { name: 'Licenses and agreements', exact: true }).click();
  // Native navigation interception opens the existing document window.
  // A plain browser uses the readable same-tab fallback.
  await expect(page.getByRole('heading', { name: 'Third-party licenses', exact: true })).toBeVisible();
  await page.goto(bridge.origin + '/usage');
  await expect(page).toHaveURL(bridge.origin + '/settings/analytics');
  await expect(page.getByTestId('settings-sections')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back from Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
