#!/usr/bin/env node
// Skills the person already has on this machine.
//
// Skills used to resolve only from the Skilled catalog, so a skill sitting in
// ~/.claude/skills was invisible and asking for it produced "not found in
// Skilled catalog". A user said it plainly: "It feels like I have walked into
// someone else's dev shop."
//
// See docs/adrs/ADR-0039-local-skills.md.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listLocalSkills, localSkillRoots, readSkillFolder, readSkillFrontmatter } from "../server/skills/local.mjs";

// --- where a skill can live ------------------------------------------------

{
  const roots = localSkillRoots({ homeDir: "/home/x", workspace: "/w" });
  for (const suffix of [".autohand/skills", ".claude/skills", ".agents/skills"]) {
    assert.ok(roots.some((root) => root === join("/home/x", suffix)), `home ${suffix} is searched`);
    assert.ok(roots.some((root) => root === join("/w", suffix)), `workspace ${suffix} is searched`);
  }
  // The workspace answers before the home directory: a skill checked in beside
  // the code is the more specific answer to "which one did you mean".
  assert.ok(roots.indexOf(join("/w", ".claude/skills")) < roots.indexOf(join("/home/x", ".claude/skills")));
  assert.deepEqual(localSkillRoots({}), [], "no home and no workspace searches nothing");
}

// --- frontmatter -----------------------------------------------------------

{
  assert.deepEqual(readSkillFrontmatter("---\nname: Writer\ndescription: Writes things\n---\nbody"), {
    name: "Writer",
    description: "Writes things",
  });
  // A block scalar puts its text on the lines below; taking the marker gave
  // skills a description of "|".
  assert.equal(readSkillFrontmatter("---\ndescription: |\n  One.\n  Two.\n---").description, "One. Two.");
  assert.equal(readSkillFrontmatter("no frontmatter at all").description, undefined);
  assert.deepEqual(readSkillFrontmatter(""), {});
  assert.deepEqual(readSkillFrontmatter(null), {});
}

// --- scanning --------------------------------------------------------------

{
  const home = await mkdtemp(join(tmpdir(), "squad-skills-"));
  const claude = join(home, ".claude", "skills");
  const autohand = join(home, ".autohand", "skills");
  await mkdir(join(claude, "review"), { recursive: true });
  await writeFile(join(claude, "review", "SKILL.md"), "---\nname: Review\ndescription: Reviews code\n---\n");
  await writeFile(join(claude, "review", "extra.md"), "more\n");
  await mkdir(join(claude, "not-a-skill"), { recursive: true });
  await mkdir(join(autohand, "review"), { recursive: true });
  await writeFile(join(autohand, "review", "SKILL.md"), "---\nname: Other review\n---\n");
  await mkdir(join(claude, ".hidden"), { recursive: true });
  await writeFile(join(claude, ".hidden", "SKILL.md"), "hidden\n");

  const roots = [autohand, claude];
  const skills = await listLocalSkills(roots);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));

  assert.ok(byId.has("review"), "a folder with a SKILL.md is a skill");
  assert.ok(!byId.has("not-a-skill"), "a folder without a SKILL.md is not");
  assert.ok(!byId.has(".hidden"), "dot folders are skipped");
  assert.equal(skills.filter((skill) => skill.id === "review").length, 1, "one entry per id");
  assert.equal(byId.get("review").name, "Other review", "the nearer root wins");
  assert.equal(byId.get("review").local, true);

  // A root that does not exist is not an error; these are optional folders.
  assert.deepEqual(await listLocalSkills([join(home, "nope")]), []);
  assert.deepEqual(await listLocalSkills([]), []);
  assert.deepEqual(await listLocalSkills(null), []);

  const files = await readSkillFolder(join(claude, "review"));
  const names = files.map(([name]) => name).sort();
  assert.deepEqual(names, ["SKILL.md", "extra.md"], "the whole folder is copied, not just SKILL.md");
  assert.ok(files.every(([, content]) => typeof content === "string"));
}

console.log("check-local-skills: ok");
