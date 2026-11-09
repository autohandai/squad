import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

function inside(path, home) {
  const part = relative(realpathSync(home), realpathSync(path));
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

/** Reading readiness never creates a directory or runs Git. */
export function defaultWorkspaceSetup(home) {
  const path = join(home, 'Documents', 'autohand-desktop');
  const exists = existsSync(path);
  let ready = false;
  try { ready = exists && statSync(path).isDirectory() && inside(path, home); } catch { /* creation explains the failure */ }
  return { path, exists, ready, needsCreationConsent: !exists };
}

export async function createDefaultWorkspace(home, consent) {
  if (consent !== true) throw Object.assign(new Error('Choose Create folder to allow Squad to create its default work folder.'), { status: 400 });
  const setup = defaultWorkspaceSetup(home);
  if (setup.exists && !setup.ready) throw Object.assign(new Error('The default path is not an available folder. Choose another folder.'), { status: 400 });
  let parent = setup.path;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  if (!inside(parent, home)) throw Object.assign(new Error('The default work folder must stay inside your user folder. Choose another folder.'), { status: 400 });
  try { await mkdir(setup.path, { recursive: true, mode: 0o700 }); }
  catch { throw Object.assign(new Error('Squad could not create the default work folder. Choose another folder or check its access permissions.'), { status: 400 }); }
  if (!defaultWorkspaceSetup(home).ready) throw Object.assign(new Error('The default work folder is unavailable. Choose another folder.'), { status: 400 });
  return { path: setup.path };
}
