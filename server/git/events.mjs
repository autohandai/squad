// Git events for a channel stream (ADR-0022). Pure: a snapshot of a bound
// repository (recent commits, pull requests, CI results) becomes event
// messages, and two snapshots diff into only what is new or changed.
//
// Event ids are deterministic (`git-commit-<sha>`, `git-pr-<number>`,
// `git-ci-<sha>`), so a poll that sees the same object again produces the
// same id and `mergeEvents` drops it; a pull request whose state moved
// (open → approved → merged) keeps its id and its row updates in place.

export const EVENT_ROLE = "event";
export const EVENT_KINDS = ["commit", "pr", "ci"];

export const PR_STATUSES = ["draft", "open", "approved", "changes-requested", "merged", "closed"];
export const CI_STATUSES = ["pending", "success", "failure", "unknown"];

export function commitEventId(sha) {
  return `git-commit-${String(sha || "").trim()}`;
}

export function pullRequestEventId(number) {
  return `git-pr-${Number(number)}`;
}

export function ciEventId(sha) {
  return `git-ci-${String(sha || "").trim()}`;
}

/** The single status word a pull request row shows. */
export function pullRequestStatus(pr) {
  if (!pr) return "open";
  if (pr.mergedAt || String(pr.state).toUpperCase() === "MERGED") return "merged";
  if (String(pr.state).toUpperCase() === "CLOSED") return "closed";
  const decision = String(pr.reviewDecision || "").toUpperCase();
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes-requested";
  if (pr.isDraft) return "draft";
  return "open";
}

function isoOr(value, fallback) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

export function commitEvent(commit, { channelId = "", branch = "", now } = {}) {
  if (!commit?.sha) return null;
  const at = isoOr(commit.at, now || new Date().toISOString());
  return {
    id: commitEventId(commit.sha),
    role: EVENT_ROLE,
    kind: "commit",
    channelId,
    ref: commit.short || commit.sha.slice(0, 7),
    sha: commit.sha,
    branch,
    title: commit.title || commit.sha.slice(0, 7),
    author: commit.author || "",
    url: commit.url || "",
    status: "committed",
    createdAt: at,
    updatedAt: at,
  };
}

export function pullRequestEvent(pr, { channelId = "", now } = {}) {
  if (!pr || !Number.isFinite(Number(pr.number))) return null;
  const status = pullRequestStatus(pr);
  const fallback = now || new Date().toISOString();
  const updatedAt = isoOr(status === "merged" ? pr.mergedAt || pr.updatedAt : pr.updatedAt, fallback);
  return {
    id: pullRequestEventId(pr.number),
    role: EVENT_ROLE,
    kind: "pr",
    channelId,
    ref: `#${Number(pr.number)}`,
    number: Number(pr.number),
    branch: pr.head || "",
    base: pr.base || "",
    title: pr.title || `Pull request #${Number(pr.number)}`,
    author: pr.author || "",
    url: pr.url || "",
    status,
    createdAt: isoOr(pr.createdAt, updatedAt),
    updatedAt,
  };
}

export function ciEvent(ci, { channelId = "", commit = null, now } = {}) {
  if (!ci?.sha) return null;
  const status = CI_STATUSES.includes(ci.status) ? ci.status : "unknown";
  if (status === "unknown") return null; // nothing ran (or gh could not tell); no row
  const at = now || new Date().toISOString();
  const short = commit?.short || ci.sha.slice(0, 7);
  return {
    id: ciEventId(ci.sha),
    role: EVENT_ROLE,
    kind: "ci",
    channelId,
    ref: short,
    sha: ci.sha,
    title: commit?.title ? `CI · ${commit.title}` : `CI for ${short}`,
    author: commit?.author || "",
    url: ci.url || commit?.url || "",
    status,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Every event a snapshot implies. `snapshot` is
 * `{ commits: [], pullRequests: [], ci: [] }` as `takeSnapshot` in the route
 * builds it. `commitLimit` caps how many commits become rows (the first poll
 * after binding shows the last five).
 */
export function snapshotEvents(snapshot, { channelId = "", branch = "", now, commitLimit = Infinity } = {}) {
  const commits = (snapshot?.commits || []).slice(0, commitLimit);
  const bySha = new Map((snapshot?.commits || []).map((commit) => [commit.sha, commit]));
  const events = [];
  for (const commit of commits) {
    const event = commitEvent(commit, { channelId, branch, now });
    if (event) events.push(event);
  }
  for (const pr of snapshot?.pullRequests || []) {
    const event = pullRequestEvent(pr, { channelId, now });
    if (event) events.push(event);
  }
  for (const ci of snapshot?.ci || []) {
    const event = ciEvent(ci, { channelId, commit: bySha.get(ci.sha) || null, now });
    if (event) events.push(event);
  }
  return events;
}

/** Change detection between two versions of the same event. */
export function eventChanged(previous, next) {
  if (!previous) return true;
  return previous.status !== next.status || previous.title !== next.title || previous.url !== next.url;
}

/**
 * Only the events that `current` adds or changes relative to `previous`
 * (a snapshot, or null right after binding). Commits unseen in the previous
 * snapshot are new; pull requests and CI rows appear when their status
 * changed. Ordered oldest first so appending keeps the stream chronological.
 */
export function diffSnapshots(previous, current, options = {}) {
  const before = previous ? new Map(snapshotEvents(previous, { ...options, commitLimit: Infinity }).map((event) => [event.id, event])) : new Map();
  const after = snapshotEvents(current, { ...options, commitLimit: previous ? Infinity : options.commitLimit });
  return after
    .filter((event) => eventChanged(before.get(event.id), event))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Merge incoming events into a channel's persisted list. Same id and same
 * status → dropped; same id and a different status → updated in place
 * (createdAt kept, updatedAt from the incoming row); unknown id → appended.
 * Returns `{ events, added, updated }` where added/updated are the rows that
 * should be announced.
 */
export function mergeEvents(existing = [], incoming = []) {
  const events = (Array.isArray(existing) ? existing : []).filter((event) => event && event.id);
  const index = new Map(events.map((event, position) => [event.id, position]));
  const added = [];
  const updated = [];
  for (const event of Array.isArray(incoming) ? incoming : []) {
    if (!event?.id) continue;
    const position = index.get(event.id);
    if (position === undefined) {
      index.set(event.id, events.length);
      events.push(event);
      added.push(event);
      continue;
    }
    const known = events[position];
    if (!eventChanged(known, event)) continue;
    const merged = { ...known, ...event, createdAt: known.createdAt || event.createdAt };
    events[position] = merged;
    updated.push(merged);
  }
  return { events, added, updated };
}
