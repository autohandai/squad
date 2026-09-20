# Desktop and Multi-Harness Delivery Plan

This plan is the execution map for `docs/desktop-multi-harness-design.md`. Run
the seven goals in order. Do not begin a later goal while an earlier goal has an
unresolved compatibility or proof failure.

## Sequence

| Order | Goal | Finish line |
| --- | --- | --- |
| 13 | SDK and runtime baseline | Squad pins Autohand Agent SDK 1.0.5 and proves the bundled CLI/runtime handshake. |
| 14 | Harness contract and Autohand adapter | Current Autohand behavior runs through a normalized adapter and event contract. |
| 15 | Codex and Claude Code adapters | Both external harnesses detect, preflight, stream, stop, and resume to their documented capability level. |
| 16 | Per-member harness assignment | Users can create and edit members with a sticky harness choice and honest readiness UI. |
| 17 | Mixed-harness orchestration | Channels, runs, handoffs, evidence, permissions, and workspace leases work across all three harnesses. |
| 18 | Tauri 2 desktop shell | The product launches in a native window and creates developer DMG/EXE installers without external Node. |
| 19 | Signed release and updates | Signed/notarized installers and signed channel updates pass clean-machine release acceptance. |

## Phase 1: Stabilize the Autohand runtime

Upgrade the exact SDK/CLI pair before extracting adapters. The app currently
hard-pins 1.0.4 in both `package.json` and `scripts/check-agent-sdk.mjs`, while
1.0.5 is additive and ships the session-awareness behavior needed by a team
control plane.

Deliverables:

- exact 1.0.5 dependency and lockfile
- SDK import, bundled CLI startup, source provenance, and required API checks
- session-awareness event and peer-snapshot coverage
- runtime diagnostics that distinguish bundled and explicit override CLIs
- no implicit mutation of the user's system Autohand installation

Exit gate: `bun run check:sdk`, server syntax, web build, and a focused prompt
smoke pass with the bundled CLI.

## Phase 2: Introduce the adapter seam without changing behavior

Extract the hard-wired Autohand execution path behind `HarnessAdapter`. Add a
registry, readiness API, normalized event schema, and a versioned
`harnessAssignment` default. Keep public chat/run routes stable.

Deliverables:

- adapter contract and registry modules outside the `server.mjs` monolith
- Autohand adapter wrapping the existing SDK and CLI paths
- normalized event mapper and raw trace reference
- `/api/harnesses` public readiness response
- migration/defaulting for existing members and runs
- deterministic fake-harness fixtures for error, interrupt, and event-ordering
  tests

Exit gate: all existing Autohand checks pass through the adapter, and a
zero-match search proves general routing no longer calls Autohand-specific
launch functions directly.

## Phase 3: Add Codex and Claude Code

Implement the external adapters one at a time, using current vendor-documented
machine-readable interfaces.

Codex:

- discover the executable and version
- connect through `codex app-server` stdio JSON-RPC
- initialize, start/resume a thread, start a turn, stream normalized events,
  resolve supported approvals, interrupt, and close
- generate or pin protocol schemas per supported Codex version
- use `codex exec --json` for bounded smoke checks only

Claude Code:

- discover the executable and version
- run print mode with streaming JSON input/output and verbose events
- capture session ID, resume, stream normalized events, interrupt, and close
- translate model, workspace, tool, and permission flags only when supported
- fail preflight when Squad's safety contract cannot be represented

Exit gate: deterministic fake-CLI tests plus one live read-only smoke per
harness. Missing credentials or unsupported installed versions are a blocker to
the live proof, not a reason to mark the adapter complete.

## Phase 4: Expose the choice on each member

Add the assignment to creation, profile, launch payloads, local persistence, and
runtime summaries. Keep the UI document-like and compact.

Deliverables:

- **Runs with** control in member creation
- Harness profile/settings page
- readiness and capability copy
- member normalization and backward-compatible migration
- harness label in preflight, active runs, evidence, and handoffs
- blocked launch with a direct setup action
- no automatic fallback

Exit gate: browser acceptance creates three members with the same brain card and
different harnesses, reloads them, and proves each launch request retains the
chosen harness.

## Phase 5: Make a mixed squad safe and observable

Route all relevant work through the registry, not only direct chat. Channels,
recipes, goal runs, task runs, handoffs, stop/quit, telemetry, evidence, and
recovery must carry the harness identity.

Deliverables:

- common run/session fields and event persistence
- workspace read/write lease coordinator
- queue reason and lease owner visibility
- adapter-aware stop, restart, orphan cleanup, and resume
- bounded cross-harness handoff context packs
- capability-aware permission mapping
- per-harness usage and failure breakdowns

Exit gate: a temporary fixture repository completes a three-member handoff
chain across Autohand, Codex, and Claude Code, preserves all three harness IDs,
and proves that two concurrent write-capable runs are serialized by default.

## Phase 6: Add the Tauri 2 application shell

Create `src-tauri/` and reuse the current service/runtime payload. Tauri owns the
window and tray; it must not launch the legacy tray alongside itself.

Deliverables:

- native main window, single instance, tray, deep links, and launch-at-login
- staged `squad` services, Autohand CLI, Node, `server.mjs`, production modules,
  and web assets as sidecars/resources
- authenticated loopback bootstrap and native recovery screen
- GUI-safe external harness path discovery
- Tauri build scripts and macOS/Windows CI matrix
- DMG and NSIS developer installers using existing public asset names
- preserved portable/headless distribution

Exit gate: install and launch on macOS and Windows without system Node, open the
native window from Applications/Start Menu, relaunch into the same instance,
and pass an installed-runtime health smoke.

## Phase 7: Production distribution and update trust

Wire credentials only after the unsigned Tauri packages are proven. Keep
operating-system signing and Tauri update signatures as separate gates.

Deliverables:

- macOS Developer ID signing, notarization, stapling, and Gatekeeper validation
- Windows Authenticode signing and signature validation
- signed Tauri updater artifacts for stable/beta/canary
- immutable tag/SHA/channel enforcement retained from the existing workflow
- clean-machine install, update, restart, rollback/recovery, and uninstall proof
- release notes that accurately state trust and external-harness requirements

Exit gate: both public installers validate their publisher/signature on clean
machines, launch successfully, and update from the previous prerelease without
losing Squad state. Do not publish or move a stable tag without explicit release
approval.

## Cross-cutting proof policy

Each goal must leave four evidence lines where relevant:

1. deterministic automated checks
2. actual harness/runtime smoke
3. browser or native product acceptance
4. release/deployment evidence

A green unit/build suite does not replace missing live harness, native install,
signing, or published-artifact proof. When credentials, certificates, a vendor
CLI, or a target OS are unavailable, stop and report that boundary rather than
weakening the finish line.

## Main risks and controls

| Risk | Control |
| --- | --- |
| Vendor event formats drift | Version detection, generated/pinned schemas, fixture corpus, unknown-event tolerance. |
| Permission semantics differ | Capability matrix and least-permissive mapping; block unsafe gaps. |
| Concurrent agents edit the same repo | Squad-owned workspace leases above all adapters. |
| GUI cannot find terminal-installed CLIs | explicit executable paths plus GUI-safe discovery and diagnostics. |
| Auth tokens leak between member homes | never copy vendor auth; store no secrets in member records or logs. |
| Tauri duplicates the existing tray | Tauri uses the service-only launch path and owns the only desktop tray. |
| Installer migration regresses payloads | retain current packaging smoke tests until Tauri reaches parity. |
| Unsigned build is mistaken for release readiness | separate build, native install, OS signing, update signing, and public release gates. |

