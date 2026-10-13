# ADR-0064: Upgrade from the official repository through the local bridge

Date: 2026-10-01
Status: Accepted

## Context

The owner asked for Check for upgrades to use our repository and let users
upgrade. The existing daemon already checked GitHub Releases, but the web
bridge swallowed refresh failures and retained the old snapshot. The Settings
panel displayed “You're up to date” even with no snapshot and offered an
external download anchor rather than an installation flow. A link in an
embedded webview does not establish that a native installer was downloaded,
verified or opened.

Source inspection identified `/api/updates` and `SettingsUpdatesPanel` as
those gaps. The daemon's selected native installer now carries its asset
name and published SHA256 checksum as well as its URL. Standalone daemon and
tray executables are not desktop installers.

## Decision

The follow-up request replaces the permanent account-menu check with a
contextual notice above the account footer. It appears only after a successful
official-repository check reports a newer compatible release. Download uses
the same verified installer action; errors and progress stay beside it.
Manual checks remain in the native menu, About, and Settings. The previous
footer label and account-menu decision described below are superseded.

Use `autohandai/squad` GitHub Releases as the upgrade source. The existing
daemon owns release discovery and platform selection; the local bridge owns
the explicit Upgrade action. The client supplies no download URL, destination
or process command.

The upgrade POST uses the bridge's existing same-origin guard and refreshes
the daemon snapshot before downloading. A failed refresh, offline daemon,
missing checksum, incompatible installer, unrecognized source or nonofficial
asset URL blocks the action. A cached available snapshot is useful as context
but never authorizes installation. Checks are reported as never checked,
offline, failed, current or available; checking does not claim success.

Stream the download to a private temporary directory under the application's
`updates` folder, bounded to 1 GiB and five minutes. Allow GitHub's official
asset CDN redirects, compare SHA256, and rename the verified file into place
on the same filesystem. Only then request the platform's installer opener.
Use fixed executable names and argument arrays without a shell. macOS and
Linux opener exit failures are reported; Windows launches the installer or
MSI wizard. A second simultaneous upgrade request is rejected.

Open the official releases page through a fixed local bridge action too,
rather than depending on a webview's new-window handling.

## Consequences

- Upgrade is a usable native flow: check, download, verify, open, then clear
  instructions to finish installation and reopen Squad.
- The running bundle is never overwritten and ongoing work is never
  silently restarted. The human chooses when to finish installation.
- Verification protects against incomplete or changed downloads and checks
  provenance against the official repository. It is checksum verification,
  not a new signing or automatic update framework.
- Releases without a compatible checksummed installer remain downloadable
  through the releases page, but the app cannot perform their upgrade.
- Linux AppImage fallback opens the verified file's folder and asks the human
  to replace their current AppImage after finishing work; it does not launch
  another instance as a supposed installer.
- Verified downloads are retained so an opener failure can name a file to
  open manually. Temporary partial downloads are removed; retention or cleanup
  of older verified installers is deliberately left for a separate policy.
- This still depends on the local daemon being running and its repository
  check succeeding. Offline cached results cannot bypass that boundary.

## Evidence

`node scripts/check-desktop-updates.mjs` passed 28 focused cases with mocked
downloads and process openers: official repository/name/checksum/platform
guards, successful atomic download, checksum mismatch, size limit, timeout,
redirect allowlist, stale snapshot refusal, failed/offline/never-checked/current
status and platform opener arguments. `node --check server.mjs` passed.
`bun run build` passed the JSX import check and production Vite build.

No live installer was downloaded or opened for these checks. They establish
bridge behavior and production compilation, not a completed installation
across macOS, Linux and Windows.

The browser harness subsequently passed all five update status states,
check/upgrade busy states, a mocked verified installer result, checksum
failure, retry and the native releases-page bridge action. It also caught
two interaction assumptions: clicking Upgrade while a check was still busy
was a test timing error; the footer's `/settings/updates` route really did
leave Appearance selected because the section parser only read the query.
The parser now accepts both path and query section routes, and the final
visual assertion proves Updates is visible near the top. The footer says
"Upgrade available", never "Restart to update" before an installer is opened.

The clean macOS build was installed and launched in Applications. Its live
`GET /api/updates?refresh=1` returned `fresh: true`, a reachable daemon,
`source: github:autohandai/squad`, stable 0.1.5, the Mac ARM64 DMG name and
published SHA256. The native Updates screen displayed this successful check.
The installed version equals the latest stable release, so no live upgrade
was offered or performed. Available-version downloads/openers remain covered
by mocks; other platforms were not installed here.

During local installation, copying over the old bundle's executable files
left its Node sidecar unable to execute (a signal exit in preflight). A
checksum/signature inspection alone was not sufficient runtime evidence.
The old services were stopped, the previous bundle moved aside, and the
fresh bundle copied into an empty destination. Its Node sidecar executed
`--version` successfully and the native app completed startup. Local builds
are development bundles; release signing/notarization was not performed.
