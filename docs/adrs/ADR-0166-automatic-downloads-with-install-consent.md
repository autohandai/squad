# ADR-0166: Discover and download updates; ask before installation

Date: 2026-11-03. Status: Accepted.

## Context and evidence

The user had to look for releases manually and the automatic-check switch was
under System. Their screenshot showed installed 0.1.16, public 0.1.14 and
“Updated to 0.1.16”. The preview correction already on main addresses that
particular comparison, but it did not address the next release: adding a
regression to `check-desktop-updates.mjs` reproduced an available 0.1.6 hidden
behind a completed 0.1.5 receipt. The test failed with “Updated to 0.1.5.”
instead of “Version 0.1.6 is available”.

Inspection also found that the bridge trusted the daemon's `updateAvailable`
comparison, although its own `appVersion` may differ. A regression exercises a
daemon already at the published version serving an older app. Both discovery
and the installer preflight now compare against the app version.

The user explicitly chose automatic downloads with a prompt before installing
or restarting, and asked that the choice remain configurable.

## Decision

Settings › Updates owns both preferences. Preserve the saved automatic-check
choice (default on); automatic downloads require opt-in (default off). Turning
checks off suppresses unattended downloads too. Manual checks remain available.
Preference values reflect the bridge's saved result; failed saves do not imply
success. The original System setting key is retained so existing choices survive.

One bridge policy owns automatic downloads across windows and a five-minute
background timer, rechecking consent before starting. It uses the existing
official-source, platform, SHA-256, redirect, size and timeout checks and the
existing durable operation. Ready downloads survive restarts. A failed or
cancelled attempt waits for a manual retry for that version. Discovery never
invokes installation or stops running work. Explicit Install remains the
consent boundary and retains ADR-0145's explanation that running work stops.

A calm, nonmodal notice offers Review update and Later, including with the
sidebar hidden. Later snoozes that version/stage in the current browser session
for one day; the Updates page remains accessible. A newer release, manual check,
or check failure wins over a previous completion receipt. Preview builds never
offer a downgrade.

## Consequences and validation

- Automatic download uses bandwidth only after opt-in; the person must still
  approve each installation. There is deliberately no unattended installation.
- This retains ADR-0130's installer and signature checks, not a new OTA signing
  format. SHA-256 from the release feed is not an independent signed manifest.
  Notarization, public release publication and installed-app proof remain
  distinct from local/browser tests.
- Checks depend on the local daemon and an available official release. Older
  installations receive this behavior only after installing a new build.
- The notice's snooze is per browser session; it is not synchronized across
  devices or windows. Downloads are bridge-owned and are synchronized.
- `node scripts/check-desktop-updates.mjs` covers stale receipts and app/daemon
  mismatch alongside existing trusted-download cases. `check:update-flow`
  covers durable lifecycle/cancellation. `check:automatic-updates` uses the real
  flow, checksum and files with a fixture installer, exercising opt-in, disabled
  checks, concurrency, restart, cancellation, manual retry, failure retention
  and explicit installation. No fixture executable is run.
- `check:updates:playwright` drives real rendered controls and bridge-backed
  preferences/discovery at desktop and phone sizes, with installer endpoints
  mocked. Browser evidence therefore does not prove native replacement.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/) distinguishes
checking, downloading and installing and requires updater signatures for its
own artifact format; [Electron updates](https://www.electronjs.org/docs/latest/tutorial/updates)
documents notifying the user and choosing the restart. The existing custom
installer contract remains in use here.
