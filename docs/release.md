# Autohand Squad Release Runbook

This repo ships four release surfaces together:

- the built web UI in `dist/`
- the local Node bridge in `server.mjs`
- the Rust runtime binaries in `daemon/`
- native macOS DMG, Windows NSIS, Linux Debian, and Linux AppImage installers with a bundled Node runtime

## CI Gates

Every pull request should pass:

- Autohand SDK 1.0.4 import and bundled CLI startup: `bun run check:sdk`
- web server syntax check: `bun run check:server`
- release metadata check: `bun run check:release`
- native portable packaging check on every target, including the host `tar`
  implementation and redirected packaged-state startup
- native CrabNebula packager binding import on every release target
- web build: `bun run build`
- Rust formatting: `cd daemon && cargo fmt -- --check`
- Rust tests: `cd daemon && cargo test -j1 -- --test-threads=1`
- Rust binary build: `cd daemon && cargo build --bins -j1`
- release dry run: builds native release binaries on Linux x64, macOS Apple
  Silicon, macOS Intel, and Windows x64, packages checksums, and merges an
  installer manifest

The release dry run protects the contract used by the Autohand CLI launcher:
`squad`, `autohand-squad-daemon`, `autohand-squad-analytics`,
`autohand-squad-tray`, and `autohand-squad-ui` must all exist for the current
platform. The merged manifest must include `linux/x64`, `darwin/arm64`,
`darwin/x64`, and `win32/x64` entries before release assets can publish.

## Channels

| Channel | How it is made | Tag | GitHub release |
| --- | --- | --- | --- |
| stable | a maintainer tags a reviewed `main` commit | `v1.2.3` | release, marked latest |
| beta | a maintainer tags a candidate | `v1.2.3-beta.1`, `v1.2.3-rc.1` | pre-release |
| canary (nightly) | `nightly.yml` at 03:00 UTC, or on demand | `v<next>-canary.<yyyymmddHHMM>` | pre-release, seven kept |

The app and the daemon pick releases by channel (`daemon/src/install.rs`):
stable takes the newest non-prerelease, beta the newest pre-release without
`canary` in the tag, canary the newest pre-release.

## Release Flow

1. Keep `CHANGELOG.md` current as work lands: add entries under
   **Unreleased**. Nightlies publish that section verbatim.
2. For a stable release, move the Unreleased entries under `## [x.y.z] - date`,
   set `version` in `package.json`, `daemon/Cargo.toml`, and
   `src-tauri/Cargo.toml`, merge, then tag the exact reviewed commit:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   Ordinary pushes to `main` never publish a release. To rerun a failed
   pre-publication build, dispatch the Release workflow on the existing tag
   with the same version; dispatch never creates or moves a tag.

3. The Release workflow builds, per target (Linux x64, macOS Apple Silicon,
   macOS Intel, Windows x64):

   - the web bundle (`dist/`, `server.mjs`, package metadata stamped with the
     version);
   - the runtime binaries (`squad`, daemon, analytics, tray, ui) with
     checksums and the installer manifest used by the Autohand CLI launcher,
     plus one portable `.tar.gz` per target;
   - the desktop app (Tauri): DMG, NSIS setup EXE, Debian package, and
     AppImage, renamed to `autohand-squad-<version>-<platform>` and listed in
     `manifest-desktop-<os>-<arch>.json`.

4. Every desktop bundle is smoke tested before publication: macOS mounts the
   DMG, verifies the signature, and boots the bundled bridge; Windows installs
   silently, checks the installed files, and uninstalls; Linux extracts the
   deb and the AppImage and runs the bundled CLI.

5. The publish job merges the manifests, writes `checksums.txt`, composes the
   release body with `scripts/release-notes.mjs` (channel banner, changelog
   section, download table, install/verify/update instructions) and lets
   GitHub append the categorised pull-request list (`.github/release.yml`).
   A stable tag becomes the latest release; anything else is a pre-release.

## Publishing Credentials

The publish job creates the GitHub release with the job-scoped
`GITHUB_TOKEN` (`contents: write`). The repository's default workflow token
permission must allow write (Settings → Actions → General → Workflow
permissions), or organisation policy must permit the workflow to elevate it.
If neither is possible, add an `AUTOHAND_RELEASE_TOKEN` repository secret holding a
fine-grained personal access token with **Contents: read and write** on this
repository; the workflow prefers it automatically.

## Nightly Builds

`nightly.yml` runs at 03:00 UTC and on demand. It skips when `HEAD` already
carries a canary tag (unless dispatched with `force`), otherwise it tags HEAD
as `v<package version>-canary.<yyyymmddHHMM>`, pushes the tag, dispatches the
Release workflow on it (a tag pushed with the workflow token does not trigger
workflows by itself), and deletes nightlies older than the newest seven,
tags included.

## Asset Names

Portable archives: `autohand-squad-<version>-<os>-<arch>.tar.gz`; after
extraction run `bin/squad` (`bin/squad.exe` on Windows) with Node 18.17+ on
`PATH`. Desktop installers: `autohand-squad-<version>-macos-<arch>.dmg`,
`autohand-squad-<version>-windows-x64-setup.exe`,
`autohand-squad-<version>-linux-x64.deb`, and
`autohand-squad-<version>-linux-x64.AppImage`; they bundle Node, so users do
not need a system Node installation.

The setup job rejects malformed versions, confirms that `GITHUB_REF` is
exactly `refs/tags/v<VERSION>`, and resolves both the tag and `HEAD` to the
same commit. Every build and publish job checks out that resolved commit SHA
and repeats the verification. Immediately before creating the GitHub release,
the publish job resolves the remote tag through the GitHub API and requires it
to match the verified source SHA.

Pull requests do not publish releases. They use dry-run versions such as
`0.0.0-pr.17.abc123def456` so manifest generation is still exercised.

## Autohand Code CLI

Releases ship the Autohand Code CLI pinned in `package.json`
(`autohand.cliVersion`). Every workflow job runs `bun run cli:fetch` before the
SDK check, which downloads the matching GitHub release asset for the runner's
platform, verifies it against the published `.sha256`, and writes
`vendor/autohand-cli/BUILD_INFO.json`. `check:sdk` runs with
`AUTOHAND_SQUAD_REQUIRE_VENDORED_CLI=1` so a missing or mismatched binary fails
early, and both packagers copy only the vendored binary (plus its build info)
into the app; the Agent SDK's own bundled CLI is never shipped.

## Code Signing And Notarization

Signing is optional and driven entirely by repository secrets. Without them
the release still builds; the release summary and installer trust records
(`trust-<os>-<arch>.json`) say so honestly.

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 `.p12` containing a Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | App-specific password and team for `notarytool`; all three enable notarization |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Base64 `.pfx` Authenticode certificate imported into the runner store |
| `WINDOWS_TIMESTAMP_URL` | Optional RFC 3161 timestamp server (default DigiCert) |

The macOS job imports the certificate into a temporary keychain and exports
`APPLE_SIGNING_IDENTITY`; the packager signs every binary and the bundle with
the hardened runtime and the entitlements the bundled Node runtime needs, then
notarizes when the Apple account secrets are present. Without an identity the
bundle is ad-hoc signed (`-`) so it stays internally consistent; users must
clear the quarantine flag once. The Windows job imports the PFX and exports
`WINDOWS_CERTIFICATE_THUMBPRINT`; `WINDOWS_SIGN_COMMAND` can replace it for
Azure Trusted Signing or another external signer. The macOS smoke test runs
`codesign --verify --deep --strict` on every DMG and `spctl --assess` when an
identity was used.

## Release Channels

- `stable`: a version without a prerelease suffix, such as `v1.2.3`
- `beta`: any prerelease except `canary`, such as `v1.2.3-beta.1` or
  `v1.2.3-rc.1`
- `canary`: a `canary` prerelease, such as `v1.2.3-canary.1`

The channel is derived from the immutable tag; it is not a manual release
switch. Non-stable channels are marked as GitHub prereleases.

Stable releases become GitHub's latest release. Canary and beta releases are
created with `--latest=false`.

Publishing is append-only. If a GitHub release already exists for the tag, the
workflow stops instead of replacing assets or editing release metadata. Fix a
failed build before publication and rerun it from the same tag. If publication
itself partially completed, inspect the existing release and resolve it
manually rather than using an automated overwrite.

## Rollback

Do not mutate a published release in place. Revert the faulty change, create a
new patch version from the restored source, and publish that new immutable tag.
Keep the failed release available for investigation unless it contains a
security or legal issue.

## Branch Protection

Recommended required checks:

- `Runner startup`
- `Web checks`
- `Runtime checks (linux-x64)`
- `Runtime checks (macos-arm64)`
- `Runtime checks (macos-x64)`
- `Runtime checks (windows-x64)`
- `Release dry run (linux-x64)`
- `Release dry run (macos-arm64)`
- `Release dry run (macos-x64)`
- `Release dry run (windows-x64)`
- `Validate release manifest`

Require at least one owner review for changes under `.github/`, `daemon/`,
`server.mjs`, `scripts/`, and release documentation.

Add a repository ruleset for `refs/tags/v*` that blocks tag updates and
deletions. The workflow checks the remote tag again immediately before release
creation, while the ruleset closes the remaining force-move race at the
repository boundary.

## GitHub Runner Readiness

This public repository uses GitHub-hosted Linux, macOS, and Windows runners.
The repository and organization must allow GitHub Actions and the job-scoped
permissions declared by each workflow. If GitHub refuses to start a job because
of an Actions policy, fix the repository or organization policy first, then
rerun `CI` or create a new immutable release tag as appropriate.

The release publish job targets channel environments named `canary`, `beta`, and
`stable`. Add approval rules to the `stable` environment when the repo moves
from test releases to customer releases. Environment reviewers do not change
the tag or source commit; they only approve the already-built release.

The release workflow keeps its default `GITHUB_TOKEN` read-only. Only the final
publish job requests `contents: write` and passes GitHub's short-lived,
job-scoped workflow token directly to the GitHub CLI. Do not infer this granular
token's access from the repository API's user-oriented `permissions.push`
field: that field can be absent even when the job log confirms the
`Contents: write` permission. A policy that blocks the requested job permission
must be fixed in the repository or organization Actions settings before
publishing.

Release integrity is checked with SHA-256 checksum files, exact target coverage
in the installer manifest, immutable commit pins for third-party GitHub
Actions, and the tag-to-commit verification described above. The workflow does
not claim artifact signing, code signing, notarization, or GitHub artifact
attestation.

## Local Preflight

Before a release PR, run:

```bash
bun run check:sdk
bun run check:server
bun run check:release
bun run build
cd daemon
cargo fmt -- --check
cargo test -j1 -- --test-threads=1
cargo build --bins -j1
```

For a local package dry run:

```bash
node scripts/resolve-squad-version.mjs --mode dry-run
cd daemon
cargo build --release --bins -j1
cd ..
RELEASE_VERSION=0.1.0 RELEASE_TAG=v0.1.0 bun run release:package
WEB_RUNTIME_DIR="$PWD" RELEASE_VERSION=0.1.0 RELEASE_OS="$(node -p process.platform)" RELEASE_ARCH="$(node -p process.arch)" bun run release:portable
NODE_RUNTIME_PATH="$(node -p process.execPath)" WEB_RUNTIME_DIR="$PWD" RELEASE_VERSION=0.1.0 RELEASE_OS="$(node -p process.platform)" RELEASE_ARCH="$(node -p process.arch)" bun run release:installers
bun run release:merge-manifests release
```

`release:installers` runs natively on each supported platform and refuses a
cross-target build. Mount the resulting DMG, install the resulting EXE or
Debian package, and inspect the AppImage payload before creating a version tag.

To check an existing tag locally with the same immutable-source guard:

```bash
git checkout v0.1.0
GITHUB_REF=refs/tags/v0.1.0 scripts/verify-release-ref.sh v 0.1.0
```
