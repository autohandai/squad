# ADR-0019: Push notifications from the bridge

Date: 2026-09-26 · Status: accepted · Issue #37

## Context

Long runs finish silently when the window is in the background; a handoff
or approval can wait unnoticed for an hour. The bridge already emits
`run.finished`, `chat.finished`, `handoff.pending`, `approval.pending` and
`mention.received` on `server/events.mjs`, and it runs on the user's
machine, so it can talk to the OS directly. The desktop shell is a Tauri
webview; browser `Notification` permission prompts and a second
notification path through Rust would both duplicate what the bridge can do
with one process spawn. Mobile push is out of scope.

## Decision

- **Native posting lives in the bridge** (`server/notify/native.mjs`).
  macOS: `terminal-notifier` when on PATH (Homebrew prefixes included, since
  the shell-launched bridge has a thin PATH) because its `-open <url>` makes
  a click open the right conversation; otherwise `osascript display
  notification`, which cannot carry a click target. Windows: one PowerShell
  script that uses BurntToast when installed (toast with an Open button) and
  a `NotifyIcon` balloon otherwise. Linux: `notify-send`. Every command is
  spawned with an argv array, never a shell; AppleScript and PowerShell
  literals are escaped, Pango markup is neutralised, control characters are
  stripped, and only `http(s)` URLs are handed over. The poster never
  throws; it returns `{ posted, method, error? }`.
- **Policy is pure** (`server/notify/policy.mjs`): one setting per kind
  (`runFinished`, `runFailed`, `handoffPending`, `approvalPending`,
  `mention`, all on), a stopped run and a completed chat reply never
  notify, a failed chat reply counts as `runFailed`. Suppression compares
  the event's relevant routes (member chat, channel, Inbox for handoffs,
  Mission Control for channel-less approvals) with the route the web app
  last reported; an empty focused route (window hidden or blurred) means
  nothing is focused. Copy is short and specific: "Kai finished · Fix CI",
  "Eva needs you · handoff: Smoke suite", "Kai mentioned you in #ci".
- **The feed is server state**, not browser state: the route plug-in keeps
  the last 100 items in `<squadStateDir>/notifications.json` so the bell
  survives reloads and every window sees the same unread count. A suppressed
  event still enters the feed, already read, as history. The web app polls
  `GET /api/notifications?since=` every 10 s and reports its route with
  `POST /api/notifications/focus`; the bridge learns the app URL from that
  request's `Host` header (`AUTOHAND_SQUAD_APP_URL` overrides).
- **UI follows DESIGN.md**: a ghost bell next to the sidebar search control
  with a small unread dot and a divider-list popover; Settings gets a
  "Notifications" section of switch rows and a ghost "Send test
  notification" button. Both components are presentational and take the
  feed, settings and callbacks as props.

## Consequences

- Clicking a notification opens the app only where the OS can carry a URL
  (terminal-notifier, BurntToast). With plain `osascript` or a balloon the
  notification still shows; the user opens the app and the bell lists it.
  Installing `terminal-notifier` (`brew install terminal-notifier`) is the
  documented upgrade on macOS; a Tauri deep link would be the next step.
- Names are resolved from `web-status.json` and `channels.json`, so a
  notification for a member the web app has not mirrored yet says "A
  member". That is accepted over threading member metadata through the
  bridge.
- Suppression depends on the web app reporting focus; if it never does, the
  bridge notifies for everything, which is the safe failure.
- The check (`scripts/check-notifications.mjs`) covers the policy, every
  platform branch of the poster through an injected spawn, and the route
  plug-in end to end with a fake bridge context, so the module is verified
  without an OS notification centre in CI.
