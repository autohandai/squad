// Git as a first-class object in channels (ADR-0022).
//
//   GET    /api/git/status?workspace=&branch=&remote=&fetch=1
//   GET    /api/git/watch                 → all bindings
//   GET    /api/git/watch/:channelId      → binding, last status, events
//   POST   /api/git/watch                 { channelId, repoPath, remote?, branch? }
//   DELETE /api/git/watch/:channelId
//   POST   /api/git/pr                    { workspace, title, body?, base?, head?, draft?, permissionLevel, channelId? }
//
// A bound channel gets a 30 s poller. Each poll snapshots the repository
// (recent commits on the branch and its upstream, pull requests touching the
// branch, CI for the newest commits), diffs it against the previous snapshot,
// merges the new rows into the channel's events, persists them, and emits
// `git.event` on the bridge bus.
//
// Persistence: bindings and events live in `<squadStateDir>/git-watch.json`,
// which this module owns. They are mirrored into `channels.json` as
// `channel.git` and `channel.events` so the app can read them with the
// channel; until the monolith's normalizeChannel() passes those two fields
// through (docs/integration/git.md), the sidecar file is the source of truth
// and every poll re-mirrors it.

import { join } from "node:path";

import { ciStatus, gitStatus, ghAvailable, listPullRequests, createPullRequest, recentCommits, DEFAULT_REMOTE, RECENT_COMMIT_LIMIT as INITIAL_COMMIT_ROWS } from "../git/status.mjs";
import { diffSnapshots, mergeEvents } from "../git/events.mjs";

export const name = "git";
export const POLL_INTERVAL_MS = 30_000;
export const STATE_FILE = "git-watch.json";
const SNAPSHOT_COMMITS = 20;
const CI_LOOKBACK = 2;

// Permission ladder (src/App.jsx AUTONOMY_LADDER_LEVELS). Pushing and PR
// creation are approvals from "open-pr" upwards; below that they are blocked.
export const LADDER_RANKS = {
  "chat-only": 1,
  "suggest-commands": 2,
  "run-read-only": 3,
  "edit-files": 4,
  "open-pr": 5,
  "auto-merge-disabled": 6,
};
export const PR_MIN_LADDER_LEVEL = "open-pr";

export function ladderRank(level) {
  if (typeof level === "number") return Number.isFinite(level) ? level : 0;
  const id = typeof level === "object" && level ? level.id || level.ladderLevel : level;
  return LADDER_RANKS[String(id || "").trim()] || 0;
}

export function ladderAllowsPullRequest(level) {
  return ladderRank(level) >= LADDER_RANKS[PR_MIN_LADDER_LEVEL];
}

const watchers = new Map(); // channelId → { binding, timer, previous, ciCache, status, busy }
let bridge = null;
let stateCache = null;

function statePath(ctx) {
  return join(ctx.squadStateDir, STATE_FILE);
}

async function readState(ctx) {
  if (stateCache) return stateCache;
  const saved = await ctx.readOptionalJsonFile(statePath(ctx));
  const bindings = Array.isArray(saved?.bindings) ? saved.bindings.filter((item) => item?.channelId && item?.repoPath) : [];
  stateCache = { version: 1, bindings, events: saved?.events && typeof saved.events === "object" ? saved.events : {} };
  return stateCache;
}

async function writeState(ctx) {
  const state = await readState(ctx);
  await ctx.writeJsonFile(statePath(ctx), { ...state, updatedAt: new Date().toISOString() });
}

function normalizeBinding(input) {
  const channelId = String(input?.channelId || "").trim();
  const repoPath = String(input?.repoPath || input?.workspace || "").trim();
  if (!channelId || !repoPath) return null;
  return {
    channelId,
    repoPath,
    remote: String(input?.remote || DEFAULT_REMOTE).trim() || DEFAULT_REMOTE,
    branch: String(input?.branch || "").trim(),
    fetch: input?.fetch !== false,
    boundAt: String(input?.boundAt || new Date().toISOString()),
  };
}

// Mirror the binding and events into channels.json without going through
// writeChannelsState (which would normalize the extra fields away).
async function mirrorIntoChannel(ctx, channelId, { git, events }) {
  const path = join(ctx.squadStateDir, "channels.json");
  try {
    const raw = await ctx.readOptionalJsonFile(path);
    if (!raw) return false;
    const channels = Array.isArray(raw) ? raw : Array.isArray(raw.channels) ? raw.channels : null;
    const channel = channels?.find((item) => item?.id === channelId);
    if (!channel) return false;
    if (git !== null) {
      // Skip the write when the record already carries this binding and these events.
      const sameGit = !git || (channel.git && channel.git.repoPath === git.repoPath && channel.git.remote === git.remote && channel.git.branch === git.branch);
      const current = Array.isArray(channel.events) ? channel.events : [];
      const sameEvents = !events || (current.length === events.length && current.every((row, index) => row?.id === events[index]?.id && row?.status === events[index]?.status && row?.updatedAt === events[index]?.updatedAt));
      if (sameGit && sameEvents) return true;
    }
    if (git === null) delete channel.git;
    else if (git) channel.git = { repoPath: git.repoPath, remote: git.remote, branch: git.branch, boundAt: git.boundAt };
    if (events) channel.events = events;
    channel.updatedAt = new Date().toISOString();
    await ctx.writeJsonFile(path, raw);
    return true;
  } catch (error) {
    ctx.logEvent?.(ctx.SEVERITY?.WARN, `git: could not mirror channel ${channelId} into channels.json: ${error.message}`, { channelId });
    return false;
  }
}

function takeSnapshot(binding, watcher, { spawnSync, env } = {}) {
  const status = gitStatus(binding.repoPath, { branch: binding.branch, remote: binding.remote, limit: SNAPSHOT_COMMITS, fetch: binding.fetch, spawnSync, env });
  if (status.error) return { status, snapshot: null };
  const branch = status.branch;
  let commits = status.recentCommits;
  if (status.upstream) {
    const upstream = recentCommits(binding.repoPath, status.upstream, { limit: SNAPSHOT_COMMITS, remoteUrl: status.remoteUrl, spawnSync, env });
    const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
    for (const commit of upstream) if (!bySha.has(commit.sha)) bySha.set(commit.sha, commit);
    commits = [...bySha.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, SNAPSHOT_COMMITS);
  }

  let pullRequests = [];
  let ci = [];
  const gh = Boolean(status.remoteUrl) && ghAvailable({ spawnSync, env });
  if (gh) {
    const listed = listPullRequests(binding.repoPath, { state: "all", limit: 30, spawnSync, env });
    pullRequests = listed.pullRequests.filter((pr) => !branch || pr.base === branch || pr.head === branch);
    if (listed.error) status.ghError = listed.error;
    const cache = watcher.ciCache;
    for (const commit of commits.slice(0, CI_LOOKBACK)) {
      const cached = cache.get(commit.sha);
      if (cached && (cached.status === "success" || cached.status === "failure")) {
        ci.push(cached);
        continue;
      }
      const result = ciStatus(binding.repoPath, commit.sha, { spawnSync, env });
      if (result.error) {
        status.ghError = status.ghError || result.error;
        continue;
      }
      cache.set(commit.sha, result);
      ci.push(result);
    }
    // Keep only the cache entries that still matter.
    for (const sha of [...cache.keys()]) if (!commits.some((commit) => commit.sha === sha)) cache.delete(sha);
  }
  status.gh = { available: gh, error: status.ghError || "" };
  return { status: { ...status, recentCommits: status.recentCommits.slice(0, INITIAL_COMMIT_ROWS) }, snapshot: { commits, pullRequests, ci, takenAt: new Date().toISOString() } };
}

/** One poll for a channel. Exported so checks can drive it without timers. */
export async function pollChannel(channelId, ctx = bridge, { spawnSync, env } = {}) {
  const watcher = watchers.get(channelId);
  if (!watcher || !ctx) return { added: [], updated: [], error: "not watching" };
  if (watcher.busy) return { added: [], updated: [], skipped: true };
  watcher.busy = true;
  try {
    const { status, snapshot } = takeSnapshot(watcher.binding, watcher, { spawnSync: spawnSync || ctx.spawnSync, env });
    watcher.status = status;
    watcher.lastPollAt = new Date().toISOString();
    if (!snapshot) {
      ctx.logEvent?.(ctx.SEVERITY?.WARN, `git: poll for ${channelId} failed: ${status.error}`, { channelId, repoPath: watcher.binding.repoPath });
      return { added: [], updated: [], error: status.error, status };
    }
    const state = await readState(ctx);
    const existing = state.events[channelId] || [];
    const candidates = diffSnapshots(watcher.previous, snapshot, {
      channelId,
      branch: status.branch,
      now: snapshot.takenAt,
      commitLimit: INITIAL_COMMIT_ROWS,
    });
    const { events, added, updated } = mergeEvents(existing, candidates);
    watcher.previous = snapshot;
    const changed = added.length + updated.length > 0;
    if (changed) {
      state.events[channelId] = events;
      await writeState(ctx);
    }
    // Re-mirror every poll: the app's own channels.json writes drop the
    // fields until normalizeChannel() learns them.
    await mirrorIntoChannel(ctx, channelId, { git: watcher.binding, events });
    for (const event of added) ctx.emit?.("git.event", { channelId, change: "added", event });
    for (const event of updated) ctx.emit?.("git.event", { channelId, change: "updated", event });
    if (changed) {
      ctx.logEvent?.(ctx.SEVERITY?.INFO, `git: ${added.length} new and ${updated.length} updated event(s) for channel ${channelId}`, { channelId, branch: status.branch });
    }
    return { added, updated, events, status };
  } finally {
    watcher.busy = false;
  }
}

function startWatcher(ctx, binding, { immediate = true } = {}) {
  stopWatcher(binding.channelId);
  const watcher = { binding, timer: null, previous: null, ciCache: new Map(), status: null, busy: false, lastPollAt: "" };
  watchers.set(binding.channelId, watcher);
  if (POLL_INTERVAL_MS > 0 && process.env.AUTOHAND_GIT_POLL !== "off") {
    watcher.timer = setInterval(() => {
      pollChannel(binding.channelId, ctx).catch((error) => {
        ctx.logEvent?.(ctx.SEVERITY?.WARN, `git: poll for ${binding.channelId} threw: ${error.message}`, { channelId: binding.channelId });
      });
    }, POLL_INTERVAL_MS);
    watcher.timer.unref?.();
  }
  return immediate ? pollChannel(binding.channelId, ctx) : Promise.resolve({ added: [], updated: [] });
}

function stopWatcher(channelId) {
  const watcher = watchers.get(channelId);
  if (!watcher) return false;
  if (watcher.timer) clearInterval(watcher.timer);
  watchers.delete(channelId);
  return true;
}

/** Stop every poller (checks call this so the process can exit). */
export function stopAllWatchers() {
  for (const channelId of [...watchers.keys()]) stopWatcher(channelId);
  stateCache = null;
}

export function watchedChannels() {
  return [...watchers.values()].map((watcher) => ({ ...watcher.binding, lastPollAt: watcher.lastPollAt, status: watcher.status }));
}

export async function init(ctx) {
  bridge = ctx;
  const state = await readState(ctx);
  for (const saved of state.bindings) {
    const binding = normalizeBinding(saved);
    if (!binding) continue;
    startWatcher(ctx, binding).catch((error) => {
      ctx.logEvent?.(ctx.SEVERITY?.WARN, `git: could not resume watching ${binding.channelId}: ${error.message}`, { channelId: binding.channelId });
    });
  }
  if (state.bindings.length) {
    ctx.logEvent?.(ctx.SEVERITY?.INFO, `git: watching ${state.bindings.length} bound channel(s)`, { count: state.bindings.length });
  }
}

async function bindChannel(ctx, input, { spawnSync, env } = {}) {
  const binding = normalizeBinding(input);
  if (!binding) throw Object.assign(new Error("channelId and repoPath are required"), { status: 400 });
  binding.repoPath = await ctx.cleanWorkspace(binding.repoPath);
  const probe = gitStatus(binding.repoPath, { branch: binding.branch, remote: binding.remote, spawnSync: spawnSync || ctx.spawnSync, env });
  if (probe.error) throw Object.assign(new Error(probe.error), { status: 400 });
  binding.branch = probe.branch;

  const state = await readState(ctx);
  const position = state.bindings.findIndex((item) => item.channelId === binding.channelId);
  const previous = position >= 0 ? state.bindings[position] : null;
  if (previous && (previous.repoPath !== binding.repoPath || previous.branch !== binding.branch)) {
    // A different repository or branch: its old events no longer belong here.
    state.events[binding.channelId] = [];
  }
  if (position >= 0) state.bindings[position] = binding;
  else state.bindings.push(binding);
  await writeState(ctx);
  await mirrorIntoChannel(ctx, binding.channelId, { git: binding });
  const first = await startWatcher(ctx, binding);
  return { binding, status: first.status || probe, events: state.events[binding.channelId] || [], added: first.added || [] };
}

async function unbindChannel(ctx, channelId) {
  const state = await readState(ctx);
  const before = state.bindings.length;
  state.bindings = state.bindings.filter((item) => item.channelId !== channelId);
  stopWatcher(channelId);
  if (state.bindings.length !== before) await writeState(ctx);
  await mirrorIntoChannel(ctx, channelId, { git: null });
  return state.bindings.length !== before;
}

function fail(ctx, res, error) {
  const status = Number(error?.status) || 500;
  ctx.json(res, status, { success: false, error: error?.message || String(error) });
  return true;
}

export async function handle(req, res, url, ctx) {
  const { pathname } = url;
  if (!pathname.startsWith("/api/git/")) return false;
  bridge = bridge || ctx;

  if (pathname === "/api/git/status" && req.method === "GET") {
    try {
      const workspace = await ctx.cleanWorkspace(String(url.searchParams.get("workspace") || ""));
      const branch = String(url.searchParams.get("branch") || "");
      const remote = String(url.searchParams.get("remote") || DEFAULT_REMOTE);
      const fetch = ["1", "true"].includes(String(url.searchParams.get("fetch") || ""));
      const status = gitStatus(workspace, { branch, remote, fetch, spawnSync: ctx.spawnSync });
      const gh = Boolean(status.remoteUrl) && !status.error && ghAvailable({ spawnSync: ctx.spawnSync });
      const listed = gh ? listPullRequests(workspace, { state: "open", limit: 20, spawnSync: ctx.spawnSync }) : { pullRequests: [] };
      ctx.json(res, 200, {
        success: true,
        data: { ...status, pullRequests: listed.pullRequests, gh: { available: gh, error: listed.error || "" } },
      });
    } catch (error) {
      return fail(ctx, res, error);
    }
    return true;
  }

  if (pathname === "/api/git/watch" && req.method === "GET") {
    const state = await readState(ctx);
    ctx.json(res, 200, { success: true, data: { bindings: state.bindings, watching: watchedChannels() } });
    return true;
  }

  if (pathname === "/api/git/watch" && req.method === "POST") {
    try {
      const payload = await ctx.readBody(req);
      const result = await bindChannel(ctx, payload);
      ctx.json(res, 200, { success: true, data: result });
    } catch (error) {
      return fail(ctx, res, error);
    }
    return true;
  }

  const watchMatch = pathname.match(/^\/api\/git\/watch\/([^/]+)$/);
  if (watchMatch && req.method === "GET") {
    const channelId = decodeURIComponent(watchMatch[1]);
    const state = await readState(ctx);
    const binding = state.bindings.find((item) => item.channelId === channelId) || null;
    const watcher = watchers.get(channelId);
    ctx.json(res, 200, {
      success: true,
      data: { binding, status: watcher?.status || null, lastPollAt: watcher?.lastPollAt || "", events: state.events[channelId] || [] },
    });
    return true;
  }

  if (watchMatch && req.method === "DELETE") {
    const channelId = decodeURIComponent(watchMatch[1]);
    const removed = await unbindChannel(ctx, channelId);
    ctx.json(res, 200, { success: true, data: { channelId, removed } });
    return true;
  }

  if (pathname === "/api/git/pr" && req.method === "POST") {
    try {
      const payload = await ctx.readBody(req);
      if (!ladderAllowsPullRequest(payload.permissionLevel)) {
        throw Object.assign(
          new Error(`opening a pull request needs the "${PR_MIN_LADDER_LEVEL}" permission level or higher (got "${payload.permissionLevel || "none"}")`),
          { status: 403 }
        );
      }
      const workspace = await ctx.cleanWorkspace(String(payload.workspace || payload.repoPath || ""));
      const result = createPullRequest(workspace, {
        title: payload.title,
        body: payload.body,
        base: payload.base,
        head: payload.head,
        remote: payload.remote,
        draft: payload.draft === true,
        push: payload.push !== false,
        spawnSync: ctx.spawnSync,
      });
      if (result.error) throw Object.assign(new Error(result.error), { status: 502 });
      const channelId = String(payload.channelId || "").trim();
      if (channelId && watchers.has(channelId)) {
        pollChannel(channelId, ctx).catch(() => {});
      }
      ctx.logEvent?.(ctx.SEVERITY?.INFO, `git: opened pull request ${result.url}`, { workspace, permissionLevel: payload.permissionLevel, channelId });
      ctx.json(res, 200, { success: true, data: { url: result.url, number: result.number, head: result.head } });
    } catch (error) {
      return fail(ctx, res, error);
    }
    return true;
  }

  return false;
}
