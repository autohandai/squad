// Notifications route plug-in (docs/integration/notifications.md, ADR-0019).
//
// Subscribes to the bridge events that matter to a person waiting on the
// squad, keeps the last 100 as an in-app feed persisted to
// <squadStateDir>/notifications.json, and posts a native OS notification for
// each one unless the web app reports that the relevant conversation is
// focused (POST /api/notifications/focus).
//
//   GET  /api/notifications/settings          { settings }
//   PUT  /api/notifications/settings          body: partial settings → { settings }
//   POST /api/notifications/focus             body: { route } → { focusedRoute }
//   GET  /api/notifications?since=<ISO>       { items, unread, lastReadAt, focusedRoute }
//   POST /api/notifications/read              body: { ids? } → { unread }
//   POST /api/notifications/test              → { posted, method }

import { join } from "node:path";

import { postNativeNotification } from "../notify/native.mjs";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_EVENTS,
  normalizeNotificationSettings,
  notificationFor,
  shouldNotify,
} from "../notify/policy.mjs";

export const name = "notifications";

const FEED_LIMIT = 100;
const STATE_VERSION = 1;
const NAME_CACHE_MS = 5000;
const DEFAULT_APP_URL = "http://127.0.0.1:19821";

function newId() {
  return `ntf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseSince(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function publicItem(item) {
  return {
    id: item.id,
    kind: item.kind,
    at: item.at,
    title: item.title,
    body: item.body,
    route: item.route,
    url: item.url,
    memberId: item.memberId || "",
    channelId: item.channelId || "",
    status: item.status || "",
    read: Boolean(item.read),
    native: item.native || null,
  };
}

/**
 * Build a plug-in instance. `postNative` is injectable so the check can run
 * the whole route without touching the OS.
 */
export function createNotificationsPlugin({ postNative = postNativeNotification } = {}) {
  const state = {
    settings: { ...DEFAULT_NOTIFICATION_SETTINGS },
    items: [], // newest first
    focusedRoute: "",
    lastReadAt: "",
    appUrl: process.env.AUTOHAND_SQUAD_APP_URL || DEFAULT_APP_URL,
  };
  let ctx = null;
  let statePath = "";
  let writeChain = Promise.resolve();
  let nameCache = { at: 0, memberNames: {}, channelNames: {} };
  const listeners = [];

  function log(severity, message, attributes = {}) {
    try {
      ctx?.logEvent?.(severity, message, { "squad.module": "notifications", ...attributes });
    } catch {
      // logging must never break a notification
    }
  }

  function persist() {
    if (!statePath || !ctx?.writeJsonFile) return writeChain;
    const snapshot = {
      version: STATE_VERSION,
      settings: state.settings,
      lastReadAt: state.lastReadAt,
      items: state.items.slice(0, FEED_LIMIT),
    };
    writeChain = writeChain
      .then(() => ctx.writeJsonFile(statePath, snapshot))
      .catch((error) => log(ctx?.SEVERITY?.WARN ?? 13, `notifications: could not persist ${statePath}: ${error?.message || error}`));
    return writeChain;
  }

  async function loadNames() {
    if (Date.now() - nameCache.at < NAME_CACHE_MS) return nameCache;
    const memberNames = {};
    const channelNames = {};
    try {
      const status = await ctx.readOptionalJsonFile?.(join(ctx.squadStateDir, "web-status.json"));
      for (const member of status?.members || status?.agents || []) {
        if (member?.id) memberNames[String(member.id)] = String(member.name || "");
      }
    } catch {
      // names are cosmetic
    }
    try {
      const channels = await ctx.readChannelsState?.();
      for (const channel of channels?.channels || []) {
        if (channel?.id) channelNames[String(channel.id)] = String(channel.name || "");
      }
    } catch {
      // names are cosmetic
    }
    nameCache = { at: Date.now(), memberNames, channelNames };
    return nameCache;
  }

  function unreadCount() {
    return state.items.reduce((count, item) => count + (item.read ? 0 : 1), 0);
  }

  async function onEvent(event) {
    try {
      const decision = shouldNotify(event, state.settings, { focusedRoute: state.focusedRoute });
      if (decision.reason === "ignored" || decision.reason === "disabled") return null;
      const names = await loadNames();
      const copy = notificationFor(event, { appUrl: state.appUrl, ...names });
      const item = {
        id: newId(),
        kind: String(event.name || ""),
        at: String(event.at || new Date().toISOString()),
        title: copy.title,
        body: copy.body,
        route: copy.route,
        url: copy.url,
        memberId: String(event.memberId || event.toMemberId || ""),
        channelId: String(event.channelId || ""),
        status: String(event.status || ""),
        // Seen already when the conversation was on screen: history, not unread.
        read: decision.reason === "focused",
        suppressed: decision.reason === "focused",
        native: null,
      };
      state.items.unshift(item);
      if (state.items.length > FEED_LIMIT) state.items.length = FEED_LIMIT;
      if (decision.notify) {
        item.native = await postNative({ title: copy.title, body: copy.body, url: copy.url });
        if (!item.native?.posted) {
          log(ctx?.SEVERITY?.WARN ?? 13, `notifications: native post failed (${item.native?.method}): ${item.native?.error || "unknown"}`, { "notification.kind": item.kind });
        }
      }
      await persist();
      return item;
    } catch (error) {
      log(ctx?.SEVERITY?.ERROR ?? 17, `notifications: event handler failed: ${error?.message || error}`, { "event.name": String(event?.name || "") });
      return null;
    }
  }

  async function init(context) {
    ctx = context;
    statePath = join(ctx.squadStateDir, "notifications.json");
    try {
      const saved = await ctx.readOptionalJsonFile?.(statePath);
      if (saved && typeof saved === "object") {
        state.settings = normalizeNotificationSettings(saved.settings);
        state.lastReadAt = typeof saved.lastReadAt === "string" ? saved.lastReadAt : "";
        state.items = Array.isArray(saved.items)
          ? saved.items.filter((item) => item && typeof item === "object" && item.id && item.at).slice(0, FEED_LIMIT)
          : [];
      }
    } catch (error) {
      log(ctx?.SEVERITY?.WARN ?? 13, `notifications: could not read ${statePath}: ${error?.message || error}`);
    }
    dispose();
    for (const eventName of NOTIFICATION_EVENTS) {
      const listener = (event) => {
        onEvent(event);
      };
      ctx.events?.on?.(eventName, listener);
      listeners.push([eventName, listener]);
    }
  }

  function dispose() {
    for (const [eventName, listener] of listeners) ctx?.events?.off?.(eventName, listener);
    listeners.length = 0;
  }

  function rememberAppUrl(req) {
    const host = String(req?.headers?.host || "").trim();
    if (host && !process.env.AUTOHAND_SQUAD_APP_URL) state.appUrl = `http://${host}`;
  }

  async function handle(req, res, url, context) {
    if (!url.pathname.startsWith("/api/notifications")) return false;
    if (!ctx) ctx = context;
    const json = context.json;
    const method = req.method;
    const path = url.pathname;

    if (path === "/api/notifications/settings" && method === "GET") {
      json(res, 200, { success: true, data: { settings: state.settings } });
      return true;
    }
    if (path === "/api/notifications/settings" && method === "PUT") {
      const body = await context.readBody(req);
      const source = body && typeof body === "object" ? body.settings || body : {};
      state.settings = normalizeNotificationSettings({ ...state.settings, ...source });
      await persist();
      json(res, 200, { success: true, data: { settings: state.settings } });
      return true;
    }
    if (path === "/api/notifications/focus" && method === "POST") {
      const body = await context.readBody(req);
      state.focusedRoute = typeof body?.route === "string" ? body.route.trim().slice(0, 512) : "";
      rememberAppUrl(req);
      json(res, 200, { success: true, data: { focusedRoute: state.focusedRoute } });
      return true;
    }
    if (path === "/api/notifications" && method === "GET") {
      const since = parseSince(url.searchParams.get("since"));
      const items = state.items.filter((item) => !since || Date.parse(item.at) > since).map(publicItem);
      json(res, 200, { success: true, data: { items, unread: unreadCount(), lastReadAt: state.lastReadAt, focusedRoute: state.focusedRoute } });
      return true;
    }
    if (path === "/api/notifications/read" && method === "POST") {
      const body = await context.readBody(req);
      const ids = Array.isArray(body?.ids) ? new Set(body.ids.map(String)) : null;
      for (const item of state.items) {
        if (!ids || ids.has(item.id)) item.read = true;
      }
      if (!ids) state.lastReadAt = new Date().toISOString();
      await persist();
      json(res, 200, { success: true, data: { unread: unreadCount(), lastReadAt: state.lastReadAt } });
      return true;
    }
    if (path === "/api/notifications/test" && method === "POST") {
      rememberAppUrl(req);
      const result = await postNative({
        title: "Autohand Squad",
        body: "Notifications are working. Clicking one opens the conversation it came from.",
        url: `${state.appUrl}/squad`,
      });
      if (!result?.posted) {
        json(res, 200, { success: false, error: `Could not post a native notification (${result?.method || "unknown"}): ${result?.error || "unknown"}` });
        return true;
      }
      json(res, 200, { success: true, data: result });
      return true;
    }
    return false;
  }

  return { init, handle, dispose, state, onEvent };
}

const plugin = createNotificationsPlugin();
export const init = plugin.init;
export const handle = plugin.handle;
