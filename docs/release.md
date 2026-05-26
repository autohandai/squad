# Autohand Squad Release Runbook

This repo ships three release surfaces together:

- the built web UI in `dist/`
- the local Node bridge in `server.mjs`
- the Rust runtime binaries in `daemon/`

## CI Gates

Every pull request should pass:

- web server syntax check: `bun run check:server`
- release metadata check: `bun run check:release`
- web build: `bun run build`
- Rust formatting: `cd daemon && cargo fmt -- --check`
- Rust tests: `cd daemon && cargo test -j1`
- Rust binary build: `cd daemon && cargo build --bins -j1`
- release dry run: builds release binaries on Linux, macOS, and Windows,
  packages checksums, and merges an installer manifest

The release dry run protects the contract used by the Autohand CLI launcher:
`squad`, `autohand-squad-daemon`, `autohand-squad-analytics`,
`autohand-squad-tray`, and `autohand-squad-ui` must all exist for the current
platform. The merged manifest must include Linux, macOS, and Windows entries
before release assets can publish.

## Release Flow

1. Open a release checklist issue with the target version and channel.
2. Merge only when CI is green and release-impacting PRs have review.
3. Create a stable release with either:

   ```bash
   git tag squad-v0.1.0
   git push origin squad-v0.1.0
   ```

   or run the `Release` workflow manually with channel `stable`. If no version
   is provided, the workflow resolves the next patch version from the latest
   stable `squad-v*` or `v*` tag and falls back to `package.json`.

4. The workflow builds:

   - macOS, Windows, and Linux runtime binaries
   - checksums for every runtime asset
   - a web bundle containing `dist/`, `server.mjs`, and package metadata
   - `manifest-<channel>.json` for the installer/update path

5. Smoke test the published assets before moving a draft release to public.

Pushes to `main` automatically publish a canary prerelease. Canary versions use
the next stable base plus the run number and commit, for example:
`0.1.1-canary.42.abc123def456`.

Pull requests do not publish releases. They use dry-run versions such as
`0.0.0-pr.17.abc123def456` so installer-manifest generation is still exercised
without creating customer-facing artifacts.

Non-PR CI dry runs use versions such as `0.0.0-ci.42.abc123def456`. That keeps
pull-request provenance clear while still exercising package metadata from
manual or branch-triggered CI runs.

## Release Channels

- `stable`: normal customer release
- `beta`: pre-release customer validation
- `canary`: internal or very early rollout

Non-stable channels are marked as prereleases by the workflow.

Stable releases are allowed to become GitHub's latest release. Canary and beta
releases are explicitly created with `--latest=false`.

## Rollback

Rollback is manifest-driven. Point the hosted channel manifest back to the last
known-good version, or republish the previous `manifest-<channel>.json` as the
active channel manifest. Keep the failed release available for investigation
unless it contains a security or legal issue.

## Branch Protection

Recommended required checks:

- `Runner startup`
- `Web checks`
- `Runtime checks (ubuntu-latest)`
- `Runtime checks (macos-latest)`
- `Runtime checks (windows-latest)`
- `Release dry run (ubuntu-latest)`
- `Release dry run (macos-latest)`
- `Release dry run (windows-latest)`
- `Validate release manifest`

Require at least one owner review for changes under `.github/`, `daemon/`,
`server.mjs`, `scripts/`, and release documentation.

## GitHub Runner Readiness

This private repository uses GitHub-hosted Linux, macOS, and Windows runners.
Before remote CI can prove the matrix, the account must have GitHub Actions
billing available and a spending limit high enough for private-repository
runner minutes. If GitHub refuses to start jobs with a billing or spending-limit
annotation, fix Billing & plans first, then rerun `CI` and `Release`.

The release publish job targets channel environments named `canary`, `beta`, and
`stable`. Add approval rules to the `stable` environment when the repo moves
from test releases to customer releases.

The release workflow intentionally keeps the default `GITHUB_TOKEN` read-only so
it can run in organizations that disable workflow write permissions. Publishing
requires an `AUTOHAND_RELEASE_TOKEN` secret on the `canary`, `beta`, and
`stable` environments, or as a repository secret while this repo is still in
test mode. That token should be a fine-grained token or GitHub App token with
release/content write access only for this repository.

Release channels are intentionally limited to `stable`, `beta`, and `canary`.
Invalid channels fail during the metadata step before any release assets are
published. Existing beta and canary releases are edited with `--latest=false`
as well as created with `--latest=false`, so reruns cannot accidentally promote
a prerelease to GitHub's latest release.

GitHub artifact attestations can be added after the organization enables
workflow `id-token` and `attestations` write permissions. Until then, release
integrity is enforced with SHA-256 checksums and manifest validation.

## Local Preflight

Before a release PR, run:

```bash
bun run check:server
bun run check:release
bun run build
cd daemon
cargo fmt -- --check
cargo test -j1
cargo build --bins -j1
```

For a local package dry run:

```bash
node scripts/resolve-squad-version.mjs --mode dry-run
cd daemon
cargo build --release --bins -j1
cd ..
RELEASE_VERSION=0.1.0 RELEASE_TAG=squad-v0.1.0 bun run release:package
bun run release:merge-manifests release
```
