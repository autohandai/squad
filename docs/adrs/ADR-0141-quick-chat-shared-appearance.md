# ADR-0141: Quick Chat follows shared appearance preferences

Date: 2026-10-22. Status: Accepted; two-window browser proof, native observation unavailable.

## Context and evidence

The screenshot shows a dark Quick Chat above a light main window. Quick Chat
uses the same app and design tokens but stays alive while hidden. The app
read skin/theme only on mount and persisted local state; it did not subscribe
to changes another window saved.

`node scripts/check-quick-chat-theme.mjs` opens two real app documents in a
disposable shared browser profile. Initially both use Soft/light. Saving
Grut/dark from the other document fails the assertion “already-open Quick
Chat follows grut/dark”. This reproduces stale preferences without changing
the native window's colour or inventing another theme implementation.

The corrected check passes live changes through Grut/dark, Default/light
and Soft/light. Computed background and corner tokens match the main window;
the document identity and unsent draft stay unchanged. The final check uses
the native popover's 380×520 content size. Native Computer Use could not
connect ("Sky Computer Use native pipe startup failed"); that observation
failure is not an installed-app check. The desktop shell compiles separately.

## Decision

Read shared appearance preferences on storage events and on window focus or
becoming visible. Update the existing theme/skin state only when it differs.
The existing token effect applies the entire skin: palette, corners, density
and avatars. There is no Quick Chat override or native-window palette.

Keep the document mounted. Do not navigate, recreate the window or reset
conversation state to refresh appearance.

## Consequences and limits

- Changes reach open windows immediately through storage events; showing a
  hidden window also repairs stale state. Identical values do not trigger
  repeated state updates or cross-window write loops.
- System light/dark changes continue through the existing media-query
  listener. Skins that intentionally choose a surface keep that contract.
- Browser checks compare computed tokens and skin/surface attributes while
  checking the document identity and unsent draft remain unchanged. A source
  browser check does not establish an installed native release.

## Amendment, 2026-10-23: the shell signals when the popover is shown

The screenshot was reported again from installed 0.1.8, built 2026-10-21,
before this fix existed. Recovery on show still depended on the webview
delivering `focus` or `visibilitychange` to an always-on-top popover that was
hidden and shown again. Nobody has observed that in the native shell. The
shell now dispatches `squad:popup-shown` into the page each time it shows
Quick Chat, and the app re-reads appearance on that event too.

What was checked: `bun run desktop:check` compiles the shell, and
`check-quick-chat-theme.mjs` passes. A browser control that blocked storage,
focus and visibility events still saw Quick Chat update without the new
event, by a path that was not identified. So the browser check cannot show
that the signal is needed, and the native popover is still unobserved.
