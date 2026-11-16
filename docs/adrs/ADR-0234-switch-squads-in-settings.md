# ADR-0234: Switch Squads in Settings, reached from the account menu

Status: Accepted
Date: 2026-11-16
Supersedes: the sidebar placement in ADR-0221 (its "no window-wide strip" and
"only when there is a choice" rules stand)

## Context

ADR-0193 binds every Squad data path to a verified owner: a personal Squad
(issuer plus subject) or an existing Autohand team (issuer plus account ID).
Changing owner is not a view filter. The broker revokes the current context,
drains the old worker, verifies the new owner and publishes a new generation;
the browser then reloads into a fresh JavaScript realm for that owner
(`OwnershipBootstrap` shows "Finishing background work…" while it drains).

ADR-0221 moved the personal/team choice out of a window-wide strip and into
the sidebar header, as a "Personal Squad ⌄" popover beside the "Local ⌄"
workspace switcher, shown only when the account has a team. The owner used
it and found it confusing. Two quiet chevron menus side by side in the
header read as the same kind of thing, but they are not: "Local ⌄" picks
which computer runs the members you are looking at and is instant and
reversible; "Personal Squad ⌄" replaces the whole app with another owner's
members, conversations and data, through a drain and a reload. Nothing in a
one-line popover said so, and the sidebar header is the place people glance
at most, not the place for a choice made rarely and with consequences.

## Decision

- The sidebar no longer has a Squad switcher. `App.jsx` renders only the
  workspace switcher there, plus `SquadSyncNotice`: the one muted line for a
  backup sync failure that used to ride along with the switcher, because that
  is a fact the person should still see.
- Settings has a **Squads** section (`/settings/squads`, second in the list,
  after Onboarding; `src/components/settings/SquadsSettings.jsx`). It lists
  every Squad the account belongs to, personal first, each with one quiet
  line ("Personal · Your own members and data", "Team · Owner",
  "Team · Read only"), marks the current one "Current" and offers "Switch" on
  the others. One sentence explains what switching does: each Squad has its
  own members, conversations and data, and switching opens the one you
  choose. While it switches, the row says "Switching…" and a status line says
  background work is finishing first. With one Squad the section still
  exists and says teams appear here.
- Switching reuses the existing flow, now exported from
  `SquadOwnerSwitcher.jsx` as `switchSquadOwner(context, item)`:
  `POST /api/ownership/select` with the expected generation, then
  `location.replace('/squad')`. `useSquadOwners(context)` is the shared
  owners lookup. Nothing about draining, verification or the realm reload
  changed.
- The account menu (the gear at the bottom of the sidebar) gains
  "Switch Squad…" right after Settings, opening Settings › Squads, and names
  the current Squad quietly under the email ("Personal Squad",
  "Acme · Team Squad"). Both appear only when the account belongs to more
  than one Squad, so a person with only a personal Squad sees no ownership
  wording at rest (as in ADR-0221).
- "Local ⌄" is unchanged; it was never part of the Squad switcher component.
- `SquadOwnerSwitcher` itself stays for the two pages that stand outside the
  app shell, the read-only team page (`OwnedSquadView`) and the
  restore-complete page in `OwnershipBootstrap`. Settings is not reachable
  from either, and a person must still be able to leave them.

## Evidence

`node scripts/check-owner-switcher-browser.mjs` (rewritten for this
placement) boots an isolated ownership broker with a fixture identity, twice:

- personal only: no `Choose personal or team Squad` control anywhere, nothing
  ownership-related in the top 64px, the sidebar does not name the Squad, the
  workspace switcher is present; the account menu has no "Switch Squad…" and
  no Squad line; `/settings/squads` lists one row, Personal Squad, Current.
- personal plus team "Acme" (seeded with its own member, Tom): the same
  sidebar assertions; the account menu header reads "Personal Squad" and
  "Switch Squad…" sits directly after Settings; choosing it lands on
  `/settings/squads` with Personal Squad current and Acme offering Switch;
  Switch moves the broker to `team:acme` in state `ready`, and the page
  reloads to `/squad` showing Tom and not Eva; the menu then reads
  "Acme · Team Squad" and Settings › Squads marks Acme current.

No JavaScript errors in either run. Light and dark screenshots were taken of
the account menu and the Settings section. `bun run build`, `check:jsx`,
`check:render`, `check:settings:browser` (which asserts the section list
matches `SETTINGS_SECTION_IDS`, now including `squads`) and
`check:shell-settings:browser` pass.

## Consequences

- Switching takes two steps (gear, Switch Squad…, then Switch) instead of
  one popover. That is deliberate for a rare, heavy action, but a person who
  moves between a personal and a team Squad many times a day pays for it.
  No keyboard shortcut was added.
- The sidebar no longer tells a team member which Squad they are in at a
  glance; that now lives in the account menu header and Settings. The
  member directory still shows ownership where members are created.
- There is no confirmation before Switch. The reload preserves each owner's
  drafts in its own namespace, so nothing is lost, but an accidental click
  still costs a drain and a reload.
- The owners list is fetched by each mounted account menu and by Settings ›
  Squads (one GET each per context generation); it is not shared or cached.
- Quick Chat still has no Squad switcher, and the read-only and restore pages
  keep the old popover; their look was not revisited.
- Not verified in the packaged macOS app; the browser check covers the
  layout and the switch against the real broker, not the native shell.
