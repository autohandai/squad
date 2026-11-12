# Notifications (issue #37) — integration note

Native OS notifications posted by the bridge, an in-app bell, and a Settings
section. Module files: `server/notify/{policy,native}.mjs`,
`server/routes/notifications.route.mjs`, `src/lib/notifications.js`,
`src/components/shell/NotificationBell.jsx`,
`src/components/settings/NotificationSettings.jsx`,
`scripts/check-notifications.mjs`. Decision record: `docs/adrs/ADR-0019-notifications.md`.

## Bridge (auto-loaded, nothing to wire)

The route plug-in subscribes to `run.finished` (completed / failed; stopped
is ignored), `chat.finished` (failed only), `handoff.pending`,
`approval.pending`, `mention.received`. Each eligible event lands in a feed
(last 100, persisted to `<squadStateDir>/notifications.json`) and is posted
natively unless the relevant conversation is focused. Member names come from
`web-status.json` (`members[].name`), channel names from `channels.json`.

| Route | Body → data |
| --- | --- |
| `GET /api/notifications/settings` | → `{ settings }` |
| `PUT /api/notifications/settings` | `{ runFinished?, runFailed?, handoffPending?, approvalPending?, mention? }` → `{ settings }` |
| `PATCH /api/notifications/channels/:id` | `{ mode?: "all"/"mentions"/"muted"/"default", hidden?: boolean }` → `{ settings }` |
| `POST /api/notifications/focus` | `{ route }` → `{ focusedRoute }` |
| `GET /api/notifications?since=<ISO>` | → `{ items, unread, lastReadAt, focusedRoute }` (newest first) |
| `POST /api/notifications/read` | `{ ids? }` (omit for all) → `{ unread, lastReadAt }` |
| `POST /api/notifications/test` | → `{ posted, method }`; `success: false` with a reason when the OS refused |

Item shape: `{ id, kind, at, title, body, route, url, memberId, channelId, messageId, status, read, native }`.
The click URL is `http://<host of the last focus/test request>` + `route`
(override with `AUTOHAND_SQUAD_APP_URL`). The three client-side events still
need the web app to raise them through `POST /api/events` (CONTRACT.md).

## Channel and group preferences (MCP contract 2.2.0)

`settings` now also contains `channelDefault` (`mentions` initially) and
`channelOverrides`, keyed by conversation ID with optional `mode` and `hidden`.
The global PUT accepts `channelDefault`; it preserves overrides, including
when an older client sends its settings snapshot. The channel PATCH validates
an existing conversation and changes only supplied fields. `mode: "default"`
removes the explicit mode. Saving waits for the selected owner's file write;
a failed write returns 500 and leaves earlier settings intact. Successful
saves emit `notifications.settings.changed` on the existing owned live stream.

Channel and group sidebar rows share right-click and ellipsis actions. Mute
and hide sets `mode: "muted", hidden: true`; Show in sidebar clears only
`hidden`, retaining the quiet mode. The Hidden channels section and Settings
provide recovery. Preferences never remove membership, messages or work.

The bridge observes `channels.changed` and scans canonical saved messages.
A newly completed member post produces at most one `channel.posted` receipt
per process. Baseline history, older cache backfill, incomplete streamed text,
user messages and replayed IDs stay quiet. All new posts alerts for each new
member post; Just mentions requires the current verified person's name/email
or `@you` and the global mention setting. Mentions of another agent are not
personal alerts. The earlier browser emitter treated any agent mention as a
personal mention; canonical saved-message detection replaces that behavior.

Muted conversations suppress channel-scoped alerts. Hide alone does not mute.
Existing independent run, approval and handoff switches remain available;
run completion and a saved channel publication are separate events. Viewing
the originating channel suppresses its post alert; viewing that member's
direct chat does not. A canonical human-mention event is still emitted for
audit/search/history without creating a second notification.

Personal datasets retain `notifications.json`. Team datasets use
`notifications-<actorKey>.json`, where the existing identity helper hashes
the verified issuer and immutable subject; email/name do not select storage.
This isolates different humans' feeds and hide/mute choices while keeping
team conversations shared. Older un-attributed team `notifications.json`
files stay untouched and are not automatically assigned to the next human;
this change does not add a recovery UI for those earlier preferences.
There is no new notification worker or durable delivery queue:
OS denial/Focus can prevent a visible banner, and a service failure during
publication is not retried as a guaranteed delivery. Restart never replays
old posts. Operator MCP provides `get_notification_preferences`,
`set_notification_defaults` and `set_channel_notifications`; managed members
cannot edit the person's preferences. See ADR-0205 and the control-plane
documentation for the separate MCP contract version and reconnect behavior.

Checks: `bun run check:channel-notifications` covers real owned HTTP saves,
saved publications, focus, history/replay, restart and write failure/recovery.
`bun run check:channel-actions:browser` covers real pointer/right-click menus,
rename error/retry, visibility recovery, Settings and live preference updates.

## App.jsx wiring

**Focus reporting.** Wherever `navigate(route)` commits the new route, post
it so the bridge can suppress duplicates:

```js
useEffect(() => {
  const report = (route) => api("/api/notifications/focus", { method: "POST", body: JSON.stringify({ route }) }).catch(() => {});
  report(document.visibilityState === "visible" ? currentRoute : "");
  const onVisibility = () => report(document.visibilityState === "visible" ? currentRoute : "");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);
  window.addEventListener("blur", onVisibility);
  return () => { /* remove the three listeners */ };
}, [currentRoute]);
```

An empty route means "nothing is focused" (window hidden or blurred), so a
finish in the focused chat still notifies when the app is in the background.

**Feed polling (10 s).** Keep `notifications` state in App.jsx:

```js
import { mergeNotifications, newestAt, markAllRead, routeForNotification, unreadCount, NOTIFICATION_POLL_MS } from "@/lib/notifications";
// initial: api("/api/notifications") → setNotifications(data.items)
// every NOTIFICATION_POLL_MS: api(`/api/notifications?since=${encodeURIComponent(newestAt(items))}`)
//   → setNotifications((current) => mergeNotifications(current, data.items))
```

Also refetch (no `since`) after `POST /api/notifications/read` so read state
from another window converges.

**Bell.** In `WorkspaceSidebar`, the search control sits alone in a `px-3`
block; wrap it in `flex items-center gap-1` and render the bell as its right
neighbour (the search button keeps `flex-1`):

```jsx
<NotificationBell
  items={notifications}
  unread={unreadCount(notifications)}
  copy={copy}
  onOpen={(item) => { navigate(routeForNotification(item)); api("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: [item.id] }) }); }}
  onMarkAllRead={() => { setNotifications(markAllRead); api("/api/notifications/read", { method: "POST", body: "{}" }); }}
/>
```

`WorkspaceSidebar` is presentational; pass the bell in as a `searchTrailing`
prop (or render it from App.jsx next to `onNavigate.search`).

**Settings section.** Add to `settingsSections` after `chat`:

```js
{ id: "notifications", icon: Bell, label: copy.notifications || "Notifications", detail: notificationSettingsDetail }
```

where `notificationSettingsDetail` is e.g. "All on" / "3 of 5 on" / "Off".
Section markup, between `settings-chat` and `settings-handoff`:

```jsx
<section id="settings-notifications" className="scroll-mt-6 border-b border-border/70 py-8 first:pt-0">
  <SettingsSectionHeader title={copy.notifications || "Notifications"} description={copy.notificationsDescription || "Native alerts when the squad needs you and the window is elsewhere."} />
  <NotificationSettings
    settings={notificationSettings}
    copy={copy}
    onChange={(next) => { setNotificationSettings(next); api("/api/notifications/settings", { method: "PUT", body: JSON.stringify(next) }); }}
    onTest={() => api("/api/notifications/test", { method: "POST", body: "{}" })}
  />
</section>
```

`notificationSettings` is loaded once from `GET /api/notifications/settings`
(fall back to `DEFAULT_NOTIFICATION_SETTINGS` from `src/lib/notifications.js`).

## Copy keys (`src/locales.js`, `en`)

`notifications` "Notifications", `notificationsDescription`, `markAllRead`
"Mark all read", `notificationsEmpty` "Nothing yet. Finished runs, handoffs
and mentions land here.", `notificationsToday` / `notificationsYesterday` /
`notificationsEarlier`, `sendTestNotification` "Send test notification",
`notificationTestSent` "Sent.", `notificationTestFailed`, and per kind
`notify_runFinished`, `notify_runFailed`, `notify_handoffPending`,
`notify_approvalPending`, `notify_mention` plus the `…Detail` variants
(defaults in `NOTIFICATION_KINDS`). Every key has a literal fallback in the
components.

## package.json

`"check:notifications": "node scripts/check-notifications.mjs"` (add to CI
next to `check:recruiting`).

## DESIGN.md

Under **Workspace Shell**: "A bell beside the search control carries a small
dot while notifications are unread; its popover is a divider list (title,
one-line body, relative time) with Mark all read. Native notifications are
posted by the bridge, never while the conversation is on screen." Under
**Settings**: "Notifications is one switch row per event kind and a ghost
Send test notification button."
