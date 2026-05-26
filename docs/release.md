# Autohand Squad Release Runbook

This repo ships three release surfaces together:

- the built web UI in `dist/`
- the local Node bridge in `server.mjs`
- the Rust runtime binaries in `daemon/`

## CI Gates

Every pull request should pass:

- web server syntax check: `bun run check:server`
- web build: `bun run build`
- Rust formatting: `cd daemon && cargo fmt -- --check`
- Rust tests: `cd daemon && cargo test -j1`
- Rust binary build: `cd daemon && cargo build --bins -j1`
- release dry run: builds release binaries, packages checksums, and merges an installer manifest

The release dry run protects the contract used by the Autohand CLI launcher:
`squad`, `autohand-squad-daemon`, `autohand-squad-analytics`,
`autohand-squad-tray`, and `autohand-squad-ui` must all exist for the current
platform.

## Release Flow

1. Open a release checklist issue with the target version and channel.
2. Merge only when CI is green and release-impacting PRs have review.
3. Create a release with either:

   ```bash
   git tag squad-v0.1.0
   git push origin squad-v0.1.0
   ```

   or run the `Release` workflow manually with a version and channel.

4. The workflow builds:

   - macOS, Windows, and Linux runtime binaries
   - checksums for every runtime asset
   - a web bundle containing `dist/`, `server.mjs`, and package metadata
   - `manifest-<channel>.json` for the installer/update path
   - GitHub artifact attestations for the published files

5. Smoke test the published assets before moving a draft release to public.

## Release Channels

- `stable`: normal customer release
- `beta`: pre-release customer validation
- `canary`: internal or very early rollout

Non-stable channels are marked as prereleases by the workflow.

## Rollback

Rollback is manifest-driven. Point the hosted channel manifest back to the last
known-good version, or republish the previous `manifest-<channel>.json` as the
active channel manifest. Keep the failed release available for investigation
unless it contains a security or legal issue.

## Branch Protection

Recommended required checks:

- `Web checks`
- `Runtime checks (ubuntu-latest)`
- `Runtime checks (macos-latest)`
- `Runtime checks (windows-latest)`
- `Release dry run`

Require at least one owner review for changes under `.github/`, `daemon/`,
`server.mjs`, `scripts/`, and release documentation.

## Local Preflight

Before a release PR, run:

```bash
bun run check:server
bun run build
cd daemon
cargo fmt -- --check
cargo test -j1
cargo build --bins -j1
```

For a local package dry run:

```bash
cd daemon
cargo build --release --bins -j1
cd ..
RELEASE_VERSION=0.1.0 RELEASE_TAG=squad-v0.1.0 bun run release:package
bun run release:merge-manifests release
```
