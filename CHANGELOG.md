# Changelog

All notable changes to Autohand Squad. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
SemVer. Nightly builds publish the **Unreleased** section as-is; a stable
release moves it under a version heading.

Release notes on GitHub add a download table and the categorised pull-request
list to the section for that version.

## [Unreleased]

## [0.1.5] - 2026-09-24

### Added
- First run ends in a conversation: point at a folder, meet a teammate
  suggested from what the folder contains, and open the chat with the first
  message already drafted.
- Squad recruiting: when a channel's project needs a role nobody in it covers,
  that member asks to join. Only you see the request; Add or Not now. On by
  default (Settings → Chat → Squad suggestions).
- Folder profiles (`POST /api/workspaces/profile`): languages, frameworks,
  and needs detected from marker files and dependencies.

- Native desktop app (Tauri 2): system-webview window, menu bar (File › New ›
  Agent / Channel, View › Inbox / Agents / Channels / Mission Control), tray
  with account, plan usage gauges, members, and service controls.
- Installers for macOS (Apple Silicon and Intel), Windows x64, and Linux x64
  (Debian and AppImage), each bundling Node, the daemon, analytics, the
  `squad` CLI, and the pinned Autohand Code CLI.
- Nightly builds from `main` on the canary channel; Settings → Updates and the
  tray check GitHub Releases for the selected channel.
- Autohand account sign-in from the app (`squad login`), Codex OAuth and
  Claude Code sign-in from the member harness settings, real sign-out.
- Bird-of-Aotearoa member portraits, channel projects, native folder picker,
  member-to-member delegation, channels created by members.
- Composer syntax: `/` commands, `$` skills, `!` shell, `@` mentions with
  presence; queued follow-ups can steer a running reply.
- Warm Autohand Code sessions (follow-ups answer in seconds), OpenTelemetry
  log format for every runtime component.

### Changed

- Channel presence is one living line under the composer ("Iris, Noah and 2
  others are thinking…"); replies appear when they start instead of as
  placeholder rows.
- A member that keeps producing events is never cut off: the chat timeout is
  an inactivity window with a 45-minute ceiling.
- Autohand Sans and Autohand Mono ship with the app; no font CDN.
- Chat, channel, execution panel, and inbox surfaces redesigned; the inbox
  badge clears with "Mark all read".
- The device sign-in page names the product "Autohand Desktop".

### Fixed

- Fresh desktop installs no longer require the legacy tray binary.
- The desktop title bar no longer shows the window behind the app.
- Channel composer send button is no longer covered by the feedback button.

## [0.1.4] - 2026-08-31

- Release pipeline fixes for the Windows installer smoke test; runtime
  binaries, portable archives, and installer manifests for all four targets.

## [0.1.3] - 2026-08-31

- Upload macOS installer assets from the release workflow.

## [0.1.2] - 2026-08-31

- Installable desktop release pipeline with signed and notarised builds when
  credentials are present.

[Unreleased]: https://github.com/autohandai/squad/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/autohandai/squad/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/autohandai/squad/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/autohandai/squad/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/autohandai/squad/releases/tag/v0.1.2
