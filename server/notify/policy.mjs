// Notification policy: pure functions that decide whether a bridge event
// becomes a notification and what it says. No I/O, no timers; the route
// (server/routes/notifications.route.mjs) supplies names and the focused
// route, scripts/check-notifications.mjs exercises every branch. See ADR-0019.

import { basename } from "node:path";

/** Event names the bridge emits that can become a notification. */
export const NOTIFICATION_EVENTS = ["run.finished", "chat.finished", "handoff.pending", "approval.pending", "mention.received", "vault.request.pending", "folder.request.pending", "team.built"];

/** Settings shape; every kind is on by default. */
export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  runFinished: true,
  runFailed: true,
  handoffPending: true,
  approvalPending: true,
  mention: true,
});

export const NOTIFICATION_SETTING_KEYS = Object.keys(DEFAULT_NOTIFICATION_SETTINGS);

export const MEMBER_CHAT_ROUTE = "/conversations/new";
export const CHANNELS_ROUTE = "/channels";
export const INBOX_ROUTE = "/inbox";
export const MISSION_CONTROL_ROUTE = "/mission-control";

/** Coerce anything into a complete settings object; unknown keys are dropped. */
export function normalizeNotificationSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const settings = {};
  for (const key of NOTIFICATION_SETTING_KEYS) {
    settings[key] = key in source ? Boolean(source[key]) : DEFAULT_NOTIFICATION_SETTINGS[key];
  }
  return settings;
}

/**
 * Which setting governs an event, or null when the event never notifies
 * (a run the user stopped, a chat reply that simply completed).
 */
export function settingKeyFor(event) {
  const name = String(event?.name || "");
  const status = String(event?.status || "").toLowerCase();
  switch (name) {
    case "run.finished":
      if (status === "failed") return "runFailed";
      if (status === "completed") return "runFinished";
      return null;
    case "chat.finished":
      return status === "failed" ? "runFailed" : null;
    case "handoff.pending":
      return "handoffPending";
    case "approval.pending":
    case "vault.request.pending": // a secret or payment request is an approval the person owns (ADR-0104)
    case "folder.request.pending": // a folder request is one too (ADR-0120)
      return "approvalPending";
    case "mention.received":
      return "mention";
    case "team.built": // a team finished preparing in the background (ADR-0118)
      return status === "failed" ? "runFailed" : "runFinished";
    default:
      return null;
  }
}

function memberChatRoute(memberId) {
  const id = String(memberId || "").trim();
  return id ? `${MEMBER_CHAT_ROUTE}?member=${encodeURIComponent(id)}` : "";
}

function channelRoute(channelId) {
  const id = String(channelId || "").trim();
  return id ? `${CHANNELS_ROUTE}/${encodeURIComponent(id)}` : "";
}

/**
 * The in-app route a notification opens: a channel when the event names
 * one, otherwise the member's chat; handoffs live in Inbox, approvals
 * without a channel in Mission Control.
 */
export function routeForEvent(event) {
  const name = String(event?.name || "");
  const channel = channelRoute(event?.channelId);
  if (name === "handoff.pending") return INBOX_ROUTE;
  if (name === "approval.pending") return channel || MISSION_CONTROL_ROUTE;
  if (name === "vault.request.pending") return memberChatRoute(event?.memberId) || INBOX_ROUTE;
  if (name === "folder.request.pending") return memberChatRoute(event?.memberId) || INBOX_ROUTE;
  if (name === "mention.received") return channel || memberChatRoute(event?.memberId) || INBOX_ROUTE;
  if (name === "team.built") return "/squad";
  return channel || memberChatRoute(event?.memberId) || MISSION_CONTROL_ROUTE;
}

/**
 * Every route on which the user is already looking at the event's
 * conversation, so a notification would be noise there.
 */
export function relevantRoutesFor(event) {
  const routes = new Set([routeForEvent(event)]);
  const name = String(event?.name || "");
  const channel = channelRoute(event?.channelId);
  if (channel) routes.add(channel);
  if (name === "handoff.pending") {
    const target = memberChatRoute(event?.toMemberId);
    if (target) routes.add(target);
  } else {
    const member = memberChatRoute(event?.memberId);
    if (member) routes.add(member);
  }
  return Array.from(routes).filter(Boolean);
}

function splitRoute(route) {
  const [path, query = ""] = String(route || "").trim().split("?");
  return { path: path.replace(/\/+$/, "") || "/", params: new URLSearchParams(query) };
}

/** True when `focusedRoute` shows the same conversation as `route`. */
export function routeMatches(route, focusedRoute) {
  if (!route || !focusedRoute) return false;
  const a = splitRoute(route);
  const b = splitRoute(focusedRoute);
  if (a.path !== b.path) return false;
  if (a.path === MEMBER_CHAT_ROUTE) {
    const wanted = a.params.get("member") || "";
    return wanted ? wanted === (b.params.get("member") || "") : true;
  }
  return true;
}

/**
 * Decide whether an event should notify. Returns `{ notify, reason }`;
 * `reason` is one of "ok", "ignored", "disabled", "focused".
 */
export function shouldNotify(event, settings, { focusedRoute = "" } = {}) {
  const key = settingKeyFor(event);
  if (!key) return { notify: false, reason: "ignored", key: null };
  const normalized = normalizeNotificationSettings(settings);
  if (!normalized[key]) return { notify: false, reason: "disabled", key };
  if (relevantRoutesFor(event).some((route) => routeMatches(route, focusedRoute))) {
    return { notify: false, reason: "focused", key };
  }
  return { notify: true, reason: "ok", key };
}

function nameOf(map, id, fallback) {
  const key = String(id || "").trim();
  if (!key) return fallback;
  const value = map && typeof map === "object" ? map[key] : null;
  return String(value || "").trim() || fallback;
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function joinUrl(appUrl, route) {
  const base = String(appUrl || "").replace(/\/+$/, "");
  return `${base}${route}`;
}

/**
 * Title, body and URL for an event. `memberNames` and `channelNames` map ids
 * to display names (from web-status.json and channels.json); missing names
 * fall back to neutral copy.
 */
export function notificationFor(event, { appUrl = "http://127.0.0.1:19821", memberNames = {}, channelNames = {} } = {}) {
  const name = String(event?.name || "");
  const status = String(event?.status || "").toLowerCase();
  const member = nameOf(memberNames, event?.memberId, "A member");
  const channel = event?.channelId ? `#${nameOf(channelNames, event.channelId, "channel")}` : "";
  const route = routeForEvent(event);
  let title = "Autohand Squad";
  let body = "";

  switch (name) {
    case "run.finished": {
      const task = clip(event?.title, 60);
      const workspace = event?.workspace ? basename(String(event.workspace)) : "";
      if (status === "failed") {
        title = task ? `${member} failed · ${task}` : `${member} failed`;
        body = workspace ? `The run in ${workspace} ended with an error. Open the conversation for details.` : "The run ended with an error. Open the conversation for details.";
      } else {
        title = task ? `${member} finished · ${task}` : `${member} finished`;
        body = workspace ? `Done in ${workspace}. Open the conversation to review the result.` : "Open the conversation to review the result.";
      }
      break;
    }
    case "chat.finished": {
      title = channel ? `${member} could not reply in ${channel}` : `${member} could not reply`;
      body = clip(event?.preview, 140) || "The reply failed. Open the conversation to retry.";
      break;
    }
    case "handoff.pending": {
      const from = nameOf(memberNames, event?.fromMemberId, "A member");
      const to = nameOf(memberNames, event?.toMemberId, "a teammate");
      const task = clip(event?.title, 60);
      title = task ? `${from} needs you · handoff: ${task}` : `${from} needs you · handoff`;
      body = `${from} handed ${task ? `“${task}”` : "a task"} to ${to}. Accept or reassign it in Inbox.`;
      break;
    }
    case "approval.pending": {
      title = channel ? `Approval needed in ${channel}` : "Approval needed";
      body = "A workflow step is waiting for your go-ahead.";
      break;
    }
    case "vault.request.pending": {
      const what = clip(event?.title, 60);
      if (String(event?.type) === "payment") {
        title = what ? `${member} needs you · payment: ${what}` : `${member} needs you · payment`;
        body = "Approve with a saved card, pay yourself, or decline in the conversation.";
      } else {
        title = what ? `${member} needs you · ${what}` : `${member} needs you · a secret`;
        body = "Fill the secure form in the conversation. The value goes to your vault, not to the member.";
      }
      break;
    }
    case "folder.request.pending": {
      title = `${member} needs a folder · ${clip(event?.folder, 60)}`;
      body = "Allow it in the conversation and the message goes; decline and nothing runs.";
      break;
    }
    case "mention.received": {
      title = channel ? `${member} mentioned you in ${channel}` : `${member} mentioned you`;
      body = clip(event?.preview, 140) || "Open the channel to read the message.";
      break;
    }
    case "team.built": {
      const team = clip(event?.team, 60) || "The team";
      const count = Number(event?.memberCount) || 0;
      const failed = Number(event?.failedCount) || 0;
      if (status === "failed") {
        title = `${team} could not be finished`;
        body = failed
          ? `${failed} ${failed === 1 ? "member was" : "members were"} not prepared. Retry or dismiss it in Squad.`
          : clip(event?.error, 140) || "Open Squad for details.";
      } else {
        title = `${team} is ready`;
        const channels = Array.isArray(event?.channels) ? event.channels.filter(Boolean) : [];
        const routines = Number(event?.routines) || 0;
        body = [`${count} ${count === 1 ? "member" : "members"} prepared`, channels.length ? `#${channels[0]} created` : "", routines ? `${routines} ${routines === 1 ? "routine" : "routines"} paused` : ""].filter(Boolean).join(" · ") + ".";
      }
      break;
    }
    default:
      body = clip(event?.preview || event?.title, 140);
  }

  return { title: clip(title, 120), body: clip(body, 240), url: joinUrl(appUrl, route), route };
}
