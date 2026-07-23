# Autohand Squad Release Runbook

This repo ships four release surfaces together:

- the built web UI in `dist/`
- the local Node bridge in `server.mjs`
- the Rust runtime binaries in `daemon/`
- native macOS DMG and Windows NSIS installers with a bundled Node runtime

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

## Release Flow

1. Open a release checklist issue with the target version and channel.
2. Merge only when CI is green and release-impacting PRs have review.
3. Tag the exact reviewed commit with a `v`-prefixed SemVer and push the tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Tags such as `v1.0.0-beta.1` and `v1.0.0-canary.1` create prereleases.
   Ordinary pushes to `main` never publish a release.

   To retry a failed release through `workflow_dispatch`, select the default
   branch as the workflow ref and enter the existing version, such as `0.1.0`.
   Setup checks out and verifies `v0.1.0` itself, so the retry uses the immutable
   tag source while still benefiting from workflow fixes on the default branch.

4. The workflow builds:

   - macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64 runtime binaries
   - checksums for every runtime asset
   - a web bundle containing `dist/`, `server.mjs`, and package metadata stamped
     with the resolved release version
   - one extract-and-run portable archive per platform, combining the five
     native binaries, web runtime, and minimal production Node modules
   - DMG installers for macOS Apple Silicon and Intel, each containing the
     desktop app, web runtime, production modules, Autohand CLI, and Node
   - a current-user NSIS setup EXE for Windows x64 with the same bundled runtime
   - `manifest-<channel>.json` for the installer/update path

5. Setup immediately creates the versioned GitHub release and generates notes
   from merged changes using `.github/release.yml`. Every platform job extracts
   its portable archive, imports the bundled Agent SDK, and starts the packaged
   `squad --help` command before uploading. The macOS jobs also mount each DMG
   and start its bundled web runtime; the Windows job silently installs,
   exercises, and uninstalls the NSIS package. Each successful platform job
   uploads its verified assets directly to the existing release; finalization
   uploads the merged installer manifest and checksums. A stable tag creates a
   normal release; a prerelease version creates a GitHub prerelease. A manual
   retry may set `notes_start_tag` when the automatic comparison would otherwise
   start from an unpublished tag.

Portable archives are named
`autohand-squad-<version>-<os>-<arch>.tar.gz`. After extraction, run
`bin/squad` (`bin/squad.exe` on Windows). Node 18.17 or newer must be on `PATH`;
the archive vendors the web runtime and its production modules but not Node
itself. These archives are directly runnable distributions, not code-signed
installers.

Native installers are named
`autohand-squad-<version>-macos-<arch>.dmg` and
`autohand-squad-<version>-windows-x64-setup.exe`. They bundle Node, so users do
not need a system Node installation. The current workflow does not code-sign
the Windows installer or sign and notarize the macOS app; release notes must
not claim a verified publisher until those credentials and steps are added.

The setup job rejects leading-zero or malformed versions, confirms that
`GITHUB_REF` is exactly `refs/tags/v<VERSION>`, and resolves both the tag and
`HEAD` to the same commit. Every build and finalization job checks out that
resolved commit SHA and repeats the verification before doing work. A tag cannot
be used to release a different commit, including through manual dispatch.
Immediately before creating the GitHub release, setup resolves the remote tag
through the GitHub API and requires it to match the verified source SHA.

For a retry, dispatch the workflow from the default branch with the existing
version. Setup checks out that exact tag before verification, so workflow fixes
can be applied without moving or recreating the release tag.

Pull requests do not publish releases. They use dry-run versions such as
`0.0.0-pr.17.abc123def456` so installer-manifest generation is still exercised
without creating customer-facing artifacts.

Non-PR CI dry runs use versions such as `0.0.0-ci.42.abc123def456`. That keeps
pull-request provenance clear while still exercising package metadata from
manual or branch-triggered CI runs.

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

The release workflow keeps its default `GITHUB_TOKEN` read-only. Setup creates
the empty versioned release, and the web, platform, and finalization jobs each
request only `contents: write` to append their verified assets. When an
enterprise policy disables write-capable workflow tokens, add a fine-grained
token with repository Contents read/write permission as the
`AUTOHAND_RELEASE_TOKEN` Actions secret. The workflow uses that secret only when
present; otherwise it uses the short-lived job-scoped token. Do not infer either
token's access from the repository API's user-oriented `permissions.push` field:
that field can be absent even when the job log confirms the `Contents: write`
permission.

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
WEB_RUNTIME_DIR=release/web/runtime RELEASE_VERSION=0.1.0 RELEASE_OS="$(node -p process.platform)" RELEASE_ARCH="$(node -p process.arch)" bun run release:portable
NODE_RUNTIME_PATH="$(node -p process.execPath)" WEB_RUNTIME_DIR="$PWD" RELEASE_VERSION=0.1.0 RELEASE_OS="$(node -p process.platform)" RELEASE_ARCH="$(node -p process.arch)" bun run release:installers
bun run release:merge-manifests release
```

`release:installers` runs only on macOS or Windows and refuses a cross-target
build. Mount the resulting DMG or install the resulting EXE and exercise the
bundled `squad` runtime before creating a version tag.

To check an existing tag locally with the same immutable-source guard:

```bash
git checkout v0.1.0
GITHUB_REF=refs/tags/v0.1.0 scripts/verify-release-ref.sh v 0.1.0
```
