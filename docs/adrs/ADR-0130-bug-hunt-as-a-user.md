# ADR-0130: A bug hunt as a user, and what it changed about seeds and frames

Status: accepted, 2026-10-14

## Context

Autohand Squad was used as a new person would use it: a fresh state
directory, the Autohand sign-in, then each surface in turn, driven through a
real Chrome over the DevTools protocol against a throwaway bridge. Every bug
found is in `docs/reports/bughunt-2026-10.md` with what was seen, the cause
and the fix. This record covers the judgements in that list that someone
could reasonably have made differently.

What a fresh install showed before any change (screenshots
`01-first.png`–`04.png` in the session scratchpad, reproduced by deleting the
state directory and opening the app):

- A channel `clients-pie-shop-nz` with eight messages and a workspace at
  `/Users/igorcosta/Documents/autohand/demo/pieshop`. It was a one-off
  recovery of the developer's own channel (`RECOVERED_CHANNELS` in
  `src/App.jsx`), merged into every browser on every load.
- "4 members · 1 working", each member listing current work from
  `dark-web-cli`, a project on one machine, dated May 2026. `src/data.js`
  carried nine absolute `/Users/igorcosta/…` paths, ten fabricated tasks (one
  `running`), a pending memory proposal and an active automation with a
  made-up last run.
- "Needs you 3" before the person had done anything.
- The member page's activity calendar showed a busy year for a member made a
  minute earlier: `buildActivity()` returned the same repeating pattern for
  everyone, under month labels hard-coded "May … May".

Deleting `#general` lasted until the next reload, because the merge re-added
any seed channel missing from the saved list. Seed tasks and memory came back
the same way.

## Decision

1. **Seeds are a first-run default and carry nothing personal.** The four
   starting members and the two channels stay, because a squad with members
   to talk to is the product's first screen. They have no folder, no project,
   no activity and no fabricated memory, and they are dated when this install
   first loads them. There are no seed tasks, memory proposals or
   automations. Once channels have been saved, the saved list is taken as it
   is, so a deleted seed stays deleted.
2. **Activity is computed, not illustrated.** `src/lib/activity-calendar.js`
   builds the calendar from the member's own runs and tasks: 41 weeks ending
   today, levels relative to the busiest day, month labels from the dates.
   "Active days" in Work Record comes from the same calendar.
3. **The member page follows DESIGN.md.** The brain card, ID card, Work
   Record, Memory & Growth, every `Metric` and every `EmptyBlock` drew a
   border and a fill, often nested three deep. They now sit under one
   divider each. Metrics are a value over a label. Empty states have no
   frame. The permission ladder is a stepped line rather than six tiles.

## Consequences

- Installs that already saved the pie-shop channel, the seed tasks or the
  seed memory keep them: nothing is deleted from saved state. Only the
  re-adding stops.
- A new person no longer sees what a busy squad looks like until they use
  it. That was the point of the fabricated data, and it is traded away
  knowingly: showing work that never happened is worse than an empty list.
- `Metric` and `EmptyBlock` are shared, so every page that uses them loses
  its frames at once. That was checked on the member page only; other pages
  were not re-screenshotted for this change.
- The checks that listed seed task ids (`check-inbox-browser`,
  `verify-work-profile-browser`, `verify-goals-browser`) still map over the
  seed arrays, which are now empty. `verify-channel-browser` no longer
  asserts the recovered channel exists.
