import { mkdir, readFile, stat } from 'node:fs/promises';
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
