# Autohand Squad Runtime

This package builds the standalone Autohand Squad runtime.

## Binaries

- `squad`: foreground CLI for launching and controlling the full Squad stack
- `autohand-squad-daemon`: background local orchestrator
- `autohand-squad-analytics`: background analytics collector
- `autohand-squad-tray` / `autohand-squad-ui`: separate desktop controller binary
  for menu bar, system tray, AppIndicator/StatusNotifier, or browser fallback

## Run Contract

Run the product stack with:

```bash
squad
```

or, from the Autohand CLI wrapper:

```bash
autohand squad
```

The launcher starts the web application, the local daemon API, the analytics
daemon, and the desktop tray/menu controller, then opens the configured Squad
URL. `squad start` starts the same stack without opening a browser.

Use:

```bash
squad status
squad restart
squad stop
```

to inspect, restart, or stop the stack. Stop leaves the tray available as a
separate controller so it can start services again; Quit exits the tray after
stopping local Squad services and isolated member CLI processes.

## State

The shared state directory is `~/.autohand/squad/` unless `AUTOHAND_SQUAD_HOME`
is set.

It contains:

- `bin/`
- `daemon.json`
- `install.json`
- `device-id`
- `server.log`
- `queue/`
- `runs/`
- `config.json`
- `telemetry.jsonl`
- `sync.json`
- `update.json`
- `analytics.json`
- `analytics-snapshot.json`
- `web-server.json`
- `channels.json`
- `tray.json`

## Config Precedence

Highest to lowest:

1. CLI flags
2. Environment variables
3. Company/admin config (`AUTOHAND_SQUAD_ADMIN_CONFIG` or `/etc/autohand/squad/config.json`)
4. User config (`~/.autohand/squad/config.json`)
5. Defaults

Supported config fields are `host`, `port`, `fixedPort`, `openUrl`,
`hostedUiUrl`, `proxyUrl`, `apiGatewayUrl`, `apiBaseUrl`, `updateChannel`,
`launchAtLoginPolicy`, `telemetryPolicy`, `accountEmail`, and `planState`.

`openUrl` defaults to `http://127.0.0.1:19821`. Enterprise config can point the
desktop controller at a hosted UI URL, fixed local port, proxy, API gateway,
launch-at-login policy, and telemetry policy without changing the daemon API.

## Local API

The visible web application opens on `http://127.0.0.1:19821` by default. When
the stack is launched, the internal daemon API uses the configured daemon port
unless that would collide with the web app port; in that case the launcher moves
the daemon API to the next port and passes that port to the tray.

- `GET /health`
- `GET /status`
- `GET /queue`
- `POST /queue`
- `GET /runs`
- `POST /runs`
- `GET /runs/:id`
- `GET /runs/:id/logs`
- `GET /logs`
- `POST /telemetry`
- `POST /sync`
- `POST /updates/check`
- `POST /heartbeat`
- `POST /auth/logout`
- `POST /launch-at-login/toggle`
- `GET /config`
- `GET /channels`
- `POST|PUT /channels`
- `POST /restart`
- `POST /stop`

`GET /channels` returns the squad channel/thread snapshot from `channels.json`
(channel `visibility`, `memberIds`, `autoModeDefault`, and thread
`channelId`/`parentMessageId` metadata). `POST|PUT /channels` persists the
snapshot proxied from the web app so channel orchestration survives web reloads
and daemon restarts; `GET /status` reports `channels` and `channelThreads`
counts, and queue/run records carry optional `channelId`/`threadId` fields for
channel-dispatched work. Auto mode (self-judge) metadata defaults to off when
absent.

`POST /restart` requests a drain: the daemon stops accepting new work, records
the drain in `daemon.json`, then exits so the launcher can start a fresh daemon.
`POST /runs` records run state under `runs/`, executes a local `autohand`
process, and stores logs next to the run record.

## Desktop Controller

`autohand-squad-tray --describe` prints the current platform integration,
daemon summary, and menu model. `--action <id>` executes a menu action. The
controller talks to the local daemon for status, updates, heartbeat/logout, and
launch-at-login requests; start/restart actions use the launcher path for
services without spawning another tray controller. Open uses the configured web
app URL, not the daemon API URL.

Menu actions include Open Autohand Squad, Update Autohand Squad, Login /
Logout, Start Service, Stop Service, Restart Service, Open Queue, Launch at
Login, Settings, About, and Quit. The auth row shows Login only when no account
is signed in and Logout when an account is signed in. Login opens the
Autohand browser auth flow, stores the returned token and account email in the
local runtime config, and refreshes the daemon account state when the daemon is
running.
Quit runs the same cleanup as `squad stop`, then exits the tray controller.
Since the controller is a separate binary, a UI crash does not stop the daemon.
The native controller records its own PID and exits early when another
controller instance is already running, so the user should only get one Squad
menu-bar/tray process per machine.
When Restart Service is selected while sessions, agents, queued jobs, or
trigger work are active, the native controller asks for confirmation before it
requests the service restart.

On macOS the tray icon is a template status item: the icon is rendered by the
system as white in a dark menu bar and black in a light menu bar. The tray runs
as an accessory menu bar app, so it does not show a separate Dock icon. The
About menu item uses the native macOS About panel with the Autohand Squad logo,
version, legal text, and `https://autohand.ai/code/squad/`.

## Release Manifest

Release assets are produced by the root release scripts and GitHub workflows.
The installer manifest must include all runtime binaries for each supported
target: `squad`, `autohand-squad-daemon`, `autohand-squad-analytics`,
`autohand-squad-tray`, and `autohand-squad-ui`. The manifest uses the Node
launcher target names (`darwin`, `win32`, `linux`, `arm64`, `x64`) and also
adds Rust runtime aliases (`macos`, `windows`, `aarch64`, `x86_64`) where
needed so both launcher paths understand the same release.
