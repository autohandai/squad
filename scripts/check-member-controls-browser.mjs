#!/usr/bin/env node
// Member controls (ADR-0265), rendered against a real isolated bridge:
// New message's To field lists members with presence and channels; the
// Execution panel's Permissions tab turns "Manage the team" on and off and
// the bridge saves it; the Permissions page leads with Team and email; a
// member's Connectors page offers connectors to connect. Screenshots land in
// .codex-artifacts/member-controls/.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { startBridge, startBrowser, until } from './lib/reliability-browser.mjs';
import { seedOwnedBrowserFixture } from './lib/owned-bridge-fixture.mjs';
import { MANAGE_TEAM_TOOLS } from '../src/lib/permission-policy.js';

const shots = join(process.cwd(), '.codex-artifacts/member-controls');
await mkdir(shots, { recursive: true });
const bridge = await startBridge();
let browser;
try {
  const members = ['Eva', 'Noah'].map(name => ({ id: 'controls-' + name.toLowerCase(), name, role: name === 'Eva' ? 'Growth analyst' : 'Engineer', status: 'online', workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: 'autohand' }, permissions: {} }));
  browser = await startBrowser();
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await seedOwnedBrowserFixture(bridge, browser, { members });
  assert.equal((await bridge.api('/api/channels', 'POST', { id: 'release', name: 'release', memberIds: ['controls-eva'], projects: [{ path: process.cwd() }], responder: { mode: 'everyone' } })).success, true);
  const settle = () => new Promise(resolve => setTimeout(resolve, 450));
  const shoot = async name => { await settle(); await browser.screenshot(join(shots, `${name}.png`)); };
  const options = "[...document.querySelectorAll('[role=option]')]";

  // New message: To lists members with their presence, then channels.
  await browser.navigate(`${bridge.origin}/messages/new`);
  await until(() => browser.evaluate("!!document.querySelector('input[aria-label=To]')"), 'To field');
  await browser.evaluate("document.querySelector('input[aria-label=To]').focus()");
  await until(() => browser.evaluate(`${options}.length >= 2`), 'To lists members');
  const listed = await browser.evaluate(`${options}.map(option => option.textContent.trim())`);
  assert.ok(listed.some(text => text.startsWith('Eva')) && listed.some(text => text.startsWith('Noah')), `members listed: ${listed}`);
  assert.ok(await browser.evaluate(`${options}.every(option => option.querySelector('[data-presence]') || option.textContent.startsWith('release'))`), 'every member shows presence');
  await shoot('new-message-to');
  await browser.fill('input[aria-label="To"]', '#rel');
  await until(() => browser.evaluate(`${options}.some(option => option.textContent.includes('release'))`), 'typing # offers channels');
  await browser.evaluate(`${options}.find(option => option.textContent.includes('release')).click()`);
  await until(() => browser.evaluate("location.pathname.startsWith('/channels/release')"), 'choosing a channel opens it');

  // Execution panel › Permissions: Manage the team.
  const eva = members[0];
  await browser.navigate(`${bridge.origin}/conversations/new?member=${eva.id}&panel=permissions`);
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-quick-settings]')"), 'Permissions tab', 30000);
  const quick = await browser.evaluate("document.querySelector('[data-testid=member-quick-settings]').innerText");
  for (const words of ['Manage the team', 'Email', 'Connectors', 'Computer Use']) assert.ok(quick.includes(words), `quick settings show ${words}`);
  await shoot('execution-permissions');
  const saved = async () => (await bridge.api('/api/channels')).data.agentChannelAccess[eva.id]?.agent?.permissions?.builtInPolicies || {};
  await browser.evaluate("document.querySelector('[data-testid=manage-team-switch]').click()");
  await until(async () => MANAGE_TEAM_TOOLS.every(async () => true) && (await saved()).squad_create_member === 'allow', 'Manage the team on reaches the bridge');
  for (const tool of MANAGE_TEAM_TOOLS) assert.equal((await saved())[tool], 'allow', `${tool} allowed`);
  await browser.evaluate("document.querySelector('[data-testid=manage-team-switch]').click()");
  await until(async () => (await saved()).squad_create_member === 'ask', 'Manage the team off asks again');

  // Permissions page leads with Team and email.
  await browser.navigate(`${bridge.origin}/squad-members/${eva.id}/permissions`);
  await until(() => browser.evaluate("document.body.innerText.includes('Team and email')"), 'Team and email on the Permissions page', 30000);
  await shoot('permissions-page');

  // Connectors: what the member can use, then connectors to connect.
  await browser.navigate(`${bridge.origin}/squad-members/${eva.id}/connector`);
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-connectors]')"), 'member Connectors page', 30000);
  await until(() => browser.evaluate("document.querySelectorAll('[data-testid=member-connector-suggestion]').length > 0"), 'connectors offered to connect', 30000);
  await shoot('member-connectors');
  await browser.evaluate("document.querySelector('[data-testid=member-connector-suggestion] button').click()");
  await until(() => browser.evaluate("location.pathname.includes('/settings') && location.search.includes('install=')"), 'Connect opens Settings › Connectors on that entry');
  await until(() => browser.evaluate("!!document.querySelector('[role=dialog]')"), 'the install dialog opens', 20000);
  await shoot('connect-dialog');
  assert.deepEqual(browser.errors, []);
  console.log('PASS member controls: To lists members with presence and channels and opens a channel; Permissions tab turns Manage the team on and off in the bridge; Team and email lead the Permissions page; member Connectors offer connectors and Connect opens the install dialog.');
} finally {
  await browser?.close();
  await bridge.close();
}
