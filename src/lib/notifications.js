// In-app notification feed helpers: pure functions over the items returned by
// GET /api/notifications (server/routes/notifications.route.mjs). No React,
// no DOM, so scripts/check-notifications.mjs can import this from Node.
// See docs/integration/notifications.md and ADR-0019.

export const NOTIFICATION_POLL_MS = 10_000;
export const NOTIFICATION_FEED_LIMIT = 100;

export const MEMBER_CHAT_ROUTE = "/conversations/new";
export const CHANNELS_ROUTE = "/channels";
export const INBOX_ROUTE = "/inbox";
export const MISSION_CONTROL_ROUTE = "/mission-control";

/** Settings keys in the order Settings shows them, with default copy. */
export const NOTIFICATION_KINDS = [
  { key: "runFinished", label: "Run finished", detail: "A member completed a run while you were elsewhere." },
  { key: "runFailed", label: "Run failed", detail: "A run or reply ended with an error." },
  { key: "handoffPending", label: "Handoff waiting", detail: "A member handed work to a teammate and needs your go-ahead." },
  { key: "approvalPending", label: "Approval waiting", detail: "A workflow step is paused for your approval." },
  { key: "mention", label: "Mentions", detail: "A member mentioned you in a channel." },
];

export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze(
  Object.fromEntries(NOTIFICATION_KINDS.map(({ key }) => [key, true]))
);

export function normalizeNotificationSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const settings = {};
  for (const { key } of NOTIFICATION_KINDS) settings[key] = key in source ? Boolean(source[key]) : true;
  return settings;
}

/** Number of items not yet read. */
export function unreadCount(items = []) {
  let count = 0;
  for (const item of items) if (item && !item.read) count += 1;
  return count;
}

/**
 * The route a notification opens. Prefers the route the bridge computed;
 * falls back to the item's ids so an older feed entry still opens somewhere.
 */
export function routeForNotification(item = {}) {
  if (typeof item.route === "string" && item.route.startsWith("/")) return item.route;
  const channel = String(item.channelId || "").trim();
  const member = String(item.memberId || "").trim();
  const kind = String(item.kind || "");
  if (kind === "handoff.pending") return INBOX_ROUTE;
  if (channel) return `${CHANNELS_ROUTE}/${encodeURIComponent(channel)}`;
  if (kind === "approval.pending") return MISSION_CONTROL_ROUTE;
  if (member) return `${MEMBER_CHAT_ROUTE}?member=${encodeURIComponent(member)}`;
  return MISSION_CONTROL_ROUTE;
}

/** Newest first, deduplicated by id, capped to the feed limit. */
export function mergeNotifications(current = [], incoming = [], limit = NOTIFICATION_FEED_LIMIT) {
  const byId = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item?.id) continue;
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? { ...previous, ...item, read: Boolean(previous.read || item.read) } : item);
  }
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
    .slice(0, limit);
}

/** ISO time of the newest item, for the `since` query on the next poll. */
export function newestAt(items = []) {
  let newest = "";
  for (const item of items) {
    if (item?.at && (!newest || Date.parse(item.at) > Date.parse(newest))) newest = item.at;
  }
  return newest;
}

export function markAllRead(items = []) {
  return items.map((item) => (item?.read ? item : { ...item, read: true }));
}

function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "Today" / "Yesterday" / "Earlier" groups for the bell popover. */
export function groupNotifications(items = [], now = Date.now()) {
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const groups = [
    { id: "today", label: "Today", items: [] },
    { id: "yesterday", label: "Yesterday", items: [] },
    { id: "earlier", label: "Earlier", items: [] },
  ];
  for (const item of items) {
    const time = Date.parse(item?.at || "");
    if (!Number.isFinite(time) || time < yesterday) groups[2].items.push(item);
    else if (time >= today) groups[0].items.push(item);
    else groups[1].items.push(item);
  }
  return groups.filter((group) => group.items.length);
}

/** Compact relative time: "now", "3m", "2h", "Yesterday", "12 Sep". */
export function relativeTime(at, now = Date.now(), locale) {
  const time = Date.parse(at || "");
  if (!Number.isFinite(time)) return "";
  const diff = Math.max(0, now - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && time >= startOfDay(now)) return `${hours}h`;
  if (time >= startOfDay(now) - 86_400_000) return "Yesterday";
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(time);
  } catch {
    return new Date(time).toDateString().slice(4, 10);
  }
}
