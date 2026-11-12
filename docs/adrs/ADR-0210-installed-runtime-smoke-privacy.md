# ADR-0210: Check installed CLI readiness separately from public broker liveness

## Context and evidence

Release run 43146615890 failed the macOS DMG smoke check because it queried
`/api/runtime` without an owner context and expected `available`, `autohandPath`
and `defaultWorkspace`. The broker intentionally returns only its service name
and ownership readiness to that caller. A fresh signed-out bridge reproduced the
same old `Bundled Autohand CLI is unavailable` assertion despite answering
correctly. The absence of private fields was not evidence of a broken CLI.

The Windows release job also ran daemon tests before building the daemon binary
that the owned-process lifecycle test launches. The normal runtime CI job builds
the binaries first; the release job did not.

## Decision

Keep the public runtime response private. The DMG check now verifies that public
broker contract, reads the mounted runtime's pinned CLI manifest, verifies its
staged checksum, and launches that exact executable with `--version` from a
temporary home outside the bundle. It removes inherited Autohand and Node
overrides and never substitutes a system CLI. Build the Windows daemon test
helper before running release runtime tests.

## Evidence

- `node scripts/check-installed-runtime-proof.mjs` checks a real signed-out
  broker with an executable fixture, fresh working directory and environment;
  wrong pin, corrupt payload and missing executable all fail.
- The helper was also run against the existing installed macOS app's actual
  bundled `autohand-macos-arm64`, which reported the pinned version 0.9.9 from a
  fresh home. It did not stop or replace the installed app.
- `bun run check:release` passes the workflow packaging checks.

## Consequences

The smoke check can distinguish public liveness from an executable that really
fails to start. Its existing signature, notarization and Gatekeeper checks remain.
It does not sign in, send model prompts, or prove a member's private workspace
configuration. Owned runtime/bootstrap tests cover that separate contract. Local
installed-executable proof does not replace a new notarized DMG canary on both
macOS architectures or the Windows release tests; those remain required before
claiming the next release is ready.
