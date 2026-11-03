# ADR-0165: One workspace scan, and it stops on a stalled folder

Date: 2026-11-03
Status: Accepted.

## Context and evidence

The 0.1.16 release run and CI on `main` failed in the fallback browser
check (`check-model-fallbacks-browser`). Locally the same check failed at a
different step on almost every run: a model-routing reset or
`GET /api/channels` timed out after 10 and then 30 seconds, while `GET
/api/runs` answered in the same moment. The first explanation was load. The
Mac had a load average around 20 from unrelated work, and the dev bridge
compiles the 500 KB `App.jsx` on its main thread. Measuring disproved the
second part: compiling `App.jsx` held `/api/runs` for about 0.5 s, not 30.

A routes-from-memory-answer, routes-from-disk-hang pattern pointed at Node's
file thread pool (four threads by default). A run with
`UV_THREADPOOL_SIZE=64` passed the whole check; two runs with the default
pool failed, one of them exactly as CI does ("member tool receipt updates the
editor"). A tracer loaded into the bridge (`NODE_OPTIONS=--require`, counting
`fs/promises` calls in flight by path and caller) showed the pool's holders:
`readdir` of `~/Documents/ios_apps/Shoppa/Shoppa.xcodeproj` from
`listWorkspaces`, in flight for more than 80 seconds, with `channels.json`,
`cloud-sync.json`, `remotes.json` and the member files queued behind it.
`~/Documents` is synced by iCloud Drive, and its sync process (`bird`) was
busy; a read of a folder that is not on disk yet waits for it.

`listWorkspaces` scans the home folder (up to 6,000 folders, seven levels)
for the workspace picker. Every page load requests it, and feedback reports
call it too. Nothing was shared, so each navigation in the check started
another scan, and a few scans parked on iCloud folders took every file thread.
A person with Desktop and Documents in iCloud would see the same freeze: the
app stops loading channels, saving members and answering file routes for as
long as macOS takes to fetch the folder.

## Decision

1. **One scan at a time.** Requests that arrive while a scan runs share it
   (`sharedScan` in `server/workspace-scan.mjs`).
2. **A finished scan is reused for a minute.** Navigation no longer rescans.
   A failed scan is not reused; the next request scans again.
3. **A folder read that does not answer within two seconds ends the scan**
   with what it found (`readFolderWithin`, `FolderReadStalled`). The stalled
   read still holds its thread until macOS answers, so the scan stops rather
   than reading on and parking more threads; a stalled folder can hold at
   most one.

`scripts/check-workspace-scan.mjs` covers the stalled read, sharing, reuse,
expiry and retry with a fake folder read; it runs as part of `check:server`,
which CI and the release run. The fallback browser check now prints the
bridge's latest runs, both copies of the member and the member tool's last
responses when it fails, and `AUTOHAND_CHECK_TRACE=1` prints each wait it
starts and finishes, so a CI failure carries its own evidence.

## Consequences

- A repository created in the last minute can be missing from the picker
  until the minute is up; adding it by path works as before.
- A home folder whose scan meets a stalled iCloud folder lists only what was
  found before it. The scan order is unchanged (priority folders first), so
  the folders most people use are read early, but a project behind the
  stalled folder is not listed until a later scan gets past it.
- The scan still reads iCloud folders; it does not try to tell synced
  folders apart, which would need macOS file-provider APIs.
- This explains the local failures under load. Whether it is also what failed
  on GitHub's Linux runner is not proven: the runner has no iCloud, and its
  failure dump did not include bridge state. The dump does now.
