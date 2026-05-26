# Autohand Squad

Local-first Autohand Squad console for launching and monitoring isolated Autohand CLI squad members from a repository browser.

## What was mapped

- Web stack: Bun-packed executable serving an Express/Vite React app from `http://127.0.0.1:19821`
- Local store: browser local storage for roster/message preferences and `.autohand/agents` for isolated CLI profiles
- Main data concepts: agents, sessions, tasks, triggers, skills, MCPs, connectors, memory events, and extension status
- Main UI surfaces: squad member roster, conversation task composer, new squad member form, squad member home, work record, memory, skills, automations, permissions, feedback, and extensions
- Public reference: Autohand Squad presents squad members as always-on digital employees with role templates, configurable tools, memory, guardrails, conversation tasks, and automated tasks

This prototype implements a fresh Autohand Squad interface around local Autohand CLI processes.

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

## Product Goals

The implementation roadmap lives in [goals/README.md](goals/README.md). Each
goal also has a paste-ready Codex `/goal` prompt in
[goals/codex/README.md](goals/codex/README.md).

| Goal | Codex `/goal` |
| --- | --- |
| [01: Agent Mission Control](goals/01-agent-mission-control.md) | [Start Goal 01](goals/codex/01-agent-mission-control.goal.md) |
| [02: Role Depth Brain Cards](goals/02-role-depth-brain-cards.md) | [Start Goal 02](goals/codex/02-role-depth-brain-cards.goal.md) |
| [03: Memory Inbox](goals/03-memory-inbox.md) | [Start Goal 03](goals/codex/03-memory-inbox.goal.md) |
| [04: Permission Ladder](goals/04-permission-ladder.md) | [Start Goal 04](goals/codex/04-permission-ladder.goal.md) |
| [05: Task Evidence Timeline](goals/05-task-evidence-timeline.md) | [Start Goal 05](goals/codex/05-task-evidence-timeline.goal.md) |
| [06: Layered Context Model](goals/06-layered-context-model.md) | [Start Goal 06](goals/codex/06-layered-context-model.goal.md) |
| [07: Evaluation Hooks](goals/07-evaluation-hooks.md) | [Start Goal 07](goals/codex/07-evaluation-hooks.goal.md) |
| [08: Context Packs](goals/08-context-packs.md) | [Start Goal 08](goals/codex/08-context-packs.goal.md) |
| [09: Run Recipes](goals/09-run-recipes.md) | [Start Goal 09](goals/codex/09-run-recipes.goal.md) |
| [10: Agent Handoffs](goals/10-agent-handoffs.md) | [Start Goal 10](goals/codex/10-agent-handoffs.goal.md) |
| [11: Skill Health Panel](goals/11-skill-health-panel.md) | [Start Goal 11](goals/codex/11-skill-health-panel.goal.md) |
| [12: Failure Replay](goals/12-failure-replay.md) | [Start Goal 12](goals/codex/12-failure-replay.goal.md) |

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
