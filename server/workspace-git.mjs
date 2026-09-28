// Whether a folder is tracked by git, and who git thinks you are.
//
// Onboarding asks for a folder and then says nothing about version control,
// so someone can point a squad at an untracked directory and only find out
// what that means after a member has edited it. This reads the two facts that
// matter at that moment, and offers the one action.
//
// Every call is bounded and never prompts: `GIT_TERMINAL_PROMPT=0` and no
// credential helper, so a repo with an unreachable remote cannot hang the
// onboarding screen.
//
// See docs/adrs/ADR-0050-onboarding-knows-about-git.md.

import { spawnSync as nodeSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT_MS = 4000;

function git(args, cwd, spawnSync = nodeSpawnSync) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

/**
 * What git knows about this folder.
 *
 * `tracked` is whether the folder is inside a work tree at all. `name` and
 * `email` come from git's own configuration, so they are what a commit made
 * here would actually be authored by, not a guess.
 */
export function readGitContext(path, { spawnSync = nodeSpawnSync } = {}) {
  const folder = String(path || "").trim();
  const context = { tracked: false, root: "", branch: "", name: "", email: "", available: true };
  if (!folder || !existsSync(folder)) return context;

  const version = git(["--version"], folder, spawnSync);
  if (!version) return { ...context, available: false };

  // Identity is global and worth reporting even for an untracked folder,
  // because it answers "who will these commits be from" before there are any.
  context.name = git(["config", "--get", "user.name"], folder, spawnSync);
  context.email = git(["config", "--get", "user.email"], folder, spawnSync);

  const inside = git(["rev-parse", "--is-inside-work-tree"], folder, spawnSync);
  if (inside !== "true") return context;

  context.tracked = true;
  context.root = git(["rev-parse", "--show-toplevel"], folder, spawnSync);
  // A repo with no commits yet has a branch name but no HEAD to resolve.
  context.branch = git(["rev-parse", "--abbrev-ref", "HEAD"], folder, spawnSync) || git(["symbolic-ref", "--short", "HEAD"], folder, spawnSync);
  return context;
}

/**
 * Start tracking a folder. Refuses when it is already inside a work tree,
 * because running `git init` there would create a nested repository, which is
 * almost never what someone means and is confusing to undo.
 */
export function startTracking(path, { spawnSync = nodeSpawnSync } = {}) {
  const folder = String(path || "").trim();
  if (!folder || !existsSync(folder)) throw new Error("that folder does not exist");
  const before = readGitContext(folder, { spawnSync });
  if (!before.available) throw new Error("git is not installed, so this folder cannot be tracked");
  if (before.tracked) return before;

  const result = spawnSync("git", ["init"], {
    cwd: folder,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || result.error?.message || "git init failed").trim().slice(0, 200));
  }
  if (!existsSync(join(folder, ".git"))) throw new Error("git init reported success but created no repository");
  return readGitContext(folder, { spawnSync });
}
