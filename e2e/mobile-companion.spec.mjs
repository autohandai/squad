import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { until } from '../scripts/lib/reliability-browser.mjs';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';
import { sealPacket, openPacket } from '../server/mobile/protocol.mjs';

let bridge, member, counter;
test.beforeAll(async () => { ({ bridge, member, counter } = await startMobileFixture()); });
test.afterAll(async () => { await bridge?.close(); });

test('a phone pairs only after desktop approval and uses the real member queue', async ({ page }, info) => {
  const context = (await bridge.api('/api/ownership/context')).data;
  await page.addInitScript(({ prefix }) => {
    if (window === window.top) localStorage.setItem(prefix + encodeURIComponent('autohandSquad.v1.onboarding'), '{"version":1,"status":"skipped"}');
  }, { prefix: `autohandSquad.owner.v1.${context.storageKey}.` });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(bridge.origin + '/settings/computers');
  const settings = page.getByTestId('computers-settings');
  const toggle = settings.getByRole('switch', { name: 'Connect phones' });
  await expect(toggle).not.toBeChecked();
  await toggle.click(); await expect(toggle).toBeChecked();
  const response = page.waitForResponse(value => value.url().endsWith('/api/mobile/pair') && value.request().method() === 'POST');
  await settings.getByRole('button', { name: 'Connect a phone', exact: true }).click();
  const offerResponse = await (await response).json(); expect(offerResponse.success, offerResponse.error).toBe(true);
  const offer = JSON.parse(Buffer.from(new URL(offerResponse.data.link).searchParams.get('data'), 'base64url').toString('utf8'));
  await expect(settings.getByRole('img', { name: /Private pairing code/ })).toBeVisible();
  const endpoint = `http://127.0.0.1:${new URL(offer.endpoint).port}`;
  const deviceID = randomUUID(), deviceKey = randomBytes(32), pairingKey = Buffer.from(offer.secret, 'base64');
  async function request(command, parameters = {}, { pair = false, id = randomUUID() } = {}) {
    const key = pair ? pairingKey : deviceKey;
    const packet = sealPacket({ issuedAt: Date.now() / 1000, command, parameters }, key,
      { kind: pair ? 'pair' : 'device', computerID: offer.computerID, peerID: pair ? offer.pairingID : deviceID, requestID: id }, 'request');
    const response = await fetch(endpoint + '/v1/mobile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet) });
    if (!response.ok) return { httpStatus: response.status };
    return openPacket(await response.json(), key, 'response');
  }
  const claim = await request('pair.claim', { deviceID, deviceName: 'Fixture iPhone', deviceKey: deviceKey.toString('base64') }, { pair: true });
  expect(claim.data.state).toBe('pending');
  expect((await request('snapshot')).httpStatus).toBe(401);
  await expect(settings).toContainText('Fixture iPhone wants to connect.');
  await page.screenshot({ path: info.outputPath('approve-phone.png'), fullPage: true });
  await settings.getByRole('button', { name: 'Approve connection', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Approve connection', exact: true })).toHaveCount(0);
  expect((await request('pair.status', { deviceID }, { pair: true })).data.state).toBe('approved');
  const snapshot = await request('snapshot'); expect(snapshot.data.members.map(row => row.id)).toContain(member.id);
  expect((await request('computer.grant')).ok).toBe(false);
  const id = randomUUID(), parameters = { memberID: member.id, text: 'Hello from the paired phone.' };
  const delivered = await request('message', parameters, { id });
  expect(delivered.ok, delivered.error).toBe(true);
  const retried = await request('message', parameters, { id });
  expect(retried.data.messageID).toBe(delivered.data.messageID);
  await until(async () => (await bridge.api(`/api/queues/${member.id}`)).data.items.find(item => item.id === delivered.data.messageID)?.status === 'done', 'the real mobile message completes');
  const transcript = await request('conversation', { memberID: member.id });
  expect(transcript.data.turns.some(turn => turn.prompt === parameters.text && turn.reply.includes('Message received on this computer.'))).toBe(true);
  expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
  const phone = settings.getByRole('listitem').filter({ hasText: 'Fixture iPhone' });
  await phone.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(phone).toHaveCount(0);
  expect((await request('snapshot')).httpStatus).toBe(401);
  await toggle.click(); await expect(toggle).not.toBeChecked();
  await page.screenshot({ path: info.outputPath('phones-disconnected.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
