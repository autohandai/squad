# Developing Autohand Squad

How Squad is put together, how to build each part, and which checks to run.
Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow
and [SETUP_GUIDE.md](../SETUP_GUIDE.md) for first-time setup and
troubleshooting. Release maintainers want [release.md](release.md).

- [How the pieces fit](#how-the-pieces-fit)
- [Run from source](#run-from-source)
- [Desktop app (Tauri 2)](#desktop-app-tauri-2)
- [Computer Use inputs](#computer-use-inputs)
- [Native runtime](#native-runtime)
- [Configuration](#configuration)
- [Local bridge API](#local-bridge-api)
- [Agent channels](#agent-channels)
- [Routes](#routes)
- [Checks](#checks)
- [README screenshots](#readme-screenshots)
- [CI and release](#ci-and-release)
- [Writing conventions](#writing-conventions)

## How the pieces fit

| Part | Where | What it does |
| --- | --- | --- |
| Web app | `src/` | The React UI. |
| Local bridge | `server.mjs`, `server/` | A Node server that serves the built UI and talks to the agent engines (the bundled Autohand CLI, Codex, Claude Code, ACP agents). |
| Native runtime | `daemon/` | Rust binaries that start and supervise the bridge, the daemon API, analytics and the tray / menu bar. |
| Desktop shell | `src-tauri/` | The Tauri 2 window that loads the bridge, with native title bar, vibrancy, single-instance relaunch and the boot sequence. |
| Bundled CLI | `vendor/autohand-cli/` | The pinned Autohand Code release, fetched by `bun run cli:fetch`. Not committed. |

State lives in `~/.autohand/squad/` (`bin/`, `daemon.json`, `install.json`,
`device-id`, `server.log`, `queue/`, `runs/`, `channels.json`) plus the app
state directory.

## Run from source

Prerequisites: Git, Node.js 22.13 LTS or 24+, Bun 1.3.13, Rust 1.90+ with
`rustfmt`. See [SETUP_GUIDE.md](../SETUP_GUIDE.md) for Linux packages.

Web-only loop, for React UI, copy, routes and bridge changes:

```bash
bun install --frozen-lockfile
bun run dev
```

Full runtime loop, for the launcher, daemon API, analytics, tray, local state,
installer or release behaviour:

```bash
bun install --frozen-lockfile
bun run build
cd daemon
cargo build --bins -j1
./target/debug/squad
```

Open `http://127.0.0.1:19821/`. First-run or signed-out users go to
`/welcome`; signed-in users who completed or skipped onboarding land on
`/squad`.

`squad` starts the web app, the daemon API, the analytics daemon and the menu
bar / tray controller, then opens the Squad URL. Lifecycle commands:

```bash
./target/debug/squad status
./target/debug/squad restart
./target/debug/squad stop
./target/debug/squad doctor
```

The internal daemon API moves off the web port when needed, so the app URL can
stay on `http://127.0.0.1:19821`. From the Autohand CLI, `/squad` opens the
same local URL with the current workspace selected.

## Desktop app (Tauri 2)

`src-tauri/` is the native shell: a system-webview window that loads the local
bridge, a tray, single-instance relaunch, and the same boot sequence as the
launcher (preflight, daemon, bridge, health handshake, native recovery
dialog). Closing the window keeps the squad running in the tray; Quit stops
the services.

```bash
bun run build                         # web assets
bun run cli:fetch                     # vendored Autohand Code release
node scripts/fetch-computer-use.mjs   # pinned engine + macOS permission host
bun run desktop:stage                 # stages runtime/ and the sidecars (Node, daemon, analytics, squad)
bun run desktop:build                 # .app + .dmg (macOS), NSIS (Windows), deb/AppImage (Linux)
bun run desktop:dev                   # window against a staged runtime, debug build
```

Local macOS builds use a complete ad-hoc app-bundle signature when
`APPLE_SIGNING_IDENTITY` is unset, and keep a configured Developer ID
identity. macOS notification permissions need the bundle identity; the
executable's linker signature alone is not enough. An ad-hoc signature is for
local use and gives no Developer ID trust or notarization. For a native-only
rebuild after staging, run `node scripts/build-native-shell.mjs --bundles app`.

On macOS the window uses a transparent title bar with the traffic lights over
the sidebar, and the sidebar is a native vibrancy surface; on Windows it uses
Mica. The web app detects the shell through its user agent
(`AutohandSquadDesktop/…`) and switches to transparent chrome and drag
regions.

The bundle carries the bridge under `Resources/runtime` and the sidecars next
to the executable. The shell points the runtime at them through
`AUTOHAND_SQUAD_WEB_SERVER`, `AUTOHAND_SQUAD_NODE`, `AUTOHAND_SQUAD_DAEMON` and
`AUTOHAND_SQUAD_ANALYTICS`, so a source checkout and the installed app run one
code path. Signing and notarization use the secrets described in
[release.md](release.md).

On first launch the app runs a preflight (state directory, bundled Node, web
bridge, bundled Autohand CLI, free ports). If anything fails it shows a native
dialog with the cause and **Retry / Open Logs / Quit** instead of a blank
page. The same checks run from a terminal:

```bash
"/Applications/Autohand Squad.app/Contents/MacOS/squad" doctor   # macOS
"%LOCALAPPDATA%\Autohand Squad\squad.exe" doctor                 # Windows
```

## Computer Use inputs

Computer Use is prepared at build time. `node scripts/fetch-computer-use.mjs`
verifies and reuses existing `vendor/computer-use` artifacts, downloading
missing engine archives from the pinned `computer-use-v0.28.2` release. On
macOS it builds the permission host from immutable commit
`fc92b70417cdae941ba8b104a6e7b3b5b52a07e2` in a temporary directory, verifies
the source archive and individual source hashes, targets macOS 13.0, and
includes the Apache licence, source notice and signed build provenance.

The host is built unmodified: what ships is `Autohand Computer Use.app` with
the identity `ai.autohand.computer-use`, the same app, consent text and icon
that Autohand Code installs with `autohand computer install`, so the CLI,
Squad and Autohand Desktop share one component and one macOS grant
(ADR-0162). At run time the bridge prefers the CLI's installed copy and falls
back to the bundled one. Building it needs the Xcode command-line tools.
Agents use the packaged inputs; they never download or build the engine while
working.

Flags: `--check` verifies prepared inputs without downloads or changes,
`--target linux/x64` (or another supported target) prepares one engine,
`--all` prepares every engine archive, and `--rebuild-host` rebuilds the macOS
host. Preparing both Mac architectures on macOS produces a universal host; Mac
host builds on other operating systems are unsupported.

`AUTOHAND_SQUAD_COMPUTER_USE_DIR` overrides the vendor input directory, and
`AUTOHAND_SQUAD_COMPUTER_USE_SOURCE_ARCHIVE` selects an already downloaded
source archive with the same fixed checksum. Staging defaults to the host
inside the vendor directory; `AUTOHAND_SQUAD_COMPUTER_USE_HOST` supplies a
separately verified host. Build preparation does not install the app or
request system permissions. Source pins make the inputs repeatable; compiler,
SDK and signature differences can still change the built executable, so the
receipt records the actual toolchain and output checksum rather than claiming
byte-identical builds.

## Native runtime

`daemon/` builds these Rust binaries:

- `squad`
- `autohand-squad-daemon`
- `autohand-squad-analytics`
- `autohand-squad-tray` / `autohand-squad-ui`

The daemon owns queued agent work, run records and logs, telemetry events, API
sync snapshots and update checks. The launcher checks account entitlement and
the `squad_daemon` feature flag before starting the stack. Release metadata
carries SHA-256 checksums for the installer and update path.

The tray / UI binary is separate from the daemon. It renders one menu model
for the macOS menu bar, the Windows tray, Linux AppIndicator /
StatusNotifier, or a browser fallback, and talks to the daemon API for status,
telemetry, updates, queue, logout, heartbeat and policy actions. The default
"Open Autohand Squad" target is `http://127.0.0.1:19821`; company config can
provide a hosted UI URL, fixed port, proxy, API gateway, launch-at-login
policy and telemetry policy. Quit from the tray stops the local stack, running
member `autohand` processes and any leftover Squad runtime processes.

The bundled Autohand Code release is pinned in `package.json`
(`autohand.cliVersion`) and vendored by `bun run cli:fetch` from the GitHub
release with checksum verification. Releases fail if the vendored binary is
missing or does not match the pin. `GET /api/runtime` reports the running CLI
version and whether it came from the vendored release, the Agent SDK package,
or `PATH`.

## Configuration

The bridge reads these environment variables when `server.mjs` starts:

| Variable | Default | Notes |
| --- | --- | --- |
| `AUTOHAND_SQUAD_HANDOFF_RETRY_MODE` | `checkpoint` | Retry behaviour for work handed from one member to another: `checkpoint`, `manual` or `disabled`. The workspace can follow this default or override it. |
| `AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER` | `5` | Most project folders per member. Values below `1` become `1`; values above `5` are capped at `5`. |
| `AUTOHAND_SKILLS_REPO_DIR` | `../../../community-skills` from this repository | Optional local skills-registry checkout used before remote skill fetches. |
| `AUTOHAND_SQUAD_UPDATE_REPO` | `autohandai/squad` | Repository checked for updates. |
| `AUTOHAND_SQUAD_UPDATE_SOURCE` | GitHub Releases | `api` uses the Autohand API manifest. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Exports logs over OTLP/HTTP; see [observability.md](observability.md). |

Example:

```bash
AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER=3 AUTOHAND_SQUAD_HANDOFF_RETRY_MODE=manual ./daemon/target/debug/squad
```

## Local bridge API

A selection of the routes `server.mjs` exposes. Feature notes in
[`docs/integration/`](integration/) document the rest.

- `GET /api/runtime`: the installed `autohand` binary and version, the
  project limit and handoff defaults
- `POST /api/setup/login`: hands sign-in to the tray / browser auth flow
- `GET /api/workspaces`: local folder workspaces under the user directory
- `POST /api/chat`: a one-shot reply for a direct conversation
- `POST /api/chat/stream`: streams direct or channel replies
- `POST /api/chat/reset`, `GET /api/sessions`: warm session control
- `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`: tracked background
  work, recent runs, one run with logs
- `POST /api/terminal`: opens Terminal in a workspace with `autohand`
- `GET /api/channels`, `GET /api/channels/events`: channel and thread state,
  and change events for open windows
- `POST /api/channels`: creates a channel; repeating the same id/name returns
  it, another channel with the same name returns 409
- `PUT /api/channels/sync`: merges browser caches without dropping other
  windows' records or reviving deleted channels; legacy `PUT /api/channels`
  replaces a snapshot and checks its revision when supplied
- `PATCH|PUT|DELETE /api/channels/:id`, `POST /api/channels/:id/members`,
  `GET|POST /api/channels/:id/threads`
- `GET /api/channel-actions`, `POST /api/channel-actions/:id/approve|decline`:
  member action receipts and approvals
- `PUT /api/members/:id/channel-access`: saves member configuration, or
  revokes it with `{ "removed": true }`
- `POST /api/agents/provision`: writes an isolated profile for a member
- `GET|POST /api/provider-settings`: provider and model settings
- `GET /api/harnesses`, `GET /api/harnesses/models`: engine readiness and
  model catalogs
- `GET /api/workspace-files`: mentionable project files, respecting Git
  ignore rules
- `POST /api/context-pack`: bounded handoff context and evidence
- `GET|POST /api/memory-inbox`: proposed memory events
- `GET /api/updates`: the last update check (`?refresh=1` checks again)

## Agent channels

Creating, editing and changing membership wait for bridge confirmation.
Channel settings include name, visibility and sidebar section. Failed creation
keeps the draft for retry. Local bridge writes are serialized and atomic.

Each channel records `name`, `visibility` (`public` | `private`),
`memberIds`, `creatorId`, `autoModeDefault` and `createdAt` / `updatedAt`.
Collaboration context travels with chat and run payloads (`/api/chat`,
`/api/chat/stream`, `/api/runs`) through `channelId`, `threadId`,
`parentMessageId`, `visibility`, `memberIds`, `autoModeDefault` and
`selfJudge`. The runtime stores it in `~/.autohand/squad/channels.json` so it
stays connected to queue and run telemetry.

A member may propose a channel with one
`SQUAD_ACTION: {"type":"create_channel", …}` line in a DM, channel reply or
successful background run. The bridge checks the member's current
`squad_create_channel` permission: ask shows an approval row, allow creates,
block refuses. The executing member and existing named teammates join, the
assigned folder becomes a project, and the purpose is saved under the
originating member and sent through the runtime once per teammate. Retries
reuse receipts; stopped or failed runs cannot execute actions.

## Routes

- `/welcome`
- `/squad`
- `/conversations/new`, `/conversations/new?member=<id>`,
  `/conversations/:sessionId?member=<id>`
- `/channels`, `/channels/:channelId`
- `/mission-control`
- `/settings`, `/settings/<section>`, `/usage`
- `/squad-members/new`
- `/squad-members/:id/home`, `/project`, `/triggers`, `/task`, `/memory`,
  `/skill`, `/model`, `/connector`, `/im`, `/permissions`
- `/extensions`

## Checks

Run the checks that match your change before opening a pull request:

```bash
bun run check:server
bun run check:onboarding
bun run build
cd daemon
cargo fmt -- --check
cargo test -j1 -- --test-threads=1
cargo build --bins -j1
```

`bun run ci` runs the broad set; use it before wide changes or anything that
affects a release. `bun run check:release` covers `.github/`, `scripts/`,
release metadata and installer manifests.

Browser checks drive a disposable headless Chrome against an isolated bridge
with fixture data. They need Chrome (or `CHROME_PATH`) and never read your
real Squad data or call a model provider unless the name says `:live`. A few
worth knowing:

| Check | What it covers |
| --- | --- |
| `check:onboarding:browser` | Account and provider readiness, Settings resume, keeping existing users' data, and the clean-install flow. |
| `check:fresh-install` | Only the clean-install regression: one or several Git repositories, project-specific suggestions, provisioning, failed delivery, restart and recovery. Results go to `.codex-artifacts/fresh-install/`. |
| `check:onboarding:recovery` | Service recovery after failed provisioning or partial saves. |
| `check:runtime-bootstrap` (`:browser`) | First-install CLI recovery without a system or bundled CLI, failed verification, retries and restart. |
| `check:runtime-source-staging` | The desktop source boundary against injected state, credentials and symlinks. |
| `check:member-creation:browser` | Normal and recommended member creation, duplicate submission and refresh recovery. |
| `check:member-config` | Config damage, write failures and permission-update recovery. |
| `check:channel-lifecycle` (`:browser`) | Channel lifecycle and restart, in the bridge and through the sidebar. |
| `check:agent-channel-actions` | Member action permissions, approval, retry and recovery with controlled model output. |
| `check:collaboration:browser` | The implement → QA → review → return path, parallel review, interruption and bridge restart. |

Live-provider results are reported separately in
[reports/squad-reliability.md](reports/squad-reliability.md).

## README screenshots

The images in `docs/assets/readme/` are generated, not hand-captured:

```bash
node scripts/capture-readme-screenshots.mjs              # all of them
node scripts/capture-readme-screenshots.mjs channel chat # only some
```

The script starts an isolated bridge with a stub identity server, fixture
engines (Autohand Code, Codex and Claude Code that answer locally) and six
invented members, seeds a direct message and a channel, and captures each
screen in headless Chrome at 1440×900, in light and dark where the README uses
both. It needs Chrome and `cwebp` (`brew install webp`). No real account,
folder, email or token can appear, and it never touches an installed Squad on
port 19821. Re-run it when a screen in the README changes, look at every image
before committing, and update the README alt text if the screen's content
changed.

## CI and release

- `.github/workflows/ci.yml` runs web checks, Rust runtime checks on macOS,
  Windows and Linux, and a release-manifest dry run.
- `.github/workflows/release.yml` builds platform runtime assets, packages
  the web bundle, assembles one portable archive per target, creates macOS
  DMGs, a Windows NSIS installer, and Linux Debian and AppImage packages,
  smoke-tests the installed runtimes, generates SHA-256 checksums, publishes
  the release manifest, and attaches the verified assets to the tag's GitHub
  release.
- Nightly canary builds run from `main` at 03:00 UTC when there are new
  commits.

The maintainer runbook is [release.md](release.md).

## Writing conventions

- Say `Autohand Squad` (or `Squad`) for the product and `member` for each
  configured agent. Keep API field names such as `workspace` unchanged.
- Use `project` or `folder` for a connected local work folder.
- Keep existing routes, local storage and legacy runtime compatibility unless
  a change removes them on purpose.
- Update the README, [guide.md](guide.md) or this page when routes, setup
  commands, configuration or visible behaviour change;
  [SETUP_GUIDE.md](../SETUP_GUIDE.md) when local setup or contributor workflow
  changes; [release.md](release.md) when CI, release, installer or runtime
  artifact contracts change.
- Record why in [`docs/adrs/`](adrs/), the standing UI rules in
  [DESIGN.md](../DESIGN.md), and what shipped in
  [CHANGELOG.md](../CHANGELOG.md).
