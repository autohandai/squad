# Autohand Squad

**A new native workspace for human + agent teams.**

Chat with teammates and specialized agents in one shared space, then move
directly into planning, project management, coding, and pull requests. Create
agents tailored to your workflows, let them collaborate with agents across
your team, and bring work once scattered across chat, trackers, and developer
tools into one place.

Autohand Squad is local-first. It launches and monitors isolated Autohand CLI
squad members from a repository browser.

## What it brings together

- Runtime: a Bun-packed executable serving an Express/Vite React app from `http://127.0.0.1:19821`
- Local data: browser storage for roster and message preferences, plus `.autohand/agents` for isolated CLI profiles
- Core concepts: agents, sessions, tasks, triggers, skills, MCPs, connectors, memory events, and extension status
- Workspace: the squad roster, shared conversations, member profiles, work records, memory, skills, automations, permissions, feedback, and extensions
- Squad members: always-on digital teammates with role templates, configurable tools, memory, guardrails, conversational tasks, and automations

## Run

```bash
bun install
bun run build
cd daemon
cargo build --bins -j1
./target/debug/squad
```

Open `http://127.0.0.1:19821/conversations/new`.

`squad` starts the local stack: the web application, the local daemon API, the
analytics daemon, and the macOS menu bar / desktop tray controller. It also
opens the configured Squad URL. Use these commands for lifecycle checks:

```bash
./target/debug/squad status
./target/debug/squad restart
./target/debug/squad stop
```

The internal daemon API moves off the web port when needed, so the visible app
URL can stay on `http://127.0.0.1:19821`.

From the CLI checkout, `/squad` opens this same local URL and passes the current
workspace as the initially selected repository folder.

## Configuration

The local bridge reads these environment variables when `server.mjs` starts:

| Variable | Default | Notes |
| --- | --- | --- |
| `AUTOHAND_SQUAD_HANDOFF_RETRY_MODE` | `checkpoint` | Default global retry behavior for failed handoffs. Supported values: `checkpoint`, `manual`, `disabled`. The Web UI can follow this bridge default or override it globally for the current console. |
| `AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER` | `5` | Maximum associated projects or repositories per squad member. Values below `1` are raised to `1`; values above `5` are capped at `5`. |
| `AUTOHAND_SKILLS_REPO_DIR` | `../../../community-skills` from this prototype | Optional local skills registry checkout used before remote skill fetches. |

Example:

```bash
AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER=3 AUTOHAND_SQUAD_HANDOFF_RETRY_MODE=manual ./daemon/target/debug/squad
```

The runtime command starts `server.mjs`, which serves the built Vite app and
exposes the local Autohand bridge:

- `GET /api/runtime` checks the installed `autohand` binary and version
- `GET /api/runtime` returns the effective Squad project limit and handoff defaults
- `GET /api/workspaces` lists local folder workspaces under the user directory
- `POST /api/chat` returns a one-shot conversational Autohand reply without creating an execution run
- `POST /api/runs` starts a background Autohand run and captures output
- `GET /api/runs` lists recent runs
- `GET /api/runs/:id` returns one run with logs
- `POST /api/terminal` opens Terminal in a workspace with `autohand`

## Build

```bash
bun run build
```

## CI and Release

The GitHub release lane lives under `.github/workflows/`:

- `ci.yml` runs web checks, Rust runtime checks on macOS/Windows/Linux, and a
  release-manifest dry run.
- `release.yml` builds platform runtime assets, packages the web bundle,
  generates checksums, publishes `manifest-<channel>.json`, and attaches
  GitHub artifact attestations.

The team runbook is in [docs/release.md](docs/release.md).

## Standalone runtime

The installable Squad runtime lives in `daemon/` and builds these Rust binaries:

- `squad`
- `autohand-squad-daemon`
- `autohand-squad-analytics`
- `autohand-squad-tray` / `autohand-squad-ui`

The runtime stores shared state in `~/.autohand/squad/` (`bin/`,
`daemon.json`, `install.json`, `device-id`, `server.log`, `queue/`, and
`runs/`). The daemon owns queue creation, run records/logs, telemetry events,
API sync snapshots, and update checks. The Autohand CLI launcher verifies
account entitlement, the `squad_daemon` feature flag, and the release artifact
checksum/signature before installing or updating these binaries.

The tray/UI binary is intentionally separate from the daemon. It renders the
cross-platform menu model for macOS menu bar, Windows tray, Linux
AppIndicator/StatusNotifier, or browser fallback and talks to the local daemon
API for status, telemetry, updates, queue, logout, heartbeat, and policy
actions. Default "Open Autohand Squad" target is `http://127.0.0.1:19821`;
company config can provide a hosted UI URL, fixed port, proxy, API gateway,
launch-at-login policy, and telemetry policy.

## Implemented routes

- `/conversations/new`
- `/conversations/new?member=b3bc502e795a`
- `/conversations/:sessionId?member=b3bc502e795a`
- `/squad-members/new`
- `/squad-members/:id/home`
- `/squad-members/:id/project`
- `/squad-members/:id/triggers`
- `/squad-members/:id/task`
- `/squad-members/:id/memory`
- `/squad-members/:id/skill`
- `/squad-members/:id/connector`
- `/squad-members/:id/im`
- `/squad-members/:id/permissions`
- `/extensions`

## Prototype behavior

- Creates new squad members in browser local storage
- Treats each workspace as a local folder inside the user directory
- Lets each squad member keep a configured list of associated projects or
  repositories, up to the runtime project limit
- Sends normal chat messages from the composer without adding execution records
- Lists online squad members and workspace files from `@` in the chat composer;
  file suggestions use git ignored-file rules when the workspace is a Git repo
- Starts real local Autohand CLI runs only from explicit run controls, automations, or Terminal handoff
- Treats each visible squad member as a configured CLI profile and passes that profile
  to chat and run processes with `--append-sys-prompt`
- Creates `.autohand/agents/<member-id>/config.json` and launches each process with
  `AUTOHAND_HOME`, `AUTOHAND_CONFIG`, and `--config` pointing at that isolated path
- Supports `autohand --prompt`, `autohand --auto-mode`, and `autohand --goal`
- Opens an interactive Terminal session for a selected squad member workspace
- Polls and displays run output in the execution panel
- Toggles automation state
- Exposes a global handoff retry policy in Settings, with an environment-backed bridge default
- Switches light and dark themes
- Persists agents, messages, handoff settings, and theme locally
