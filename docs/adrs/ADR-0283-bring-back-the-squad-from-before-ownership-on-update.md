# ADR-0283: Bring back the squad from before account ownership on update

Status: accepted, 2026-11-26. Amends ADR-0196 (manual recovery only).

## Context

Reported by the owner for Daniel's Mac: after updating, Squad lost the CST
team and ran setup again. The old members were still in
`~/.autohand/squad/web-state`.

What the code does, read from the source and reproduced in
`scripts/check-legacy-auto-import.mjs`:

- Before 0.1.22 the installed app ran `server.mjs` directly. The daemon set
  `AUTOHAND_SQUAD_HOME=~/.autohand/squad` (channels.json, team.json,
  browser-state.json, chats/, attachments/) and
  `AUTOHAND_SQUAD_APP_STATE_DIR=~/.autohand/squad/web-state` (agents/<id>/
  profile.json, memory/, skills/) (`daemon/src/cli.rs`).
- From 0.1.22 (ADR-0193) the ownership broker runs `server.mjs` against an
  account dataset, `~/.autohand/squad/owners/<owner-key>/datasets/<id>/{state,app}`.
  On the first sign-in `ensureDataset` publishes an empty dataset
  (`server/ownership/datasets.mjs`). Nothing reads the old roots.
- Setup (`server/onboarding.mjs`) tells a new installation from an existing one
  by the dataset's own `channels.json` and `web-status.json`. The dataset was
  empty, so it said `new` and the app opened setup.
- ADR-0196 had decided that unowned data comes back only through Settings ›
  Backups › Recover older unowned data, because a sign-in can't prove who owns
  the old files. In practice nobody updating from 0.1.21 knew that page
  existed; they saw their squad gone. The owner reversed the decision for
  this case.

## Decision

`server/ownership/legacy-auto-import.mjs` decides; the broker acts in
`activate`, before the window is told the Squad is ready. While it runs, the
context says `loading`, so the window shows Squad starting, never setup.

- **Import automatically** when all of these hold:
  - the signed-in owner is the personal account, not a team;
  - it can write;
  - its current dataset was never set up: no `onboarding.json`, no channels,
    and no members other than the built-in designer (setup's own test);
  - the old roots hold at least one member that isn't removed;
  - no `legacy-import.json` marker exists in the service root. The marker is
    once per computer, 0600, and records the account, both dataset ids, the
    counts and what was left out.
- **The copy is ADR-0196's**, unchanged: `prepareLegacyRecovery` makes a
  passive, verified copy (credentials, sessions, runtime config, symlinks and
  removed members excluded). It then goes through the same journalled restore
  transaction as a backup restore: drain, staged dataset, publication,
  members paused. The broker acknowledges the restart itself, since the person
  never asked for an import screen. The operation journal and the marker are
  the record; the broker log says what happened.
- **The window says so:** "Brought back your squad from before the update: N
  members, M chats. Your earlier files are untouched. Members start paused
  until you look them over." It also has:
  - "What was left out", listing the exclusions and pointing to Settings ›
    Backups;
  - Undo, which republishes the empty dataset and keeps the imported one on
    disk;
  - Done, which hides the notice for good.
- **Otherwise offer it, never import:**
  - a second account on the same computer;
  - a team Squad;
  - a Squad already set up again (Daniel's state today);
  - an automatic copy that failed.

  The same line shows the old member names and "Bring back your earlier
  squad", which opens Settings › Backups with the old folders filled in. Old
  members already in the dataset aren't offered, so a Mac that was recovered
  by hand sees nothing. "Not now" is remembered per account.

## Consequences

- An updated Mac with a blank Squad gets its squad back with no action, and
  the old files are never changed. The check hashes every file before and
  after.
- It trusts that the person signed in on that Mac owns the unowned files.
  ADR-0196 refused that assumption. It is limited to the personal account,
  the first time, on a Squad with nothing in it, so a team Squad or a second
  person's account never receives someone else's data unasked.
- Daniel already ran setup again, so his Squad is not blank. He gets the
  offer, not the automatic import. Bringing it back through the offer
  replaces the Squad he set up, as any restore does, behind the existing
  preview and confirmation.
- Work folders aren't copied: members keep their old workspace paths as
  references, which ADR-0196 also does without a chosen work root. Browser-only
  data from very old versions is not read automatically; the manual page can
  still include it.
- A crash mid-import leaves the marker at `importing`. The next start offers
  instead of importing again, and the journal finishes or reports the
  half-done operation as before.

Evidence:

- `node scripts/check-legacy-auto-import.mjs` drives the real broker with a
  fixture identity and worker. It covers:
  - Daniel's fixture imports 3 members, the CST channel, the chat, team and
    member memory, all paused, with no credentials and no removed member;
  - the originals are byte-identical;
  - the marker is 0600;
  - there is no second import, and the notice persists until Done;
  - Undo returns to the empty dataset and keeps the imported one;
  - a second account gets the offer, and dismissing it sticks;
  - a Squad that was set up gets the offer and isn't replaced;
  - a hard-linked old file makes the copy fail: setup stays, the offer
    explains, and the marker says failed.
- `node scripts/check-legacy-auto-import-browser.mjs` runs the real
  `server.mjs`. The notice replaces setup with the members in place,
  "What was left out" lists the exclusions, and Done sticks. A colleague sees
  the offer during setup, and it opens Settings › Backups with
  `~/.autohand/squad` and `web-state` filled in.
- The browser check's first runs failed twice on a real race. The context said
  `ready` between `recoverOperations` and the scan. The window and the test both
  moved on, and the closing broker cancelled the copy ("The account or selected
  Squad changed"). The whole check now runs under `loading`.
