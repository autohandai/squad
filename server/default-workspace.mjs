import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { writePersistentJson } from './persistent-json.mjs';

function inside(path, home) {
  const part = relative(realpathSync(home), realpathSync(path));
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

/** Reading readiness never creates a directory or runs Git. */
export function defaultWorkspaceSetup(home, ownership) {
  const path = join(home, 'Documents', 'autohand-desktop');
  const exists = existsSync(path);
  let available = false, accepted = !ownership;
  try { available = exists && statSync(path).isDirectory() && inside(path, home); } catch { /* creation explains the failure */ }
  if (ownership && available) {
    try {
      const receipt = JSON.parse(readFileSync(join(ownership.stateDir, 'workspace-consent.json'), 'utf8'));
      accepted = receipt.version === 1 && receipt.ownerKey === ownership.ownerKey && receipt.path === realpathSync(path);
    } catch { accepted = false; }
  }
  return { path, exists, available, ready: available && accepted, needsCreationConsent: !exists, needsReuseConsent: available && !accepted };
}

export async function createDefaultWorkspace(home, consent, ownership) {
  if (consent !== true) throw Object.assign(new Error('Choose Create folder to allow Squad to create its default work folder.'), { status: 400 });
  const setup = defaultWorkspaceSetup(home, ownership);
  if (setup.exists && !setup.available) throw Object.assign(new Error('The default path is not an available folder. Choose another folder.'), { status: 400 });
  let parent = setup.path;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  if (!inside(parent, home)) throw Object.assign(new Error('The default work folder must stay inside your user folder. Choose another folder.'), { status: 400 });
  try { await mkdir(setup.path, { recursive: true, mode: 0o700 }); }
  catch { throw Object.assign(new Error('Squad could not create the default work folder. Choose another folder or check its access permissions.'), { status: 400 }); }
  if (!defaultWorkspaceSetup(home).available) throw Object.assign(new Error('The default work folder is unavailable. Choose another folder.'), { status: 400 });
  if (ownership) await writePersistentJson(join(ownership.stateDir, 'workspace-consent.json'), { version: 1, ownerKey: ownership.ownerKey, path: realpathSync(setup.path), acceptedAt: new Date().toISOString() });
  return { path: setup.path };
}
