// Git status for a bound channel (ADR-0022). Thin, synchronous wrappers over
// `git` and `gh` that never throw: a missing binary, a folder that is not a
// repository, or a `gh` that is not signed in all come back as `{ error }`
// fields so a poller can keep going and the UI can say what is wrong.
//
// Every function accepts `{ spawnSync, env }` so checks can inject a fake
// PATH without touching the real machine.

import { spawnSync as nodeSpawnSync } from "node:child_process";

export const DEFAULT_REMOTE = "origin";
export const RECENT_COMMIT_LIMIT = 5;

const GIT_TIMEOUT_MS = 5000;
const GH_TIMEOUT_MS = 15000;
const UNIT = "\u001f";

function exec(command, args, { cwd, timeout, env, spawnSync = nodeSpawnSync } = {}) {
  let result;
  try {
    result = spawnSync(command, args, {
      cwd,
      env: env || process.env,
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    return { ok: false, stdout: "", stderr: "", error: error?.message || String(error) };
  }
  if (result.error) {
    const missing = result.error.code === "ENOENT";
    return {
      ok: false,
      stdout: "",
      stderr: String(result.stderr || ""),
      missing,
      error: missing ? `${command} is not installed or not on PATH` : result.error.message || String(result.error),
    };
  }
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.status !== 0) {
    return { ok: false, stdout, stderr, error: stderr.trim().split(/\r?\n/)[0] || `${command} exited with ${result.status}` };
  }
  return { ok: true, stdout, stderr };
}

function git(repoPath, args, options = {}) {
  return exec("git", ["-C", repoPath, ...args], { timeout: GIT_TIMEOUT_MS, ...options });
}

function gh(repoPath, args, options = {}) {
  return exec("gh", args, { cwd: repoPath, timeout: GH_TIMEOUT_MS, ...options });
}

/** `git@github.com:o/r.git` or `https://github.com/o/r.git` → `https://github.com/o/r`. */
export function remoteWebUrl(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return "";
  let host = "";
  let path = "";
  const ssh = raw.match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/);
  const http = raw.match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+)\/(.+)$/);
  if (http) {
    host = http[1];
    path = http[2];
  } else if (ssh) {
    host = ssh[1];
    path = ssh[2];
  } else {
    return "";
  }
  path = path.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!host || !path) return "";
  return `https://${host}/${path}`;
}

export function commitUrl(remoteUrl, sha) {
  const base = remoteWebUrl(remoteUrl);
  return base && sha ? `${base}/commit/${sha}` : "";
}

export function parseCommitLog(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, short, title, author, at] = line.split(UNIT);
      if (!sha) return null;
      return { sha, short: short || sha.slice(0, 7), title: (title || "").trim(), author: (author || "").trim(), at: (at || "").trim() };
    })
    .filter(Boolean);
}

/** The newest `limit` commits reachable from `ref` (a branch or `origin/branch`). */
export function recentCommits(repoPath, ref, { limit = RECENT_COMMIT_LIMIT, remoteUrl = "", spawnSync, env } = {}) {
  const target = String(ref || "HEAD").trim() || "HEAD";
  const log = git(repoPath, ["log", target, `-n${Math.max(1, Math.min(100, limit))}`, "--no-color", `--format=%H${UNIT}%h${UNIT}%s${UNIT}%an${UNIT}%aI`], { spawnSync, env });
  if (!log.ok) return [];
  return parseCommitLog(log.stdout).map((commit) => ({ ...commit, url: commitUrl(remoteUrl, commit.sha) }));
}

/**
 * Status of `repoPath` on `branch` (default: the checked-out branch) against
 * `remote/branch`. `ahead`/`behind` are null when the remote branch is
 * unknown locally; call with `fetch: true` to refresh the remote refs first.
 */
export function gitStatus(repoPath, { branch = "", remote = DEFAULT_REMOTE, limit = RECENT_COMMIT_LIMIT, fetch = false, spawnSync, env } = {}) {
  const opts = { spawnSync, env };
  const path = String(repoPath || "").trim();
  const remoteName = String(remote || DEFAULT_REMOTE).trim() || DEFAULT_REMOTE;
  const base = { repoPath: path, remote: remoteName, branch: String(branch || "").trim(), head: "", ahead: null, behind: null, upstream: "", dirty: false, changedFiles: 0, recentCommits: [], remoteUrl: "", webUrl: "" };
  if (!path) return { ...base, error: "repoPath is required" };

  const top = git(path, ["rev-parse", "--show-toplevel"], opts);
  if (!top.ok) return { ...base, error: top.missing ? top.error : `${path} is not a git repository` };
  base.root = top.stdout.trim();

  const headResult = git(path, ["rev-parse", "--abbrev-ref", "HEAD"], opts);
  base.head = headResult.ok ? headResult.stdout.trim() : "";
  if (!base.branch) base.branch = base.head && base.head !== "HEAD" ? base.head : "";
  if (!base.branch) return { ...base, error: "no branch checked out" };

  const branchExists = git(path, ["rev-parse", "--verify", "--quiet", `refs/heads/${base.branch}`], opts);
  if (!branchExists.ok) return { ...base, error: `branch ${base.branch} does not exist in ${path}` };

  const remoteUrl = git(path, ["remote", "get-url", remoteName], opts);
  base.remoteUrl = remoteUrl.ok ? remoteUrl.stdout.trim() : "";
  base.webUrl = remoteWebUrl(base.remoteUrl);

  if (fetch && base.remoteUrl) {
    git(path, ["fetch", "--quiet", remoteName, base.branch], { ...opts, timeout: GH_TIMEOUT_MS });
  }

  const upstream = `${remoteName}/${base.branch}`;
  const upstreamExists = git(path, ["rev-parse", "--verify", "--quiet", `refs/remotes/${upstream}`], opts);
  if (upstreamExists.ok) {
    base.upstream = upstream;
    const counts = git(path, ["rev-list", "--left-right", "--count", `${base.branch}...${upstream}`], opts);
    if (counts.ok) {
      const [ahead, behind] = counts.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
      base.ahead = Number.isFinite(ahead) ? ahead : null;
      base.behind = Number.isFinite(behind) ? behind : null;
    }
  }

  // Dirty state describes the working tree, which only makes sense for the
  // checked-out branch; a bound branch that is not checked out is reported clean.
  if (base.head === base.branch) {
    const status = git(path, ["status", "--porcelain", "--untracked-files=normal"], opts);
    if (status.ok) {
      const lines = status.stdout.split(/\r?\n/).filter((line) => line.trim());
      base.changedFiles = lines.length;
      base.dirty = lines.length > 0;
    }
  }

  base.recentCommits = recentCommits(path, base.branch, { limit, remoteUrl: base.remoteUrl, ...opts });
  return base;
}

/** True when the GitHub CLI is on PATH (a signed-out `gh` still counts as present). */
export function ghAvailable({ spawnSync, env } = {}) {
  const result = exec("gh", ["--version"], { timeout: GIT_TIMEOUT_MS, spawnSync, env });
  return result.ok;
}

const PR_FIELDS = ["number", "title", "url", "state", "isDraft", "headRefName", "baseRefName", "reviewDecision", "mergedAt", "updatedAt", "createdAt", "author"];

export function normalizePullRequest(item) {
  if (!item || typeof item !== "object") return null;
  const number = Number(item.number);
  if (!Number.isFinite(number)) return null;
  const state = String(item.state || "OPEN").toUpperCase();
  return {
    number,
    title: String(item.title || "").trim(),
    url: String(item.url || "").trim(),
    state,
    isDraft: item.isDraft === true,
    head: String(item.headRefName || "").trim(),
    base: String(item.baseRefName || "").trim(),
    reviewDecision: String(item.reviewDecision || "").toUpperCase(),
    mergedAt: item.mergedAt ? String(item.mergedAt) : "",
    updatedAt: item.updatedAt ? String(item.updatedAt) : "",
    createdAt: item.createdAt ? String(item.createdAt) : "",
    author: String(item.author?.login || item.author?.name || "").trim(),
  };
}

/**
 * Pull requests via `gh pr list`. Returns `{ pullRequests, error? }`; an empty
 * list with `error` set means `gh` is missing, signed out, or the repository
 * has no GitHub remote. `state` is "open" (default), "merged", "closed" or "all".
 */
export function listPullRequests(repoPath, { state = "open", limit = 30, spawnSync, env } = {}) {
  const result = gh(repoPath, ["pr", "list", "--state", state, "--limit", String(limit), "--json", PR_FIELDS.join(",")], { spawnSync, env });
  if (!result.ok) return { pullRequests: [], error: result.error };
  try {
    const parsed = JSON.parse(result.stdout || "[]");
    return { pullRequests: (Array.isArray(parsed) ? parsed : []).map(normalizePullRequest).filter(Boolean) };
  } catch (error) {
    return { pullRequests: [], error: `gh pr list returned invalid JSON: ${error.message}` };
  }
}

/** Open pull requests, or `[]` when `gh` is unavailable. */
export function openPullRequests(repoPath, options = {}) {
  return listPullRequests(repoPath, { ...options, state: "open" }).pullRequests;
}

export function summarizeRuns(runs = []) {
  const list = runs.filter(Boolean);
  if (!list.length) return "unknown";
  const conclusions = list.map((run) => String(run.conclusion || "").toLowerCase());
  const statuses = list.map((run) => String(run.status || "").toLowerCase());
  if (conclusions.some((value) => ["failure", "timed_out", "cancelled", "startup_failure", "action_required"].includes(value))) return "failure";
  if (statuses.some((value) => value && value !== "completed")) return "pending";
  if (conclusions.every((value) => ["success", "skipped", "neutral"].includes(value))) return "success";
  return "pending";
}

/**
 * CI result for a commit via `gh run list --commit`. Returns
 * `{ sha, status: "success"|"failure"|"pending"|"unknown", runs, url, error? }`.
 */
export function ciStatus(repoPath, sha, { spawnSync, env } = {}) {
  const commit = String(sha || "").trim();
  if (!commit) return { sha: "", status: "unknown", runs: [], url: "", error: "sha is required" };
  const result = gh(repoPath, ["run", "list", "--commit", commit, "--limit", "20", "--json", "databaseId,name,status,conclusion,url,headSha,updatedAt"], { spawnSync, env });
  if (!result.ok) return { sha: commit, status: "unknown", runs: [], url: "", error: result.error };
  try {
    const parsed = JSON.parse(result.stdout || "[]");
    const runs = (Array.isArray(parsed) ? parsed : []).map((run) => ({
      id: run.databaseId,
      name: String(run.name || "").trim(),
      status: String(run.status || "").toLowerCase(),
      conclusion: String(run.conclusion || "").toLowerCase(),
      url: String(run.url || "").trim(),
      updatedAt: run.updatedAt ? String(run.updatedAt) : "",
    }));
    const status = summarizeRuns(runs);
    const worst = runs.find((run) => run.conclusion === "failure") || runs.find((run) => run.status !== "completed") || runs[0];
    return { sha: commit, status, runs, url: worst?.url || "" };
  } catch (error) {
    return { sha: commit, status: "unknown", runs: [], url: "", error: `gh run list returned invalid JSON: ${error.message}` };
  }
}

/**
 * `gh pr create`. Pushes `head` to `remote` first when `push` is true (the
 * default) so a branch that only exists locally can still get a PR. Returns
 * `{ url, number }` or `{ error }`.
 */
export function createPullRequest(repoPath, { title, body = "", base = "", head = "", remote = DEFAULT_REMOTE, draft = false, push = true, spawnSync, env } = {}) {
  const opts = { spawnSync, env };
  const path = String(repoPath || "").trim();
  const prTitle = String(title || "").trim();
  if (!path) return { error: "workspace is required" };
  if (!prTitle) return { error: "title is required" };
  if (!ghAvailable(opts)) return { error: "GitHub CLI (gh) is not installed or not on PATH" };

  let headBranch = String(head || "").trim();
  if (!headBranch) {
    const current = git(path, ["rev-parse", "--abbrev-ref", "HEAD"], opts);
    if (!current.ok) return { error: current.error };
    headBranch = current.stdout.trim();
    if (!headBranch || headBranch === "HEAD") return { error: "no branch checked out to open a PR from" };
  }
  if (push) {
    const pushed = git(path, ["push", "--set-upstream", String(remote || DEFAULT_REMOTE), headBranch], { ...opts, timeout: 60000 });
    if (!pushed.ok) return { error: `git push failed: ${pushed.error}` };
  }
  const args = ["pr", "create", "--title", prTitle, "--body", String(body || ""), "--head", headBranch];
  if (base) args.push("--base", String(base));
  if (draft) args.push("--draft");
  const created = gh(path, args, { ...opts, timeout: 60000 });
  if (!created.ok) return { error: created.error, head: headBranch };
  const url = (created.stdout.match(/https?:\/\/\S+\/pull\/\d+/) || [""])[0].trim();
  const number = Number((url.match(/\/pull\/(\d+)/) || [])[1]);
  return { url, number: Number.isFinite(number) ? number : null, head: headBranch };
}
