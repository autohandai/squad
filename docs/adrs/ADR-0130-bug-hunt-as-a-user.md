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

4. **A reply nobody is producing is closed, not left spinning.** Killing
   the bridge, then reloading the page mid-reply, showed what a person sees:
   a reply stuck at "Running local runtime… 1 min 37 sec" and counting,
   while `/api/runs` already said `stopped`. A chat turn ends on the bridge
   when its stream closes (`streamChat` aborts on `res.close`), and the
   browser's recovery only knew about bridge restarts. Now, on every presence
   poll, a `loading` reply is closed as interrupted when this page is not
   streaming it and the bridge reports the member with no live run
   (`recoverOrphanedChats`, 20 s grace).
5. **Retry answers the same question again.** It used to post the question
   a second time and leave the failed reply in place. The failed reply is now
   marked `superseded` and hidden, through the same `message.patch` event
   other windows already apply.
6. **Channel settings are a side sheet.** They run to about 1,070 px. A
   popover capped at 34rem hid Workflows, Repository, Export and Delete below
   a scroll with no visible cue.

7. **Member ids carry randomness.** Adding a four-person team kept one
   member. The ids were `asq_` + `Date.now()` in base 36, and the team
   builder drafts every member in one loop: all four landed in the same
   millisecond, shared an id, replaced each other in the list and were
   provisioned into one runtime folder. After the change, the next team's
   three ids were `asq_mv7dv2lb1bvz8271`, `asq_mv7dv2lb1g0bga3a` and
   `asq_mv7dv2lb137u2mby`: the same millisecond prefix, which is the
   evidence for the diagnosis, with distinct suffixes.

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
- Reloading the page still ends the member's turn on the bridge; this
  change only makes the page say so. Keeping the turn alive across a reload
  (as goals already do) needs the bridge to hold the reply until a page
  collects it. That was not built.
- The Autohand CLI in the throwaway home printed nothing for 25 s in
  `--mode rpc` and the chat failed after 180 s. That hang is in the CLI and
  was not diagnosed further. Squad now names the SDK's failure reason in the
  run and gives a next step in the timeout message, but still waits the full
  timeout on the CLI fallback.
- Teams added before this change lost their members for good; the lost
  members' choices are not recoverable from the shared folder.
- Other ids built from the time alone (channel threads, local notes) were
  left as they are: each is made once per action and includes another id, so
  a collision needs two actions in one millisecond.
- The checks that listed seed task ids (`check-inbox-browser`,
  `verify-work-profile-browser`, `verify-goals-browser`) still map over the
  seed arrays, which are now empty. `verify-channel-browser` no longer
  asserts the recovered channel exists.
