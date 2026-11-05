import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publicSystemSettings, readSystemSettings, writeSystemSettings } from '../server/system/settings.mjs';
import { startBridge } from './lib/reliability-browser.mjs';
const dir = await mkdtemp(join(tmpdir(), 'squad-quick-settings-'));
try {
  assert.equal((await readSystemSettings(dir)).quickChatEnabled, true);
  assert.equal((await readSystemSettings(dir)).quickChatMenuBarMode, 'single');
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ autoDownloadUpdates: true, retained: 'keep' }));
  await Promise.all([writeSystemSettings(dir, { quickChatEnabled: false }), writeSystemSettings(dir, { quickChatMenuBarMode: 'active-agents', quickChatShowUsage: false })]);
  const saved = await readSystemSettings(dir);
  assert.equal(saved.retained, 'keep'); assert.equal(saved.autoDownloadUpdates, true); assert.equal(saved.quickChatEnabled, false); assert.equal(saved.quickChatMenuBarMode, 'active-agents');
  assert.equal('retained' in publicSystemSettings(saved), false);
} finally { await rm(dir, { recursive: true, force: true }); }
const bridge = await startBridge({ prepare: async directory => { await mkdir(join(directory, 'squad')); await writeFile(join(directory, 'squad', 'settings.json'), JSON.stringify({ quickChatShowUsage: false })); return {}; } });
try {
  for (const body of [{ quickChatEnabled: 'false' }, { quickChatMenuBarMode: 'dock' }, { quickChatShowUsage: 0 }, null]) assert.equal((await bridge.api('/api/system/settings', 'PUT', body)).status, 400);
  const saved = await bridge.api('/api/system/settings', 'PUT', { quickChatEnabled: false, quickChatMenuBarMode: 'active-agents', quickChatShowUsage: false });
  assert.equal(saved.data.quickChatEnabled, false);
  assert.deepEqual((await bridge.api('/api/harnesses/usage')).data, { harnesses: [], enabled: false });
  await bridge.restart();
  assert.equal((await bridge.api('/api/system/settings')).data.quickChatMenuBarMode, 'active-agents');
  console.log('Quick Chat settings pass: defaults, serialized patch writes, retained update preferences, strict bridge validation, disabled usage probes and restart persistence.');
} finally { await bridge.close(); }
