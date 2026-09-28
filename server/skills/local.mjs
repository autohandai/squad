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
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Where a skill can live, in the order a name is resolved. */
export function localSkillRoots(options) {
  const { homeDir = "", workspace = "" } = options && typeof options === "object" ? options : {};
  const roots = [];
  // The workspace first: a skill checked in beside the code is the most
  // specific answer to "which skill did you mean".
  if (workspace) {
    roots.push(join(workspace, ".autohand", "skills"), join(workspace, ".claude", "skills"), join(workspace, ".agents", "skills"));
  }
  if (homeDir) {
    roots.push(join(homeDir, ".autohand", "skills"), join(homeDir, ".claude", "skills"), join(homeDir, ".agents", "skills"));
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
export async function listLocalSkills(roots = []) {
  const found = new Map();
  for (const root of Array.isArray(roots) ? roots : []) {
    if (!root || !existsSync(root)) continue;
    let entries = [];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      if (found.has(id)) continue;
      const dir = join(root, id);
      const skillPath = join(dir, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      let frontmatter = {};
      try {
        frontmatter = readSkillFrontmatter(await readFile(skillPath, "utf8"));
      } catch {
        // A skill that cannot be read is still a skill that is there.
      }
      found.set(id, {
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
      });
    }
  }
  return [...found.values()];
}

/** The files of a skill folder, relative path to contents, for copying. */
export async function readSkillFolder(dir, { maxFiles = 200, maxBytes = 2_000_000 } = {}) {
  const files = [];
  let total = 0;
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || files.length >= maxFiles) continue;
      const full = join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(full);
      if (total + info.size > maxBytes) continue;
      total += info.size;
      files.push([relative, await readFile(full, "utf8")]);
    }
  }
  await walk(dir, "");
  return files;
}
