# Changelog

All notable changes to Autohand Squad. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
SemVer. Nightly builds publish the **Unreleased** section as-is; a stable
release moves it under a version heading.

Release notes on GitHub add a download table and the categorised pull-request
list to the section for that version.

## [Unreleased]

### Added
- **Workflows in channels**: automations that trigger on a message, a
  reaction, a schedule, or a webhook, run their steps through squad members,
  and pause at approval gates you clear with a button or an emoji.
- **Git as a channel object**: bind a repository folder to a channel and its
  commits, pull requests, and CI results land in the stream as one-line rows.
  Members can open a pull request once their autonomy ladder allows it.
- **Canvases**: Markdown documents in a channel or a member chat that you and
  the members edit together. Every save is an attributed revision with a diff
  and Revert; mention `@canvas:<slug>` to hand one to a member.
- **Media with anchored comments**: images and video render inline in
  channels, and a comment can anchor to a region, a moment, or both. The
  member receives the path, the region, and an extracted frame.
- **Cross-surface search**: one index over messages, channels, members, runs,
  tasks, handoffs, canvases, and workflow runs, grouped by type, with recent
  searches and deep links that highlight the record in place.
- **Activity feed**: agent replies and run output now show a semantic feed of
  what happened (read, search, edit, shell, status) with a Raw toggle, in
  member chat, channel replies, and the Execution panel.
- **Notifications**: native alerts for finished and failed runs, waiting
  handoffs and approvals, and mentions, suppressed while that conversation is
  on screen. A bell beside search carries the unread feed.
- **Member history**: a durable per-member record of every run, reply, edit,
  shell command, handoff, and approval, filterable by kind and exportable.
- **Remote members**: run a member on another machine's bridge. Chat, streams,
  and runs are forwarded with a bearer token and replies stream back marked
  with the bridge that ran them.
- **Multi-user relay**: a relay you host yourself, so a team shares channels
  and messages. The sidebar gains a workspace switcher and Settings a Relay
  section.
- **Presence and stop**: live per-member state with a stop control.
- **Members that introduce themselves**: a new member's first message says
  what it is, where it works, what it is set up for, and when it will stop and
  ask, composed from its own configuration rather than asked of a model
  (ADR-0034).
- **Describe a member and the page fills itself in**: one sentence designs the
  whole member, with the wait naming how long it has been, when it will stop,
  and a Stop that leaves your sentence intact. The instructions and the brain
  card are editable behind a disclosure (ADR-0031, ADR-0035).
- **Members take breaks, brief you, and improve themselves**: a member can
  decline work in its own voice, opening its chat leads with what changed
  since your last visit, and a chief-of-staff pass proposes skills and rules
  it needs (ADR-0027, ADR-0028, ADR-0029).
- **Work in the sidebar**: the surface listing what every member is doing now
  has a permanent row beside Inbox and Agents (ADR-0037).
- **Replies in the Inbox**: a member answering you in a direct message reaches
  the surface named for what needs you.
- **Boot screen**: the window paints the mark and one line before the bundle
  parses, then real start-up checks replace it (ADR-0033).

### Changed
- **Mission Control is now Work.** The old name promised a command centre for
  what is a roster of who is on what. The page drops its display headline,
  metric tiles, card grid, five-column table and status glossary for one
  column of divider rows (ADR-0037).

### Fixed
- Route plug-ins could load twice on a cold bridge, which made every feature
  handle each event twice (duplicate notifications and audit rows).
- Tailwind only scanned four component directories, so styles used by newer
  features were never generated.
- The form-control font reset was unlayered and overrode every utility, so
  fonts and sizes never applied to inputs and textareas.
- A local `tauri build` bundled whatever runtime happened to be staged, so a
  desktop build could ship the previous release's server.
- CI's release dry run never fetched the vendored Autohand CLI and failed on
  every platform.
- Designing a member always timed out, so every custom role came back from the
  deterministic fallback with generic skills however good the description.
  The designer was waiting on MCP servers it cannot use; it now gets none, is
  warmed when the screen opens, and starts each draft with a clean
  conversation (ADR-0036).
- The draft asked a model for a brain-card field the app has no place for and
  never asked for three it does, so three of a designed member's seven fields
  were boilerplate.
- A new member introduced itself and then told you what *you* do, because the
  brain card is written to the member as "you" and was quoted verbatim.
- Designing a member was dead in the installed desktop app: the route imported
  a file the app does not ship, so the loader skipped it silently. A check now
  walks the bridge's import graph.
- The Work page (formerly Mission Control) forced a light palette in dark
  mode, so it rendered white inside a dark app.
- Skill installs and failures were filed as memory proposals needing a
  decision, which buried the Inbox under rows that needed none.
- The new-member page scrolled itself away from the answer, so the line saying
  whether a model or your description designed the member was never seen.
- A deleted member came back on the next launch. Deleting removed it from
  storage, and the seed list read "missing from storage" as "never seen" and
  added it again (ADR-0038).
- The window can be dragged from anywhere along the top band, on every page.
  Dragging used to depend on whichever header a page rendered, so it worked
  only on slivers and not at all on a member's Permissions page. Content also
  no longer starts under the traffic lights (ADR-0040).
- Skills you already have in `~/.autohand/skills`, `~/.claude/skills` or
  `~/.agents/skills`, and the same folders in your workspace, are now found
  and installed. They used to be invisible, so a member asking for one failed
  with "not found in Skilled catalog" (ADR-0039).

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
