# ADR-0144: Recover device sign-in without waiting for a code to expire

Date: 2026-10-23. Status: Accepted. Igor approved merging PR #44.

## Context and evidence

The desktop sign-in gate used an anchor with `target="_blank"`. The main Tauri window has no new-window handler; only the information windows route external links through the system opener. A fresh isolated browser regression fails on the missing bridge-backed button. The URL is present in the running CLI flow, so a missing verification URL is not the cause reproduced by the fixture.

Closing the main window deliberately hides it and leaves the local bridge running. `HarnessLoginManager.start` returns an existing running flow. That state is in memory, not an on-disk pending-login record, and the original gate offered neither cancellation nor a restart. Reopening could therefore reuse a request opened in the wrong browser profile.

Independent review also reproduced a race: resetting while the login POST is pending can finish DELETE before POST starts its child. Ignoring a stale UI response alone leaves that child running. Start and cancel mutations must be ordered, in addition to ignoring stale poll responses.

## Decision

- Reopen only the URL from a running CLI flow through a local bridge endpoint. Use a fixed platform opener with argument arrays and no shell; await its outcome with a timeout. Reject inactive flows and show opener failures with the copy-link fallback.
- Show the actual URL and code as selectable text and provide separate copy actions using the shared clipboard helper. This lets the person select a browser profile themselves.
- Provide Cancel sign-in and Start over. Serialize their mutations with a pending start; invalidate older UI responses and stop polling when cancelled or unmounted.
- Cancel pending authorization when the gate mounts. Native CloseRequested emits a reset event before hiding the window; the rest of the team keeps running.
- Keep credentials in the existing CLI login flow and do not store device authorization in frontend persistence.

## Validation

`node scripts/check-sign-in-recovery-browser.mjs` runs the real local bridge and rendered React gate with an isolated state directory, a fixture login process and a fixture system opener. It checks opener arguments, copy URL/code callbacks, opener failure, cancel, a fresh code on restart, native reset event handling, webview reload while the bridge survives, a delayed start followed by reset, bridge restart, inactive-open HTTP 409 and browser exceptions. The regression failed before the implementation and passes afterward.

Existing harness adapter and rendered onboarding checks pass. The frontend build and all 18 existing native shell unit tests pass. `cargo fmt -- --check` and an offline native `cargo check` pass with bundle sidecars disabled for compile checking, because this clean source checkout has not staged release resources.

## Consequences and limits

- Copy checks exercise the shared helper with a controlled browser clipboard adapter, not the macOS system clipboard.
- The native reset listener is tested by dispatching the shell event and the Rust call compiles. A rebuilt installed-app CloseRequested/relaunch test remains required before release; this change has not replaced the user's installed app or published a desktop artifact.
- Reopening the gate cancels its outstanding authorization rather than restoring it. Approving an old code afterward does not resume that cancelled CLI process.
- Other external links in the main webview retain their existing handling; this change is limited to sign-in.

## Integration with current main

Main independently added the bridge-backed link, copy link and fresh-code restart in ADR-0143. PR #44 preserves those actions while using the checked platform opener, copy-code action, explicit cancel and ordered reset handling. The pending-flow restoration choice is superseded by this ADR: reopening the gate cancels the old flow. The 0.1.9 release history and newer natural workflows and Quick Chat changes remain intact.

Integration verification after resolving against main `8771069`: the production build and JSX-import check pass; the platform-opener, real-bridge/browser sign-in regression, harness adapters, rendered onboarding and Quick Chat appearance checks pass. The browser regressions use isolated fixture accounts and processes; they do not establish a packaged-app or public-release result. The build used Vite runner config loading to avoid writing its config cache through the shared node_modules symlink.
