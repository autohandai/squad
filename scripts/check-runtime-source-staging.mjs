import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageRuntimeSources } from './lib/stage-runtime-sources.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-source-staging-'));
try {
  const source = join(directory, 'source'), target = join(directory, 'staged');
  for (const path of ['acp', 'teams/templates', '.squad', 'node_modules']) await mkdir(join(source,path),{recursive:true});
  const files = { 'onboarding.mjs': 'export const neutral=true;', 'acp/bundled-registry.json':'{}', 'teams/templates/engineering-team.squad-team.json':'{}', 'teams/templates/personal-team.squad-team.json':'private team', 'channels.json':'private channels', 'web-status.json':'private team', 'config.json':'credentials', '.env':'credentials', '.squad/memory.mjs':'private memory', 'node_modules/private.mjs':'private' };
  for (const [path, content] of Object.entries(files)) await writeFile(join(source,path),content);
  assert.deepEqual((await stageRuntimeSources(source,target,'server')).sort(), ['acp/bundled-registry.json','onboarding.mjs','teams/templates/engineering-team.squad-team.json']);
  assert.equal(await readFile(join(target,'onboarding.mjs'),'utf8'),files['onboarding.mjs']);
  await symlink(join(source,'config.json'),join(source,'linked.mjs'));
  await assert.rejects(stageRuntimeSources(source,target,'server'),/must not be a symlink/);
  console.log('PASS desktop runtime source staging excludes state, credentials, hidden directories, dependencies and symlinks; retains explicit product catalogs');
} finally { await rm(directory,{recursive:true,force:true}); }
