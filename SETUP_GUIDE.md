# Autohand Squad Setup Guide

This guide is for internal Autohand engineers working on the local-first
Autohand Squad prototype and standalone runtime.

## Repository Shape

The repo has three main surfaces:

- `src/`: React UI for the Squad console.
- `server.mjs`: local Node bridge that serves the UI and talks to the
  installed `autohand` CLI.
- `daemon/`: Rust runtime that launches and controls the web app, daemon API,
  analytics daemon, and desktop tray/menu controller.

Release and installer logic lives in `.github/`, `scripts/`, and
`docs/release.md`. Product roadmap specs live in `goals/`.

## Prerequisites

Install these before working in the repo:

- Bun for the web app and local bridge.
- Rust stable with Cargo for the standalone runtime.
- The Autohand CLI on your `PATH` when testing real chat, run, terminal, or
  squad-member execution flows.
- GitHub access to the internal Autohand repository and Actions logs.
- Optional: a local `autohandai/community-skills` checkout if you need to test
  skill installation before remote registry fetches.

On macOS, the desktop tray binary appears as a menu bar controller. Windows and
Linux runtime builds are covered by CI, but local tray behavior depends on the
host desktop environment.

## First-Time Setup

From the repository root:

```bash
bun install
bun run build
cd daemon
cargo build --bins -j1
```

Run the complete local stack:

```bash
./target/debug/squad
```

Open:

```text
http://127.0.0.1:19821/
```

The `squad` launcher starts the web application, local daemon API, analytics
daemon, and tray/menu controller. The visible web app stays on port `19821` by
default. If the daemon API would collide with the web app, the launcher moves
the daemon API to another local port.

First-run or signed-out users are routed from `/` to `/welcome` until account
sign-in is ready and setup is completed or optional setup is skipped. The
onboarding flow reuses the existing runtime checks, tray/browser login action,
Settings LLM provider controls, workspace list, and squad-member creation route.

Use these lifecycle commands from `daemon/`:

```bash
./target/debug/squad status
./target/debug/squad restart
./target/debug/squad stop
```

## Development Modes

Use web-only development when you are changing React UI, copy, local bridge
routes, or browser behavior:

```bash
bun run dev
```

This starts `server.mjs` in Vite middleware mode at
`http://127.0.0.1:19821`. It is the fastest loop for UI work and bridge API
changes.

Use the full runtime when you are changing launcher, daemon, analytics, tray,
state, release, install, or cross-process behavior:

```bash
bun run build
cd daemon
cargo build --bins -j1
./target/debug/squad
```

Use the production-style preview path when you need to verify the built web
bundle without the Rust launcher:

```bash
bun run build
bun run preview
```

## Local Configuration

The local bridge reads these environment variables when `server.mjs` starts:

| Variable | Purpose |
| --- | --- |
| `AUTOHAND_SQUAD_HANDOFF_RETRY_MODE` | Default failed-handoff retry behavior. Supported values are `checkpoint`, `manual`, and `disabled`. |
| `AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER` | Maximum associated projects or repositories per squad member. Values are clamped from `1` to `5`. |
| `AUTOHAND_SKILLS_REPO_DIR` | Optional local skills registry checkout used before remote skill fetches. |
| `AUTOHAND_HOME` | Optional global Autohand home. The bridge derives Squad runtime state from it unless `AUTOHAND_SQUAD_HOME` is set. |
| `AUTOHAND_SQUAD_HOME` | Optional isolated Squad runtime state directory. Useful for clean local tests. |

The Rust runtime also accepts Squad config through CLI flags, environment
variables, admin config, and user config. See `daemon/README.md` for the full
precedence order and supported runtime fields.

Example isolated run:

```bash
AUTOHAND_SQUAD_HOME=/tmp/autohand-squad-dev \
AUTOHAND_SQUAD_MAX_PROJECTS_PER_MEMBER=3 \
AUTOHAND_SQUAD_HANDOFF_RETRY_MODE=manual \
./daemon/target/debug/squad
```

## Local State

The prototype intentionally keeps most state local:

- Browser local storage stores roster, messages, theme, language, automations,
  tasks, and handoff preferences.
- Repo-local `.autohand/agents/<member-id>/` stores isolated squad-member
  profile files and Autohand config.
- `~/.autohand/squad/` stores runtime daemon state, install records, logs,
  queue records, run records, config, telemetry, sync, update, analytics, web
  server, and tray state.
- `~/.autohandsquad/` stores local worker/workspace data used by the prototype.

For a clean UI-only test, clear the browser's local storage for
`127.0.0.1:19821`. For a clean squad-member profile, remove only the matching
repo-local `.autohand/agents/<member-id>/` directory. Avoid deleting
`~/.autohand` unless you intentionally want to reset broader Autohand CLI
state, auth, and config.

For a clean first-run onboarding test, clear
`autohandSquad.v1.onboarding` from local storage or clear all local storage for
`127.0.0.1:19821`, then open `/`. Skip only defers optional setup after account
sign-in; it does not bypass the public-beta login requirement. The setup guide
remains resumable from the account menu.

The repeatable browser check is:

```bash
bun run check:onboarding:browser
```

It starts the preview server when needed, launches a clean headless Chrome
profile, verifies `/` routes into `/welcome`, skips into `/squad`, resumes setup
from the app shell, opens the Settings LLM provider controls, and writes
screenshots to `.codex-artifacts/`.

## Verification

Use the smallest check that proves your change, then run broader checks before
opening a PR.

For docs-only changes:

```bash
bun run check:server
```

For web UI, bridge API, copy, routes, or frontend state:

```bash
bun run check:server
bun run check:onboarding
bun run build
```

For runtime, daemon, analytics, tray, state, or launcher behavior:

```bash
cd daemon
cargo fmt -- --check
cargo test -j1
cargo build --bins -j1
```

For release workflow, installer manifest, or package scripts:

```bash
bun run check:release
```

For a full local preflight:

```bash
bun run ci
```

When changing user-visible UI, verify the exact route in a browser. Important
routes are listed in `README.md`. When changing release behavior, also review
`docs/release.md`.

## Troubleshooting

If port `19821` is busy, stop the existing stack first:

```bash
cd daemon
./target/debug/squad stop
```

If the built app is stale, rebuild before relaunching:

```bash
bun run build
```

If the UI says the Autohand CLI is missing, confirm that `autohand` is on your
`PATH` and that `autohand --version` works in the same shell.

If skill installation does not find a local skill, set `AUTOHAND_SKILLS_REPO_DIR`
to a local skills repository or let the bridge fetch from
`https://skilled.autohand.ai`.

If runtime behavior looks wrong after repeated tests, start with
`./target/debug/squad status`, then stop the stack and use an isolated
`AUTOHAND_SQUAD_HOME` for the next run.

## Internal Contribution Checklist

Before opening a PR:

- Keep visible product language consistent: use `Autohand Squad` and
  `squad member`.
- Preserve legacy compatibility unless the PR explicitly removes it.
- Update README route, behavior, setup, or configuration sections when the
  user-facing contract changes.
- Update `SETUP_GUIDE.md` when local setup, state, validation, or contributor
  workflow changes.
- Update `docs/release.md` when release, installer, manifest, or CI gates
  change.
- Add or update focused tests when changing shared runtime, bridge, state, or
  release behavior.
- Fill out the pull request template with release impact and verification.
- Ask for owner review on changes under `daemon/`, `server.mjs`, `src/`,
  `.github/`, `scripts/`, and release docs.
