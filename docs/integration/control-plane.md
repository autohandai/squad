# Control plane: stdio MCP server over the bridge (ADR-0109)

Lets Autohand Code and other MCP clients coordinate this Squad: select
members, exchange direct messages, read Library, post to channels, and manage
independent runs/goals, member profiles, folder grants, skills and routines. The server uses existing bridge routes. This is the
person's operator connection; the [managed member MCP](teams.md) has a separate
identity and permissions and is supplied to each Squad agent automatically.

Module files:

- `server/control-plane/mcp-server.mjs` — stdio entry point (JSON-RPC 2.0,
  newline and Content-Length framing, `initialize`, `ping`, `tools/list`,
  `tools/call`, `notifications/cancelled`).
- `server/control-plane/control-plane.mjs` — pure: tool schemas, argument
  validation, loopback check, secret redaction, outcome mapping, framing codec.
- `server/control-plane/runtime.mjs` — reusable bridge client, tool handlers,
  RPC dispatch and stdio transport; bundled by Autohand Code.
- `server/control-plane/management.mjs` — operator management schemas and handlers,
  bundled with the runtime by Autohand Code.
- `scripts/check-control-plane.mjs` — Node check (`bun run check:control-plane`).
- `daemon/src/cli.rs` — `squad mcp` execs the bundled Node on the entry.

## Registering it

From a source checkout:

```json
{
  "mcpServers": {
    "autohand-squad": {
      "command": "node",
      "args": ["/absolute/path/to/autohandSWE/server/control-plane/mcp-server.mjs", "--bridge", "http://127.0.0.1:19821"]
    }
  }
}
```

`bun run mcp` runs the same entry. With the installed app, use the sidecar so
the bundled Node and the staged runtime are resolved for you:

```json
{
  "mcpServers": {
    "autohand-squad": {
      "command": "/Applications/Autohand Squad.app/Contents/MacOS/squad",
      "args": ["mcp"]
    }
  }
}
```

`squad mcp --web-port 19821` or `squad mcp --bridge http://127.0.0.1:19821`
pins the bridge; `--server-path` points at another runtime's `server.mjs`.
`AUTOHAND_SQUAD_BRIDGE_URL` is honoured by the Node entry when `--bridge` is
absent. Claude Desktop reads `claude_desktop_config.json`; Cursor reads
`.cursor/mcp.json` with the same `mcpServers` shape.

The bridge must be running (open Autohand Squad, or `squad serve`). Without
it `initialize` still succeeds and every tool returns a tool error that says
the bridge did not answer.

## Tools

The operator server now has 37 tools. For a direct conversation, use
`list_members` → `message_member` → `wait_for_message`; `send_message` keeps
its original independent run/goal behavior for existing integrations.

Autohand Code includes this operator MCP at runtime under `autohand-squad`.
With the next CLI release, `/squad` opens an agent picker, `/message <text>`
sends to the selected agent, and `/message squad <agent-id> <text>` addresses
one explicitly. `/squad history` reads replies and `/squad queue` shows
delivery state. `/message team <name> <text>` addresses a local CLI teammate;
`/squad clear` clears the desktop recipient. Outside an interactive session:

```sh
autohand squad agents
autohand squad message kai "Please review the latest changes"
autohand squad history kai
autohand squad mcp
```

The CLI discovers the local bridge from `AUTOHAND_SQUAD_BRIDGE_URL`, then
`$AUTOHAND_SQUAD_HOME/web-server.json` (default `~/.autohand/squad`), then
`http://127.0.0.1:19821`. It does not launch/install the app during MCP startup.
`/squad app` explicitly opens or installs it. Bare, offline and no-daemon CLI
sessions do not add the built-in connection; `mcp.enabled: false` disables it,
and `AUTOHAND_DISABLE_SQUAD=1` opts out of the built-in server only. A managed
Squad member retains its existing identity-scoped MCP and never receives this
operator connection.

| Tool | Arguments | What it does on the bridge |
| --- | --- | --- |
| `list_members` | — | `GET /api/status/snapshot` (the app's `web-status.json` mirror: id, name, role, status), `GET /api/members/presence`, plus the harness and workspace of the member's latest run or goal from `GET /api/runs` and `GET /api/goals`. |
| `list_channels` | — | `GET /api/channels`: id, name, visibility, members, projects, thread and message counts. |
| `get_messages` | `channel_id`, `thread_id?`, `limit?`, `before?` or `member_id`, `limit?`, `before?` | Channel: threads and messages from channel state, oldest first, newest `limit` (max 200). Member: run/goal summaries; use `get_conversation` for the transcript. |
| `search` | `query`, `types?`, `limit?` | `GET /api/search`. |
| `create_member` | `name?`, `role?` | Always the error `not_available_from_bridge`: members are created in the app. |
| `create_channel` | `name`, `visibility?`, `member_ids?`, `section?` | `POST /api/channels`; the app reloads channel state on the bridge's `changed` event. |
| `send_message` | `text`, `channel_id?`, `thread_id?`, `member_id?`, `workspace?`, `mode?`, `author?` | Channel: appends a user message (and a thread when `thread_id` is absent) through `PUT /api/channels/sync`; with `member_id` also starts `POST /api/runs` with the channel context. Member only: `POST /api/runs` (`mode: "run"`) or `POST /api/chat` with `mode: "goal"`. Returns `run_id` or `goal_id`. |
| `wait_for_reply` | `run_id` or `goal_id`, `timeout_ms?` (≤ 600000), `tail_lines?` (≤ 60) | Polls `GET /api/runs/:id` or `GET /api/goals/:id` every 400 ms. Outcomes: `settled`, `needs-you`, `failed`, `timed-out`. A settled or failed channel run posts its reply into the thread. |
| `interrupt` | exactly one of `run_id`, `goal_id`, `member_id` | `POST /api/runs/:id/stop`, `POST /api/goals/:id/pause`, or `POST /api/members/:id/stop`. |
| `set_model` | `member_id?`, `model?`, `provider?` | Always the error `not_available_from_bridge`: the member's harness and model are chosen in the app and sent with each turn. |
| `message_member` | `member_id`, `text`, `workspace?` | Queue a direct conversation turn via `POST /api/queues/:member/items`. Returns `message_id`, workspace and pause state immediately. Reuses saved work/profile workspace; rejects unknown recipients. |
| `get_conversation` | `member_id`, `limit?` (≤60 turns), `since?` | Read direct-message transcript from bridge history, including app and CLI turns. `since` filters a conversation boundary; archived chat files are not read. |
| `get_member_queue` | `member_id`, `limit?` (≤200 items) | Read durable receipts, replies, failures and queue pause state. |
| `wait_for_message` | `member_id`, `message_id`, `timeout_ms?` (≤25000) | Wait for `settled`, `failed`, `needs-you` or `timed-out`. A timeout or cancelled wait retains the message. Repeat the wait with the same receipt; do not resend it. |
| `list_artifacts` | `member_id?`, `query?`, `limit?` (≤100) | Find published artifact metadata in Library. |
| `get_artifact` | `artifact_id` | Read published metadata and local preview/download links; does not execute content or read arbitrary files. |
| `list_memories` | `member_id?`, `query?`, `limit?` (≤100), `offset?` | Search the person's knowledge library, optionally by owner. |
| `read_memory` | `memory_id` | Read one knowledge-library entry; no editing/sharing/deletion. |

| `get_member_profile` | `member_id` | Read saved profile, revision, projects, skills, permissions and supported ability IDs. |
| `update_member_profile` | `member_id`, `expected_revision?`, `name?`, `role?`, `description?`, `instructions?`, `personality?` | Patch the canonical profile; stale revisions return 409. |
| `set_member_abilities` | `member_id`, `expected_revision?`, `capabilities?`, `tool_policies?`, `workspace?` | Patch specific `{id, mode}` policies (`allow`, `ask`, `block`), optionally in a workspace override. Other policies and safety guards are preserved. |
| `add_member_directory` / `remove_member_directory` | `member_id`, `path`, `expected_revision?` | Grant/revoke an extra project folder for later turns. Existing folders inside the physical home only; no deleting files or removing the primary workspace. |
| `list_skills` | `member_id`, `query?`, `offset?` | Discover local and registry packages for the saved workspace, including qualified IDs. |
| `set_member_skills` | `member_id`, `skill_ids`, `expected_revision?` | Replace selections; empty clears. Existing engine preparation installs/pins them on the next turn. |
| `get_channel` / `update_channel` | `channel_id`, plus update `name?`, `purpose?`, `section?` | Read or patch channel settings without replacing history or membership. |
| `set_channel_members` | `channel_id`, `add?`, `remove?` | Atomically add/remove existing member IDs; dispatches no work. |
| `list_channel_threads` | `channel_id`, `limit?` (≤100) | Read newest saved threads. |
| `create_group_chat` | `name`, `member_ids` (≥2 distinct) | Create a persistent private channel; dispatches no work. |
| `send_channel_message` | `channel_id`, `text`, `thread_id?`, `member_ids?` | Save a threaded message; dispatch only explicitly selected channel members. Omitted recipients means post only. Returns per-member run receipts/errors. |
| `list_routines` / `get_routine` | `member_id?` / `routine_id` | Read saved schedules and run history. |
| `preview_routine` | `schedule` | Validate and preview up to three occurrences without saving. |
| `create_routine` | `member_id`, `title`, `instructions`, `schedule`, `workspace?`, `enabled?`, `max_run_minutes?` | Save disabled by default. Explicit `enabled:true` schedules it; does not run immediately. |
| `update_routine` | `routine_id`, fields from create except member | Patch saved settings; `enabled:false` pauses future scheduling, without stopping current work. |
| `run_routine` | `routine_id` | Explicit manual run with saved settings; refuses overlap. Read completion in `get_routine`. |

Member management requires the updated Squad bridge. An older running app
returns an upgrade instruction; MCP never installs, restarts or upgrades it.
The operator can change policy settings, but cannot grant macOS permissions,
change engine login, bypass proposal approval or disable safety guards.

Read `get_member_profile` before editing. An explicit `expected_revision`
protects a decision based on that read. When omitted, MCP reads the current
revision just before the patch and rejects a concurrent change. Folder grants
are canonical member projects, passed through each engine's existing directory
mechanism (`--add-dir` on fresh CLI turns; Codex resume uses sandbox config).
Current work keeps its existing settings. Removing a grant never deletes files.
Skills receipts confirm selection, not successful installation; installation
happens during the next engine preparation using the existing pinned packages.

For example, create a group with `create_group_chat({name:"Release review",
member_ids:["kai","iris"]})`, then use its returned channel ID with
`send_channel_message({channel_id:"…",text:"Review the release",
member_ids:["kai","iris"]})`. Keep the returned thread and per-member run IDs.
Replies are saved by the bridge even if the client disconnects; use
`get_messages` for the thread and `wait_for_reply` for each run. Retrying a send
creates a new prompt and new runs; inspect receipts before resending. Partial
recipient failures are returned individually. Channel threads reuse their own
saved context and do not replace members' direct-message conversations.

Schedules require `kind` and an explicit IANA `timeZone`. Supported kinds and
fields follow the existing routine scheduler: `once` (`date`, `time`),
`weekdays` (`days` 0–6, `time`), `interval` (`everyMinutes`, optional
`startDate`/`startTime`), `monthly` (`day` 1–31 or `"last"`, `time`), `yearly`
(`month`, `day`, `time`), and `cron` (`cron`). Preview before enabling.
Example: `{kind:"weekdays",days:[1,2,3,4,5],time:"09:00",
timeZone:"Pacific/Auckland"}`. A disabled routine can still be run manually
with `run_routine`; manual execution is distinct from enabling its schedule.

Messages wait behind current work and preserve paused queues. They use the
member's current saved harness and restrictions; the connection does not send
an engine, permission override or API key with the message. The receipt means
accepted into the durable queue, not that the agent has replied. If a send
loses its response, inspect the member queue before retrying: sending is not
automatically retried or deduplicated.

Outcome mapping. Runs: `completed` → `settled`, unless a channel action is
`proposed` → `needs-you`; `stopped` and `failed` → `failed` with the reason
(last stderr line, redacted). Goals: `completed` → `settled`; `paused` and
`blocked` → `needs-you`; `failed` and `cancelled` → `failed`.

Workspaces. A run needs a project folder. When `workspace` is omitted the
member's last bridge-owned workspace is reused; a member the bridge has never
run gets an error naming the missing field. `list_members` shows
`lastWorkspace` for this.

Errors. Argument problems (unknown fields, bounds, missing required fields)
are JSON-RPC `-32602`. Bridge refusals and the two documented
not-available tools come back as tool results with `isError: true` and a
JSON body `{ error, code?, status? }`.

## Safety and data scope

- Loopback only: `--bridge` and `AUTOHAND_SQUAD_BRIDGE_URL` must name
  `127.0.0.1`, `localhost` or `::1`; anything else exits with code 2 before
  any request is made. No bearer tokens, no remote mode.
- Never exposed: approvals and proposal decisions, channel or member
  deletion, provider keys and settings, harness logins, computer-use grants
  and sessions, shutdown and upgrade.
- Redaction: replies, log tails and failure reasons pass through
  `redactSecrets` (vendor `sk-`/`pk-` keys, GitHub and Slack tokens, AWS
  access keys, JWTs, bearer headers, `key=value` secrets, long bare hex or
  base64 runs). Paths survive. Tool output strings are redacted, including
  channel bodies (capped at 4,000 characters), transcripts and library reads.
- Bounded reads: 200 messages per `get_messages`, 100 search hits, 60 tail
  lines, 10 minutes per wait.
- Roster and history: registered member profiles supplement the app's status
  mirror and live presence. Direct-message turns are available through
  `get_conversation`; archived chat files are outside this tool's scope.
  Members cannot be created or re-modelled here.

## Packaging

`scripts/stage-desktop.mjs` and `scripts/package-squad-portable.mjs` copy
`server/` whole and now assert `server/control-plane/mcp-server.mjs` is
present, so the installed app and the portable archive can run `squad mcp`.
No npm dependency was added.
