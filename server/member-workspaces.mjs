import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const fail = message => Object.assign(new Error(message), { status: 400 });

/** Validate the whole replacement before publishing one revision-checked edit. */
export async function memberWithWorkspaces(ctx, agent, { workspace, directories }) {
  if (typeof workspace !== 'string' || !workspace.trim() || workspace.length > 1000
    || !Array.isArray(directories) || directories.some(path => typeof path !== 'string' || !path.trim() || path.length > 1000)) {
    throw fail('Choose a primary workspace and an explicit list of additional folders (empty clears additional grants).');
  }
  const limit = ctx.getRuntime().limits?.maxProjectsPerMember || 32;
  if (directories.length + 1 > limit) throw fail(`Choose at most ${limit} work folders.`);
  const previousProjects = agent.projects || [];
  const previousRoots = await Promise.all(previousProjects.map(project => realpath(project.path).catch(() => '')));
  const primaryRoot = agent.workspace ? await realpath(agent.workspace).catch(() => '') : '';
  const projects = [], roots = new Set();
  for (const raw of [workspace, ...directories]) {
    const value = raw.trim();
    const path = value.startsWith('~/') ? resolve(ctx.homeDir, value.slice(2)) : value;
    if (!isAbsolute(path)) throw fail('Work folders must be absolute local paths.');
    // Do not let a managed-workspace helper create a missing directory. Folder
    // creation has its own explicit person-owned consent flow.
    const requestedRoot = await realpath(path).catch(() => { throw fail(`Work folder does not exist: ${value}`); });
    if (!(await stat(requestedRoot)).isDirectory()) throw fail(`Choose a directory: ${value}`);
    const clean = await ctx.cleanWorkspace(path, { createManagedWorkspace: false });
    const root = await realpath(clean);
    if (roots.has(root)) continue;
    roots.add(root);
    const previous = previousProjects[previousRoots.indexOf(root)];
    // Permissions are keyed by the saved locator. A physically equivalent
    // alias must not replace that locator and drop a restrictive override.
    const locator = root === primaryRoot ? agent.workspace : previous?.path || clean;
    projects.push(previous ? { ...previous, path: locator } : { path: locator });
  }
  return { ...agent, workspace: projects[0].path, projects };
}
