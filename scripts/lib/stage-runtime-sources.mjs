import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const serverData = new Set([
  'acp/bundled-registry.json',
  ...['competitor-watch', 'engineering-team', 'inbox-follow-up', 'lead-research-team', 'marketing-campaign-team', 'seo-growth-team'].map(name => `teams/templates/${name}.squad-team.json`),
]);
/** Copy runtime source, never working state, credentials, caches or symlinks.
 * Product catalogs are explicit exceptions, not permission to ship all JSON. */
export async function stageRuntimeSources(source, destination, kind) {
  const copied = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(source, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'target', 'cache', 'coverage'].includes(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Runtime source must not be a symlink: ${kind}/${path}`);
      if (entry.isDirectory()) { await walk(path); continue; }
      const code = entry.isFile() && (kind === 'lib' ? path.endsWith('.js') : path.endsWith('.mjs'));
      const catalog = kind === 'server' && serverData.has(path);
      if (!code && !catalog) continue;
      await mkdir(join(destination, relative), { recursive: true });
      await copyFile(join(source, path), join(destination, path)); copied.push(path);
    }
  }
  await walk();
  return copied;
}
