# ADR-0150: Recover from refused app exchanges and expose installation directly

Date: 2026-10-27
Status: Accepted

## Context and evidence

The operator downloaded 0.1.11 from a local preview. The persisted live
`GET /api/updates/progress` returned `failed`, `verified: true`,
`installMode: restart`, and a native `--squad-swap-update` failure:
`Operation not permitted (os error 1)`. The original app reopened. The sidebar
offered only View and displayed the entire executable command and bundle paths.

`SQUAD_UPDATE_NATIVE=<local-preview-executable> node scripts/check-mac-update.mjs`
passed: real DMG, ad hoc signature checks, temporary-directory exchanges and
restore. That test did not establish that macOS permits exchanges of the real
installed bundles. Capability checked POSIX parent writability, which is not
proof of app-management permission. The browser regression in
`node scripts/verify-work-profile-browser.mjs` failed the assertion that a
verified download offers installation directly in the directory sidebar.

A first hypothesis was a change in developer signing identity. Direct
`codesign -dv --verbose=4` inspection disproved it for this incident: both
current and staged apps have `Signature=adhoc` and `TeamIdentifier=not set`.
The incoming plist has no NSUpdateSecurityPolicy. Filtered tccd/syspolicyd logs
did not establish a more specific policy cause. Do not report this incident as
a proven signing mismatch or TCC diagnosis.

[Sparkle's primary installer implementation](https://github.com/sparkle-project/Sparkle/blob/2.x/Autoupdate/SUPlainInstaller.m)
provides independent evidence that atomic exchange can be refused by macOS
bundle policy even when ordinary moves are suitable. Its policy-specific
cases are supporting design evidence, not a diagnosis of this installation.

## Decision

Keep atomic exchange first. For a permission or unsupported-exchange refusal,
the native worker uses exclusive same-volume moves in a private recovery
directory: preserve the old bundle, place the new bundle, then put the old
bundle at the original staging path. Persist a phase journal before replacement.
Restore the original layout if placement or backup placement fails. Refuse an
existing recovery directory; never overwrite an interrupted backup. Unknown
atomic errors do not initiate replacement. Neither path deletes user state.

The rollback path reports a restore failure as such. The detached helper saves
full diagnostics privately and exposes a short actionable error. Keep the
verified DMG and offer the system installer as a separate explicit recovery
choice. Do not change OS permissions or bypass signing validation.

Settings and expanded sidebars use the same install label and operation.
A ready download, including one retained after a failed installation, offers
Install and restart instead of View. Install still observes ADR-0145: managed
work stops only after installer verification and duplicate installs are refused.

## Consequences and proof boundaries

- The move fallback has a brief interval with no bundle at its installed path;
  atomic exchange remains preferable when available. A process crash during
  fallback leaves the phase journal and recovery bundle for manual recovery.
  Fully automatic recovery after power loss is not implemented here.
- A system policy can deny both exchange and ordinary moves. In that case the
  installer action is the recovery path; no blanket admin privileges are added.
- Already installed versions run their old helper. Publishing a fixed binary
  cannot retrofit that code; one manual installation may be necessary.
- Filesystem failure injection covers permission refusal, placement failure and
  restore failure. Temporary signed bundles and mocked openers do not prove a
  successful update of an installed, registered app or Apple notarization.

## Validation

`rustc --test src-tauri/src/update_transaction.rs -o /private/tmp/squad-update-transaction-tests`
and that executable exercise real directories with only the failing syscall
result injected. The browser check exercises the actual sidebar and Settings
components against isolated operation fixtures. Backend update-flow and
desktop-update checks retain checksum, download, cancellation and restart
admission coverage. Final native/app and browser outcomes are reported
separately from these focused checks.

The final source check compiled `update_swap.rs` in a headless harness against
the runtime's existing `anyhow` and `libc` dependencies: six tests passed,
including refusal before any mutation when a recovery journal already exists.
`SQUAD_UPDATE_NATIVE=<that-harness> node scripts/check-mac-update.mjs` also passed
with real DMGs and signed fixture bundles. Application launch remained mocked.

## Manual-install correction found before publication

Final validation reproduced a second failure: a retained `failed`, verified
0.1.11 operation rendered "Could not update" and "Install and restart" even
when the running app was 0.1.12. `load()` only recognized an exact version
match in `installing` or `restarting`; the recommended manual recovery left
older failures actionable. This was a distinct lifecycle gap, rather than
evidence that the original macOS policy diagnosis was wrong.

The bridge now reconciles any superseded operation on load and before install,
removing its installer and plan references without deleting the cached file.
Both UI surfaces apply the same reconciliation to late responses. Shared
version ordering distinguishes stable and prerelease versions; unknown versions
keep their existing state. Tests cover macOS, Windows and Linux recovery and
assert that an obsolete installer neither opens nor stops work.

The unpublished 0.1.12 workflow was cancelled after this reproduction. Its tag
remains unchanged; the corrected code ships as 0.1.13.
