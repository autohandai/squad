import { mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createRemoteRegistry } from '../server/remote/registry.mjs';
import { startMobileFixture } from '../scripts/lib/mobile-fixture.mjs';

let fixture;
test.beforeAll(async () => { fixture = await startMobileFixture(); });
test.afterAll(async () => { await fixture?.bridge.close(); });

test('setup guide repairs a saved member folder with explicit default-folder consent', async ({ page }, info) => {
  const { bridge, member, counter } = fixture;
  const missing = join(bridge.directory, 'home', 'moved-away-project');
  const state = (await bridge.api('/api/channels')).data;
  const access = state.agentChannelAccess[member.id];
  const prepared = await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', {
    agent: access.agent,
    profilePatch: { workspace: missing, projects: [{ path: missing }], instructions: 'Keep my authored instructions.', memory: [{ id: 'authored', text: 'Preserve my preferences.' }] },
    expectedProfileRevision: access.agent.profileRevision || 0,
  });
  expect(prepared.success, prepared.error).toBe(true);
  const before = (await bridge.api('/api/channels')).data;
  const beforeAgent = before.agentChannelAccess[member.id].agent;
  const engineCallsBefore = await readFile(counter, 'utf8').catch(() => '');
  const context = (await bridge.api('/api/ownership/context')).data;
  await page.addInitScript(prefix => {
    localStorage.setItem(prefix + encodeURIComponent('autohandSquad.v1.onboarding'), '{"version":1,"status":"completed"}');
  }, `autohandSquad.owner.v1.${context.storageKey}.`);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(bridge.origin + '/settings/setup');
  await page.getByRole('button', { name: 'Run the setup guide', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review where your squad works.', exact: true })).toBeVisible();
  const folders = page.getByRole('list', { name: 'Selected work folders', exact: true });
  await expect(folders).toContainText(missing);
  await expect(page.getByRole('button', { name: 'Save work folders', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: `Remove ${missing}`, exact: true }).click();
  const consent = page.getByTestId('default-workspace-consent');
  await expect(consent).toBeVisible();
  const setup = (await bridge.api('/api/runtime')).data.defaultWorkspaceSetup;
  expect(setup.exists).toBe(false);
  await expect(stat(setup.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await consent.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save work folders', exact: true })).toBeEnabled();
  expect((await stat(setup.path)).isDirectory()).toBe(true);
  await expect(stat(join(setup.path, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('review-work-folders.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save work folders', exact: true }).click();
  await expect(page).toHaveURL(bridge.origin + '/squad');
  const after = (await bridge.api('/api/channels')).data;
  const saved = after.agentChannelAccess[member.id].agent;
  expect(Object.keys(after.agentChannelAccess)).toEqual(Object.keys(before.agentChannelAccess));
  expect(after.channels).toEqual(before.channels);
  expect(saved.workspace).toBe(setup.path);
  expect(saved.projects.map(project => project.path)).toEqual([setup.path]);
  for (const key of ['name', 'role', 'description', 'instructions', 'memory', 'skills', 'harness', 'modelRouting', 'permissions', 'brainCard', 'profileFiles']) {
    expect(saved[key], key).toEqual(beforeAgent[key]);
  }
  expect(await readFile(counter, 'utf8').catch(() => '')).toBe(engineCallsBefore);
  const runtime = (await bridge.api('/api/runtime')).data;
  const legacyRoot = runtime.legacySquadWorkspaceRoots[0];
  expect(legacyRoot.startsWith(runtime.workspaceRoot)).toBe(true);
  const legacy = join(legacyRoot, 'data', 'workers', 'not-consented');
  const mapped = join(runtime.squadWorkspaceRoot, 'data', 'workers', 'not-consented');
  await mkdir(legacy, { recursive: true });
  await expect(stat(mapped)).rejects.toMatchObject({ code: 'ENOENT' });
  const refusedAnalysis = await bridge.api('/api/setup/repositories', 'POST', { paths: [legacy], preserveFolders: true });
  expect(refusedAnalysis.success).toBe(false);
  await expect(stat(mapped)).rejects.toMatchObject({ code: 'ENOENT' });
  const refusedAlias = await bridge.api(`/api/control-plane/members/${member.id}/workspace`, 'PATCH', { workspace: legacy, directories: [], expectedRevision: saved.profileRevision });
  expect(refusedAlias.success).toBe(false);
  await expect(stat(mapped)).rejects.toMatchObject({ code: 'ENOENT' });
  const remotes = createRemoteRegistry({ squadStateDir: bridge.dataRoot });
  await remotes.set(member.id, { url: 'http://127.0.0.1:9', token: 'fixture-only-remote-token', label: 'Other execution computer' });
  const refused = await bridge.api(`/api/control-plane/members/${member.id}/workspace`, 'PATCH', { workspace: setup.path, directories: [], expectedRevision: saved.profileRevision });
  expect(refused.status).toBe(409);
  expect(refused.error).toContain('execution computer');
  await remotes.remove(member.id);

  await page.goto(bridge.origin + '/welcome');
  await expect(folders).toContainText(setup.path);
  await expect(folders).not.toContainText(missing);
  await expect(page.getByRole('button', { name: 'Save work folders', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('review preserves a Git subfolder alias and its workspace permissions', async ({ page }) => {
  const { bridge, member } = fixture;
  const home = (await bridge.api('/api/runtime')).data.workspaceRoot;
  const repository = join(home, 'review-monorepo'), subfolder = join(repository, 'apps', 'api');
  const alias = join(home, 'review-api-alias');
  await mkdir(subfolder, { recursive: true });
  await promisify(execFile)('git', ['init', repository]);
  await symlink(subfolder, alias);
  const current = (await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent;
  const permissions = { ...current.permissions, workspaceOverrides: { [alias]: { modes: { 'shell.dev': 'block' } } } };
  const seeded = await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', {
    agent: current, profilePatch: { workspace: alias, projects: [{ path: alias }], permissions }, expectedProfileRevision: current.profileRevision,
  });
  expect(seeded.success, seeded.error).toBe(true);
  await page.goto(bridge.origin + '/welcome');
  await expect(page.getByRole('list', { name: 'Selected work folders', exact: true })).toContainText(alias);
  await page.getByRole('button', { name: 'Save work folders', exact: true }).click();
  await expect(page).toHaveURL(bridge.origin + '/squad');
  const saved = (await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent;
  expect(saved.workspace).toBe(alias);
  expect(saved.projects.map(project => project.path)).toEqual([alias]);
  expect(saved.permissions).toEqual(permissions);
});

test('delayed setup discovery never starts runtime preparation for an existing squad', async ({ page }) => {
  const { bridge } = fixture;
  let releaseSetup, held = false, runtimeReads = 0, preparations = 0;
  const gate = new Promise(resolve => { releaseSetup = resolve; });
  await page.route('**/api/setup', async route => {
    const response = await route.fetch(); held = true;
    await gate; await route.fulfill({ response });
  });
  await page.route('**/api/runtime', async route => {
    const response = await route.fetch(), body = await response.json();
    body.data.available = false; body.data.bootstrap = { phase: 'idle' }; runtimeReads++;
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/setup/runtime', async route => {
    preparations++;
    await route.fulfill({ status: 409, json: { success: false, error: 'Unexpected fixture runtime preparation.' } });
  });
  try {
    await page.goto(bridge.origin + '/welcome');
    await expect.poll(() => held && runtimeReads > 0).toBe(true);
    await expect(page.getByTestId('first-run')).toBeVisible();
    // Give passive effects a rendered turn while discovery is deliberately held.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(preparations).toBe(0);
  } finally { releaseSetup(); }
  await expect(page.getByRole('heading', { name: 'Review where your squad works.', exact: true })).toBeVisible();
  expect(preparations).toBe(0);
});

test('an earlier save receipt cannot replace a newer streamed workspace', async ({ page }) => {
  const { bridge, member } = fixture;
  const home = (await bridge.api('/api/runtime')).data.workspaceRoot;
  const newer = join(home, 'newer-work-folder'); await mkdir(newer, { recursive: true });
  let releaseSave, savedRevision;
  const gate = new Promise(resolve => { releaseSave = resolve; });
  await page.route(`**/api/control-plane/members/${member.id}/workspace`, async route => {
    const response = await route.fetch(); savedRevision = (await response.json()).data.revision;
    await gate; await route.fulfill({ response });
  });
  await page.goto(bridge.origin + '/welcome');
  await page.getByRole('button', { name: 'Save work folders', exact: true }).click();
  try {
    await expect.poll(() => savedRevision).toBeTruthy();
    const current = (await bridge.api('/api/channels')).data.agentChannelAccess[member.id].agent;
    const changed = await bridge.api(`/api/members/${member.id}/channel-access`, 'PUT', {
      agent: current, profilePatch: { name: 'Eva updated elsewhere', workspace: newer, projects: [{ path: newer }] }, expectedProfileRevision: current.profileRevision,
    });
    expect(changed.success, changed.error).toBe(true);
    // This proves the newer revision has reached React before the old reply.
    await expect(page.getByRole('combobox')).toContainText('Eva updated elsewhere', { timeout: 20000 });
  } finally { releaseSave(); }
  await expect(page).toHaveURL(bridge.origin + '/squad');
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-sections').getByRole('link', { name: 'Setup guide', exact: true }).click();
  await page.getByRole('button', { name: 'Run the setup guide', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Selected work folders', exact: true })).toContainText(newer);
});
