# ACP agents and the registry (ADR-0122)

Any coding agent that speaks the Agent Client Protocol (ACP,
https://agentclientprotocol.com, v1) can run a member. The registry at
https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json lists
them; Squad reads it, finds what is installed, and launches the rest through
`npx` or `uvx` on first use.

Module files:

- `server/acp/registry.mjs` — fetch, cache (`<squadStateDir>/acp/registry.json`,
  refreshed at most daily and only on request), normalise, `launchFor()`
  (how an entry starts on this machine), `listAcpAgents()`.
- `server/acp/bundled-registry.json` — the offline snapshot (Pi, Autohand
  Code, Claude Agent, Codex, Gemini CLI, Copilot, OpenCode, Cursor, Grok Build).
- `server/acp/client.mjs` — `AcpConnection`: JSON-RPC 2.0 over a child's stdio.
- `server/harness/acp.mjs` — the adapter (`forHarnessId()`), the pure helpers
  (`decidePermission()`, `eventsFromUpdate()`, `isInsideDirs()`) and the
  runner (`runAcpHarness()`).
- `server/routes/acp.route.mjs` — the route plug-in.
- `src/lib/harness.js` — `isAcpHarnessId()`, `fetchAcpRegistry()`,
  `registerAcpAgents()`, `acpOption()`, `harnessTakesModel()`.
- `src/components/members/HarnessSelect.jsx` — the grouped chooser.
- `scripts/check-acp.mjs` — pure checks plus a real bridge with a fake ACP
  agent; `bun run check:acp`.

## Harness ids

| Id | What runs |
| --- | --- |
| `acp:<registry id>` | the registry entry's launch, e.g. `acp:codex-acp`, `acp:gemini`, `acp:cursor` |
| `pi` | the registry's `pi-acp` adapter (`npx pi-acp@<version>`), which needs `pi` on the PATH |
| `autohand-acp` | the Autohand CLI the app already uses, with `--acp` |

`pi-acp` as an id normalises to `pi`. Ids are validated as
`acp:[a-z0-9][a-z0-9._-]*`; anything else falls back to Autohand like any
unknown id. Session ids live in `<agentHome>/harness-sessions.json` under the
harness id, so `acp:` keys are accepted there.

## Routes

| Route | Response `data` |
| --- | --- |
| `GET /api/acp/registry` | `{ agents, fetchedAt, source, stale, error, version, url }`. Fetches when the cache is missing or older than a day; otherwise the cache. Falls back to the cache, then the bundled snapshot, with `error` saying why |
| `GET /api/acp/registry?refresh=1` | the same, fetching regardless of age |
| `GET /api/harnesses` | now also lists every known ACP agent with the usual readiness shape (`status`, `detail`, `setup`, `installed`, `fetchOnUse`, `accessModes`, `efforts`, `agent`); no network, no process spawned |

An agent in the listing is `{ id, harnessId, name, description, version,
website, repository, authors, icon, builtIn, installed, fetchOnUse,
available, efforts, launch: { kind, command, args } | null, detail, setup,
source }`. `command` is shown with the home directory replaced by `~`.
`source` is `network`, `cache`, `bundled` or `built-in`.

## Adapter contract

The adapter is shaped like the others (`id`, `label`, `vendor`,
`executableName`, `capabilities`, `setup`, `detect`, `buildArgs`,
`parseLine`, `resumeIdFrom`) with two additions:

- `transport: "acp"` — `executeExternalHarness` in `server.mjs` calls
  `adapter.run(...)` instead of `runExternalHarness(...)`.
- `buildArgs()` returns `{ args, displayArgs, turn }`: `args` are the launch
  args from readiness (`readiness.launchArgs`), `turn` is `{ prompt,
  instructions, workspace, addDirs, access, resumeId, model, effort }`.

`runAcpHarness({ adapter, executable, args, cwd, env, turn, timeoutMs,
inactivityMs, firstEventTimeoutMs, signal, onEvent, terminate })` resolves
with the same shape as `runExternalHarness`: `{ events, rawStdout,
rawStderr, exitCode, resumeId, error, timedOut, timeoutKind, stopped,
stalled }`.

What the runner does, in order: `initialize` (`protocolVersion: 1`,
`clientCapabilities.fs.readTextFile/writeTextFile: true`, no terminal);
`session/load` when `turn.resumeId` is set and the agent advertised
`loadSession` (replayed updates are ignored), else `session/new` with
`cwd` and no `mcpServers`; `session/set_mode` to `plan` when the member is in
plan mode and the agent lists a `plan` mode; `session/prompt` with one text
block, the member profile wrapped in `<operating_instructions>` on a new
session only. Stop sends `session/cancel`, then SIGTERM after two seconds.

Events: `agent_start { sessionId, resumed }`, `status turn_started`,
`message_update` per `agent_message_chunk` (thoughts carry `thought`),
`message_end` at the next tool call and at the end of the turn, `tool_start`
/ `tool_update` / `tool_end` from `tool_call` and `tool_call_update`
(`toolName` is the call's `name`, else its `kind`, else its title; the
`diff`, `content` and `terminal` content items become text),
`plan_update` from `plan`, `usage { used, size, modelUsage.acp }` from
`usage_update`, `permission_request` for every answered
`session/request_permission`, `agent_end { reason: stopReason }`.

Permissions (`decidePermission`): full → allow (`allow_always` if offered);
write → allow unless the call is an edit, delete or move with a location
outside the member's folders (workspace, profile docs, canvas dir, project
folders); plan → allow only `read`, `search`, `fetch` and `think`. Refusals
pick `reject_once`, then `reject_always`; with no reject option the answer is
`cancelled`. `fs/read_text_file` is served inside the folders (anywhere under
full), `fs/write_text_file` is refused in plan mode and outside the folders
with write access. `terminal/*` answers method not found.

## Adding an agent

Nothing to code. Published agents appear when the registry refreshes. An
agent that is not published: add an entry in the registry's format to
`<squadStateDir>/acp/registry.json` under `registry.agents` (the file is
`{ fetchedAt, url, registry }`); it is replaced on the next successful
fetch, so prefer sending it to the registry. For a one-off executable, set
the member's engine to any `acp:` id and give it an executable path in
Advanced; the path is launched as the agent with that entry's args.
`scripts/check-acp.mjs` shows the minimum an agent has to implement.
