// Skills the person already has on this machine.
//
// Skills used to resolve only from the Skilled catalog, so a skill sitting in
// ~/.claude/skills was invisible and a member asking for it got "not found in
// Skilled catalog". A user put it plainly: "It feels like I have walked into
// someone else's dev shop. If I can get better access to skills that already
// exist in my $HOME that would help a lot."
//
// A skill is a directory holding a SKILL.md. That is the shape Claude,
// Autohand and the agents convention all use, so one reader covers all three.
// The frontmatter is read only for a name and description; a SKILL.md without
// frontmatter is still a valid skill named after its folder.
//
// See docs/adrs/ADR-0039-local-skills.md.

import { existsSync } from "node:fs";
import { readFile, readdir, lstat, realpath, mkdir, writeFile, rename, chmod } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const digest = value => createHash('sha256').update(value).digest('hex');
const ordered = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const SKILL_CONTRACT_VERSION = 1;

export async function ensureSkillWorkspaceIdentity(workspace) {
  const info = await lstat(workspace);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The skill workspace is unavailable');
  const folder = join(workspace, '.autohand');
  const existing = await lstat(folder).catch(() => null);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('The workspace identity folder is unsafe');
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'workspace-identity.json');
  try { await writeFile(file, JSON.stringify({ version: 1, id: randomUUID() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return await readSkillWorkspaceIdentity(workspace);
}

export async function readSkillWorkspaceIdentity(workspace) {
  const root = await lstat(workspace).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) throw new Error('The skill workspace is unavailable');
  const file = join(workspace, '.autohand', 'workspace-identity.json');
  const folder = await lstat(dirname(file)).catch(() => null);
  if (folder?.isSymbolicLink() || (folder && !folder.isDirectory())) throw new Error('The workspace identity folder is unsafe');
  const info = await lstat(file).catch(() => null);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('The saved workspace identity is unsafe');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  if (saved.version !== 1 || typeof saved.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id)) throw new Error('The saved workspace identity is invalid');
  return saved.id;
}

export function localSkillRootDescriptors(options = {}) {
  const { homeDir = '', workspace = '', squadStateDir = '', workspaceId = '', memberId = '' } = options;
  const projectRoots = new Set(workspace ? localSkillRoots({ workspace }) : []);
  return localSkillRoots(options).map(path => {
    const project = projectRoots.has(path);
    const personal = !project && homeDir && ['.autohand', '.claude', '.codex', '.agents', '.agent'].some(name => path === join(homeDir, name, 'skills'));
    const team = !project && squadStateDir && path === join(squadStateDir, 'skills');
    const relativeRoot = project ? relative(workspace, path).split(sep).join('/') : '';
    const origin = project ? relativeRoot === 'skills' ? 'workspace' : relativeRoot.replace(/\/skills$/u, '').replace(/^\./u, '') : basename(dirname(path)).replace(/^\./, '');
    return { path, authority: team ? 'local:squad' : personal ? `local:personal:${origin}` : workspaceId ? `local:workspace:${workspaceId}:${origin}` : '', identityState: !team && !personal && !workspaceId ? 'locator-only' : 'stable', scope: team ? 'team' : personal ? 'member' : 'project', ownerId: personal ? memberId : '', workspace: !personal && !team ? resolve(workspace) : '' };
  });
}

/** Where a skill can live, in the order a name is resolved. */
export function localSkillRoots(options) {
  const { homeDir = "", workspace = "", squadStateDir = "" } = options && typeof options === "object" ? options : {};
  const roots = [];
  // The workspace first: a skill checked in beside the code is the most
  // specific answer to "which skill did you mean".
  if (workspace) {
    roots.push(join(workspace, ".autohand", "skills"), join(workspace, ".claude", "skills"), join(workspace, ".agents", "skills"), join(workspace, ".codex", "skills"), join(workspace, ".agent", "skills"));
    for (const ecosystem of ['aider-desk', 'augment', 'bob', 'codeartsdoer', 'codebuddy', 'codemaker', 'codestudio', 'commandcode', 'continue', 'cortex', 'crush', 'devin', 'factory', 'forge', 'goose', 'hermes', 'junie', 'iflow', 'kilocode', 'kiro', 'kode', 'mcpjam', 'vibe', 'mux', 'openhands', 'pi', 'qoder', 'qwen', 'rovodev', 'roo', 'tabnine/agent', 'trae', 'windsurf', 'zencoder', 'neovate', 'pochi', 'adal']) roots.push(join(workspace, `.${ecosystem}`, 'skills'));
    roots.push(join(workspace, 'skills'));
  }
  // Skills that arrived in a team file (server/teams, ADR-0106) live in the
  // app's own state folder, so they are found by name like any local skill
  // and never written into a folder the person owns.
  if (squadStateDir) roots.push(join(squadStateDir, "skills"));
  if (homeDir) {
    roots.push(join(homeDir, ".autohand", "skills"), join(homeDir, ".claude", "skills"), join(homeDir, ".agents", "skills"), join(homeDir, ".codex", "skills"), join(homeDir, ".agent", "skills"));
  }
  return roots;
}

/** Frontmatter `name` and `description`, when the file has any. */
export function readSkillFrontmatter(text) {
  const source = String(text || "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pair = lines[index].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    let value = pair[2].trim();
    // A block scalar ("description: |") puts the text on the indented lines
    // below. Taking the marker itself gave skills a description of "|".
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const block = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (!/^\s+\S/.test(lines[next]) && lines[next].trim()) break;
        block.push(lines[next].trim());
      }
      value = block.join(" ").trim();
    }
    value = value.replace(/^["']|["']$/g, "").trim();
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Every skill under the given roots, nearest root first, one entry per id.
 * A root that does not exist is skipped rather than failing the scan; these
 * are optional directories on someone else's machine.
 */
export async function listLocalSkillPackages(roots = []) {
  const found = new Map();
  for (const input of Array.isArray(roots) ? roots : []) {
    const root = typeof input === 'string' ? input : input?.path;
    if (!root || !existsSync(root)) continue;
    async function scan(folder, prefix = '') {
      let entries;
      try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => ordered(a.name, b.name))) {
      if (!entry.isDirectory() || (entry.name.startsWith('.') && entry.name !== '.system')) continue;
      const id = prefix ? `${prefix}/${entry.name}` : entry.name;
      const dir = join(folder, entry.name);
      const skillPath = join(dir, "SKILL.md");
      if (!existsSync(skillPath)) { await scan(dir, id); continue; }
      let frontmatter = {};
      try {
        frontmatter = readSkillFrontmatter(await readFile(skillPath, "utf8"));
      } catch {
        // A skill that cannot be read is still a skill that is there.
      }
      const authority = typeof input === 'object' && input.authority ? input.authority : '';
      const reference = { authority, packageId: id, resource: 'SKILL.md' };
      const key = `${authority}\0${id}`;
      if (found.has(key)) continue;
      found.set(key, {
        id,
        name: frontmatter.name || id,
        description: frontmatter.description || "",
        category: "local",
        author: "",
        source: "local",
        local: true,
        dir,
        path: skillPath,
        root,
        reference,
        qualifiedId: authority ? `${authority}::${id}` : '',
        identityState: authority ? 'stable' : 'locator-only',
        scope: typeof input === 'object' ? input.scope || 'member' : 'member',
        ownerId: typeof input === 'object' ? input.ownerId || '' : '',
        workspace: typeof input === 'object' ? input.workspace || '' : '',
      });
      }
    }
    await scan(root);
  }
  return [...found.values()];
}

export async function listLocalSkills(roots = []) {
  const found = new Map();
  for (const skill of await listLocalSkillPackages(roots)) if (!found.has(skill.id)) found.set(skill.id, skill);
  return [...found.values()];
}

/** The files of a skill folder, relative path to contents, for copying. */
export async function readSkillFolder(dir, { maxFiles = 200, maxBytes = 2_000_000 } = {}) {
  const packet = await readSkillPackage(dir, { maxFiles, maxBytes });
  return packet.files.map(([path, bytes]) => [path, bytes.toString('utf8')]);
}

export async function readSkillPackage(dir, { maxFiles = 200, maxBytes = 2_000_000 } = {}) {
  const files = [];
  const modes = new Map();
  let total = 0;
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe symbolic skill package root');
  const root = await realpath(dir);
  async function walk(current, prefix) {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => ordered(a.name, b.name));
    for (const entry of entries) {
      if (['.git', '.hg'].includes(entry.name) || entry.name.includes('\\') || entry.name.includes('\0')) throw new Error('Unsafe skill resource path');
      const full = join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(full);
      if (info.isSymbolicLink() || !(await realpath(full)).startsWith(`${root}${sep}`)) throw new Error(`Unsafe symbolic skill resource: ${relative}`);
      if (info.isDirectory()) {
        await walk(full, relative);
        continue;
      }
      if (!info.isFile()) throw new Error(`Unsafe skill resource: ${relative}`);
      if (files.length >= maxFiles || total + info.size > maxBytes) throw new Error('Skill package exceeds the complete-package file/byte limit');
      const bytes = await readFile(full);
      const after = await lstat(full);
      if (!after.isFile() || after.isSymbolicLink() || info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs || bytes.length !== info.size) throw new Error(`Skill resource changed while reading: ${relative}`);
      total += bytes.length;
      modes.set(relative, info.mode & 0o777);
      files.push([relative, bytes]);
    }
  }
  await walk(root, "");
  if (!files.some(([path]) => path === 'SKILL.md')) throw new Error('Skill package is missing SKILL.md');
  files.sort(([a], [b]) => ordered(a, b));
  const resources = files.map(([path, bytes]) => ({ path, sha256: digest(bytes), bytes: bytes.length }));
  const manifest = { version: SKILL_CONTRACT_VERSION, revision: `sha256:${digest(JSON.stringify(resources))}`, resources };
  return { files, modes, manifest };
}

export async function copySkillPackage(source, target, reference) {
  const packet = await readSkillPackage(source);
  if (reference.revision && reference.revision !== packet.manifest.revision) throw new Error('Skill package revision changed before snapshot');
  await mkdir(dirname(target), { recursive: true });
  const stage = join(dirname(dirname(target)), 'skill-staging', randomUUID());
  await mkdir(stage, { recursive: true });
  for (const [path, bytes] of packet.files) {
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await writeFile(join(stage, path), bytes, { mode: packet.modes.get(path) });
    await chmod(join(stage, path), packet.modes.get(path));
  }
  if ((await readSkillPackage(stage)).manifest.revision !== packet.manifest.revision) throw new Error('Skill snapshot validation failed');
  await rename(stage, target);
  return { reference: { ...reference, revision: packet.manifest.revision, resource: reference.resource || 'SKILL.md' }, manifest: packet.manifest };
}

export async function writeSkillPackage(files, target, reference) {
  if (files instanceof Map) files = [...files];
  if (!Array.isArray(files) || files.length > 200) throw new Error('Skill package exceeds file limit');
  const paths = new Set();
  let total = 0;
  for (const [path, content] of files) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part === '.hg') || paths.has(path)) throw new Error('Unsafe or duplicate skill resource path');
    paths.add(path);
    total += Buffer.byteLength(content);
    if (total > 2_000_000) throw new Error('Skill package exceeds byte limit');
  }
  if (!paths.has('SKILL.md')) throw new Error('Skill package is missing SKILL.md');
  const stage = join(dirname(dirname(target)), 'skill-staging', randomUUID());
  await mkdir(stage, { recursive: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await writeFile(join(stage, path), content);
  }
  const { manifest } = await readSkillPackage(stage);
  if (reference.revision && reference.revision !== manifest.revision) throw new Error('Skill package revision changed before snapshot');
  await rename(stage, target);
  return { reference: { ...reference, revision: manifest.revision, resource: reference.resource || 'SKILL.md' }, manifest };
}
