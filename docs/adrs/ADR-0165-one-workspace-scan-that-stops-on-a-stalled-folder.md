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

## Addendum, 18 November 2026: a parked read also stopped the bridge from exiting

**What was seen.** After the checks lane merged, `check:team:browser`,
`check:natural-automations:browser` and `check:onboarding:browser` failed on
this Mac every time, alone, with nothing else running: the restarted bridge
refused to start with "A previous private Squad process has not finished".
The same checks had passed in the lane hours earlier.

**What it was, step by step, with what showed each step.**

1. Timing `stop()` in `scripts/lib/reliability-browser.mjs` showed the broker
   took 10,055 ms to exit after SIGTERM, which is the broker's
   `terminationGraceMs`, so it was waiting for its worker. The check gives a
   bridge 2 s and then SIGKILLs the broker, which orphaned the worker; the next
   broker found the orphan in its worker ledger and correctly refused to start.
2. Timestamps in the worker's `stopAndExitFromSignal` showed every step
   (memory, cloud, runs, engines) done in under 1 ms and the `exit` event
   firing the same millisecond SIGTERM arrived. Yet the process stayed.
3. `sample` of the stuck worker: the main thread was in
   `node::DefaultProcessExitHandlerInternal → uv__threadpool_cleanup →
   uv_thread_join`, and the one busy libuv worker was in
   `uv__fs_work → scandir → __opendir2 → open`. `process.exit()` joins every
   file thread, and one was parked in the kernel opening a folder.
4. A scan of the home folder with a 2 s limit stalled on
   `/Users/igorcosta/Desktop` after three folders, and `ls ~/Desktop` from a
   shell also hung. The owner had just signed in to their Apple account; a
   few minutes later `ls ~/Desktop` answered (279 entries) and all three
   checks passed unchanged. Whether it was a pending privacy prompt or
   iCloud Drive syncing Desktop was not established.

So the decision above was incomplete: "a stalled folder can hold at most one
thread" is true, but one parked thread is enough to keep the process from
ever exiting. The shipped app has the same hang: quitting Squad waits the
broker's 10 s and then force-kills the worker.

**Decision.**

- The home scan does not open `Desktop`, `Documents` or `Downloads` at the
  top of the home folder (`isProtectedHomeFolder`). These are the folders
  macOS guards with a privacy prompt and iCloud Drive may sync, so a read can
  wait with no limit. Folders with those names deeper down are still read.
- `readFolderWithin` counts reads that outlived their wait and are still in
  flight (`parkedFolderReads`). The worker's shutdown, after every save and
  drain has finished, ends itself with SIGKILL while that count is above
  zero, instead of calling a `process.exit()` that cannot return.
- Check bridges keep the real `HOME`. Giving `startBridge` an empty `HOME`
  was tried and reverted: `check:team:browser`,
  `check:natural-automations:browser` and `check:onboarding:browser` use the
  repository as a workspace, and the bridge only accepts workspaces inside the
  user directory ("workspace must be a folder inside the user directory"), so
  all three failed. With the two rules above the bridge no longer opens the
  protected folders and exits even with a parked read, which is what the
  checks needed.

`scripts/check-workspace-scan.mjs` (part of `check:server`) now proves the
counter, the protected folders, and the exit rule against a real kernel
block: a FIFO with no writer parks `open()` the same way. Plain
`process.exit()` in that state is shown to hang (killed after 3 s), and with
the rule the process ends at once.

**Consequences.**

- Projects kept directly in `~/Desktop`, `~/Documents` or `~/Downloads` no
  longer appear in the workspace picker by themselves; they are added with
  Add folder (ADR-0186). `Documents` stays in the priority list, which now
  only matters for a `Documents` folder below the top level.
- A worker that exits with a parked read ends with SIGKILL, not exit code 0.
  The broker treats both as exited; nothing is unsaved at that point, but a
  log reader sees a killed process.
- Other places that read folders (`server.mjs` workspace walk under a chosen
  folder, project observers) are not covered by the counter. A parked read
  there can still hold the exit until the broker's 10 s.
- Check bridges still scan the person's home folder (outside the protected
  folders). Isolating it needs the workspace rule to accept a fixture
  directory first.
