import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';

// ADR-0230: onboarding continues past work folders to the menu bar (macOS app
// only) and an optional iPhone pairing, both through the existing save paths.
let fixture;
test.beforeAll(async () => { fixture = await startMobileFixture(); });
test.afterAll(async () => { await fixture?.bridge.close(); });

async function prepare(page, { theme = 'light', desktop = true } = {}) {
  const context = (await fixture.bridge.api('/api/ownership/context')).data;
  await page.addInitScript(({ prefix, theme, desktop }) => {
    if (window !== window.top) return;
    if (!sessionStorage.getItem('onboarding.seeded')) {
      localStorage.setItem(prefix + encodeURIComponent('autohandSquad.v1.onboarding'), '{"version":1,"status":"completed"}');
      sessionStorage.setItem('onboarding.seeded', '1');
    }
    const appearance = JSON.stringify({ mode: theme, lightTheme: 'autohand-light', darkTheme: 'autohand-dark' });
    localStorage.setItem('autohandSquad.v1.theme', appearance);
    localStorage.setItem(prefix + encodeURIComponent('autohandSquad.v1.theme'), appearance);
    window.__nativeCalls = [];
    if (desktop) {
      // The macOS app's WKWebView: a Tauri bridge on a Mac platform.
      window.__TAURI_INTERNALS__ = { invoke: async command => { window.__nativeCalls.push(command); return null; } };
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    }
  }, { prefix: `autohandSquad.owner.v1.${context.storageKey}.`, theme, desktop });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  return context;
}
const onboarding = (page, context) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), `autohandSquad.owner.v1.${context.storageKey}.${encodeURIComponent('autohandSquad.v1.onboarding')}`);

async function shoot(page, info, name) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(350);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  if (process.env.ONBOARDING_SHOTS) { await mkdir(process.env.ONBOARDING_SHOTS, { recursive: true }); await copyFile(path, join(process.env.ONBOARDING_SHOTS, `${info.project.name}-${name}.png`)); }
}

/** The phone side of pairing, speaking the real protocol to the local route. */
function phone(offerLink) {
  const offer = JSON.parse(Buffer.from(new URL(offerLink).searchParams.get('data'), 'base64url').toString('utf8'));
  const endpoint = `http://127.0.0.1:${new URL(offer.endpoint).port}`;
  const deviceID = randomUUID(), deviceKey = randomBytes(32), pairingKey = Buffer.from(offer.secret, 'base64');
  async function request(command, parameters = {}, { pair = false } = {}) {
    const key = pair ? pairingKey : deviceKey;
    const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters: { deviceID, ...parameters } }, key,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: randomUUID() }, 'request');
    const response = await fetch(endpoint + '/v1/mobile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) });
    return response.ok ? openPacket(await response.json(), key, 'response') : { httpStatus: response.status };
  }
  request.deviceKey = deviceKey.toString('base64');
  return request;
}

async function resetPhones() {
  const status = (await fixture.bridge.api('/api/mobile/status')).data;
  for (const device of status.devices) await fixture.bridge.api(`/api/mobile/devices/${device.id}`, 'DELETE');
  await fixture.bridge.api('/api/mobile/config', 'PUT', { ...status.config, enabled: false });
}

for (const theme of ['light', 'dark']) {
  test(`re-running onboarding walks the menu bar and iPhone steps (${theme})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop' && theme === 'dark', 'One compact pass is enough.');
    await resetPhones();
    await fixture.bridge.api('/api/system/settings', 'PUT', { quickChatMenuBarMode: 'single', quickChatEnabled: true });
    const context = await prepare(page, { theme });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.bridge.origin + '/settings/setup');
    await expect(page.getByTestId('settings-sections').getByRole('link', { name: 'Onboarding', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run onboarding again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review where your squad works.', exact: true })).toBeVisible();
    await expect(page.getByTestId('onboarding-progress')).toContainText('Step 1 of 5 · Work folders');
    await shoot(page, info, `${theme}-1-work-folders`);

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    // ADR-0233: the layout comes next and saves at once to the device store
    // Settings › Appearance reads.
    await expect(page.getByRole('heading', { name: 'Choose your layout.', exact: true })).toBeFocused();
    await expect(page.getByTestId('onboarding-progress')).toContainText('Step 2 of 5 · Layout');
    await expect(page.getByRole('radio', { name: /^Full/ })).toBeChecked();
    await shoot(page, info, `${theme}-1b-layout-full`);
    await page.getByText('Minified', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /^Minified/ })).toBeChecked();
    await expect(page.getByTestId('onboarding-layout')).toContainText('Saved. Squad uses the Minified layout now.');
    expect(await page.evaluate(() => localStorage.getItem('autohandSquad.v1.layout'))).toBe('minified');
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'minified');
    await page.mouse.move(0, 0);
    await shoot(page, info, `${theme}-1c-layout-minified`);
    await page.getByText('Full', { exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('autohandSquad.v1.layout'))).toBe('full');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    // ADR-0271: the avatar style, saved at once to the store Settings › Appearance reads.
    await expect(page.getByRole('heading', { name: 'Choose how your squad looks.', exact: true })).toBeFocused();
    await expect(page.getByTestId('onboarding-progress')).toContainText('Step 3 of 5 · Avatars');
    await expect(page.getByRole('radio', { name: /^Flat/ })).toBeChecked();
    await page.getByText('3D', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /^3D/ })).toBeChecked();
    await expect(page.getByTestId('onboarding-avatar-style')).toContainText('Saved. Your squad shows 3D avatars now.');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.endsWith('avatarStyle')).map(key => localStorage.getItem(key)).join())).toBe('3d');
    await expect(page.getByTestId('avatar-style-preview').locator('img[src*="/avatars/birds-3d/"]')).toHaveCount(4);
    await page.mouse.move(0, 0);
    await shoot(page, info, `${theme}-1d-avatars-3d`);
    await page.getByText('Flat', { exact: true }).click();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.endsWith('avatarStyle')).map(key => localStorage.getItem(key)).join())).toBe('flat');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const heading = page.getByRole('heading', { name: 'How Squad shows in your menu bar.', exact: true });
    await expect(heading).toBeFocused();
    await expect(page.getByTestId('onboarding-progress')).toContainText('Step 4 of 5 · Menu bar');
    await expect(page.getByRole('radio', { name: 'One Squad icon' })).toBeChecked();
    await shoot(page, info, `${theme}-2-menu-bar-icon`);
    if (theme === 'light' && info.project.name === 'desktop') {
      // The moving version, caught as Quick Chat drops and the reply is written.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByText('One Squad icon', { exact: true }).hover();
      await page.waitForTimeout(4300);
      await shoot(page, info, `${theme}-2-menu-bar-icon-motion`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await page.getByText('Agent avatars', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Agent avatars' })).toBeChecked();
    await expect(page.getByTestId('onboarding-menu-bar')).toContainText('Saved. Agent avatars is in your menu bar now.');
    expect((await fixture.bridge.api('/api/system/settings')).data.quickChatMenuBarMode).toBe('active-agents');
    expect(await page.evaluate(() => window.__nativeCalls)).toContain('squad_refresh_quick_chat');
    await page.mouse.move(0, 0);
    await shoot(page, info, `${theme}-3-menu-bar-avatars`);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Take your squad with you.', exact: true })).toBeFocused();
    await expect(page.getByTestId('onboarding-progress')).toContainText('Step 5 of 5 · iPhone');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(heading).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await shoot(page, info, `${theme}-4-iphone`);

    const pair = page.waitForResponse(value => value.url().endsWith('/api/mobile/pair') && value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Pair an iPhone', exact: true }).click();
    const offer = await (await pair).json(); expect(offer.success, offer.error).toBe(true);
    expect((await fixture.bridge.api('/api/mobile/status')).data.config.enabled).toBe(true);
    await expect(page.getByRole('img', { name: /Private pairing code/ })).toBeVisible();
    await shoot(page, info, `${theme}-5-iphone-code`);

    const request = phone(offer.data.link);
    const claim = await request('pair.claim', { deviceName: 'Fixture iPhone', deviceKey: request.deviceKey }, { pair: true });
    expect(claim.data.state).toBe('pending');
    await expect(page.getByTestId('onboarding-phone-approval')).toContainText('Fixture iPhone wants to connect.');
    await shoot(page, info, `${theme}-6-iphone-approve`);
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fixture iPhone is paired.', exact: true })).toBeVisible();
    expect((await request('pair.status', {}, { pair: true })).data.state).toBe('approved');
    await shoot(page, info, `${theme}-7-iphone-paired`);
    await page.getByRole('button', { name: 'Open your squad', exact: true }).last().click();
    await expect(page).toHaveURL(fixture.bridge.origin + '/squad');
    expect((await onboarding(page, context)).phonePairing).toBe('paired');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('on the web there is no menu bar step, and Not now is remembered', async ({ page }) => {
  await resetPhones();
  const context = await prepare(page, { desktop: false });
  await page.goto(fixture.bridge.origin + '/welcome');
  await expect(page.getByTestId('onboarding-progress')).toContainText('Step 1 of 4 · Work folders');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('onboarding-progress')).toContainText('Step 2 of 4 · Layout');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('onboarding-progress')).toContainText('Step 3 of 4 · Avatars');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('onboarding-progress')).toContainText('Step 4 of 4 · iPhone');
  await expect(page.getByText('You can pair a phone later in Settings › Computers.')).toBeVisible();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page).toHaveURL(fixture.bridge.origin + '/squad');
  const state = await onboarding(page, context);
  expect(state.phonePairing).toBe('skipped');
  expect(state.status).toBe('completed');
  expect((await fixture.bridge.api('/api/mobile/status')).data.config.enabled).toBe(false);
});
