// Switching between a personal Squad and team Squads lives in Settings ›
// Squads, reached from the account menu (ADR-0234; it replaced the sidebar
// switcher of ADR-0221). Nothing ownership-related sits in the sidebar header
// or across the top of the window. With only a personal Squad the account menu
// offers no switch; with a team as well it names the current Squad under the
// email and offers "Switch Squad…", which opens Settings › Squads, where the
// switch goes through the broker and reloads into the new owner.
//
// Team Squads sit behind squad_team_squads (ADR-0239). With the flag off the
// account belongs to a team yet sees only the Personal Squad, Settings ›
// Squads says nothing about teams, and turning the flag on lists the team
// without a reload or a switch.
//
// SQUADS_SHOTS_DIR=<dir> saves screenshots there (default .codex-artifacts/ownership).
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

async function scenario(name, owners, { teamWritable = true, flagFlip = false } = {}) {
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
    if (owners.includes(team)) {   // the team has its own member, so the reload lands on a real Squad
      const teamPaths = await ensureDataset(serviceRoot, ownerKey(team));
      const teamMember = { ...profile, id: 'tom', name: 'Tom', role: 'Designer', ownership: team };
      await seed(join(teamPaths.dataRoot, 'channels.json'), { version: 1, revision: 1, channels: [], threads: [], messages: [], agentChannelAccess: { tom: { agent: teamMember, mode: 'ask', workspaceModes: {}, removed: false } } });
    }
    const list = owners.map(owner => ({ owner, label: owner.kind === 'team' ? 'Acme' : 'Personal Squad', role: 'owner', canWrite: owner.kind === 'team' ? teamWritable : true }));
    // The flag answer changes only when the broker asks, as with the real service.
    const flag = { wanted: !flagFlip, answer: !flagFlip };
    const teamSquads = { fixed: false, enabled: () => flag.answer, due: () => true, refresh: async () => (flag.answer = flag.wanted) };
    const visible = () => (flag.answer ? list : list.filter(item => item.owner.kind !== 'team'));
    const identity = { credential: () => ({ token, fingerprint }), verify: async () => ({ actor, fingerprint, expiresAt: Date.now() + 3600_000 }), teamSquads,
      personal: () => list[0], authorize: async (_actor, selected) => visible().find(item => item.owner.id === selected.id) || list[0], owners: async () => visible() };
    broker = createOwnershipBroker({ rootDir, serviceRoot, configPath, identity, port: 0 });
    const origin = await broker.listen();
    await until(() => broker.context().state === 'ready', 'owned fixture ready');
    browser = await startBrowser({ disableBackForwardCache: true });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const shots = process.env.SQUADS_SHOTS_DIR || '.codex-artifacts/ownership';
    const shot = file => browser.screenshot(join(shots, `squads-${name}-${file}.png`));
    const setTheme = theme => browser.evaluate(`localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: ${JSON.stringify(theme)} }))`);
    const pointerClick = async point => { await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); };
    const centre = selectorJs => browser.evaluate(`(() => { const node = ${selectorJs}; if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const openAccountMenu = async () => {
      await pointerClick(await centre(`[...document.querySelectorAll('button[aria-label="Open account menu"]')].find(item => item.getBoundingClientRect().width)`));
      await until(() => browser.evaluate(`!!document.querySelector('[role=menu]')`), 'account menu opens');
      await new Promise(resolve => setTimeout(resolve, 300));   // let the menu finish opening before a screenshot
    };
    const menuItems = () => browser.evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map(item => item.textContent.trim())`);
    const closeMenu = async () => {
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await until(() => browser.evaluate(`!document.querySelector('[role=menu]')`), 'account menu closes');
    };
    const squadRows = () => browser.evaluate(`[...document.querySelectorAll('[data-squad-row]')].map(row => ({ key: row.dataset.squadRow, text: row.innerText, current: row.getAttribute('aria-current') === 'true', switch: !!row.querySelector('button') }))`);
    const openApp = async () => {
      await browser.navigate(`${origin}/squad`);
      await until(() => browser.evaluate("document.body.innerText.includes('Eva') && !!document.querySelector('button[aria-label=\"Open account menu\"]')"), 'Squad renders', 30_000);
      await new Promise(resolve => setTimeout(resolve, 800));   // owners list resolves
    };
    await openApp();
    if (flagFlip) {
      const description = () => browser.evaluate(`document.querySelector('h3')?.parentElement?.innerText || ''`);
      await openAccountMenu();
      assert.ok(!(await menuItems()).includes('Switch Squad…'), 'flag off: no Switch Squad…');
      await closeMenu();
      await browser.navigate(`${origin}/settings/squads`);
      await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === 1`), 'flag off: Settings › Squads lists the Personal Squad alone', 30_000);
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-squad-row]').length`), 1, 'flag off: the team stays hidden');
      assert.match(await description(), /Your Personal Squad holds your own members/);
      assert.equal(await browser.evaluate(`/Teams you belong to|switching opens/i.test(document.body.innerText)`), false, 'flag off: nothing about teams');
      await shot('flag-off-light');
      const generation = broker.context().generation;
      flag.wanted = true;
      await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === 2`), 'flag on: the team appears without a reload', 30_000);
      assert.equal(broker.context().generation, generation, 'flag on: nobody is switched');
      assert.equal(broker.context().owner.kind, 'user');
      assert.match(await description(), /switching opens the one you choose/);
      await shot('flag-on-light');
      flag.wanted = false;
      await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === 1`), 'flag off again: the team goes away', 30_000);
      assert.deepEqual(browser.errors, [], `${name}: no JS errors`);
      return;
    }
    if (!teamWritable) {
      // A read-only team page offers the writable Squad as a plain button; the
      // quiet switcher line alone left people stuck there (ADR-0237).
      const before = broker.context();
      const selected = await fetch(`${origin}/api/ownership/select`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-squad-context': before.generation }, body: JSON.stringify({ owner: team, expectedGeneration: before.generation }) });
      assert.equal(selected.status, 200);
      await until(() => browser.evaluate(`!!document.querySelector('[data-testid=owned-view-leave]')`), 'the read-only team page shows its way out', 30_000);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid=owned-view-leave]').innerText.trim()`), 'Open Personal Squad');
      await shot('read-only-team');
      await pointerClick(await centre(`document.querySelector('[data-testid=owned-view-leave]')`));
      await until(() => broker.context().owner?.kind === 'user' && broker.context().state === 'ready', 'the broker returns to the personal Squad', 30_000);
      await until(() => browser.evaluate("document.body.innerText.includes('Eva') && !!document.querySelector('button[aria-label=\"Open account menu\"]')"), 'the personal Squad renders again', 30_000);
      assert.deepEqual(browser.errors, [], `${name}: no JS errors`);
      return;
    }
    await setTheme('light'); await openApp();
    assert.equal(await browser.evaluate(`document.documentElement.classList.contains('dark')`), false, 'light theme for the first screenshots');
    // Nothing ownership-related in the top 64px, where the traffic lights sit,
    // and no Squad switcher anywhere in the app shell.
    const topStrip = await browser.evaluate(`[...document.querySelectorAll('body *')].filter(node => node.children.length === 0 && /personal members and data|Team-owned members|Choose personal or team/i.test(node.innerText || node.getAttribute?.('aria-label') || '') && node.getBoundingClientRect().top < 64).length`);
    assert.equal(topStrip, 0, `${name}: no ownership strip across the top of the window`);
    const switcher = await browser.evaluate(`[...document.querySelectorAll('button')].filter(item => /Choose personal or team Squad/.test(item.getAttribute('aria-label') || '')).length`);
    assert.equal(switcher, 0, `${name}: no Squad switcher in the sidebar`);
    const sidebarSquadText = await browser.evaluate(`[...document.querySelectorAll('aside')].some(node => /Personal Squad|Acme/.test(node.innerText))`);
    assert.equal(sidebarSquadText, false, `${name}: the sidebar does not name the Squad`);
    assert.equal(await browser.evaluate(`!!document.querySelector('button[aria-label="Switch workspace"]')`), true, `${name}: the workspace switcher is still there`);

    await openAccountMenu();
    const items = await menuItems();
    const header = await browser.evaluate(`document.querySelector('[role=menu] [data-current-squad]')?.textContent || ''`);
    if (owners.length === 1) {
      assert.ok(!items.includes('Switch Squad…'), `one Squad: no Switch Squad… (${items.join(', ')})`);
      assert.equal(header, '', 'one Squad: the menu header does not name it');
      await closeMenu();
    } else {
      assert.ok(items.includes('Switch Squad…'), `with a team: Switch Squad… is offered (${items.join(', ')})`);
      assert.equal(items.indexOf('Switch Squad…'), items.indexOf('Settings') + 1, 'Switch Squad… follows Settings');
      assert.equal(header, 'Personal Squad', 'the menu header names the current Squad');
      await shot('account-menu-light');
      await pointerClick(await centre(`[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.trim() === 'Switch Squad…')`));
      await until(() => browser.evaluate(`location.pathname === '/settings/squads'`), 'Switch Squad… opens Settings › Squads');
    }

    // Settings › Squads lists every Squad and marks the current one.
    if (owners.length === 1) await browser.navigate(`${origin}/settings/squads`);
    await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === ${owners.length}`), 'Settings › Squads lists the Squads', 30_000);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('h3')].map(node => node.textContent.trim()).join('|')`), 'Squads', 'one section heading: Squads');
    let rows = await squadRows();
    assert.ok(rows[0].current && /Personal Squad/.test(rows[0].text) && /Current/.test(rows[0].text) && !rows[0].switch, `the personal Squad is current (${JSON.stringify(rows)})`);
    await shot('settings-light');
    await setTheme('dark'); await browser.navigate(`${origin}/settings/squads`);
    await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === ${owners.length} && document.documentElement.classList.contains('dark')`), 'dark Settings › Squads', 30_000);
    await shot('settings-dark');
    if (owners.length > 1) {
      assert.ok(/Acme/.test(rows[1].text) && /Team/.test(rows[1].text) && rows[1].switch && !rows[1].current, `the team offers Switch (${JSON.stringify(rows)})`);
      await openApp(); await openAccountMenu(); await shot('account-menu-dark'); await closeMenu();
      await setTheme('light'); await browser.navigate(`${origin}/settings/squads`);
      await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row] button').length === 1`), 'Settings › Squads again', 30_000);
      // Switch through the broker: it drains, verifies and the page reloads into /squad.
      await pointerClick(await centre(`document.querySelector('[data-squad-row] button')`));
      await until(() => broker.context().owner?.id === 'acme' && broker.context().state === 'ready', 'the broker switches to the team', 30_000);
      await until(() => browser.evaluate(`location.pathname === '/squad' && !document.getElementById('boot') && document.body.innerText.includes('Tom') && !document.body.innerText.includes('Eva') && !!document.querySelector('button[aria-label="Open account menu"]')`), 'the app reloads into the team Squad and shows its member', 30_000).catch(async failure => { console.error(await browser.evaluate('location.pathname + " :: " + document.body.innerText.slice(0, 600)')); throw failure; });
      await new Promise(resolve => setTimeout(resolve, 800));
      await openAccountMenu();
      assert.equal(await browser.evaluate(`document.querySelector('[role=menu] [data-current-squad]')?.textContent || ''`), 'Acme · Team Squad', 'after switching, the menu names the team');
      await closeMenu();
      await browser.navigate(`${origin}/settings/squads`);
      await until(() => browser.evaluate(`document.querySelectorAll('[data-squad-row]').length === 2`), 'Settings › Squads after switching', 30_000);
      rows = await squadRows();
      assert.ok(rows[1].current && !rows[0].current && rows[0].switch, `the team is now current (${JSON.stringify(rows)})`);
      await shot('settings-after-switch-light');
    }
    assert.deepEqual(browser.errors, [], `${name}: no JS errors`);
  } finally {
    await browser?.close(); await broker?.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
}

await scenario('personal-only', [personal]);
await scenario('with-team', [personal, team]);
await scenario('read-only-team', [personal, team], { teamWritable: false });
await scenario('team-flag-off', [personal, team], { flagFlip: true });
console.log('Squads: no switcher in the sidebar or under the window controls; personal-only has no Switch Squad… and Settings › Squads lists one current Squad; with a team, the account menu names the current Squad, Switch Squad… opens Settings › Squads, and Switch moves the broker to the team and reloads into it; with squad_team_squads off the team is hidden and turning it on lists the team live. Isolated broker and fixture identity; installed app and real data untouched.');
