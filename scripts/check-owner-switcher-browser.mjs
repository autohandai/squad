// The personal/team Squad choice lives in the sidebar header, never as a
// window-wide strip (that strip sat under the macOS traffic lights). With only
// a personal Squad there is no ownership chrome at all; with a team as well,
// one quiet switcher appears beside the workspace switcher.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnershipBroker } from '../server/ownership/broker.mjs';
import { ensureDataset } from '../server/ownership/datasets.mjs';
import { ownerKey } from '../server/ownership/identity.mjs';
import { startBrowser, until } from './lib/reliability-browser.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const issuer = 'https://identity.example.test', actor = { issuer, id: 'alice', email: 'alice@example.test', name: 'Alice' };
const personal = { kind: 'user', issuer, id: 'alice' }, team = { kind: 'team', issuer, id: 'acme' };
const token = 'fixture-no-provider-credential', fingerprint = createHash('sha256').update(token).digest('hex');
const seed = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };

async function scenario(name, owners) {
  const directory = await mkdtemp(join(tmpdir(), `squad-owner-switcher-${name}-`)), serviceRoot = join(directory, 'squad');
  const configPath = join(directory, 'config.json'), home = join(directory, 'home'), saved = {};
  const env = { HOME: home, AUTOHAND_HOME: join(home, '.autohand'), AUTOHAND_USER_CONFIG_PATH: configPath, NODE_OPTIONS: `--import=${fileURLToPath(new URL('./fixtures/ownership-browser-guard.mjs', import.meta.url))}` };
  let broker, browser;
  try {
    await mkdir(home, { recursive: true });
    for (const [key, value] of Object.entries(env)) { saved[key] = process.env[key]; process.env[key] = value; }
    await seed(configPath, { auth: { token, email: actor.email, expiresAt: '2099-01-01T00:00:00.000Z' } });
    const paths = await ensureDataset(serviceRoot, ownerKey(personal));
    const profile = { id: 'eva', name: 'Eva', role: 'QA Engineer', ownership: personal, status: 'active', harness: { id: 'autohand', model: 'fixture' }, workspace: '', projects: [], memory: [], skills: [], profileFiles: [] };
    await seed(join(paths.dataRoot, 'channels.json'), { version: 1, revision: 1, channels: [], threads: [], messages: [], agentChannelAccess: { eva: { agent: profile, mode: 'ask', workspaceModes: {}, removed: false } } });
    const list = owners.map(owner => ({ owner, label: owner.kind === 'team' ? 'Acme' : 'Personal Squad', role: 'owner', canWrite: true }));
    const identity = { credential: () => ({ token, fingerprint }), verify: async () => ({ actor, fingerprint, expiresAt: Date.now() + 3600_000 }),
      personal: () => list[0], authorize: async (_actor, selected) => list.find(item => item.owner.id === selected.id) || list[0], owners: async () => list };
    broker = createOwnershipBroker({ rootDir, serviceRoot, configPath, identity, port: 0 });
    const origin = await broker.listen();
    await until(() => broker.context().state === 'ready', 'owned fixture ready');
    browser = await startBrowser({ disableBackForwardCache: true });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.navigate(`${origin}/squad`);
    await until(() => browser.evaluate("document.body.innerText.includes('Eva')"), 'Squad renders', 30_000);
    await new Promise(resolve => setTimeout(resolve, 800));   // owners list resolves
    // Nothing ownership-related in the top 64px, where the traffic lights sit.
    const topStrip = await browser.evaluate(`[...document.querySelectorAll('body *')].filter(node => node.children.length === 0 && /personal members and data|Team-owned members|Choose personal or team/i.test(node.innerText || node.getAttribute?.('aria-label') || '') && node.getBoundingClientRect().top < 64).length`);
    assert.equal(topStrip, 0, `${name}: no ownership strip across the top of the window`);
    const switcher = await browser.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || '').includes('Choose personal or team Squad')); if (!button) return null; const box = button.getBoundingClientRect(); const sidebar = button.closest('aside, nav, [data-sidebar]'); return { top: box.top, left: box.left, text: button.innerText, inSidebar: Boolean(sidebar) || box.left < 400 }; })()`);
    if (owners.length === 1) assert.equal(switcher, null, 'one owner: no switcher, nothing to choose');
    else {
      assert.ok(switcher, 'two owners: the switcher is shown');
      assert.ok(switcher.inSidebar && switcher.top >= 40, `switcher sits in the sidebar header below the window controls (${JSON.stringify(switcher)})`);
      assert.match(switcher.text, /Personal Squad/);
      await browser.evaluate("[...document.querySelectorAll('button')].find(item => (item.getAttribute('aria-label') || '').includes('Choose personal or team Squad')).click()");
      await until(() => browser.evaluate("[...document.querySelectorAll('[role=option]')].map(item => item.innerText).join('|').includes('Acme')"), 'popover lists both Squads');
      await browser.screenshot(`.codex-artifacts/ownership/owner-switcher-${name}-open.png`);
      await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    }
    await browser.screenshot(`.codex-artifacts/ownership/owner-switcher-${name}.png`);
    assert.deepEqual(browser.errors, [], `${name}: no JS errors`);
  } finally {
    await browser?.close(); await broker?.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
}

await scenario('personal-only', [personal]);
await scenario('with-team', [personal, team]);
console.log('Owner switcher: no ownership strip under the window controls; personal-only shows no switcher; with a team, one sidebar switcher lists both Squads. Isolated broker and fixture identity; installed app and real data untouched.');
