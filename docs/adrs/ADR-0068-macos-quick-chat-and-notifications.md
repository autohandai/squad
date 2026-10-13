# ADR-0068: macOS quick chat and app-owned notifications

Status: Accepted

## Context and evidence

The menu-bar Members submenu previously showed names and statuses. Selecting
a member navigated the main app to their DM, replacing the conversation the
person already had open. The user supplied a screenshot and asked to pick a
member by avatar and have a quick chat, with working macOS notifications.

The bridge notification adapter used terminal-notifier when available and
otherwise AppleScript. That path cannot reliably own Squad's notification
permission, branding, or native click routing. We examined Tauri's official
[desktop notification implementation](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/src/desktop.rs):
its desktop permission methods return Granted without asking the operating
system, its desktop actions are ignored, and show schedules a task which
discards the OS error. Those behaviors do not support the requested proof.

## Decision

On macOS, Members uses native icon menu items with the member's existing
portrait. Images come only from bundled avatar paths or bounded PNG/JPEG/WebP
data images; network images and arbitrary filesystem paths are rejected.
Decoding limits dimensions and allocation before resizing to the menu icon.
Selecting a member opens or reuses `quick-chat` at the fixed local bridge
route `/quick-chat?member=<id>`. Reselecting the same member preserves its
draft and stream. Its native title bar is ordinary, with no main-window
traffic-light overlay inset. The main window and route are left intact.
Window → Quick chat (⌘⇧K) provides an additional native keyboard entry.
It focuses an existing compact window without navigating or changing the
selected member. On first opening, a worker reads the live roster and
authoritative break records, prefers a valid member accepting work, and
schedules window creation on the main thread. If the whole roster is on a
break, it selects the first valid member so a person can explicitly resume
them; the existing break reply still prevents new work from starting.

The installed macOS shell directly uses Apple's UserNotifications framework.
Permission reads the operating system's actual settings; requesting permission
uses Apple's authorization prompt. Three narrow native commands expose
permission, a fixed test notification, and the fixed Notifications Settings
link. Every command checks the calling window label and active bridge origin.
No general URL, notification payload, or shell command is accepted from IPC.

When the shell starts the bridge, `AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS=macos`
makes the existing bridge event feed a persistent native queue instead of
also launching AppleScript. Queued events explicitly report `posted: false`.
The shell polls even while windows are hidden, submits only after permission
is granted, and persists Apple's submission result on the original feed item.
The same identifier and persisted result prevent replay after relaunch.
Notification clicks only open known product routes on the local bridge;
stored click destinations are restored from the feed after relaunch.

## Validation

`cargo test --manifest-path src-tauri/Cargo.toml --bin autohand-squad --offline`
passed all eight native tests, including fixed quick-chat routing and malicious
member/notification destination rejection. A test first exposed invalid
`/conversations/new` member queries falling through the generic conversation
route; the guard now validates that route separately and accepts exactly one
member parameter. Existing information-window origin and protocol tests still
pass.

`node scripts/check-notifications.mjs` passed platform notification plans,
focus suppression, queued versus accepted state, delivery acknowledgement
validation, persisted results, and rejection when a browser/headless bridge
does not own native notifications. These checks do not establish visible
macOS banner delivery; the installed app must be tested through its system
permission prompt, test action, and notification click.

## Consequences and boundaries

The compact window is deliberately one reusable window, not one window per
member. Switching members preserves the main conversation but reloads the
compact window; users should finish or send an unsent compact draft before
switching to another member. The web member picker can retain drafts when it
changes selection internally.

Notifications now carry Squad's bundle identity and native callbacks rather
than a third-party notifier identity. OS submission is not a guarantee that
a banner appears: notification style, permission, Focus mode, and macOS policy
remain in control. A rejected submission is stored as a failure rather than
retried indefinitely; the Settings test provides a direct way to diagnose it.
The native worker polls every two seconds; this trades a small local polling
cost for delivery while the main webview is hidden and independent of its
render timers. Existing bridge event-kind settings remain unchanged.

The bridge keeps focus per main/quick-chat window rather than a single
last-writer field, so one window's blur cannot clear the other's visible
conversation. A 30-second lease expires a closed window's focus; visible
windows refresh every 15 seconds. Native IPC has explicit generated command
permissions scoped to the two window labels and loopback IPv4/localhost
origins, plus a runtime check against the active bridge URL. Tauri's URL
pattern tokenizer rejected a bracketed IPv6 wildcard origin during build;
the capability deliberately does not grant an invalid broad replacement.

The macOS path requires an installed app bundle. Browser/headless usage and
other operating systems retain their existing notification adapters and
member navigation. This change does not prove notification delivery on
Windows or Linux or turn the local developer bundle into a signed release.

## Installed-app correction: macOS authorization requires a bundle signature

The first installed-app test returned `not-determined`, but clicking Enable
failed immediately with `UNErrorDomain error 1`, without an OS prompt.
`codesign -dv --verbose=2` on `/Applications/Autohand Squad.app` showed the
Rust linker's ad-hoc executable identifier `autohand_squad-4630da0e41d0892a`,
`Info.plist=not bound`, and `Sealed Resources=none`.
`codesign --verify --deep --strict --verbose=2` failed because the app had
no sealed resources. The bridge and UI had loaded normally, so a successful
native launch was not evidence that UserNotifications could authorize it.

The release installer packager already chooses a complete ad-hoc signature
when Developer ID is absent. The raw local `tauri build` path did not.
The local `desktop:build` script now calls `build-native-shell.mjs`, which
preserves an explicit `APPLE_SIGNING_IDENTITY` and chooses `-` only when it
is absent on macOS. This follows
[Tauri's documented ad-hoc signing configuration](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing).
The [Electron 42 UserNotifications migration](https://www.electronjs.org/blog/electron-42-0#macos-notifications-now-use-unnotification-api)
also documents the code-signature requirement of the same native framework.
The next installed-app check must verify the resulting bundle signature and
repeat permission, test notification, and click checks. This corrects the
initial assumption that a bootable local bundle was sufficient; it does not
claim notarization or prove OS display before that check.

## Installed native validation and observed display boundary

After rebuilding through the signing wrapper and replacing the installed app
cleanly, `codesign --verify --deep --strict --verbose=2` passed for
`/Applications/Autohand Squad.app`. `codesign -dv --verbose=2` reported
`Identifier=ai.autohand.squad`, an ad-hoc hardened-runtime signature, bound
Info.plist entries, and sealed resources. This is a valid local signature,
not Developer ID signing or notarization. The final UI rebuild and installed
replacement passed the same strict signature check.

Native UI verification opened Window → Quick chat with ⌘⇧K, reused its
minimized window, and showed a 640×700 content area beneath the normal
28-pixel title bar. The avatar toolbar displayed eight actual squad member
portraits. Selecting Noah updated the compact route, member heading, and
composer together; the main window's earlier `/work` route stayed intact.
The status-bar NSStatusItem menu could not be reached through the automation
surface, so native tray portrait pixels remain unverified. The native keyboard
entry and compact member picker were verified through the installed UI.

Only Squad's per-app notification controls were enabled in System Settings.
The native permission check then returned Granted, and Send test notification
received Apple's successful submission callback. The system's Focus and
mirroring/sharing preferences were preserved.

A bounded, read-only unified-log query for the app and fixed test identifier
established what happened after submission. At 2026-10-01 22:01:05 local time,
`autohand-squad` logged an added request with `hasError: 0`. `usernoted` routed
`autohand-squad:squad-test` for `ai.autohand.squad` to alert, lock screen, and
Notification Center with `shouldDeliver: true`. Its initial “Presenting … as
banner” line was pipeline intent, not evidence of visible pixels. The later
NotificationCenter records said “muted by DND suppression: delay”,
`canDisplayWhileCenterIsClosed: false`, “added to history”, and that sound was
not played because the record was muted. The DND resolver recorded a
suppressed outcome caused by the active mode configuration.

These records prove native submission and Notification Center history
delivery, and explain the absent banner under the existing Focus policy.
They do not prove visible banner pixels or a real OS notification click.
Notification Center was inaccessible through the UI automation surface, so
the click callback remains covered by route/security checks without live
click proof. No global Focus bypass, critical notification entitlement, or
mirroring preference change was introduced to force a banner for a test.

## Correction: Quick Chat belongs beside the menu bar

The user's follow-up screenshots showed that the original 640×700 normal
window still repeated the full DM surface: a portrait toolbar, another
identity header, harness and new-chat controls, workspace/settings controls,
and a large tinted error panel. The original title-bar decision above is
superseded. The requested interaction is to select one member and chat beside
the status icon, rather than opening another full app window.

The installed process inventory contained one shell and its daemon,
analytics, and Node children, with no legacy tray process. Source inspection
found one main-window constructor and no declarative Tauri windows. Thus a
second running shell was not the observed cause. The main bootstrap and
fresh quick webview each showed startup surfaces, and bootstrap would
unconditionally show/focus the main window. That behavior made the secondary
chat look like another startup. Bootstrap now respects a hidden main window
and a visible chat popover. Quick Chat's initial HTML and React handover each
show the same single connection line, with no fading main startup overlay.
The desktop-controller environment always points to the running shell.

Quick Chat is now one reusable, frameless 380×520 surface below the live tray
rectangle, clamped to the relevant monitor's work area. Left-click toggles it;
right-click retains the action menu. The Members submenu and ⌘⇧K reach the
same surface. Outside focus, Escape, and native Close hide it without
stopping work or destroying drafts. Member changes use local history and
popstate rather than reloading the webview. The frontend preserves each
member's draft while resetting execution defaults to that member. The
surface contains one member dropdown, messages, and a textarea plus Send/Stop.
Actual goal controls and task checklists remain when a goal exists; full DM
settings and raw activity details remain in the main app.

The tray action is shortened to About. Missing or unreadable portraits use a
local generic person icon; the frontend uses CircleUserRound rather than an
initial. A stronger browser check found that merely putting a fallback SVG
in the DOM was insufficient: Radix Avatar retained its loaded-image state
when a photo member changed to an avatarless member, hiding the fallback.
Keying the Avatar by member and image resets that state. The final check
asserts rendered SVG dimensions after a loaded-photo-to-no-photo switch.

Interrupted requests also kept an old "is thinking..." body. Recovery now
removes only that transient prefix, including previously recovered errors,
and preserves partial answers and unfinished plan items. Loading follows the
message's actual loading status, never a legacy placeholder on a terminal
reply. Compact errors are plain inline text with Retry and no elapsed-time
claim implying ongoing work.

Validation: the focused browser run passed with 11 screenshots at 380×520,
including first connection paint, visible fallback after switching, recipient
payloads, draft preservation, goal chronology and controls, break refusal,
and interruption without stale thinking/spinners. It used mocked APIs.
Native shell tests passed 10/10 (including Retina and negative-origin monitor
positioning and nonblank fallback generation), and daemon tray tests passed
8/8. The frontend and native release builds passed; strict bundle signature
verification passed on the built and installed app. Before replacement the
live runtime reported no busy sessions or goals, and service shutdown stopped
zero managed runs. The previous installed bundle was preserved in /tmp.

The smaller surface knowingly keeps execution settings in the main app,
trading in-place configuration for a direct chat interaction. Only macOS uses
this anchored popup. Existing notification Focus/display and actual-click
verification boundaries remain as recorded above. Native rendered placement
and dismissal must be recorded separately from the positioning unit tests.

## Correction: recipients stay visible in a horizontal carousel

The next user correction asked for online portrait icons that slide or scroll,
rather than the dropdown recorded above. The dropdown is therefore superseded
by one horizontal shadcn/Embla carousel of the actual roster. Each portrait has
a presence dot; working, idle, unavailable and unknown remain distinct, and a
member on a break is grey rather than falsely available. A restrained outline
marks the selected recipient, followed by one quiet name/role/status line.
Overflow arrows, mouse/touch dragging and horizontal trackpad scrolling move
the strip without changing the recipient. Left/right/Home/End select and focus
a portrait through the same existing member-selection action, preserving drafts.

The composer now uses the registry's InputGroup and InputGroupTextarea through
the existing PromptTextarea control seam. It remains one calm field with a
small Enter hint, Send, and Stop during work. Regular follow-ups still queue;
mentions, slash commands, keyboard submission and draft handling retain their
shared handlers. Execution settings stay in the main app. The portrait strip
uses more vertical space than the dropdown in exchange for visible recipients
and truthful availability; scrolling handles larger rosters without a grid.

Validation before browser/native checks: the carousel consumer and registry
JSX syntax checks passed. After the InputGroup composer change, the JSX import
check passed for 110 files, and a Vite production build to
`/tmp/squad-quick-chat-input-group-validation` passed.
Those checks establish compilation, not rendered interaction or native pixels.
The earlier 11-screenshot dropdown run does not verify this corrected carousel
or InputGroup composer; the focused browser run must be repeated.

## Amendment, 2026-10-13: the goal checklist stretched the 380x520 window

The repeated focused browser run (`node scripts/verify-goals-browser.mjs`)
failed on the quick-chat goal step twice in a row with the pinned goal
controls off screen. Instrumentation showed the window at 520px and the
quick-chat root at 520px, but the document at 1293px, scrolled 218px. The
two deepest elements were the `sr-only` status labels of completed
checklist items. Tailwind's `sr-only` is `position: absolute`; the
ScrollArea root is `relative` but does not clip, so those labels were placed
at their static position relative to the root, outside the viewport's clip,
and extended the document. `scrollIntoView` on the goal article then
scrolled the whole page and hid the controls and carousel.

Decision: each checklist item is `relative`, so its hidden labels stay
inside the scrolled list. No change to the shared ScrollArea primitive,
which other surfaces rely on not clipping. The focused run now passes with
22 screenshots. Consequence: any other `sr-only` element placed directly
inside a ScrollArea without a positioned ancestor will behave the same; the
checklist was the only instance found in this window.

