// ADR-0283 in the real window: an updated Mac whose squad predates account
// ownership opens on that squad with a quiet notice, not on setup; "What was
// left out" lists exclusions; Done hides the notice. A second account on the
// same computer sees the offer, whose action opens Settings › Backups with the
// earlier folders filled in. Real broker + server.mjs, fixture identity.
// LEGACY_SHOTS_DIR=<dir> saves screenshots (default .codex-artifacts/legacy-import).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { startBrowser, until } from './lib/reliability-browser.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url)), issuer = 'https://identity.example.test';
const seed = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
const directory = await mkdtemp(join(tmpdir(), 'squad-legacy-browser-')), serviceRoot = join(directory, 'squad');
const configPath = join(directory, 'config.json'), home = join(directory, 'home'), saved = {};
const env = { HOME: home, AUTOHAND_HOME: join(home, '.autohand'), AUTOHAND_USER_CONFIG_PATH: configPath, NODE_OPTIONS: `--import=${fileURLToPath(new URL('./fixtures/ownership-browser-guard.mjs', import.meta.url))}` };
const shots = process.env.LEGACY_SHOTS_DIR || '.codex-artifacts/legacy-import';
let broker, browser, person = 'daniel', token = 'fixture-no-provider-credential-daniel';
const signIn = async who => { person = who; token = `fixture-no-provider-credential-${who}`; await seed(configPath, { auth: { token, email: `${who}@example.test`, expiresAt: '2099-01-01T00:00:00.000Z' } }); };
try {
  await mkdir(home, { recursive: true });
  for (const [key, value] of Object.entries(env)) { saved[key] = process.env[key]; process.env[key] = value; }
  await signIn('daniel');
  // What an older Squad left: the CST team in the service root and web-state.
  const member = (id, name, role) => ({ agent: { id, name, role, description: `${name} works the CST queue.`, workspace: '', projects: [], harness: { id: 'autohand' } } });
  await seed(join(serviceRoot, 'channels.json'), { version: 1, channels: [{ id: 'cst', name: 'CST', memberIds: ['asq_cst_lead', 'asq_cst_agent'], visibility: 'private' }], threads: [], messages: [],
    agentChannelAccess: { asq_cst_lead: member('asq_cst_lead', 'Daniel', 'CST lead'), asq_cst_agent: member('asq_cst_agent', 'Priya', 'Support agent') } });
  for (const [id, name] of [['asq_cst_lead', 'Daniel'], ['asq_cst_agent', 'Priya']]) await seed(join(serviceRoot, 'web-state/agents', id, 'profile.json'), { id, name, role: 'CST' });
  const identity = { credential: () => ({ token, fingerprint: createHash('sha256').update(token).digest('hex') }),
    verify: async current => ({ actor: { issuer, id: person, email: `${person}@example.test`, name: person }, fingerprint: current.fingerprint, expiresAt: Date.now() + 3600_000 }),
    personal: value => ({ owner: { kind: 'user', issuer, id: value.actor.id }, label: 'Personal Squad', role: 'owner', canWrite: true }),
    authorize: async (value, owner) => ({ owner, label: 'Personal Squad', role: 'owner', canWrite: true }),
    owners: async value => [identity.personal(value)] };
  broker = createOwnershipBroker({ rootDir, serviceRoot, configPath, identity, port: 0 });
  const origin = await broker.listen();
  await until(() => broker.context().state === 'ready', 'the earlier squad is brought back and Squad is ready', 60_000);
  assert.equal(broker.context().legacy?.status, 'imported', JSON.stringify(broker.context().legacy));
  browser = await startBrowser({ disableBackForwardCache: true });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.navigate(`${origin}/squad`);
  try { await until(() => browser.evaluate(`!!document.querySelector('[data-testid=legacy-import-notice]')`), 'the brought-back notice shows', 30_000); }
  catch (failure) { await browser.screenshot(join(shots, 'legacy-0-failure.png')); console.error(await browser.evaluate(`location.pathname + '\\n' + document.body.innerText.slice(0, 800)`)); console.error(JSON.stringify(broker.context().legacy)); throw failure; }
  const text = await browser.evaluate(`document.querySelector('[data-testid=legacy-import-notice]').innerText`);
  assert.match(text, /Brought back your squad from before the update: 2 members/);
  assert.match(text, /Your earlier files are untouched/);
  await until(() => browser.evaluate(`document.body.innerText.includes('Priya')`), 'the CST members are in the Squad, not setup', 30_000);
  assert.equal(await browser.evaluate(`location.pathname.startsWith('/welcome') || location.pathname.startsWith('/onboarding')`), false, 'setup does not open');
  await browser.screenshot(join(shots, 'legacy-1-brought-back.png'));
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=legacy-import-notice] button')].find(b => b.textContent.includes('What was left out'))?.click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=legacy-import-omissions]')`), 'left-out items list');
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=legacy-import-omissions]').innerText`), /credentials/i);
  await browser.screenshot(join(shots, 'legacy-2-left-out.png'));
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=legacy-import-notice] button')].find(b => b.textContent.trim() === 'Done').click()`);
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=legacy-import-notice]')`), 'Done hides the notice');
  await browser.navigate(`${origin}/squad`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=legacy-import-notice]')`), false, 'Done is remembered');

  // A colleague signs in on the same computer: an offer, never an import.
  await signIn('colleague');
  await until(() => broker.context().state === 'ready' && broker.context().actor?.id === 'colleague', 'the colleague’s Squad opens', 60_000);
  assert.equal(broker.context().legacy?.status, 'offer');
  await browser.navigate(`${origin}/squad`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=legacy-import-offer]')`), 'the offer shows, also during setup', 30_000);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=legacy-import-offer]').innerText`), /still on this computer: 2 members \(Daniel, Priya\)/);
  await browser.screenshot(join(shots, 'legacy-3-offer.png'));
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=legacy-import-offer] button')].find(b => b.textContent.includes('Bring back')).click()`);
  await until(() => browser.evaluate(`!!document.querySelector('#legacy-recovery')`), 'Settings › Backups opens at recovery', 30_000);
  const filled = await browser.evaluate(`[...document.querySelectorAll('#legacy-recovery input')].map(input => input.value)`);
  assert.equal(filled[0], serviceRoot); assert.equal(filled[1], join(serviceRoot, 'web-state'), 'the earlier folders are filled in');
  await browser.screenshot(join(shots, 'legacy-4-recovery-prefilled.png'));
  assert.deepEqual(browser.errors, [], 'no JS errors');
  console.log('Legacy auto-import in the window: the brought-back notice replaces setup with the members in place, lists what was left out, and Done sticks; a second account gets the offer, which opens Settings › Backups with the earlier folders filled in.');
} finally {
  await browser?.close(); await broker?.close();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(directory, { recursive: true, force: true });
}
