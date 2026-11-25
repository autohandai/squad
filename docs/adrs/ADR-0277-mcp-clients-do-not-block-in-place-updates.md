# ADR-0277: Other apps using Squad's MCP server no longer block Install and restart

Status: accepted, 2026-11-25
Amends: ADR-0130 (in-app downloads; on macOS Install and restart swaps the app)

## Context

The owner, on 0.1.22 with 0.1.23 published: "the auto updater is broken in
this new release, i can't upgrade to the new version like i used to." On
5 November, 0.1.21 had installed in place (`web-state/updates/operation.json`:
`"phase":"complete"`, `"message":"Updated to 0.1.21."`).

What was checked, in order, and what each showed:

- **Discovery was fine.** `~/.autohand/squad/update.json`, written by the
  installed daemon every minute: `updateAvailable: true`,
  `latestAllowedVersion: 0.1.23`, source `squad-api`, download
  `autohand-squad-0.1.23-macos-arm64.dmg` with sha256 `c8a4638d…`.
- **Download and verification were fine.** `upgradeDesktop()` run against
  that snapshot, without opening anything, fetched 278,095,653 bytes and
  verified them; the sha256 matches `checksums-desktop-darwin-arm64.txt` on
  the release.
- **The bundle was fine.** `validateMacBundle()` on the mounted 0.1.23 DMG
  against the installed app: valid. Both are signed `Developer ID
  Application: Autohand AI Limited (J59GX2DRN2)`.
- **The in-place path was never taken.** The owner's attempt today is in the
  dataset's `app/updates/operation.json`: `"plan": null`,
  `"installMode": "installer"`, phase `installer-open`. Squad had opened the
  DMG instead of offering Install and restart. That happens when
  `macUpdateCapability()` returns null, and it returns null without saying why.
- **Why it returned null.** The same function, run on this Mac with each
  `return null` instrumented, stopped at the guard that refuses when any
  process running from `Autohand Squad.app/Contents/MacOS/` is not Squad's own
  (not the native app, the bridge, the daemon or analytics, or a descendant).
  Two such processes were running:

      10796 (parent 9840, Autohand Desktop)
        …/Autohand Squad.app/Contents/MacOS/node
        …/Contents/Resources/runtime/server/control-plane/mcp-server.mjs --bridge http://127.0.0.1:19821
      11446 (parent 10702, Autohand Desktop (Dev), a worktree build)
        same command

  Autohand Desktop uses Squad's control-plane MCP server and starts it with
  Squad's bundled node. Where that registration is written lives in the
  Autohand Desktop code, not this repository; it was not traced. From
  Squad's side the result is the same for any app that uses one of its stdio
  MCP servers: while that app runs, Squad can never update in place, and the
  only sign is that the DMG opens instead.

The guard exists so the bundle is never swapped under an unknown process.
These processes are not unknown: the bundle's own node running Squad's own
MCP server script, which loads its modules once (static imports only) and
reaches the bridge over HTTP. The swap is an atomic `renameatx_np`
`RENAME_SWAP` of the two bundle directories (`src-tauri/src/update_swap.rs`),
so a running process keeps the files it has open.

## Decision

`macUpdateCapability()` and the pre-swap check in `stopOwnedUpdateServices()`
both let through a process outside Squad's tree when its command line is
exactly `<app>/Contents/MacOS/node <app>/Contents/Resources/runtime/server/<dir>/mcp-server.mjs …`
(`isExternalMcpClient()`; the directory part is lower-case words only, so
`..` cannot pass). Any other process from the bundle still blocks, and the
native app, bridge and services are stopped as before. External MCP clients
are left running; they are another app's children and Squad does not stop
them.

When in-place install is refused, the bridge now logs the reason
(`[updates] Install and restart is unavailable, …`) with the pid and path
that blocked it, so the next cause is a line in `web-server.log` rather than a
day's digging.

## Evidence

- On this Mac, with both Autohand Desktop MCP clients running,
  `macUpdateCapability()` from the lane returns the app, the native pid 865
  and the daemon and analytics services; the shipped code returns null.
- `scripts/check-mac-update.mjs` gains a fixture with real processes: a
  hard-linked node as the fixture bundle's `node` and `autohand-squad`, and
  processes started through a shell that exits, so they belong to launchd
  like another app's children. An external `control-plane/mcp-server.mjs`
  client leaves Install and restart available and survives the pre-swap
  check; a bundle `node` running any other script makes the capability null
  and the pre-swap check refuse. With the old `mac-update.mjs` the check fails
  with "an external MCP client must not block Install and restart".
- `check:desktop-updates`, `check:update-flow`, `check:automatic-updates`
  pass unchanged.

### Learnt on the way

The first version of the fixture started its processes as children of the
check itself. The capability code counts its caller as the bridge, so those
processes looked like Squad's own and the fixture passed against the old code
too. A test of "a process that is not ours" has to make one that really is
not.

## Consequences

- The fix is in the bridge that runs the update, so it only helps updates
  started from a release that carries it. **0.1.22 and 0.1.23 keep the old
  guard**: to update from them in place, quit every app that uses Squad's MCP
  server (here Autohand Desktop and its Dev build) and start the update again,
  or install from the DMG Squad opens.
- An external MCP client keeps running the old version's code from the
  previous bundle (kept beside the new one) until its host restarts it. It
  talks to the new bridge over HTTP; a tool that changed shape between
  versions may answer with the old shape until then. Accepted over holding
  Squad back indefinitely.
- A client that lazily imports a module after the swap would load it from the
  new bundle. None of Squad's MCP servers does today; one that starts to
  should be checked against this.
- The refusal reason goes only to the log, not to the update screen.
- `check:mac-update` needs a native build (`SQUAD_UPDATE_NATIVE`) and is not
  in the CI chain; it was run locally against the main checkout's release
  build.
- Not verified end to end: an actual in-place 0.1.x → 0.1.y install with an
  external client running. That needs a release carrying this change.
