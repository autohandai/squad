# Control plane: stdio MCP server over the bridge (ADR-0095)

Lets Claude Desktop, Cursor or any MCP client coordinate this Squad: read
members and channels, post to channels, start bridge-owned work for a member,
wait for it, stop it. Nothing here edits `server.mjs` or `App.jsx`; the
server is a client of the bridge's existing routes.

Module files:

- `server/control-plane/mcp-server.mjs` — stdio entry point (JSON-RPC 2.0,
  newline and Content-Length framing, `initialize`, `ping`, `tools/list`,
  `tools/call`, `notifications/cancelled`).
- `server/control-plane/control-plane.mjs` — pure: tool schemas, argument
  validation, loopback check, secret redaction, outcome mapping, framing codec.
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

| Tool | Arguments | What it does on the bridge |
| --- | --- | --- |
| `list_members` | — | `GET /api/status/snapshot` (the app's `web-status.json` mirror: id, name, role, status), `GET /api/members/presence`, plus the harness and workspace of the member's latest run or goal from `GET /api/runs` and `GET /api/goals`. |
| `list_channels` | — | `GET /api/channels`: id, name, visibility, members, projects, thread and message counts. |
| `get_messages` | `channel_id`, `thread_id?`, `limit?`, `before?` or `member_id`, `limit?`, `before?` | Channel: threads and messages from channel state, oldest first, newest `limit` (max 200). Member: bridge-owned runs and goals with redacted replies and tails. Direct-message history lives in the app and is not returned; the result says so. |
| `search` | `query`, `types?`, `limit?` | `GET /api/search`. |
| `create_member` | `name?`, `role?` | Always the error `not_available_from_bridge`: members are created in the app. |
| `create_channel` | `name`, `visibility?`, `member_ids?`, `section?` | `POST /api/channels`; the app reloads channel state on the bridge's `changed` event. |
| `send_message` | `text`, `channel_id?`, `thread_id?`, `member_id?`, `workspace?`, `mode?`, `author?` | Channel: appends a user message (and a thread when `thread_id` is absent) through `PUT /api/channels/sync`; with `member_id` also starts `POST /api/runs` with the channel context. Member only: `POST /api/runs` (`mode: "run"`) or `POST /api/chat` with `mode: "goal"`. Returns `run_id` or `goal_id`. |
| `wait_for_reply` | `run_id` or `goal_id`, `timeout_ms?` (≤ 600000), `tail_lines?` (≤ 60) | Polls `GET /api/runs/:id` or `GET /api/goals/:id` every 400 ms. Outcomes: `settled`, `needs-you`, `failed`, `timed-out`. A settled or failed channel run posts its reply into the thread. |
| `interrupt` | exactly one of `run_id`, `goal_id`, `member_id` | `POST /api/runs/:id/stop`, `POST /api/goals/:id/pause`, or `POST /api/members/:id/stop`. |
| `set_model` | `member_id?`, `model?`, `provider?` | Always the error `not_available_from_bridge`: the member's harness and model are chosen in the app and sent with each turn. |

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
  base64 runs). Paths survive. Channel message bodies are returned as stored,
  capped at 4,000 characters.
- Bounded reads: 200 messages per `get_messages`, 100 search hits, 60 tail
  lines, 10 minutes per wait.
- What the bridge does not hold: the member roster is a read-only mirror the
  app rewrites about every 15 seconds, so a member created in the app appears
  after the next write and a member cannot be created or re-modelled here.
  Direct-message history is browser-only.

## Packaging

`scripts/stage-desktop.mjs` and `scripts/package-squad-portable.mjs` copy
`server/` whole and now assert `server/control-plane/mcp-server.mjs` is
present, so the installed app and the portable archive can run `squad mcp`.
No npm dependency was added.
