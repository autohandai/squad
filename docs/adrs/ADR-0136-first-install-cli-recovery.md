# ADR-0136: Recover a missing CLI during first-run setup

Date: 2026-10-21. Status: Accepted.

## Context and evidence

The product owner reported that installing Squad on a Mac without Autohand
Code stalled onboarding rather than downloading its runtime. Inspection
corrected the initial assumption: desktop releases already include the CLI
pinned in package.json. A healthy package should not require a global CLI or
a download. However, the bridge only searched existing executables, runtime
readiness accepted the existence of a file, and onboarding's Retry refreshed
account state without preparing anything.

The pre-change reproduction copied the actual bridge and SDK imports into an
isolated, thin installed runtime with an empty vendor directory, no SDK CLI,
and PATH restricted to `/usr/bin:/bin`. Runtime readiness was false;
`POST /api/setup/runtime` returned 404, “no route for POST”. There was no
recovery operation to unblock onboarding. This establishes the missing repair
path; it does not establish why any particular older installer lacked a
working bundled executable.

## Decision

Keep offline bundled startup as the primary path. Probe a candidate's
`--version` with a bounded timeout before declaring it available, caching by
file revision. Vendored and managed executables must match the pinned CLI
version. Explicit paths, development SDK binaries and PATH remain supported.

One bridge-owned bootstrap service shares platform asset names with the build
downloader. Its idempotent setup route starts a single background attempt;
GET `/api/runtime` reports phase, measured bytes, known total and error. A
healthy existing CLI short-circuits without network access.

Download only the pinned repository/version's platform archive and companion
SHA-256, with time and size bounds. Verify bytes before extraction, reject
unsafe entry paths, select one regular executable, and verify its version
before atomic promotion. Install under the user's app-state directory at
`runtime/autohand-cli/<version>/<platform>-<arch>` and record source/digests.
Never write into the signed app, global PATH or a package manager directory.
Remove incomplete scratch files on success or failure.

Onboarding automatically requests setup when the bridge is reachable but its
CLI is unavailable. A quiet line shows preparation, downloading, verification
and installation. Failed attempts retain their error and explicit Retry;
there is no automatic retry loop. Completion refreshes runtime/account state
and unlocks Start only when the other existing prerequisites also pass.
The folder, selected role and typed name stay in place throughout recovery.

## Validation

- `node scripts/check-runtime-bootstrap.mjs` runs the real isolated bridge
  without any machine, vendor or SDK CLI. Controlled release responses check
  checksum refusal without installation, retry, shared concurrent requests,
  idempotency, persisted discovery after bridge restart, rejection/repair of
  a non-executable file and offline preference for a healthy bundled CLI.
- `node scripts/check-runtime-bootstrap.mjs --browser` drives actual Chrome
  through automatic setup, the failed verification sentence, Retry and the
  enabled Start action, asserting the handwritten name survives. Screenshot:
  `.codex-artifacts/runtime-bootstrap/onboarding-ready.png`.
- `node scripts/check-onboarding-recovery.mjs --filter 'runtime readiness'`
  preserves the existing prerequisite-gating regression.
- `node scripts/verify-onboarding-browser.mjs` retains signed-out gating,
  skip, resume and provider navigation coverage. Its older selector expected
  Settings to be a button and all sections to render together; it now uses
  the menu item's accessible role and the existing section navigation.
- `SQUAD_UPDATE_NATIVE='/Applications/Autohand Squad.app/Contents/MacOS/autohand-squad' node scripts/check-mac-update.mjs`
  exercised the existing installed updater binary only against disposable
  signed app copies and real DMGs: staging, atomic exchange, opener-failure
  rollback, version refusal and owned-service shutdown passed. Actual launch
  was mocked; the user's installed app and saved work were untouched.
- CI and release web jobs gate on the isolated bootstrap check. macOS DMG
  smoke boots the packaged bridge with PATH `/usr/bin:/bin` and requires the
  actual executable to resolve inside the mounted app's vendor directory.
- A live recovery run downloaded the official pinned 0.9.7 release, checked
  its published SHA-256 and executed its `--version` from disposable user
  state. Receipt: `.codex-artifacts/runtime-bootstrap/live-cli-download.json`.
- Cross-platform CI exposed an existing Computer Use fixture that made only
  the macOS host executable. Linux launches the driver directly; that fixture
  now puts the same mock protocol at the driver entry point on non-macOS.
  This was a fixture launch error, not an unsupported-OS policy failure.

These browser/download checks use a fixture CLI and account, not a live model
provider. Native package smoke and published asset verification are separate
release evidence.

## Consequences and limits

- Complete packages remain usable offline. Repairing an incomplete package
  requires GitHub access; an offline machine gets a retained, retryable error.
- User data owns the repaired binary, avoiding app-signature changes and
  administrator access. Old version caches are not pruned in this change.
- The published checksum guards corruption and wrong assets, not compromise
  of the release repository; it is not an independent signature authority.
- Extraction depends on the host's tar (bsdtar also handles Windows ZIP).
  Download buffers are bounded to 256 MiB; streaming directly to disk and
  cross-process installation locks are deferred. Requests in one bridge
  already share a single attempt.
- Candidate probes prove the executable starts and identifies its version.
  They do not prove provider authentication or successful model inference.
