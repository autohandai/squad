import assert from 'node:assert/strict';
import { access, mkdir, writeFile, readFile, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { startBridge } from './lib/reliability-browser.mjs';

let home;
const bridge = await startBridge({ development: false, prepare: async directory => {
  home = join(directory, 'home'); await mkdir(home);
  return { HOME: home, USERPROFILE: home };
} });
try {
  const folder = join(home, 'Documents', 'autohand-desktop');
  const runtime = (await bridge.api('/api/runtime')).data;
  assert.equal(runtime.defaultWorkspace, '', 'never use the app directory or an arbitrary scanned project as the default');
  assert.equal(runtime.defaultWorkspaceSetup.path, folder);
  assert.equal(runtime.defaultWorkspaceSetup.needsCreationConsent, true);
  await assert.rejects(access(folder));
  const refused = await bridge.api('/api/workspaces/default', 'POST', { consent: false });
  assert.equal(refused.status, 400); await assert.rejects(access(folder));
  const outside = join(bridge.directory, 'outside-home'); await mkdir(outside);
  await symlink(outside, join(home, 'Documents'), 'dir');
  assert.equal((await bridge.api('/api/workspaces/default', 'POST', { consent: true })).status, 400);
  await assert.rejects(access(join(outside, 'autohand-desktop')));
  await unlink(join(home, 'Documents'));
  const accepted = await bridge.api('/api/workspaces/default', 'POST', { consent: true });
  assert.equal(accepted.status, 201); assert.equal(accepted.data.path, folder);
  await access(folder); await assert.rejects(access(join(folder, '.git')));
  await writeFile(join(folder, 'keep.txt'), 'existing work');
  await bridge.restart();
  assert.equal((await bridge.api('/api/runtime')).data.defaultWorkspace, folder);
  assert.equal((await bridge.api('/api/workspaces/default', 'POST', { consent: true })).status, 201);
  assert.equal(await readFile(join(folder, 'keep.txt'), 'utf8'), 'existing work');
  await assert.rejects(access(join(folder, '.git')));
  console.log('PASS default workspace: no implicit creation or app-directory fallback, explicit creation consent, existing files preserved, restart reuse, no Git initialization.');
} finally { await bridge.close(); }
