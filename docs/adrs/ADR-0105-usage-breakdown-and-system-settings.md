# ADR-0105: Usage ledger by member, model and day; Settings → System

Date: 2026-10-13. Lane L5 of `docs/superpowers/specs/2026-10-13-parity-lanes-design.md`.
Reference behaviour: xiryn's `turns` ledger (one row per turn, grouped by day,
model and agent in its Usage page) and its Settings → System counts.

## Context

The Usage page (`/usage`, `AnalyticsPanel`) already shows totals: records,
tokens, top harnesses, providers and models. It cannot answer "which member
spent the tokens", "which model" with provider, or "what happened on which
day". Settings has no section that says what the squad holds on this computer
or where that data lives, and the only way to stop unattended release checks
was to leave the app closed.

What the data path actually looks like on this machine was measured before
deciding where to compute anything:

- `~/.autohand/squad/telemetry.jsonl` is 59,556,931 bytes, 171,175 lines, of
  which 138 are `usage.recorded` (the rest are `device.registered`,
  `update.checked`, `feature_flags.checked`, `api.sync`, roughly 42,600 each).
  Every `usage.recorded` event carries `agentId`, `provider`, `model`,
  `durationMs`, `tokens`, `inputTokens`, `outputTokens`; none carried steps
  or a run id.
- `~/.autohand/squad/runs/` is empty. The bridge reads that folder but never
  writes it; live runs exist only in the bridge's memory and leave a
  telemetry event when they finish. The same work can therefore appear twice
  (a live run plus its telemetry twin) and the existing totals count both.
- `curl 127.0.0.1:19823/metrics` on the installed 0.1.6 app answers
  `"source":"analytics-daemon"`. `analyticsSnapshot()` returns that snapshot
  as-is whenever the Rust analytics daemon is up, and only falls back to its
  own reading of the files when it is not. Anything added to the fallback
  alone would never show in the installed app.
- Members are not on the bridge: `web-status.json` mirrors `{ id, name,
  role, status }` for each member from the browser.
- `channels.json` keeps `threads` (22) and `messages` (93) as top-level
  arrays beside `channels` (8); nothing is nested under a channel.
- Memory lives in two places under the member state folder
  (`<appStateDir>/agents/<id>/`): `profile/MEMORY.md`, a bullet list the
  bridge writes ("Durable context for this squad member:" then `- …` lines),
  and `memory/index.json` (`{ version, entries: [] }`, empty on every member
  here). `memory-inbox.json` holds proposals, not entries.
- The analytics page polls `/api/analytics` once a second.
- The Rust daemon runs its own `check_updates_response` inside its periodic
  sync cycle (`daemon/src/daemon.rs`), separate from the bridge's
  `GET /api/updates` and the browser's 30-minute `refreshUpdates(false)`.
  A cargo build is not possible in this lane (about 1.6 GiB of disk free).

## Decision

**Ledger on the bridge, attached to both analytics paths.**
`server/usage/ledger.mjs` is pure: it takes the usage records the bridge
already normalises from telemetry and run records, the members list from
`web-status.json`, and returns `byMember`, `byModel`, `byDay` rows
(`runs, inputTokens, outputTokens, totalTokens, steps, durationMs, lastAt`)
plus `ledgerWindowDays`, `ledgerSince`, `ledgerRecords`. `analyticsSnapshot`
in `server.mjs` computes it and spreads it into `usage` on the daemon
snapshot as well as the fallback, so the installed app and the dev bridge
show the same tables. Existing `usage` fields are untouched.

All three tables cover the last 30 days. Member and model tables could have
been all-time, but one window for the whole ledger reads as one ledger and
keeps the 59 MB file's older half out of every poll.

**Steps when known, otherwise "—".** `usageMetadata` now records `steps`
(the trace's tool calls) and `runId` on each `usage.recorded` event; rows
report `steps: null` until at least one record in the row carried them.
Existing events have neither, so the Steps column shows "—" for history and
fills in from this change forward.

**Dedupe by run id.** A run record whose id also appears on a telemetry
event is dropped from the ledger; the telemetry event carries the tokens.
The old totals (`totalRecords`, `totalTokens`) keep their behaviour.

**Cache keyed on inputs.** The ledger is recomputed only when
`telemetry.jsonl`'s size or mtime, the runs folder count, the live run set
or `web-status.json` changes. The check script shows two consecutive
`/api/analytics` calls hit the daemon stub twice and the ledger once.

**Settings → System** is a route plug-in (`server/routes/system.route.mjs`)
with pure modules under `server/system/`:

- `GET /api/system/summary`: members from `web-status.json` (falling back to
  member folders), channels, threads and messages from `readChannelsState()`
  (top-level arrays, with the older nested shape still counted), memory
  entries as `MEMORY.md` bullet lines plus `memory/index.json` entries across
  member folders (the bridge's own `observers` folder is skipped), the data
  folder and the member state folder.
- `GET/PUT /api/system/settings`: `{ autoCheckUpdates }` in
  `<squadStateDir>/settings.json`, atomic write, unknown keys preserved.
- `POST /api/system/reveal`: opens the data folder with a fixed opener per
  platform (`open`, `explorer.exe`, `xdg-open`); the request cannot name a
  path. The desktop shell's opener plugin already does this for "Open logs
  folder" in the tray, but it is not callable from the web app, so the bridge
  does it. Copy path sits beside it for a plain browser.
- `ctx.appStateDir` is added to the route context so a plug-in can find the
  member folders; `docs/integration/CONTRACT.md` records it.

**The switch gates unattended checks only.** `desktopUpdateStatus` takes
`autoCheck`; with it off and `refresh=false` it reports what `update.json`
holds and never asks the daemon to contact GitHub, answering
`autoCheck: false, skipped: true`. `refresh=1` (Check for upgrades in
Settings, the app menu, About, the tray) always runs. The browser reads
`autoCheck` off every answer and stops its 30-minute timer while it is off;
its first ask on mount still goes to the bridge, which skips, so no network
call happens either way.

**UI** follows the Settings contract: `UsageBreakdown` is three plain
`Table`s separated by dividers under the existing Usage cards, one sentence
when empty; `SystemSettings` is five count rows, a Data folder row with the
path, Copy path and Show in Finder, and one switch row. Both live in
`src/components/settings/`; `App.jsx` gains imports, the section id, the nav
entry, the mount and a ref-guarded timer.

## Evidence

`bun run check:usage-and-system` starts the real bridge in an isolated state
dir seeded with two members, two models, three UTC days, a run record with a
telemetry twin, a run record without one, a 45-day-old event, an unknown
member id, a thread for a missing channel, and member memory files. It
asserts the sums (Ava 800 tokens over 2 runs and 8 steps; Ben 1,190 over 3
runs; day totals 2,000; three day rows), that the unknown member shows its
id, that the same rows are attached when a stand-in `/metrics` server
answers as the analytics daemon, the summary counts (2 members, 2 channels,
3 threads, 5 messages, 7 memory entries), the settings round trip through
`settings.json`, and that a stand-in update daemon receives zero
`/updates/check` calls while the switch is off, one on a manual refresh and
one more once it is back on. Twelve checks pass. `bun run check:jsx` (126
files), `bun run check:desktop-updates` (28 cases), `bun run
check:bridge-imports` and `bun run build` pass.

## Consequences

- Left undone: cost estimates in currency (out of scope by the lane spec; the
  ledger carries the token counts a price table would need).
- Left undone: the Rust daemon's own periodic release check inside its sync
  loop still runs regardless of the switch; it writes `update.json` and a
  `update.checked` telemetry line but opens nothing and tells no one. Making
  it read `settings.json` needs a cargo build, which this lane could not run.
- Left undone: the analytics daemon's Rust snapshot does not compute the
  ledger itself; the bridge attaches it. If the bridge is down the daemon's
  `/metrics` has no breakdown, which is already the case for the whole Usage
  page.
- Steps are empty for all history and for CLI harness runs that report no
  trace; only SDK traces with tool calls fill the column.
- Memory entries count what the bridge writes into `MEMORY.md` as bullets
  and the CLI's `memory/index.json`; a member who writes prose into
  `MEMORY.md` is counted as zero entries for that document. Proposals in the
  memory inbox are not counted.
- "Show in Finder" opens the folder on the machine the bridge runs on. For a
  remote bridge that is the wrong machine; the path and Copy path remain.
- The ledger cache signature stats three files per `/api/analytics` call;
  that is three `stat` calls per second while the Usage page is open, in
  exchange for not parsing 59 MB per second.
- The UI was verified by the JSX import check and a production build, not by
  a headless browser run; the bridge behaviour the UI depends on is covered
  by the check script.
