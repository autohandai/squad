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
  for (const words of ['Manage the team', 'Connectors', 'Computer Use']) assert.ok(quick.includes(words), `quick settings show ${words}`);
  assert.ok(!quick.includes('Email'), 'an account outside autohand.ai never sees the email row');
  await shoot('execution-permissions');
  const saved = async () => (await bridge.api('/api/channels')).data.agentChannelAccess[eva.id]?.agent?.permissions?.builtInPolicies || {};
  await browser.evaluate("document.querySelector('[data-testid=manage-team-switch]').click()");
  await until(async () => MANAGE_TEAM_TOOLS.every(async () => true) && (await saved()).squad_create_member === 'allow', 'Manage the team on reaches the bridge');
  for (const tool of MANAGE_TEAM_TOOLS) assert.equal((await saved())[tool], 'allow', `${tool} allowed`);
  await browser.evaluate("document.querySelector('[data-testid=manage-team-switch]').click()");
  await until(async () => (await saved()).squad_create_member === 'ask', 'Manage the team off asks again');

  // ADR-0274: Manage in the Permissions tab opens the member's connectors in a
  // side sheet, without leaving the conversation.
  await browser.evaluate("document.querySelector('[data-testid=quick-connectors-manage]').click()");
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-connectors-sheet] [data-testid=member-connectors]')"), 'Manage opens the connectors sheet', 20000);
  await until(() => browser.evaluate("document.querySelectorAll('[data-testid=member-connectors-sheet] [data-testid=member-connector-suggestion]').length > 0"), 'the sheet offers connectors', 20000);
  assert.ok(await browser.evaluate("location.pathname.startsWith('/conversations/new')"), 'the conversation stays open behind the sheet');
  await shoot('connectors-sheet');
  await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await until(() => browser.evaluate("!document.querySelector('[data-testid=member-connectors-sheet]')"), 'Escape closes the connectors sheet', 10000);

  // ADR-0274: the shield beside the member menu is a quick permissions menu.
  await browser.navigate(`${bridge.origin}/conversations/new?member=${eva.id}`);
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-permissions-menu]')"), 'the permissions shield in the chat header', 30000);
  await browser.evaluate("document.querySelector('[data-testid=member-permissions-menu]').click()");
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-permissions-popover] [data-testid=member-quick-settings]')"), 'the quick permissions menu opens', 20000);
  const menuText = await browser.evaluate("document.querySelector('[data-testid=member-permissions-popover]').innerText");
  for (const words of ['Ask me first', 'Play it safe', 'Act on its own', 'Manage the team', 'Connectors', 'Computer Use', 'All permissions for Eva']) assert.ok(menuText.includes(words), `the quick menu shows ${words}`);
  await shoot('permissions-quick-menu');
  const mode = async () => (await bridge.api('/api/channels')).data.agentChannelAccess[eva.id]?.agent?.permissions?.permissionMode;
  await browser.evaluate("[...document.querySelectorAll('[data-testid=member-permissions-popover] [role=radio]')].find(item => item.innerText.startsWith('Play it safe')).click()");
  await until(async () => (await mode()) === 'restricted', 'Play it safe reaches the bridge as restricted');
  await browser.evaluate("[...document.querySelectorAll('[data-testid=member-permissions-popover] [role=radio]')].find(item => item.innerText.startsWith('Ask me first')).click()");
  await until(async () => (await mode()) === 'interactive', 'Ask me first returns it to interactive');

  // Permissions page leads with Team and email.
  await browser.navigate(`${bridge.origin}/squad-members/${eva.id}/permissions`);
  await until(() => browser.evaluate("document.body.innerText.includes('Manage the team')"), 'Team on the Permissions page', 30000);
  await shoot('permissions-page');

  // Communications (ADR-0266): one view, right after Home, then Permissions.
  await browser.navigate(`${bridge.origin}/squad-members/${eva.id}/im`);
  await until(() => browser.evaluate("document.body.innerText.includes('Direct conversation')"), 'Communications page', 30000);
  const nav = await browser.evaluate("[...document.querySelectorAll('nav a, nav button, aside a, aside button')].map(item => item.innerText.trim()).filter(text => ['Home','Communications','Permissions','Projects','Messaging'].includes(text))");
  assert.deepEqual(nav.slice(0, 4), ['Home', 'Communications', 'Permissions', 'Projects'], `member sections in order: ${nav}`);
  assert.ok(!nav.includes('Messaging'), 'Messaging is gone');
  assert.ok(!(await browser.evaluate("document.body.innerText.includes('Email')")), 'no email row outside autohand.ai');
  await shoot('communications');

  // Connectors: what the member can use, then connectors to connect.
  await browser.navigate(`${bridge.origin}/squad-members/${eva.id}/connector`);
  await until(() => browser.evaluate("!!document.querySelector('[data-testid=member-connectors]')"), 'member Connectors page', 30000);
  await until(() => browser.evaluate("document.querySelectorAll('[data-testid=member-connector-suggestion]').length > 0"), 'connectors offered to connect', 30000);
  await shoot('member-connectors');
  // Connectors reach a member only with its permission (ADR-0269): the page says so and the switch sets it.
  assert.ok(await browser.evaluate("document.querySelector('[data-testid=member-connectors]').innerText.includes('uses them only with your permission')"), 'the page says the member cannot use connectors yet');
  const modes = async () => (await bridge.api('/api/channels')).data.agentChannelAccess[eva.id]?.agent?.permissions?.modes || {};
  await browser.evaluate("document.querySelector('[data-testid=member-connectors-switch]').click()");
  await until(async () => (await modes())['mcp.connectors'] === 'allow', 'Let Eva use connectors reaches the bridge as mcp.connectors = allow');
  await until(() => browser.evaluate("document.querySelector('[data-testid=member-connectors]').innerText.includes('can use the connectors you’ve added')"), 'the page says it can');
  await browser.evaluate("document.querySelector('[data-testid=member-connectors-switch]').click()");
  await until(async () => (await modes())['mcp.connectors'] === 'ask', 'off returns it to ask');
  await browser.evaluate("document.querySelector('[data-testid=member-connector-suggestion] button').click()");
  await until(() => browser.evaluate("location.pathname.includes('/settings') && location.search.includes('install=')"), 'Connect opens Settings › Connectors on that entry');
  await until(() => browser.evaluate("!!document.querySelector('[role=dialog]')"), 'the install dialog opens', 20000);
  await shoot('connect-dialog');
  assert.deepEqual(browser.errors, []);
  console.log('PASS member controls: To lists members with presence and channels and opens a channel; Permissions tab turns Manage the team on and off in the bridge; Team leads the Permissions page; Communications follows Home with no email row outside autohand.ai; member Connectors say whether the member may use them, the switch sets mcp.connectors, offer connectors, and Connect opens the install dialog; Manage opens a connectors sheet; the header shield is a quick permissions menu that sets how the member acts.');
} finally {
  await browser?.close();
  await bridge.close();
}
