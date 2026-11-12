# ADR-0213: Keep account destinations in the existing Settings and native shell

## Context and evidence

The account menu exposed Analytics separately, while `/settings/analytics`
rendered a standalone page without the Settings section list or Back control.
The owner requested Inbox, Settings, About, then Licenses and agreements, with
Memory and Analytics inside Settings. Memory already had a Settings section;
its separate knowledge browser remains useful and is not a duplicate preference
page.

The overlay titlebar already marked its empty regions for Tauri dragging. In
Tauri 2.11.6, `window/scripts/drag.js` invokes
`plugin:window|internal_toggle_maximize` on double-click. The local bridge ACL
allowed `allow-toggle-maximize`, but omitted `allow-internal-toggle-maximize`.
The default capability covers bundled content, not this remote loopback page.
Adding another mouse handler would conceal the missing permission and risk
handling a gesture twice.

## Decision

Use the existing attention destination for Inbox and the existing About/license
document navigation. Render Analytics in the shared Settings shell; canonicalize
old `/usage` links to `/settings/analytics`. Preserve Settings return state and
unsent drafts. Remove the now-unused account Analytics callback chain.

Allow Tauri's internal maximize command for the same narrowly configured bridge
origins and windows that can already drag, minimize and maximize. Retain its
built-in exclusion of interactive controls; add no global pointer listeners.

## Verification

- `bun run check:shell-settings:browser` runs against the production bundle and
  a private owned bridge at desktop and phone widths. It checks menu order,
  Analytics/Memory sections, legacy links, readable licenses, no horizontal
  overflow, and the retained unsent draft after Back.
- A separately identified, ad-hoc native preview used an isolated fixture home
  and current web bundle. Cua recorded its frame changing from 1280 by 841 to
  1728 by 1021 after a titlebar double-click, then returning to 1280 by 841.
  Background delivery did not restore the second gesture; foreground delivery
  did. The installed app and its active data were not replaced or stopped.

## Consequences and limits

Account navigation has one Settings contract and existing links keep working.
The small window permission change restores Tauri's zoom toggle; it does not
implement every macOS preference for titlebar double-click (Fill, Minimize or
Do nothing). The native preview proves that gesture in this environment, not a
new notarized release or full installed runtime readiness. The browser's license
navigation is same-tab; the existing desktop interceptor owns separate native
document windows. Memory's knowledge browser remains in the main navigation.

## Follow-up

ADR-0215 extends the zoom-only correction with native preference handling. It
retains this record of the missing-permission cause and the initial proof limit.
