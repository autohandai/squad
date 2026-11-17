# ADR-0237: team access survives brief account-service outages; old Squads larger than 8 MiB restore

Status: accepted. Amends ADR-0193 (account and team owned Squads) and
ADR-0196 (manual unowned data recovery).

## Context and evidence

On 2026-11-17 the owner switched to their team Squad, "Igor Costa's Team",
and could not get back, then saw an error screen instead of their Squad.
Their old members also had not come back.

What was observed:

- `https://api.autohand.ai/v1/accounts` and `/v1/profile` flapped between
  200 and `500 {"success":false,"error":"Internal server error"}`. Three
  calls in a row returned 500; a few minutes later 30 of 30 returned 200,
  and then 500s again.
- The broker rechecks team access every 15 seconds, at worker start and on
  each private request. Any failure, including a 500, called `block()`. The
  team Squad then stayed `blocked` ("The account service could not verify
  current access.") until someone pressed Retry, even after the service had
  recovered: the live context still said `blocked` minutes after the 200s
  returned.
- Personal Squads were not affected, because identity verification already
  falls back to a cached verification for transport failures.
- The read-only team page offered its way out only as the quiet switcher
  line at the top ("Igor Costa's Team · Read only ⌄"). Driving that switcher
  headlessly against the running app worked. What we could not show is
  whether the owner's attempt from the window hit a block that the next 500
  had just caused. Background accessibility clicks into the Tauri window
  were refused, so it was not reproduced in the window itself.
- Restoring the old Squad failed first with "A recovery record is unsafe or
  exceeds its limit." and then with "A saved Squad record exceeds its read
  limit.". The old `~/.autohand/squad/channels.json` is 8.77 MB, and three
  places assumed at most 8 MiB per file: the legacy reader, the owned
  repository reader and the restore writer. The portable format already
  admits `MAX_FILE_BYTES`.

## Decision

- A team rechecked within the last two minutes (`teamOutageGraceMs`, default
  120 s) keeps its verified access through a transport failure: 5xx, 429 or
  no network (`identity_transport_unavailable`). One helper, `recheckTeam`,
  serves all three recheck points.
- A definite answer still blocks at once: 401/403, a lost membership or a
  changed role or write access. The two-minute window is the longest a
  revoked team member can keep reading while the account service is down.
- A block caused by an outage retries `activate` every 15 s
  (`outageRetryMs`) without a Retry press, and clears once verification
  succeeds.
- The read-only team page shows "Open <writable Squad>" as a primary button
  beside Export.
- The legacy reader, the repository reader and the restore writer all use
  `MAX_FILE_BYTES` instead of 8 MiB, so what restore writes, Squad can read
  back.

## Evidence that it works

- `scripts/check-squad-ownership.mjs` now runs the fixture account service
  at 503 for a verified team. Inside the grace window requests still
  succeed. Past it the team blocks, then returns to `ready` by itself once
  the service answers. Run against the previous broker, it fails with "an
  outage inside the grace window does not block a verified team".
- `scripts/check-owner-switcher-browser.mjs` adds a read-only team scenario:
  the page shows "Open Personal Squad", and pressing it returns to the
  personal Squad.
- `scripts/check-legacy-recovery.mjs` seeds about 9.2 MiB of channel
  messages; it failed at each of the three caps in turn before they were
  raised.
- The owner's recovery preview then reported 18 members and 171 files, and
  the restore produced a Personal Squad listing 18 members.

## Consequences and limits

- For up to two minutes of an account-service outage, a team member whose
  access was revoked in that window keeps it. We traded this for not
  throwing people out of their team on one failed check.
- The broker still calls `/v1/accounts` on every private team request. That
  volume may be part of what the account service struggles with. It is left
  for a separate change.
- The account service's 500s themselves are not fixed here. They belong to
  the api.autohand.ai service.
- Why the window's own switcher appeared not to respond was not reproduced in
  the window itself.
- A 25 MiB file cap is the next ceiling. A Squad with more history in one
  `channels.json` will need the file split, not a higher cap.
