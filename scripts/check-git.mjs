#!/usr/bin/env node
// Checks for git in channels (ADR-0022): server/git/status.mjs,
// server/git/events.mjs, server/routes/git.route.mjs and src/lib/git-events.js.
// Builds a scratch repository with a bare remote, asserts the status fields,
// drives the route with a fake bridge context (bind → poll → commit → poll →
// unbind) and proves a poll never duplicates events, then removes git and gh
// from PATH to check that nothing throws.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { ciStatus, createPullRequest, ghAvailable, gitStatus, listPullRequests, openPullRequests, remoteWebUrl, summarizeRuns } from "../server/git/status.mjs";
import { diffSnapshots, mergeEvents, pullRequestStatus, snapshotEvents } from "../server/git/events.mjs";
import * as gitRoute from "../server/routes/git.route.mjs";
import { bindingSummary, eventTitle, linkCommitsInTrace, mergeEventsIntoStream, relativeTime, statusPill } from "../src/lib/git-events.js";

process.env.AUTOHAND_GIT_POLL = "off"; // no timers in the check

const root = await mkdtemp(join(tmpdir(), "squad-git-"));
const gitBinary = (spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" }).stdout || "").trim().split(/\r?\n/)[0];
assert.ok(gitBinary, "git is required to run this check");

// A PATH with git but no gh, and one with neither.
const binGitOnly = join(root, "bin-git-only");
const binEmpty = join(root, "bin-empty");
await mkdir(binGitOnly, { recursive: true });
await mkdir(binEmpty, { recursive: true });
await symlink(gitBinary, join(binGitOnly, "git"));
const envGitOnly = { ...process.env, PATH: binGitOnly, GIT_CONFIG_NOSYSTEM: "1", HOME: root, GH_TOKEN: "", GITHUB_TOKEN: "" };
const envEmpty = { ...process.env, PATH: binEmpty, HOME: root };
// git's own subcommands need its libexec dir when PATH is stripped.
const gitExec = (spawnSync(gitBinary, ["--exec-path"], { encoding: "utf8" }).stdout || "").trim();
if (gitExec) envGitOnly.PATH = `${binGitOnly}${delimiter}${gitExec}`;

function git(cwd, args, env = envGitOnly) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  // --- scratch repository with three commits and a bare remote -------------
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "check@example.com"]);
  git(repo, ["config", "user.name", "Check"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  for (const [index, name] of ["one", "two", "three"].entries()) {
    await writeFile(join(repo, `${name}.txt`), `${name}\n`);
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", `Commit ${index + 1}: ${name}`, "--date", `2026-09-0${index + 1}T10:00:00+00:00`]);
  }
  git(root, ["init", "-q", "--bare", "remote.git"]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-q", "-u", "origin", "main"]);

  // --- gitStatus -----------------------------------------------------------
  let status = gitStatus(repo, { env: envGitOnly });
  assert.equal(status.error, undefined, `status error: ${status.error}`);
  assert.equal(status.branch, "main");
  assert.equal(status.head, "main");
  assert.equal(status.upstream, "origin/main");
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
  assert.equal(status.dirty, false);
  assert.equal(status.remoteUrl, remote);
  assert.equal(status.recentCommits.length, 3);
  const [newest] = status.recentCommits;
  assert.match(newest.sha, /^[0-9a-f]{40}$/);
  assert.equal(newest.short, newest.sha.slice(0, 7));
  assert.equal(newest.title, "Commit 3: three");
  assert.equal(newest.author, "Check");
  assert.match(newest.at, /^2026-09-03T10:00:00/);

  await writeFile(join(repo, "scratch.txt"), "dirty\n");
  status = gitStatus(repo, { env: envGitOnly, limit: 2 });
  assert.equal(status.dirty, true);
  assert.equal(status.changedFiles, 1);
  assert.equal(status.recentCommits.length, 2, "limit caps recent commits");
  await rm(join(repo, "scratch.txt"));

  await writeFile(join(repo, "four.txt"), "four\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Commit 4: four", "--date", "2026-09-04T10:00:00+00:00"]);
  status = gitStatus(repo, { env: envGitOnly });
  assert.equal(status.ahead, 1, "one commit ahead of origin/main");
  assert.equal(status.behind, 0);

  assert.equal(gitStatus(repo, { branch: "nope", env: envGitOnly }).error, `branch nope does not exist in ${repo}`);
  assert.equal(gitStatus(root, { env: envGitOnly }).error, `${root} is not a git repository`);
  assert.equal(gitStatus("", { env: envGitOnly }).error, "repoPath is required");

  assert.equal(remoteWebUrl("git@github.com:autohand/squad.git"), "https://github.com/autohand/squad");
  assert.equal(remoteWebUrl("https://github.com/autohand/squad.git"), "https://github.com/autohand/squad");
  assert.equal(remoteWebUrl("ssh://git@github.com/autohand/squad"), "https://github.com/autohand/squad");
  assert.equal(remoteWebUrl(""), "");
  assert.equal(summarizeRuns([{ status: "completed", conclusion: "success" }, { status: "in_progress", conclusion: "" }]), "pending");
  assert.equal(summarizeRuns([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]), "failure");
  assert.equal(summarizeRuns([{ status: "completed", conclusion: "success" }]), "success");
  assert.equal(summarizeRuns([]), "unknown");

  // --- no gh on PATH: everything degrades to empty results or { error } ----
  assert.equal(ghAvailable({ env: envGitOnly }), false);
  assert.deepEqual(openPullRequests(repo, { env: envGitOnly }), []);
  const listed = listPullRequests(repo, { env: envGitOnly });
  assert.deepEqual(listed.pullRequests, []);
  assert.match(listed.error, /gh is not installed/);
  const ci = ciStatus(repo, newest.sha, { env: envGitOnly });
  assert.equal(ci.status, "unknown");
  assert.match(ci.error, /gh is not installed/);
  assert.match(createPullRequest(repo, { title: "x", env: envGitOnly }).error, /GitHub CLI \(gh\) is not installed/);
  assert.equal(createPullRequest(repo, { title: "", env: envGitOnly }).error, "title is required");

  // --- no git either -------------------------------------------------------
  const noGit = gitStatus(repo, { env: envEmpty });
  assert.match(noGit.error, /git is not installed/);
  assert.deepEqual(noGit.recentCommits, []);
  assert.equal(ghAvailable({ env: envEmpty }), false);

  // --- event diffing: deterministic ids, no duplicates across polls --------
  const commits = gitStatus(repo, { env: envGitOnly, limit: 20 }).recentCommits;
  const prOpen = { number: 12, title: "Add git events", url: "https://github.com/autohand/squad/pull/12", state: "OPEN", isDraft: false, head: "git-events", base: "main", reviewDecision: "", updatedAt: "2026-09-05T09:00:00Z", createdAt: "2026-09-05T08:00:00Z", author: "iris" };
  const snapshot1 = { commits, pullRequests: [prOpen], ci: [{ sha: commits[0].sha, status: "pending", url: "https://github.com/autohand/squad/actions/runs/1" }] };

  const first = diffSnapshots(null, snapshot1, { channelId: "c1", branch: "main", now: "2026-09-05T10:00:00Z", commitLimit: 3 });
  assert.equal(first.filter((event) => event.kind === "commit").length, 3, "first poll caps commit rows");
  assert.equal(first.filter((event) => event.kind === "pr").length, 1);
  assert.equal(first.filter((event) => event.kind === "ci").length, 1);
  assert.ok(first.every((event) => event.role === "event" && event.id && event.createdAt && event.ref && event.title), "event shape");
  const commitIds = first.filter((event) => event.kind === "commit").map((event) => event.id);
  assert.deepEqual(commitIds, commits.slice(0, 3).map((commit) => `git-commit-${commit.sha}`).reverse(), "oldest first");
  assert.equal(first.find((event) => event.kind === "pr").status, "open");
  assert.equal(first.find((event) => event.kind === "ci").status, "pending");

  let merged = mergeEvents([], first);
  assert.equal(merged.added.length, first.length);
  assert.equal(merged.updated.length, 0);

  const again = diffSnapshots(snapshot1, snapshot1, { channelId: "c1", branch: "main", now: "2026-09-05T10:00:30Z" });
  assert.equal(again.length, 0, "an unchanged snapshot yields no events");
  merged = mergeEvents(merged.events, snapshotEvents(snapshot1, { channelId: "c1", branch: "main", now: "2026-09-05T10:00:30Z", commitLimit: 3 }));
  assert.equal(merged.added.length + merged.updated.length, 0, "replaying the snapshot never duplicates");
  merged = mergeEvents(merged.events, snapshotEvents(snapshot1, { channelId: "c1", branch: "main", now: "2026-09-05T10:00:30Z" }));
  assert.equal(merged.added.length, 1, "an older commit outside the first-poll cap is still new once, never twice");
  merged = mergeEvents(merged.events, snapshotEvents(snapshot1, { channelId: "c1", branch: "main", now: "2026-09-05T10:00:30Z" }));
  assert.equal(merged.added.length + merged.updated.length, 0);

  const prMerged = { ...prOpen, state: "MERGED", mergedAt: "2026-09-05T11:00:00Z", updatedAt: "2026-09-05T11:00:00Z" };
  const snapshot2 = { commits: [{ sha: "f".repeat(40), short: "fffffff", title: "Merge pull request #12", author: "iris", at: "2026-09-05T11:00:00Z", url: "" }, ...commits], pullRequests: [prMerged], ci: [{ sha: commits[0].sha, status: "success", url: "" }] };
  const second = diffSnapshots(snapshot1, snapshot2, { channelId: "c1", branch: "main", now: "2026-09-05T11:00:30Z" });
  assert.deepEqual(second.map((event) => [event.kind, event.status]).sort(), [["ci", "success"], ["commit", "committed"], ["pr", "merged"]]);
  merged = mergeEvents(merged.events, second);
  assert.equal(merged.added.length, 1, "only the new commit is appended");
  assert.equal(merged.updated.length, 2, "PR and CI rows update in place");
  assert.equal(merged.events.filter((event) => event.id === "git-pr-12").length, 1);
  assert.equal(merged.events.find((event) => event.id === "git-pr-12").status, "merged");
  assert.equal(merged.events.find((event) => event.id === "git-pr-12").createdAt, "2026-09-05T08:00:00.000Z", "createdAt survives an update");
  assert.equal(pullRequestStatus({ reviewDecision: "CHANGES_REQUESTED" }), "changes-requested");
  assert.equal(pullRequestStatus({ isDraft: true }), "draft");
  assert.equal(pullRequestStatus({ state: "CLOSED" }), "closed");

  // --- browser-side helpers ------------------------------------------------
  const pr = merged.events.find((event) => event.kind === "pr");
  assert.deepEqual(statusPill(pr).label, "Merged");
  assert.equal(statusPill({ kind: "ci", status: "failure" }).tone, "danger");
  assert.equal(statusPill({ kind: "pr", status: "approved" }).tone, "success");
  assert.equal(statusPill({ kind: "pr", status: "merged" }, { gitStatusMerged: "Fusionné" }).label, "Fusionné");
  assert.equal(eventTitle(pr), "#12 Add git events");
  assert.equal(eventTitle(merged.events[0]), "Commit 2: two", "first appended row is the oldest of the capped first poll");
  const now = Date.parse("2026-09-05T12:00:00Z");
  assert.equal(relativeTime("2026-09-05T11:59:40Z", { now }), "just now");
  assert.equal(relativeTime("2026-09-05T11:30:00Z", { now }), "30m");
  assert.equal(relativeTime("2026-09-05T09:00:00Z", { now }), "3h");
  assert.equal(relativeTime("2026-09-04T09:00:00Z", { now }), "yesterday");
  assert.equal(relativeTime("2026-09-01T09:00:00Z", { now }), "Sep 1");
  assert.equal(relativeTime("nope", { now }), "");

  const messages = [
    { id: "m1", role: "user", body: "Shipping?", createdAt: "2026-09-05T08:30:00Z" },
    { id: "m2", role: "agent", body: "Opened the PR.", createdAt: "2026-09-05T10:30:00Z" },
  ];
  const stream = mergeEventsIntoStream(messages, [...merged.events, { id: "git-pr-12", role: "event", kind: "pr", status: "merged", createdAt: "2026-09-05T08:00:00.000Z" }]);
  assert.equal(stream.filter((item) => item.id === "git-pr-12").length, 1, "duplicate event ids collapse");
  assert.equal(stream.length, messages.length + merged.events.length);
  for (let index = 1; index < stream.length; index += 1) {
    assert.ok(Date.parse(stream[index - 1].createdAt) <= Date.parse(stream[index].createdAt), "stream is chronological");
  }
  assert.equal(stream[0].id, `git-commit-${commits[3].sha}`, "the oldest commit opens the stream");

  const trace = `Committed ${commits[0].sha.slice(0, 7)} and \`${commits[0].sha.slice(0, 7)}\` then deadbeef1234 (unrelated) and colour #a1b2c3d.`;
  const linked = linkCommitsInTrace(trace, "git@github.com:autohand/squad.git", { knownShas: commits.map((commit) => commit.sha) });
  assert.ok(linked.includes(`[${commits[0].sha.slice(0, 7)}](https://github.com/autohand/squad/commit/${commits[0].sha.slice(0, 7)})`), linked);
  assert.ok(linked.includes(`\`${commits[0].sha.slice(0, 7)}\``), "code spans untouched");
  assert.ok(!linked.includes("commit/deadbeef1234"), "unknown shas are not linked");
  assert.ok(!linked.includes("commit/a1b2c3d"), "colour-like hex untouched");
  assert.equal(linkCommitsInTrace(trace, ""), trace, "no remote, no links");

  assert.equal(bindingSummary(null, null), "Not bound to a repository.");
  assert.equal(bindingSummary({ repoPath: repo, branch: "main", remote: "origin" }, { ahead: 1, behind: 0, dirty: true, changedFiles: 2, recentCommits: [] }), "Watching main at origin · 1 ahead, 0 behind · 2 changed files");

  // --- route: bind → poll → commit → poll → unbind ------------------------
  const stateDir = join(root, "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "channels.json"), JSON.stringify({ version: 1, channels: [{ id: "c1", name: "release-reviews", memberIds: [], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }], threads: [], messages: [] }));
  const emitted = [];
  const ctx = {
    squadStateDir: stateDir,
    json: (res, statusCode, payload) => {
      res.statusCode = statusCode;
      res.payload = payload;
    },
    readBody: async (req) => req.body || {},
    readOptionalJsonFile: async (path) => {
      try {
        return JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    writeJsonFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
    },
    cleanWorkspace: async (path) => {
      if (!path) throw Object.assign(new Error("workspace is required"), { status: 400 });
      return path;
    },
    emit: (name, payload) => emitted.push({ name, ...payload }),
    logEvent: () => {},
    SEVERITY: { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 },
    spawnSync: (command, args, options) => spawnSync(command, args, { ...options, env: envGitOnly }),
  };
  async function call(method, path, body) {
    const req = { method, body };
    const res = {};
    const handled = await gitRoute.handle(req, res, new URL(`http://127.0.0.1${path}`), ctx);
    return { handled, status: res.statusCode, ...res.payload };
  }

  assert.equal((await call("GET", "/api/members/presence")).handled, false, "ignores other routes");

  const statusResponse = await call("GET", `/api/git/status?workspace=${encodeURIComponent(repo)}`);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.data.branch, "main");
  assert.equal(statusResponse.data.ahead, 1);
  assert.deepEqual(statusResponse.data.pullRequests, []);
  assert.equal(statusResponse.data.gh.available, false);
  assert.equal((await call("GET", "/api/git/status")).status, 400, "missing workspace");

  assert.equal((await call("POST", "/api/git/watch", { channelId: "c1" })).status, 400);
  assert.equal((await call("POST", "/api/git/watch", { channelId: "c1", repoPath: root })).status, 400, "not a repository");

  const bound = await call("POST", "/api/git/watch", { channelId: "c1", repoPath: repo, remote: "origin", branch: "main" });
  assert.equal(bound.status, 200, JSON.stringify(bound));
  assert.equal(bound.data.binding.branch, "main");
  assert.equal(bound.data.status.branch, "main");
  assert.equal(bound.data.added.length, 4, "binding shows the last commits immediately (4 exist, cap is 5)");
  assert.equal(emitted.filter((event) => event.name === "git.event").length, 4);
  assert.equal(emitted[0].event.kind, "commit");

  const sidecar = JSON.parse(await (await import("node:fs/promises")).readFile(join(stateDir, "git-watch.json"), "utf8"));
  assert.equal(sidecar.bindings.length, 1);
  assert.equal(sidecar.events.c1.length, 4);
  let channelsFile = JSON.parse(await (await import("node:fs/promises")).readFile(join(stateDir, "channels.json"), "utf8"));
  assert.deepEqual(channelsFile.channels[0].git, { repoPath: repo, remote: "origin", branch: "main", boundAt: bound.data.binding.boundAt });
  assert.equal(channelsFile.channels[0].events.length, 4, "events mirrored into channels.json");

  const poll2 = await gitRoute.pollChannel("c1", ctx);
  assert.equal(poll2.added.length + poll2.updated.length, 0, "a quiet poll adds nothing");
  assert.equal(emitted.length, 4, "no duplicate emits");

  await writeFile(join(repo, "five.txt"), "five\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Commit 5: five", "--date", "2026-09-05T10:00:00+00:00"]);
  const poll3 = await gitRoute.pollChannel("c1", ctx);
  assert.equal(poll3.added.length, 1, "the new commit appears on the next poll");
  assert.equal(poll3.added[0].title, "Commit 5: five");
  assert.equal(poll3.events.length, 5);
  const poll4 = await gitRoute.pollChannel("c1", ctx);
  assert.equal(poll4.added.length + poll4.updated.length, 0);

  // Commits that only exist on the remote (someone else pushed) are seen too.
  const clone = join(root, "clone");
  git(root, ["clone", "-q", remote, "clone"]);
  git(clone, ["config", "user.email", "other@example.com"]);
  git(clone, ["config", "user.name", "Other"]);
  git(clone, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(clone, "six.txt"), "six\n");
  git(clone, ["add", "."]);
  git(clone, ["commit", "-q", "-m", "Commit 6: pushed elsewhere", "--date", "2026-09-06T10:00:00+00:00"]);
  git(clone, ["push", "-q", "origin", "main"]);
  const poll5 = await gitRoute.pollChannel("c1", ctx);
  assert.equal(poll5.added.length, 1, "a commit pushed to the remote branch appears after fetch");
  assert.equal(poll5.added[0].author, "Other");
  assert.equal(poll5.status.behind, 1);

  const watched = await call("GET", "/api/git/watch/c1");
  assert.equal(watched.data.binding.channelId, "c1");
  assert.equal(watched.data.events.length, 6);
  assert.equal(watched.data.status.branch, "main");
  assert.equal((await call("GET", "/api/git/watch")).data.bindings.length, 1);

  // --- PR creation respects the ladder ------------------------------------
  assert.equal(gitRoute.ladderAllowsPullRequest("edit-files"), false);
  assert.equal(gitRoute.ladderAllowsPullRequest("open-pr"), true);
  assert.equal(gitRoute.ladderAllowsPullRequest("auto-merge-disabled"), true);
  assert.equal(gitRoute.ladderAllowsPullRequest(5), true);
  assert.equal(gitRoute.ladderAllowsPullRequest({ id: "run-read-only" }), false);
  const denied = await call("POST", "/api/git/pr", { workspace: repo, title: "x", permissionLevel: "edit-files" });
  assert.equal(denied.status, 403);
  assert.match(denied.error, /open-pr/);
  const noGh = await call("POST", "/api/git/pr", { workspace: repo, title: "x", permissionLevel: "open-pr", push: false });
  assert.equal(noGh.status, 502, JSON.stringify(noGh));
  assert.match(noGh.error, /gh/);

  // --- unbind --------------------------------------------------------------
  const removed = await call("DELETE", "/api/git/watch/c1");
  assert.equal(removed.data.removed, true);
  assert.equal((await call("GET", "/api/git/watch")).data.bindings.length, 0);
  channelsFile = JSON.parse(await (await import("node:fs/promises")).readFile(join(stateDir, "channels.json"), "utf8"));
  assert.equal(channelsFile.channels[0].git, undefined, "binding removed from channels.json");
  assert.equal(channelsFile.channels[0].events.length, 6, "history stays");
  assert.deepEqual(await gitRoute.pollChannel("c1", ctx), { added: [], updated: [], error: "not watching" });

  console.log("check-git: ok");
} finally {
  gitRoute.stopAllWatchers();
  await rm(root, { recursive: true, force: true });
}
