// Git events in a channel stream (ADR-0022): status pills, relative time,
// commit links in run traces, and merging `channel.events` into the message
// list. Pure: no React, no DOM, importable from scripts/check-git.mjs.

export const GIT_EVENT_ROLE = "event";
export const GIT_EVENT_KINDS = ["commit", "pr", "ci"];

export function isGitEvent(message) {
  return Boolean(message) && message.role === GIT_EVENT_ROLE && GIT_EVENT_KINDS.includes(message.kind);
}

/** Tone → text/dot classes. Neutral tones use tokens; status tones follow the presence dots. */
export const TONE_CLASSES = {
  neutral: { text: "text-muted-foreground", dot: "bg-muted-foreground/60" },
  info: { text: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  success: { text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  warning: { text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  danger: { text: "text-destructive", dot: "bg-destructive" },
  accent: { text: "text-primary", dot: "bg-primary" },
};

const PILLS = {
  commit: {
    committed: ["committed", "neutral"],
  },
  pr: {
    draft: ["draft", "neutral"],
    open: ["open", "info"],
    approved: ["approved", "success"],
    "changes-requested": ["changesRequested", "warning"],
    merged: ["merged", "accent"],
    closed: ["closed", "neutral"],
  },
  ci: {
    pending: ["running", "warning"],
    success: ["passed", "success"],
    failure: ["failed", "danger"],
    unknown: ["noCi", "neutral"],
  },
};

const PILL_LABELS = {
  committed: "Committed",
  draft: "Draft",
  open: "Open",
  approved: "Approved",
  changesRequested: "Changes requested",
  merged: "Merged",
  closed: "Closed",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  noCi: "No CI",
};

/**
 * `{ key, label, tone, className, dotClassName }` for an event's status pill.
 * `copy` may override labels by key (`copy.gitStatusMerged`).
 */
export function statusPill(event, copy = {}) {
  const kind = String(event?.kind || "");
  const status = String(event?.status || "");
  const [key, tone] = PILLS[kind]?.[status] || [status || "unknown", "neutral"];
  const copyKey = `gitStatus${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const label = copy[copyKey] || PILL_LABELS[key] || status || "";
  const classes = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
  return { key, label, tone, className: classes.text, dotClassName: classes.dot };
}

/** "just now", "4m", "3h", "yesterday", "Sep 12", "Sep 12, 2025". */
export function relativeTime(iso, { now = Date.now(), locale = "en-US", copy = {} } = {}) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return copy.justNow || "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}${copy.minuteShort || "m"}`;
  if (diff < day) return `${Math.floor(diff / hour)}${copy.hourShort || "h"}`;
  if (diff < 2 * day) return copy.yesterday || "yesterday";
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  try {
    return date.toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** One line for the row: commit → "abc1234 Fix the thing", pr → "#12 Title", ci → "CI · Title". */
export function eventTitle(event) {
  if (!event) return "";
  const title = String(event.title || "").trim();
  if (event.kind === "pr") return `${event.ref || `#${event.number || ""}`} ${title}`.trim();
  if (event.kind === "ci") return title || `CI for ${event.ref || ""}`.trim();
  return title || event.ref || "";
}

export function eventTimestamp(message) {
  const value = Date.parse(message?.createdAt || message?.updatedAt || message?.startedAt || "");
  return Number.isFinite(value) ? value : 0;
}

/**
 * Interleave a channel's git events with its messages by time. Events with
 * a duplicate id collapse to the latest copy; the result is stable-sorted
 * by timestamp, then id.
 */
export function mergeEventsIntoStream(messages = [], events = []) {
  const byId = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (isGitEvent(event)) byId.set(event.id, event);
  }
  const list = [...(Array.isArray(messages) ? messages : []).filter((message) => message && !byId.has(message.id)), ...byId.values()];
  return list.sort((a, b) => eventTimestamp(a) - eventTimestamp(b) || String(a.id).localeCompare(String(b.id)));
}

/** `git@github.com:o/r.git` or `https://github.com/o/r.git` → `https://github.com/o/r`. */
export function remoteWebUrl(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return "";
  const http = raw.match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+)\/(.+)$/);
  const ssh = raw.match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/);
  const match = http || ssh;
  if (!match) return "";
  const path = match[2].replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return path ? `https://${match[1]}/${path}` : "";
}

export function commitUrl(remoteUrl, sha) {
  const base = remoteWebUrl(remoteUrl);
  return base && sha ? `${base}/commit/${sha}` : "";
}

const SHA_PATTERN = /(^|[^\w/`[])([0-9a-f]{7,40})(?![\w/])/g;

/**
 * Link commit shas in a run trace or reply (markdown) to the bound remote.
 * Only shas that appear in `knownShas` are linked when the set is given,
 * which keeps hex-looking ids (hashes, colours) untouched; without a set any
 * 7–40 hex run becomes a link. Text inside code spans is left alone.
 */
export function linkCommitsInTrace(text, remoteUrl, { knownShas } = {}) {
  const base = remoteWebUrl(remoteUrl);
  const source = String(text || "");
  if (!base || !source) return source;
  const known = knownShas ? new Set([...knownShas].map((sha) => String(sha).toLowerCase())) : null;
  const matches = (sha) => {
    if (!known) return /[a-f]/.test(sha) && /\d/.test(sha);
    const lower = sha.toLowerCase();
    for (const full of known) {
      if (full === lower || (lower.length >= 7 && full.startsWith(lower))) return true;
    }
    return false;
  };
  return source
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(SHA_PATTERN, (whole, lead, sha) => (matches(sha) ? `${lead}[${sha.slice(0, 7)}](${base}/commit/${sha})` : whole))))
    .join("");
}

/** The `channel.git` binding as one sentence for the settings line. */
export function bindingSummary(binding, status, copy = {}) {
  if (!binding?.repoPath) return copy.gitNotBound || "Not bound to a repository.";
  const branch = binding.branch || status?.branch || "";
  const remote = binding.remote || status?.remote || "origin";
  const parts = [`${copy.gitWatching || "Watching"} ${branch}${remote ? ` ${copy.gitAt || "at"} ${remote}` : ""}`];
  if (status?.error) parts.push(status.error);
  else if (status) {
    if (Number.isFinite(status.ahead) && Number.isFinite(status.behind)) {
      parts.push(`${status.ahead} ${copy.gitAhead || "ahead"}, ${status.behind} ${copy.gitBehind || "behind"}`);
    }
    if (status.dirty) parts.push(`${status.changedFiles} ${copy.gitChangedFiles || "changed files"}`);
    const last = status.recentCommits?.[0];
    if (last?.at) parts.push(`${copy.gitLastCommit || "last commit"} ${relativeTime(last.at, { copy })}`);
  }
  return parts.join(" · ");
}
