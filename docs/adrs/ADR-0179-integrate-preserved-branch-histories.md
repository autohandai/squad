# ADR-0179: Integrate preserved branch histories without restoring obsolete implementations

## Context and evidence

The request on 2026-11-05 was to merge every local and remote branch into
`main` and push it. After fetching and pruning origin, the repository had
10 local branches and 8 remote branches other than `main`. All worktrees
were clean.

Six branch tips had exactly the same Git trees as existing squash commits
on `main`, verified with `git rev-parse <ref>^{tree}`:

| Branch | Existing main commit |
| --- | --- |
| `fix/update-consent-and-announcements` | `15cfe4c` |
| `fix/workspace-alias-upgrade` | `b023c07` |
| `docs/release-018-verification` | `a62fc76` |
| `fix/signing-and-reset` | `4f0fe29` |
| `feat/member-artifact-library` | `346dfbd` |
| `fix/reaper-test-startup` | `a952b40` |

`fix/ci-local-contract-fixtures` is contained by the updates branch.
`docs/update-verification-correction` and the remote rust-runtime dependency
branch were already ancestors of `main`.

The two `wip/` branches use an unrelated root. Their common baseline
`97ca4fa` and the corresponding main commit `dd75746` differ only in nine
saved screenshot files. Their pending changes are earlier prototypes of
memory review and project access. Main subsequently integrated memory
review in `416078f`, including accept, edit, reject, evidence and history,
and replaced the projects layout with the flat list in `0d0bade`.
Inspecting the current `MemoryInboxPage` and `AgentProjectsPage` confirmed
those later implementations and their additional validation remain present.

## Decision

Record the six squash-equivalent branch histories with an `ours` merge.
Record both unrelated WIP histories with a separate `ours` merge permitting
unrelated histories. These merges keep the current 0.1.21 source and generated
web bundle while making the preserved branch commits reachable from main.

Merge the remaining SHA-2 dependency branch normally. Its changes update
`daemon/Cargo.toml` from `sha2 = "0.10"` to `"0.11"` and the corresponding
lockfile to 0.11.1. Refresh the desktop lockfile for its path dependency on
the runtime; its own SHA-2 0.10 dependency remains separate. Keep the current
runtime package version.

## Consequences

All preserved branch histories can be tested for ancestry against main.
The obsolete WIP layouts, demo memory seed records and generated bundles
are retained in history rather than restored to the running product.
The original branches and worktrees are retained. No history is rewritten.

The first locked runtime test build with Rust 1.97.1 failed because the new
SHA-2 digest array no longer implements `LowerHex`. Encode both memory-index
hashes byte by byte with two lowercase hex digits, matching the existing
download-checksum implementation. A regression test fixes the empty and
`abc` SHA-256 vectors and an existing-format document fingerprint. The
fingerprint fixture was independently calculated with Python's `hashlib`.

The runtime changes are the hashing dependency upgrade and this compatibility
fix.
This integration does not establish cross-platform packaging or release proof.

## Validation

With the merged dependency and compatibility fix, Rust 1.97.1 passed:

- `cargo fmt --manifest-path daemon/Cargo.toml -- --check`.
- `cargo test --locked --manifest-path daemon/Cargo.toml -j1 -- --test-threads=1`:
  100 library tests and two binary tests passed.
- `cargo build --locked --manifest-path daemon/Cargo.toml --bins -j1`.
- `cargo check --manifest-path src-tauri/Cargo.toml -j1`: the native desktop
  shell compiled and its lockfile gained only the six required dependency
  packages, leaving existing package versions intact.

`node scripts/check-release-workflows.mjs` passed release metadata and runtime
packaging checks. Its portable-component check uses fixture signatures;
it is not a signed release test.
