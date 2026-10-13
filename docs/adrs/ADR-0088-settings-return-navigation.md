# ADR-0088: Return from Settings to its originating screen

Date: 2026-10-13

## Context

Opening Settings always pushed an empty browser-history entry and rendered a
page with no return action. The app had no record of which member, profile,
work filter or workspace link led there. A member’s unsent prompt was owned by
the Conversation component, so replacing that component with Settings also
discarded the draft.

The browser regression reached Settings from a member chat and failed because
an explicit Back control was absent. Returning to a guessed active member
would not restore a work page, directory filter or profile.

## Decision

Capture the same-app originating path, query and fragment when navigation
enters Settings. Keep the snapshot in the Settings history entry and in
window-scoped session storage so section/hash entries and a reload retain it.
Further Settings navigation keeps the first origin. A Back arrow in the page
header restores that route; a direct link without an origin returns to Squad.
Replace the Settings entry on return so browser Back does not immediately
reopen it.

Lift member-chat drafts to App state so Settings cannot erase them by
unmounting Conversation. The Settings snapshot carries text drafts for
restoration after reload; it is cleared on return or deliberate navigation
away. Validate restored paths and member-ID/text pairs. This does not put new
draft data in the already quota-constrained persistent local-storage cache.

## Evidence

`node scripts/check-account-settings-browser.mjs` opens Settings through
pointer, keyboard and the native-menu DOM action. It verifies return to the
exact member route including workspace, the unsent draft, section/hash changes,
reload, directory/work/profile routes and the safe direct-link fallback.
Fresh-document tokens distinguish a completed reload from the old page still
being visible while navigation starts. An isolated bridge prevents these
checks from touching the user’s history or invoking a provider.

## Consequences

- Back has a known destination rather than guessing or walking an arbitrary
  number of history entries that may include Settings sections.
- Member-chat drafts survive the Settings detour. Existing drafts outside
  Settings remain in app memory; this is not a general persistent-draft system.
- Route parameters/fragments are restored. Arbitrary component-local UI state,
  editor changes, channel drafts and exact scroll offsets are not serialized
  by this change.
- If session storage is unavailable, current app state and the history entry
  still support ordinary return. Losing both snapshots falls back to Squad.
- These checks cover local navigation and UI behavior, not external settings
  actions or a published release.
