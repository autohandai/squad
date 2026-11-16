# ADR-0221: The personal/team Squad switcher lives in the sidebar, only when there is a choice

Status: Superseded in part by ADR-0234 (switching moved to Settings › Squads; the sidebar no longer has a Squad switcher)
Date: 2026-11-13

## Context

Owner-scoped Squads (da55919a) rendered `SquadOwnerPicker` from
`OwnershipBootstrap`, outside the app shell, as a bordered strip across the
whole window: "Squad · Personal Squad ▾ · Your personal members and data".
In the macOS app that strip sits in the titlebar band, so its "Squad" label
ran under the traffic lights, and it added a second switcher directly above
the sidebar's existing "Local ▾" workspace switcher. It rendered for every
signed-in person, including those with only a personal Squad, where there is
nothing to choose. The owner reported that it "destroys the look and feel".
DESIGN.md already asked for the selected Squad to be shown in the directory,
not as window chrome.

## Decision

- `OwnershipBootstrap` no longer renders any ownership strip. It provides the
  verified context through `SquadOwnershipContext`.
- `SquadOwnerSwitcher` (src/components/account/SquadOwnerSwitcher.jsx) is a
  quiet popover trigger in the sidebar header beside the workspace switcher,
  in the same style: owner label and chevron; the popover lists each Squad
  with "Your personal members and data" / "Team-owned members and data" and
  a Read only tag where it applies.
- With a single owner it renders nothing. A paused or read-only state still
  shows (as "· Work paused" / "· Read only"), and a backup sync failure still
  surfaces as one muted line, because those are facts, not choices.
- The read-only team page and the restore-complete page show the switcher at
  the top of their content (`alwaysShow`), so a person can still leave them.

## Evidence

`node scripts/check-owner-switcher-browser.mjs` boots an isolated ownership
broker with a fixture identity, twice: with only a personal Squad, no
ownership text or switcher exists anywhere and nothing ownership-related is
in the top 64px; with a personal Squad and a team, exactly one switcher
appears in the sidebar header (y≈56 in a browser, below the native inset in
the app) and its popover lists both. No JavaScript errors in either run.
Screenshots: `.codex-artifacts/ownership/owner-switcher-*.png`.
`npx vite build` succeeds.

## Consequences

- A person who belongs to a team discovers switching from the sidebar header,
  not a full-width bar; it is smaller and easier to miss. That is the trade
  for not occupying the titlebar of every window.
- Someone with only a personal Squad is no longer told "Your personal members
  and data" anywhere at rest; the label still appears in Settings and backups.
- Quick Chat shows no ownership switcher (as before).
- The popover inherits the shared `Popover` surface, which is slightly
  translucent over the sidebar; that is a separate, app-wide style question.
- Not verified in the packaged macOS app on this branch; the browser check
  covers layout, not the native titlebar inset.
