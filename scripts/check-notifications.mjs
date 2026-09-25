#!/usr/bin/env node
// Checks for push notifications (ADR-0019): the policy (server/notify/policy.mjs)
// suppresses a notification while its conversation is focused and produces
// the right copy per event; the native poster (server/notify/native.mjs) is
// dry-run on every platform with a stubbed spawn; the route plug-in
// (server/routes/notifications.route.mjs) is driven end to end with a fake
// bridge context; the browser helpers (src/lib/notifications.js) count,
// route and group items.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  notificationFor,
  relevantRoutesFor,
  routeForEvent,
  settingKeyFor,
  shouldNotify,
} from "../server/notify/policy.mjs";
import { commandFor, escapeAppleScript, escapePowerShell, postNativeNotification, sanitizeText } from "../server/notify/native.mjs";
import { createNotificationsPlugin } from "../server/routes/notifications.route.mjs";
import {
  groupNotifications,
  markAllRead,
  mergeNotifications,
  newestAt,
  relativeTime,
  routeForNotification,
  unreadCount,
} from "../src/lib/notifications.js";

const names = { memberNames: { asq_kai: "Kai", asq_eva: "Eva" }, channelNames: { ch_ci: "ci" } };
const at = "2026-09-26T09:00:00.000Z";

// --- policy: settings -------------------------------------------------------

assert.deepEqual(normalizeNotificationSettings(undefined), DEFAULT_NOTIFICATION_SETTINGS, "defaults when nothing saved");
assert.deepEqual(normalizeNotificationSettings({ mention: 0, bogus: true }), { ...DEFAULT_NOTIFICATION_SETTINGS, mention: false }, "unknown keys dropped, values coerced");

assert.equal(settingKeyFor({ name: "run.finished", status: "completed" }), "runFinished");
assert.equal(settingKeyFor({ name: "run.finished", status: "failed" }), "runFailed");
assert.equal(settingKeyFor({ name: "run.finished", status: "stopped" }), null, "a run the user stopped never notifies");
assert.equal(settingKeyFor({ name: "chat.finished", status: "completed" }), null, "a completed chat reply never notifies");
assert.equal(settingKeyFor({ name: "chat.finished", status: "failed" }), "runFailed");
assert.equal(settingKeyFor({ name: "handoff.pending" }), "handoffPending");
assert.equal(settingKeyFor({ name: "approval.pending" }), "approvalPending");
assert.equal(settingKeyFor({ name: "mention.received" }), "mention");
assert.equal(settingKeyFor({ name: "shell.ran" }), null);

// --- policy: suppression ----------------------------------------------------

const finished = { name: "run.finished", at, runId: "run_1", memberId: "asq_kai", status: "completed", title: "Fix CI", workspace: "/Users/me/code/api" };
assert.deepEqual(shouldNotify(finished, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/squad" }), { notify: true, reason: "ok", key: "runFinished" });
assert.equal(shouldNotify(finished, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/conversations/new?member=asq_kai" }).reason, "focused", "Kai's chat is on screen");
assert.equal(shouldNotify(finished, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/conversations/new?member=asq_eva" }).notify, true, "another member's chat does not suppress");
assert.equal(shouldNotify(finished, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "" }).notify, true, "no focus reported (window hidden) notifies");
assert.equal(shouldNotify(finished, { runFinished: false }, { focusedRoute: "/squad" }).reason, "disabled");
assert.equal(shouldNotify({ ...finished, status: "stopped" }, DEFAULT_NOTIFICATION_SETTINGS, {}).reason, "ignored");

const mention = { name: "mention.received", at, channelId: "ch_ci", memberId: "asq_kai", messageId: "m1", preview: "@you the smoke suite is red" };
assert.equal(shouldNotify(mention, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/channels/ch_ci" }).reason, "focused", "the channel is on screen");
assert.equal(shouldNotify(mention, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/channels/ch_ci/" }).reason, "focused", "trailing slash still matches");
assert.equal(shouldNotify(mention, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/channels/ch_other" }).notify, true);
assert.equal(shouldNotify(mention, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/channels" }).notify, true, "the channel list is not the channel");

const handoff = { name: "handoff.pending", at, taskId: "t1", fromMemberId: "asq_eva", toMemberId: "asq_kai", title: "Smoke suite" };
assert.deepEqual(relevantRoutesFor(handoff).sort(), ["/conversations/new?member=asq_kai", "/inbox"]);
assert.equal(shouldNotify(handoff, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/inbox" }).reason, "focused");
assert.equal(shouldNotify(handoff, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/conversations/new?member=asq_kai" }).reason, "focused");
assert.equal(shouldNotify(handoff, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/conversations/new?member=asq_eva" }).notify, true);

const approval = { name: "approval.pending", at, workflowId: "wf1", runId: "run_2", channelId: "ch_ci", stepId: "s1" };
assert.equal(routeForEvent(approval), "/channels/ch_ci");
assert.equal(routeForEvent({ ...approval, channelId: "" }), "/mission-control");
assert.equal(shouldNotify({ ...approval, channelId: "" }, DEFAULT_NOTIFICATION_SETTINGS, { focusedRoute: "/mission-control" }).reason, "focused");

// --- policy: copy -----------------------------------------------------------

const appUrl = "http://127.0.0.1:19821/";
let copy = notificationFor(finished, { appUrl, ...names });
assert.equal(copy.title, "Kai finished · Fix CI");
assert.equal(copy.body, "Done in api. Open the conversation to review the result.");
assert.equal(copy.url, "http://127.0.0.1:19821/conversations/new?member=asq_kai");
assert.equal(copy.route, "/conversations/new?member=asq_kai");

copy = notificationFor({ ...finished, status: "failed" }, { appUrl, ...names });
assert.equal(copy.title, "Kai failed · Fix CI");
assert.match(copy.body, /ended with an error/);

copy = notificationFor({ name: "chat.finished", at, memberId: "asq_eva", status: "failed", channelId: "ch_ci", preview: "401 unauthorized" }, { appUrl, ...names });
assert.equal(copy.title, "Eva could not reply in #ci");
assert.equal(copy.body, "401 unauthorized");
assert.equal(copy.route, "/channels/ch_ci");

copy = notificationFor(handoff, { appUrl, ...names });
assert.equal(copy.title, "Eva needs you · handoff: Smoke suite");
assert.equal(copy.body, "Eva handed “Smoke suite” to Kai. Accept or reassign it in Inbox.");
assert.equal(copy.url, "http://127.0.0.1:19821/inbox");

copy = notificationFor(approval, { appUrl, ...names });
assert.equal(copy.title, "Approval needed in #ci");
assert.equal(copy.url, "http://127.0.0.1:19821/channels/ch_ci");

copy = notificationFor(mention, { appUrl, ...names });
assert.equal(copy.title, "Kai mentioned you in #ci");
assert.equal(copy.body, "@you the smoke suite is red");

copy = notificationFor({ ...finished, memberId: "asq_unknown", title: "" }, { appUrl });
assert.equal(copy.title, "A member finished", "unknown names fall back to neutral copy");
copy = notificationFor({ ...finished, title: "x".repeat(200) }, { appUrl, ...names });
assert.ok(copy.title.length <= 120, "titles are clipped");

// --- native: escaping and command plans --------------------------------------

assert.equal(escapeAppleScript('say "hi" \\ bye'), 'say \\"hi\\" \\\\ bye');
assert.equal(escapePowerShell("it's"), "it''s");
assert.equal(sanitizeText("a\u0000b\n\tc   d", 100), "ab c d");
assert.equal(sanitizeText("x".repeat(50), 10).length, 10);

const payload = { title: 'Kai finished · "Fix" CI', body: "It's done <b>", url: "http://127.0.0.1:19821/conversations/new?member=asq_kai" };
let plan = commandFor(payload, { platform: "darwin", hasCommand: (name) => name === "terminal-notifier" });
assert.equal(plan.method, "terminal-notifier");
assert.deepEqual(plan.args.slice(-2), ["-open", payload.url], "click opens the app URL");
assert.equal(plan.args[plan.args.indexOf("-title") + 1], payload.title, "argv is passed verbatim, no shell");

plan = commandFor(payload, { platform: "darwin", hasCommand: () => false });
assert.equal(plan.method, "osascript");
assert.equal(plan.args[1], 'display notification "It\'s done <b>" with title "Kai finished · \\"Fix\\" CI"');

plan = commandFor(payload, { platform: "win32", hasCommand: () => false });
assert.equal(plan.method, "powershell");
assert.equal(plan.command, "powershell");
const script = plan.args[plan.args.length - 1];
assert.ok(script.includes("$b = 'It''s done <b>'"), "single quotes doubled inside PowerShell literals");
assert.ok(script.includes("BurntToast") && script.includes("NotifyIcon"), "toast with balloon fallback");
assert.ok(script.includes(`$u = '${payload.url}'`));
assert.equal(commandFor(payload, { platform: "win32", hasCommand: (name) => name === "pwsh" }).command, "pwsh");

plan = commandFor(payload, { platform: "linux", hasCommand: () => true });
assert.equal(plan.method, "notify-send");
assert.equal(plan.args[plan.args.length - 1], "It's done &lt;b&gt;", "markup neutralised for notify-send");
assert.equal(commandFor(payload, { platform: "linux", hasCommand: () => false }).method, "unsupported");
assert.equal(commandFor({ ...payload, url: "javascript:alert(1)" }, { platform: "darwin", hasCommand: () => true }).args.includes("-open"), false, "non-http URLs are dropped");

// --- native: dry run with a stubbed spawn -------------------------------------

function stubSpawn({ code = 0, stdout = "", fail = false, throwOnSpawn = false } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (throwOnSpawn) throw new Error("ENOENT");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    setImmediate(() => {
      if (fail) {
        child.emit("error", new Error("spawn failed"));
        return;
      }
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("close", code);
    });
    return child;
  };
  return { spawn, calls };
}

let stub = stubSpawn();
let result = await postNativeNotification(payload, { platform: "darwin", spawn: stub.spawn, hasCommand: (name) => name === "terminal-notifier" });
assert.deepEqual(result, { posted: true, method: "terminal-notifier" });
assert.equal(stub.calls.length, 1);
assert.equal(stub.calls[0].command, "terminal-notifier");
assert.equal(stub.calls[0].options.stdio[0], "ignore");

stub = stubSpawn();
result = await postNativeNotification(payload, { platform: "darwin", spawn: stub.spawn, hasCommand: () => false });
assert.deepEqual(result, { posted: true, method: "osascript" });
assert.equal(stub.calls[0].args[0], "-e");

stub = stubSpawn({ stdout: "burnttoast\r\n" });
result = await postNativeNotification(payload, { platform: "win32", spawn: stub.spawn, hasCommand: () => false });
assert.deepEqual(result, { posted: true, method: "powershell-burnttoast" });
stub = stubSpawn({ stdout: "balloon" });
result = await postNativeNotification(payload, { platform: "win32", spawn: stub.spawn, hasCommand: () => false });
assert.equal(result.method, "powershell-balloon");

stub = stubSpawn();
result = await postNativeNotification(payload, { platform: "linux", spawn: stub.spawn, hasCommand: () => true });
assert.deepEqual(result, { posted: true, method: "notify-send" });

stub = stubSpawn({ code: 1 });
result = await postNativeNotification(payload, { platform: "linux", spawn: stub.spawn, hasCommand: () => true });
assert.equal(result.posted, false);
assert.match(result.error, /exited with 1/);

stub = stubSpawn({ fail: true });
result = await postNativeNotification(payload, { platform: "darwin", spawn: stub.spawn, hasCommand: () => false });
assert.deepEqual(result, { posted: false, method: "osascript", error: "spawn failed" });

stub = stubSpawn({ throwOnSpawn: true });
result = await postNativeNotification(payload, { platform: "darwin", spawn: stub.spawn, hasCommand: () => false });
assert.equal(result.posted, false, "a throwing spawn is reported, never thrown");
assert.equal(result.error, "ENOENT");

result = await postNativeNotification(payload, { platform: "sunos", spawn: () => assert.fail("must not spawn") });
assert.equal(result.posted, false);
assert.equal(result.method, "unsupported");

result = await postNativeNotification(null, { platform: "linux", spawn: stubSpawn().spawn, hasCommand: () => true });
assert.equal(result.posted, true, "a missing payload still posts something rather than throwing");

// --- route plug-in end to end --------------------------------------------------

const stateDir = await mkdtemp(join(tmpdir(), "squad-notifications-"));
try {
  const posted = [];
  const logs = [];
  const events = new EventEmitter();
  const responses = [];
  const ctx = {
    squadStateDir: stateDir,
    events,
    SEVERITY: { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 },
    logEvent: (severity, message, attributes) => logs.push({ severity, message, attributes }),
    json: (res, status, body) => responses.push({ status, body }),
    readBody: async (req) => req.body || {},
    readJsonFile: async (path) => JSON.parse(await readFile(path, "utf8")),
    readOptionalJsonFile: async (path) => {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        return null;
      }
    },
    writeJsonFile: async (path, data) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    },
    readChannelsState: async () => ({ version: 1, channels: [{ id: "ch_ci", name: "ci", memberIds: ["asq_kai"] }] }),
  };
  await ctx.writeJsonFile(join(stateDir, "web-status.json"), { members: [{ id: "asq_kai", name: "Kai" }, { id: "asq_eva", name: "Eva" }] });

  const plugin = createNotificationsPlugin({
    postNative: async (notification) => {
      posted.push(notification);
      return { posted: true, method: "stub" };
    },
  });
  await plugin.init(ctx);
  assert.deepEqual(plugin.state.settings, DEFAULT_NOTIFICATION_SETTINGS);

  async function call(method, path, body) {
    responses.length = 0;
    const req = { method, url: path, headers: { host: "127.0.0.1:19821" }, body };
    const handled = await plugin.handle(req, {}, new URL(path, "http://127.0.0.1:19821"), ctx);
    assert.equal(handled, true, `${method} ${path} handled`);
    return responses[0];
  }

  assert.equal(await plugin.handle({ method: "GET" }, {}, new URL("http://127.0.0.1:19821/api/runs"), ctx), false, "other routes are not ours");

  let response = await call("POST", "/api/notifications/focus", { route: "/conversations/new?member=asq_kai" });
  assert.deepEqual(response.body, { success: true, data: { focusedRoute: "/conversations/new?member=asq_kai" } });

  // Kai finishes while Kai's chat is focused: in the feed as read, no native post.
  await plugin.onEvent({ ...finished });
  assert.equal(posted.length, 0, "focused conversation suppresses the native notification");
  response = await call("GET", "/api/notifications");
  assert.equal(response.body.data.items.length, 1);
  assert.equal(response.body.data.items[0].read, true, "a suppressed item is history, not unread");
  assert.equal(response.body.data.unread, 0);

  // The user moves away; Eva's handoff and a mention arrive through the bus.
  await call("POST", "/api/notifications/focus", { route: "/squad" });
  events.emit("handoff.pending", { ...handoff });
  events.emit("mention.received", { ...mention });
  events.emit("run.finished", { ...finished, status: "stopped" });
  events.emit("chat.finished", { name: "chat.finished", at, memberId: "asq_kai", status: "completed" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(posted.length, 2, "handoff and mention posted; stopped run and completed chat ignored");
  assert.equal(posted[0].title, "Eva needs you · handoff: Smoke suite");
  assert.equal(posted[0].url, "http://127.0.0.1:19821/inbox", "the app URL comes from the request host");
  assert.equal(posted[1].title, "Kai mentioned you in #ci");

  response = await call("GET", "/api/notifications");
  assert.equal(response.body.data.items.length, 3);
  assert.equal(response.body.data.unread, 2);
  assert.equal(response.body.data.items[0].kind, "mention.received", "newest first");
  assert.deepEqual(response.body.data.items[0].native, { posted: true, method: "stub" });

  const sinceMention = response.body.data.items[1].at;
  response = await call("GET", `/api/notifications?since=${encodeURIComponent(sinceMention)}`);
  assert.equal(response.body.data.items.length, 0, "since is exclusive on an identical timestamp");
  response = await call("GET", "/api/notifications?since=2020-01-01T00:00:00.000Z");
  assert.equal(response.body.data.items.length, 3);

  // Settings: turning mentions off drops them from feed and native alike.
  response = await call("PUT", "/api/notifications/settings", { mention: false });
  assert.deepEqual(response.body.data.settings, { ...DEFAULT_NOTIFICATION_SETTINGS, mention: false });
  await plugin.onEvent({ ...mention, messageId: "m2" });
  assert.equal(posted.length, 2);
  response = await call("GET", "/api/notifications");
  assert.equal(response.body.data.items.length, 3);

  // Read: one id, then all.
  const [newest, middle] = response.body.data.items;
  response = await call("POST", "/api/notifications/read", { ids: [newest.id] });
  assert.equal(response.body.data.unread, 1);
  response = await call("POST", "/api/notifications/read", {});
  assert.equal(response.body.data.unread, 0);
  assert.ok(response.body.data.lastReadAt);
  assert.ok(middle.id);

  // Test: posts a native notification through the injected poster.
  response = await call("POST", "/api/notifications/test", {});
  assert.deepEqual(response.body, { success: true, data: { posted: true, method: "stub" } });
  assert.equal(posted[2].url, "http://127.0.0.1:19821/squad");

  // Persistence: a fresh plug-in reloads settings and feed from disk.
  await plugin.state; // settle
  const saved = JSON.parse(await readFile(join(stateDir, "notifications.json"), "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.settings.mention, false);
  assert.equal(saved.items.length, 3);
  const reloaded = createNotificationsPlugin({ postNative: async () => ({ posted: false, method: "none", error: "nope" }) });
  await reloaded.init({ ...ctx, events: new EventEmitter() });
  assert.equal(reloaded.state.settings.mention, false);
  assert.equal(reloaded.state.items.length, 3);
  assert.equal(reloaded.state.items.every((item) => item.read), true);

  // Feed cap and a failing native poster are both survivable.
  for (let index = 0; index < 120; index += 1) {
    await reloaded.onEvent({ ...finished, runId: `run_${index}`, at: new Date(Date.parse(at) + index * 1000).toISOString() });
  }
  assert.equal(reloaded.state.items.length, 100, "feed keeps the last 100");
  assert.ok(logs.some((entry) => /native post failed/.test(entry.message)), "a failed native post is logged, not thrown");
  response = await (async () => {
    responses.length = 0;
    await reloaded.handle({ method: "POST", headers: {}, body: {} }, {}, new URL("http://127.0.0.1:19821/api/notifications/test"), ctx);
    return responses[0];
  })();
  assert.equal(response.body.success, false, "a failed test notification reports an error");
  assert.match(response.body.error, /nope/);
  plugin.dispose();
  reloaded.dispose();
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

// --- browser helpers ------------------------------------------------------------

const feed = [
  { id: "n1", kind: "run.finished", at: "2026-09-26T08:00:00.000Z", read: false, memberId: "asq_kai", route: "/conversations/new?member=asq_kai" },
  { id: "n2", kind: "mention.received", at: "2026-09-25T08:00:00.000Z", read: true, channelId: "ch_ci" },
  { id: "n3", kind: "handoff.pending", at: "2026-09-01T08:00:00.000Z", read: false },
  { id: "n4", kind: "approval.pending", at: "2026-09-01T07:00:00.000Z", read: false },
];
assert.equal(unreadCount(feed), 3);
assert.equal(routeForNotification(feed[0]), "/conversations/new?member=asq_kai", "bridge route wins");
assert.equal(routeForNotification(feed[1]), "/channels/ch_ci");
assert.equal(routeForNotification(feed[2]), "/inbox");
assert.equal(routeForNotification(feed[3]), "/mission-control");
assert.equal(routeForNotification({ kind: "run.finished", memberId: "asq_kai" }), "/conversations/new?member=asq_kai");

// Grouping depends on the local day boundary; build "now" from local dates so
// the check passes in any time zone.
const localNow = new Date(2026, 8, 26, 20, 0, 0).getTime();
const localFeed = [
  { id: "t1", at: new Date(2026, 8, 26, 8).toISOString(), read: false },
  { id: "t2", at: new Date(2026, 8, 25, 8).toISOString(), read: true },
  { id: "t3", at: new Date(2026, 8, 1, 8).toISOString(), read: false },
  { id: "t4", at: "bogus", read: false },
];
const groups = groupNotifications(localFeed, localNow);
assert.deepEqual(groups.map((group) => [group.label, group.items.map((item) => item.id)]), [
  ["Today", ["t1"]],
  ["Yesterday", ["t2"]],
  ["Earlier", ["t3", "t4"]],
]);
assert.deepEqual(groupNotifications([], localNow), [], "no empty groups");
assert.equal(relativeTime(new Date(localNow - 20_000).toISOString(), localNow), "now");
assert.equal(relativeTime(new Date(localNow - 15 * 60_000).toISOString(), localNow), "15m");
assert.equal(relativeTime(new Date(2026, 8, 26, 8).toISOString(), localNow), "12h");
assert.equal(relativeTime(new Date(2026, 8, 25, 8).toISOString(), localNow), "Yesterday");
assert.match(relativeTime(new Date(2026, 8, 1, 8).toISOString(), localNow, "en"), /1 Sep|Sep 1/);
assert.equal(relativeTime("bogus"), "");

const merged = mergeNotifications(feed, [{ id: "n1", read: true }, { id: "n5", at: "2026-09-26T09:00:00.000Z", read: false }]);
assert.equal(merged[0].id, "n5", "newest first after merge");
assert.equal(merged.find((item) => item.id === "n1").read, true, "read state sticks");
assert.equal(merged.length, 5);
assert.equal(mergeNotifications(feed, [], 2).length, 2, "capped");
assert.equal(newestAt(merged), "2026-09-26T09:00:00.000Z");
assert.equal(unreadCount(markAllRead(feed)), 0);

console.log("check-notifications: ok");
