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
| `POST /api/notifications/focus` | `{ route }` → `{ focusedRoute }` |
| `GET /api/notifications?since=<ISO>` | → `{ items, unread, lastReadAt, focusedRoute }` (newest first) |
| `POST /api/notifications/read` | `{ ids? }` (omit for all) → `{ unread, lastReadAt }` |
| `POST /api/notifications/test` | → `{ posted, method }`; `success: false` with a reason when the OS refused |

Item shape: `{ id, kind, at, title, body, route, url, memberId, channelId, status, read, native }`.
The click URL is `http://<host of the last focus/test request>` + `route`
(override with `AUTOHAND_SQUAD_APP_URL`). The three client-side events still
need the web app to raise them through `POST /api/events` (CONTRACT.md).

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
