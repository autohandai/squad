# ADR-0247: a macOS grant held by an older build of Autohand Computer Use

Status: accepted. Amends ADR-0162 (Autohand Computer Use is the one component
across the CLI, Squad and Autohand Desktop). Regression check:
`scripts/check-computer-use-tcc.mjs` (`bun run check:computer-use-tcc`).

## Context and evidence

On 17 November 2026 the owner's Mac (macOS 27.2.1, build 26B131, Darwin
27.2.0) showed a member's Permissions › Computer Use as "Not allowed" with
the "Use the computer" switch disabled and the text "Allow Autohand Computer
Use in System Settings → Privacy & Security → Accessibility and Screen
Recording, then check again." System Settings, in the macOS 27 pane titled
"Device Control and Data Access", showed Autohand Computer Use.app switched
on. Repair and Check again changed nothing.

Everything below was run read-only on that Mac.

1. **Which copy Squad runs.** `ps` showed the installed Squad bridge
   (`/Applications/Autohand Squad.app/Contents/MacOS/node … server.mjs`) as
   parent of `~/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse mcp --driver-path ~/.local/bin/cua-driver`,
   started 23:11:28. So Squad was on the CLI-installed copy, as ADR-0162
   intends, with no `fallbackReason`.
2. **What that host reports.** Spawning the same command the way Squad does
   (`NativeComputerClient`, `check_permissions` with `prompt: false`)
   returned `accessibility: false`, `screen_recording: false`,
   `source.attribution: "host"`, `host_bundle_id: "ai.autohand.computer-use"`.
   A fresh process gave the same answer, so it was not a stale daemon.
3. **What macOS has stored.** In macOS 27 the per-user TCC database is gone
   (`~/Library/Application Support/com.apple.TCC` does not exist); rows live
   in `/Library/Application Support/com.apple.TCC/TCC.db`. For
   `ai.autohand.computer-use` it had `kTCCServiceAccessibility` and
   `kTCCServiceScreenCapture` with `auth_value = 2` (allowed); the
   Accessibility row was last modified 2026-11-17 10:09:15 UTC, minutes
   before the screenshot. Both rows carry a code requirement (`csreq`) that
   decodes (`csreq -r … -t`) to
   `identifier "ai.autohand.computer-use" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: <owner> (<id>)" and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */`.
4. **What is installed.** `codesign -dvv` on the CLI-installed app (built
   5 Nov): `Developer ID Application: Autohand AI Limited (J59GX2DRN2)`.
   Autohand Desktop's copy: the same Developer ID. Squad's bundled copy in
   `/Applications/Autohand Squad.app/…/vendor/computer-use`: `Signature=adhoc`.
   `codesign --verify -R <stored csreq>` fails (exit 3) for all three. The
   only copy on disk that satisfies it is a 27 September development build in
   `~/Documents/…/cli-3/binaries`, which nothing launches.
5. **What tccd does with it.** `log show --predicate 'process == "tccd"'`
   while repeating step 2: the attribution chain is right (responsible
   process `ai.autohand.computer-use`, path in `~/Applications`), then
   `-[TCCDAccessIdentity matchesCodeRequirement:] … "Apple Development: …" … status: -67050`
   (`errSecCSReqFailed`), and the request is treated as not granted.

**Root cause.** The Accessibility and Screen Recording grant for
`ai.autohand.computer-use` was made in September to a development-signed
build. tccd stores the requirement of the build that was granted, not just the
bundle identifier. Every build installed now is signed differently, fails that
requirement, and is denied, while System Settings, which lists rows by bundle
identifier, keeps showing the switch on. Toggling the switch does not rewrite
the stored requirement: the Accessibility row was modified today and still
names the development certificate. Squad's text then asked for a step the
owner had already taken, and Repair (`autohand computer install`) reinstalls
files; neither touches the stored requirement.

### Hypotheses that were wrong

- **macOS 27 merged Accessibility and Screen Recording into a new permission
  the probe does not read.** No. The database has only the familiar services
  (`kTCCServiceAccessibility`, `kTCCServiceScreenCapture`, …); "Device Control
  and Data Access" is a System Settings pane over them, and tccd evaluated
  `kTCCServiceScreenCapture` in the log.
- **A stale driver or daemon.** No. A newly spawned host and driver gave the
  same answer.
- **Squad's per-member grant blocks Allow observe/control.** Only as a
  consequence: those buttons wait for macOS readiness, which was false.
- **An ad-hoc rebuild changed the cdhash.** Close, but not this case: the
  installed copy is Developer ID signed; the grant belonged to an Apple
  Development certificate. Both are the same mechanism: any change of
  signing identity makes the old grant dead weight.

## Decision

1. **Say what is happening when Squad can tell.** When `check_permissions`
   reports either permission missing on macOS, the bridge reads the two rows
   for `ai.autohand.computer-use` (`/usr/bin/sqlite3 -readonly`) and checks
   each stored requirement against the app it launched with real
   `/usr/bin/codesign --verify -R` (`server/computer-use-tcc.mjs`). Status
   gains `grantDiagnosis` (`granted` / `stale` / `denied` / `absent` per
   service, and the kind of build the grant belongs to, never the
   certificate holder's name). A stale grant gets its own sentence on the
   Permissions page.
2. **Offer the fix that works.** "Reset macOS permission" (shown on macOS
   whenever readiness is false and a host app is known, primary when the
   grant is known stale) asks for confirmation, then runs
   `tccutil reset Accessibility ai.autohand.computer-use`,
   `tccutil reset ScreenCapture ai.autohand.computer-use` and
   `open -n -a <the host app in use> --args permissions grant`, so macOS asks
   again and stores the requirement of the build Squad runs. The bridge then
   restarts its host so the new grant is the one read. The route
   `POST /api/computer-use/reset-macos-permission` requires the body
   `{ "confirm": "reset-macos-permission" }`.
3. **Stop claiming the grant.** The host line said "…that you have already
   granted" unconditionally; it now says so only when readiness is true. When
   the state cannot be read the instruction adds: if it is already switched
   on, macOS is holding the permission for an older build, reset it.

## Consequences

- **Squad usually cannot read the database.** Reading it needs Full Disk
  Access. A `launchctl submit` job (no Full Disk Access) got
  `authorization denied`; the installed Squad's own Full Disk Access row is
  `auth_value = 0`. So in the shipped app the precise "stale" sentence will
  normally not appear; the general sentence and the Reset button carry the
  fix. Asking for Full Disk Access to improve one message was rejected.
- **Reset is broad by design.** It clears the grant for every Autohand product
  using `ai.autohand.computer-use` (CLI, Desktop, Squad), which is the point of
  one component, and the confirmation says so. It does not touch Squad's
  per-member grants. Any process able to call the bridge with the ownership
  context can trigger it; the cost is a macOS prompt, not access.
- **Not verified end to end.** Running the reset on the owner's Mac would
  revoke the owner's current (already non-functional) grant, which needs the owner's say-so.
  `tccutil` was confirmed to accept the call shape as the user (an unknown
  identifier fails with `-10814`, not a privilege error); that the host's
  `permissions grant` raises both prompts is taken from the existing Tauri
  setup path, which opens the bundled host the same way.
- **The bundled copy is still a different identity to macOS.** Squad's
  bundled host inside `/Applications/Autohand Squad.app` is ad-hoc signed, so
  its requirement is its cdhash. A grant made to the CLI copy will not cover
  it, and a grant made to it will not cover the CLI copy. ADR-0162's "one
  grant" holds only while Squad runs the CLI copy. Signing the bundled host
  with the Developer ID during the release build is left for the release
  lane.
  *Amended by ADR-0248:* the copy observed here came from a local, ad-hoc
  build of the whole app. The published DMG's host was already signed by the
  release team; the macOS portable archive's was not, and is now. ADR-0248
  adds checks that every release host carries the release team.
- **Upstream.** `autohand computer status` reports `ready` without checking
  permissions, and `autohand computer install` (Repair) cannot clear a stale
  requirement. The component should, when `check_permissions` is false,
  offer the same reset (`tccutil reset … ai.autohand.computer-use`, then
  `permissions grant`) in `autohand computer doctor`/`install`. Not changed
  here.
- **Learnt while writing the check.** A hand-written `cdhash H"…"`
  requirement using the `CDHash=` that `codesign -dvvv` prints fails for a
  universal binary (it names one slice); the check uses the app's own
  designated requirement, which is what tccd stores for an ad-hoc app.
