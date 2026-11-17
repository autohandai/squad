# ADR-0248: sign-in clients in release builds, and the release team on every bundled Computer Use host

Status: accepted. Completes what ADR-0244 left undone (release builds never
passed the connector sign-in clients to the bridge) and corrects ADR-0247's
reading of why Squad's bundled host was ad-hoc. Checks:
`scripts/check-connector-build-clients.mjs`
(`bun run check:connector-build-clients`), `scripts/check-nested-signing.mjs`
and the workflow assertions in `scripts/check-release-workflows.mjs`
(`bun run check:release`); local proof: `scripts/verify-macos-signature.mjs`
(`bun run verify:macos-signature`).

## Context and evidence

### Sign-in clients

ADR-0244 made the bridge read `AUTOHAND_SQUAD_GOOGLE_CLIENT_ID`,
`AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET` (a Google OAuth client of type Desktop
app) and `AUTOHAND_SQUAD_GITHUB_CLIENT_ID` (a GitHub OAuth App with device
flow, no secret) from its own environment. An installed app's bridge is started
by the desktop shell or `squad serve`; nothing in `.github/workflows/release.yml`
or the shell sets these, so every shipped build said "not set up" for Squad's
own Google connectors and GitHub device sign-in. Both clients are installed-app
clients: Google documents that a Desktop app's secret is not treated as
confidential, and GitHub's device flow has no secret.

### The bundled Computer Use host

ADR-0247 recorded that Squad's bundled `Autohand Computer Use.app` was
ad-hoc signed and left Developer ID signing "for the release lane". Measured on
18 November 2026, before changing anything:

- **The published DMG was already right.** `gh release download
  v0.1.22-canary.202611160314` (macos-arm64 DMG), mounted read-only:
  `codesign -dvvv` on `Contents/Resources/runtime/vendor/computer-use/Autohand Computer Use.app`
  gave `flags=0x10000(runtime)`, `Authority=Developer ID Application: Autohand AI Limited (J59GX2DRN2)`,
  a secure timestamp and `TeamIdentifier=J59GX2DRN2`; the four engine files
  beside it carry the same team. The release workflow's desktop job already
  ran `computer-use:fetch` and `desktop:stage` with
  `AUTOHAND_CODESIGN_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"` after importing
  the identity, and notarization would have rejected ad-hoc nested code.
- **The ad-hoc copy ADR-0247 saw came from a local build.** The installed
  `/Applications/Autohand Squad.app` (0.1.22) is itself `Signature=adhoc`,
  and its host's `BUILD_PROVENANCE.json` says `"signing": "ad hoc, hardened runtime"`,
  built 2 November. `scripts/build-native-shell.mjs` signs ad-hoc whenever
  `APPLE_SIGNING_IDENTITY` is unset, so every local package does this.
  ADR-0247's diagnosis of the stale grant stands; its sentence about "Squad's
  bundled copy" describes that local build, not what the release ships.
- **The macOS portable archive was not right.** The same release's
  `autohand-squad-…-darwin-arm64.tar.gz`: host `Signature=adhoc`,
  `TeamIdentifier=not set`, and all four engine files ad-hoc. The
  `runtime-artifacts` job never imported an identity, so `release:portable`
  signed ad-hoc.
- **One stager ignored the exported identity.** `prepare-apple-signing.mjs`
  exports `APPLE_SIGNING_IDENTITY`. `stage-desktop.mjs` (for the CLI) and
  `fetch-computer-use.mjs` fell back to it; `stage-computer-use.mjs`, which
  re-signs the staged host, read only `AUTOHAND_CODESIGN_IDENTITY`. A build
  with only `APPLE_SIGNING_IDENTITY` set would sign the CLI with the
  Developer ID and the host ad-hoc. CI masked this by setting both.
- **Why the team is what matters.** `codesign -d -r-` on the CLI-installed
  copy (`~/Applications/Autohand Computer Use.app`, built 5 November) prints
  the designated requirement
  `identifier "ai.autohand.computer-use" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = J59GX2DRN2`.
  It names the team, not a certificate: this Mac's keychain holds four
  distinct Developer ID Application certificates for J59GX2DRN2 and any of
  them satisfies it. tccd stores this requirement with the grant (ADR-0247),
  so a grant made to the CLI's or Desktop's copy covers any copy with the same
  identifier signed by the same team. `codesign --verify -R` with the CLI
  copy's requirement passes for the canary DMG's host and fails for the
  portable archive's host.
- **Entitlements.** The upstream `autohand/scripts/build-macos-host.sh`
  (pinned commit `fc92b70`) signs with no entitlements file, and
  `codesign -d --entitlements -` on the CLI-installed copy shows none. The
  host needs no hardened-runtime exceptions; it only asks for Accessibility
  and Screen Recording, which are TCC grants, not entitlements.

## Decision

### Sign-in clients ship as a staged public file

1. `scripts/stage-connector-clients.mjs` writes `CONNECTOR_CLIENTS.json` into
   a runtime directory from the three build variables, the way
   `PRODUCT_TELEMETRY.json` carries PostHog's public key. It reads nothing
   else, writes `{}` when none are set, prints only which providers were
   staged, and fails the build when a value cannot be the client it claims to
   be (a Google id that is not `…apps.googleusercontent.com`, a secret without
   an id), naming the variable, never the value. A local packaged build may
   keep the values in the checkout's `.env`; the process environment wins.
2. The release workflow stages it twice: into the web runtime before it is
   archived (which the portable archive copies) and through `desktop:stage`
   for the app bundles. The client ids are repository **variables**
   (`vars.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID`, `vars.AUTOHAND_SQUAD_GITHUB_CLIENT_ID`);
   the Google secret is a repository **secret**
   (`secrets.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET`), so Actions masks it in
   logs even though it is not confidential.
3. `server/connectors/build-clients.mjs` reads the file once at bridge start.
   Each provider is taken whole from one place: the environment when it names
   that provider (development, fixtures, an operator override), otherwise the
   file. An environment client id never borrows the file's secret. A missing
   or unreadable file means "not set up", which the Connectors page already
   explains. The bridge logs which providers are set up and from where,
   never a value. The values are passed to the OAuth module and the
   Connectors route explicitly and are **not** copied into `process.env`, so
   member engines, which inherit the bridge's environment, never see them.
   The page still receives only the Google client id.

### Every macOS host a release ships carries the release team

4. One resolver, `releaseSigningIdentity()` in `scripts/lib/macos-signing.mjs`
   (`AUTOHAND_CODESIGN_IDENTITY`, then `APPLE_SIGNING_IDENTITY`, then ad-hoc),
   is used by `fetch-computer-use.mjs`, `stage-computer-use.mjs` and
   `stage-desktop.mjs`.
5. When a real identity is requested, `stageComputerUse` reads the re-signed
   host back with `codesign -dvvv` and refuses it unless it is not ad-hoc,
   carries the identity's team (when the identity names one), the hardened
   runtime and a secure timestamp. Local builds without an identity stay
   ad-hoc and pass. No entitlements are added, matching upstream and the CLI's
   copy.
6. The `runtime-artifacts` job's macOS legs now import the Developer ID the
   same way the desktop job does (`prepare-apple-signing.mjs`, temporary
   keychain, removed in an `always()` step), and run `computer-use:fetch` and
   `release:portable` with the release identity. The host stays inside the
   bundle it ships in, so the outer app's signature and notarization cover it
   in the DMG; the portable archive is signed but not notarized (below).
7. `scripts/verify-macos-signature.mjs` checks a built Squad.app, a portable
   bundle directory or the host itself: strict deep verification, the host's
   identifier, the expected team (`--team`, `APPLE_TEAM_ID`, or the outer
   app's), Developer ID authority, hardened runtime, timestamp, the
   Developer ID requirement for that team, and the four engine files' team.
   `--against <app>` checks the host against another copy's own designated
   requirement, which is the grant-sharing question asked directly. An
   ad-hoc local build fails unless `--allow-adhoc`, and then says that macOS
   will treat it as a different app. Both release smoke steps (mounted DMG,
   extracted portable) run it with `--team "$APPLE_TEAM_ID"`, before the
   stapler and Gatekeeper checks.
8. `check-release-workflows.mjs` asserts the ordering (identity before host
   build), the identity on fetch, stage and portable packaging, the cleanup,
   both verification calls, the shared resolver, and that no workflow carries
   a literal client value.

## Results of the checks

- `verify-macos-signature.mjs` on the downloaded canary DMG with
  `--against ~/Applications/Autohand Computer Use.app`: passes, and reports
  that the host satisfies the CLI copy's requirement. With `--team ABCDE12345`:
  fails on the app, the host, the requirement and all four engine files. On
  the extracted portable archive: fails (ad-hoc host and engine, no
  timestamp, CLI requirement not met). On the installed local app: fails,
  passes with `--allow-adhoc` and says why it is a different app to macOS.
- Real signing, scratch copy only: `stageComputerUse` into a scratch runtime
  with this Mac's Developer ID (selected by certificate hash, never printed;
  the keychain was not exported) produced a host with `flags=0x10000(runtime)`,
  a timestamp, `TeamIdentifier=J59GX2DRN2`, no entitlements, `valid on disk`
  and `satisfies its Designated Requirement`; `verify-macos-signature.mjs
  --team J59GX2DRN2 --against ~/Applications/…` passed.
- `check-connector-build-clients.mjs` starts the real bridge three times from a
  runtime directory holding (or not holding) a staged file: staged clients
  reach `/api/connectors` as `{ clientId, provided: "build" }`, the
  environment wins over the file, no file is `null` and "not set up", and
  neither response nor bridge logs (stdout and stderr, and every `.log`,
  `.jsonl`, `.json` and `.txt` file under its state directory) contain a
  client value. Logging the clients object in
  `server.mjs` as a deliberate mutation made it fail on "no client value lands
  in the bridge logs".
- Removing the DMG verification line, the portable signing identity, the
  web-runtime staging line, or moving the Google secret to `vars.` each makes
  `check-release-workflows.mjs` fail. `actionlint` is clean.
- `check-connectors-browser.mjs` timed out on the catalogue on its first run
  in the fresh worktree (cold Vite compile); with this change stashed it
  passed, and with the change restored it passed again.

## Consequences

- **The Google client secret is readable in every installed copy.** It sits in
  `CONNECTOR_CLIENTS.json` inside the app bundle and the portable archive.
  That is Google's model for Desktop app clients: anyone can extract it, and
  it lets them start a consent flow that shows Autohand's app name. It cannot
  read anyone's mail without that person consenting. If Google ever treats it
  as compromised, rotating it means a new release. A per-person client in
  Settings still wins over the build's.
- **The portable archive is signed, not notarized.** A `.tar.gz` cannot be
  stapled, and the archive's other executables (`bin/squad`, the daemon,
  Node) remain as before. Signing the host is what the TCC grant needs;
  Gatekeeper is not consulted for files fetched without quarantine. Signing
  and notarizing the whole portable archive was not done.
- **The runtime-artifacts macOS legs now need the Apple secrets.** A release
  without them was already blocked by the preflight job; a fork or a dry run
  that copies this job without secrets will fail at "Prepare macOS code
  signing" instead of producing an ad-hoc archive.
- **Local builds are still ad-hoc by default.** The owner's installed app is a
  local build, so its host still cannot share the CLI copy's grant. Building
  with `APPLE_SIGNING_IDENTITY` set (a certificate hash works when several
  identically named certificates exist) gives a local build the release team;
  making that the default would prompt for keychain access on every build and
  was not done.
- **Not proven end to end in CI.** No tag was pushed. The workflow is checked
  statically and by `actionlint`; the signing commands were proven on a scratch
  copy on this Mac; the published DMG shows the desktop path already worked.
  That a grant given to the CLI's copy actually admits Squad's DMG host was
  inferred from the stored requirement and `codesign --verify -R`, not by
  granting and probing on a clean Mac.
- **Product telemetry has the same gap.** The release workflow passes no
  PostHog values to `desktop:stage`, and the web runtime and portable archive
  never stage `PRODUCT_TELEMETRY.json`, so release builds ship telemetry
  inactive unless a `.env` happens to be present. Observed while writing this;
  not changed here.
- **What was wrong first.** ADR-0247's "Squad's bundled copy is ad-hoc" was
  taken as a release defect. The release DMG was correct; the defect was the
  portable archive, the inconsistent identity resolver and the absence of any
  check that would catch a regression.
