// Cross-surface search: pure helpers shared by SearchCommand,
// SearchResults, and scripts/check-search.mjs. No React, no DOM; the recent
// searches helpers take a Storage-like object so Node checks can pass a stub.
// See ADR-0020.

/** Display order of result groups. */
export const SEARCH_TYPE_ORDER = Object.freeze(["message", "channel", "member", "run", "task", "handoff", "canvas", "workflow"]);

/** Fallback group labels; `typeLabel` prefers locale copy. */
export const SEARCH_TYPE_LABELS = Object.freeze({
  message: "Messages",
  channel: "Channels",
  member: "Members",
  run: "Runs",
  task: "Tasks",
  handoff: "Handoffs",
  canvas: "Canvases",
  workflow: "Workflow runs",
});

const typeRank = new Map(SEARCH_TYPE_ORDER.map((type, index) => [type, index]));

export function isSearchType(type) {
  return typeRank.has(String(type || ""));
}

/** "run,task" or ["run", "task"] → ["run", "task"], unknown types dropped. */
export function parseTypes(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(",");
  return [...new Set(list.map((item) => String(item || "").trim().toLowerCase()).filter(isSearchType))];
}

/** Locale-aware group label: copy.searchTypeMessage, then the plural page key, then the fallback. */
export function typeLabel(type, copy = {}) {
  const key = `searchType${String(type || "").charAt(0).toUpperCase()}${String(type || "").slice(1)}`;
  const plural = { message: "messages", channel: "channels", member: "members", run: "runs", task: "tasks", handoff: "handoffs", canvas: "canvases", workflow: "workflows" }[type];
  return copy[key] || (plural && copy[plural]) || SEARCH_TYPE_LABELS[type] || String(type || "");
}

/** { type: count } for every type present in `results`. */
export function typeCounts(results = []) {
  const counts = {};
  for (const item of results) {
    if (!isSearchType(item?.type)) continue;
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  return counts;
}

/** Types present in `results`, in display order. */
export function availableTypes(results = []) {
  const counts = typeCounts(results);
  return SEARCH_TYPE_ORDER.filter((type) => counts[type]);
}

/**
 * Group results by type in display order. With `activeType` only that group
 * is returned (uncapped); otherwise each group holds at most `perType`
 * items (0 = no cap) and carries the full `count`.
 */
export function groupResults(results = [], { activeType = "", perType = 6 } = {}) {
  const buckets = new Map();
  for (const item of results) {
    if (!isSearchType(item?.type)) continue;
    if (activeType && item.type !== activeType) continue;
    if (!buckets.has(item.type)) buckets.set(item.type, []);
    buckets.get(item.type).push(item);
  }
  const groups = [];
  for (const type of SEARCH_TYPE_ORDER) {
    const items = buckets.get(type);
    if (!items?.length) continue;
    const cap = activeType || !perType ? items.length : perType;
    groups.push({ type, count: items.length, items: items.slice(0, cap) });
  }
  return groups;
}

/** Items of every group, in order, for keyboard navigation. */
export function flattenGroups(groups = []) {
  const items = [];
  for (const group of groups) for (const item of group.items || []) items.push(item);
  return items;
}

/** Next selection index for ↑/↓, wrapping at both ends. */
export function moveSelection(index, delta, length) {
  if (!length) return -1;
  const current = index < 0 || index >= length ? (delta < 0 ? 0 : -1) : index;
  return (((current + delta) % length) + length) % length;
}

/**
 * Merge bridge results with the matches SearchCommand computes in memory
 * (members, channels, messages still in the browser). Local items win on id
 * so a channel the app knows about is never shown twice; local members and
 * channels stay ahead of remote text hits, which keep their relevance order.
 */
export function mergeResults(remote = [], local = []) {
  const seen = new Set();
  const out = [];
  for (const item of local) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  for (const item of remote) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** "a <mark>b</mark> c" → [{ text: "a ", hit: false }, { text: "b", hit: true }, { text: " c", hit: false }]. */
export function snippetSegments(snippet) {
  const source = String(snippet || "");
  const segments = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) segments.push({ text: source.slice(last, match.index), hit: false });
    if (match[1]) segments.push({ text: match[1], hit: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), hit: false });
  return segments;
}

/** Compact relative time: "now", "5m", "3h", "2d", or a short date beyond a week. */
export function relativeTime(at, now = Date.now()) {
  const time = new Date(at || 0).getTime();
  if (!at || Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

// Recent searches: a small ring buffer in localStorage, newest first.

export const RECENT_SEARCHES_KEY = "autohandSquad.v1.recentSearches";
export const RECENT_SEARCHES_LIMIT = 8;

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function normalizeQuery(query) {
  return String(query || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function readRecentSearches(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem?.(RECENT_SEARCHES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map(normalizeQuery).filter(Boolean).slice(0, RECENT_SEARCHES_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentSearches(list, storage) {
  try {
    storage?.setItem?.(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // storage full, blocked, or unavailable: the in-memory list still returns
  }
  return list;
}

/** Record a query: moves an existing entry (case-insensitive) to the front and drops the oldest past the limit. */
export function pushRecentSearch(query, storage = defaultStorage()) {
  const value = normalizeQuery(query);
  const current = readRecentSearches(storage);
  if (value.length < 2) return current;
  const next = [value, ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_SEARCHES_LIMIT);
  return writeRecentSearches(next, storage);
}

export function removeRecentSearch(query, storage = defaultStorage()) {
  const value = normalizeQuery(query).toLowerCase();
  return writeRecentSearches(readRecentSearches(storage).filter((item) => item.toLowerCase() !== value), storage);
}

export function clearRecentSearches(storage = defaultStorage()) {
  try {
    storage?.removeItem?.(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
  return [];
}
