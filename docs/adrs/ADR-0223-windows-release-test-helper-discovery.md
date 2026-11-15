# ADR-0223: Resolve the Windows test helper from the actual build tree

## Context and evidence

Release run [43357391646](https://github.com/autohandai/squad/actions/runs/43357391646)
did not publish. Its Windows runtime job successfully built
`autohand-squad-daemon`, then failed
`daemon::tests::owned_native_run_stops_its_group_after_context_loss` with
“Build the real daemon helper before Windows runtime tests.”

The first suspicion was a missing build step. The downloaded job log disproved
that: `cargo build --bin autohand-squad-daemon -j1` completed successfully.
The test executable was reported at
`target/debug/build/autohand-squad-runtime/801ac9468ece3c87/out/autohand_squad_runtime-801ac9468ece3c87.exe`.
The test assumed its executable was one directory below the profile directory,
as in `target/debug/deps`. Moving up exactly two parents therefore looked in
the wrong place. A passing ordinary CI run did not cover that output layout.

The Intel Mac runtime job in the same run separately reported that its hosted
runner lost communication with GitHub. Its job log is unavailable (HTTP 404).
This does not establish a runtime defect or a reason to skip its release gate.

## Decision

Keep the helper lookup inside the test module. Starting at the running test's
directory, search its ancestors for the already-built daemon helper. Use the
same lookup in the real Windows ownership test and a cross-platform regression
covering both `deps` and the observed nested `build/.../out` layout. A missing
helper remains a test failure; do not use PATH or the installed application.

## Verification and consequences

The focused regression was run against the extracted old lookup and failed
with `None` for the nested layout while the ordinary layout resolved. After
the lookup change, `cargo test --manifest-path daemon/Cargo.toml --locked -j1
-- --test-threads=1` passed 111 library and two binary tests on macOS ARM with
Rust 1.90.0, including the regression and existing ownership tests.
`cargo fmt -- --check` and `git diff --check` also passed. The fixture removes its temporary
files before asserting and also checks absence after removal.

This changes test discovery, not production executable discovery or the
process-supervision boundary. The cross-platform fixture proves filesystem
layout handling; the Windows CI/release job must still execute the real helper
and ownership test. Signing, notarization, platform packaging and publication
remain independent release gates. No visible UI or standing design rule changes.
