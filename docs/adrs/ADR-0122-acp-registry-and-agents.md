# ADR-0122: Any coding agent from the ACP registry can run a member

Date: 2026-10-14
Status: Accepted

## Context and evidence

The person asked to "start adopting acp registry and acp integration for
autohand code and pi … Bring any coding agent. Claude Code, Codex, Cursor,
Gemini, Copilot, OpenCode, Pi, Grok Build and ~40 more — everything in the
ACP registry. Installed agents are found automatically, the rest are fetched
on first use, and every bot picks its own. Mix them freely: a Claude bot can
ask a Codex bot for a review. Obviously Pi."

**What Squad had.** Three engines, each with a hand-written adapter in
`server/harness/`: Autohand Code over the SDK, Codex over `codex exec
--json`, Claude Code over `claude -p --output-format stream-json`. Every
adapter is `id / label / detect / buildArgs / parseLine / resumeIdFrom`,
and `runExternalHarness` in `registry.mjs` spawns a one-shot process and
parses its stdout lines into SDK-shaped events (`agent_start`,
`message_update`, `message_end`, `tool_start`, `tool_update`, `tool_end`,
`permission_request`, `usage`, `agent_end`). A fourth vendor would have
meant a fourth parser for a fourth output format.

**What the protocol and the registry are.** Read on 2026-10-14:

- The Agent Client Protocol (Zed's), https://agentclientprotocol.com/protocol/overview
  and its pages `initialization`, `session-setup`, `prompt-turn`,
  `tool-calls`, `file-system`, `v1/schema`. Version 1 (`protocolVersion:
  1`); the reference crate in the protocol repository's `Cargo.toml` is
  `agent-client-protocol-schema 1.11.0`; the TypeScript SDK
  `@agentclientprotocol/sdk` is at 1.8.0 (published 2026-10-09). JSON-RPC
  2.0 over the agent's stdio, one object per line. The client calls
  `initialize`, `authenticate` (when needed), `session/new` or
  `session/load`, `session/prompt`; the agent streams `session/update`
  notifications (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
  `tool_call_update`, `plan`, `usage_update`, `available_commands_update`,
  `current_mode_update`, …) and may call back `session/request_permission`
  (options with `optionId` and a `kind` of `allow_once`, `allow_always`,
  `reject_once`, `reject_always`; the answer is `{ outcome: "selected",
  optionId }` or `{ outcome: "cancelled" }`), `fs/read_text_file`,
  `fs/write_text_file` and the `terminal/*` methods the client advertised
  in `clientCapabilities`. `session/cancel` is a notification; the
  `session/prompt` result carries `stopReason` (`end_turn`, `max_tokens`,
  `max_turn_requests`, `refusal`, `cancelled`).
- The registry, https://github.com/agentclientprotocol/registry (`FORMAT.md`)
  and its published index
  https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json:
  `{ version: "1.0.0", agents: [...] }`, 41 agents on 2026-10-14. Each entry
  has `id`, `name`, `version`, `description`, `repository`, `website`,
  `authors`, `license`, `license_url`, `icon` and a `distribution` of
  `npx { package, args }`, `uvx { package, args }` or `binary { "<platform>":
  { archive, sha256, cmd, args } }` with platforms `darwin-aarch64`,
  `darwin-x86_64`, `linux-aarch64`, `linux-x86_64`, `windows-aarch64`,
  `windows-x86_64`. Pi is `pi-acp` (`npx pi-acp@0.0.34`, an adapter that
  spawns `pi --mode rpc`); Autohand is `autohand` (`npx
  @autohandai/autohand-acp@0.2.1`); Gemini and Copilot are their own CLIs
  with `--acp`; OpenCode and Cursor are binaries launched with `acp`.

**On this machine.** `pi` 0.84.4 is at
`~/.local/share/fnm/node-versions/v24.3.0/installation/bin/pi` with no ACP
flag of its own (`pi --help` lists `--mode text|json|rpc`); the ACP route is
the `pi-acp` adapter. `autohand --help` has `--acp` ("Shorthand for --mode
acp"). `gemini`, `copilot`, `opencode`, `cursor-agent` and `autohand-acp`
are installed; `claude-agent-acp`, `codex-acp`, `grok` and `pi-acp` are not.

## Decision

**One generic adapter, many ids.** `server/harness/acp.mjs` runs any agent
over the protocol. The harness id is `acp:<registry id>`; `pi` and
`autohand-acp` are built-in ids for Pi (the registry's `pi-acp` adapter,
which needs `pi` installed) and the Autohand CLI in `--acp` mode. The
adapter has the same contract as the others (`detect`, `buildArgs`,
`resumeIdFrom`, `label`, `capabilities`) plus `transport: "acp"` and a
`run` function; `executeExternalHarness` in `server.mjs` picks that runner
instead of `runExternalHarness` and everything after it (trace, reply, run
log, usage telemetry, Previous chats) is unchanged. `getAdapter` returns one
adapter object per id, so `adapter.id` keeps being the harness id in the
session store, the run record and the trace.

**The turn over the protocol.** The bridge is the client: `initialize`
with `fs.readTextFile` and `fs.writeTextFile` and no terminal, then
`session/load` when a resume id exists and the agent advertised
`loadSession` (replayed history is ignored), else `session/new` with the
workspace as `cwd`; `session/set_mode plan` when the member is in plan mode
and the agent offers a `plan` mode; then `session/prompt`. The member profile
goes in the first turn of a session as `<operating_instructions>` the way the
Codex adapter does, because the protocol has no system-prompt field; a
resumed session gets the prompt alone. `session/update` becomes the SDK
events: chunks accumulate into one message that ends at the next tool call
or at the end of the turn, `tool_call` and `tool_call_update` become
`tool_start`, `tool_update` and `tool_end` (an update for a call never
announced starts it first), `plan` becomes `plan_update`, `usage_update`
becomes `usage` with the context window. The session id is the resume id.
Stop sends `session/cancel` and kills the process two seconds later.

**Permissions from the member's access (ADR-0114).** `decidePermission`
answers `session/request_permission` without asking anyone: full access
allows everything (`allow_always` when offered); edit access allows reads,
searches, fetches, thoughts and commands, and edits, deletes and moves only
when every location is inside the member's folders (workspace, profile docs,
canvas and projects); plan allows only reads, searches, fetches and
thoughts. `fs/read_text_file` is served inside those folders (anywhere
under full access); `fs/write_text_file` is refused in plan mode and outside
the folders in edit mode. Every decision is a `permission_request` row in
the run log so the person can see what was refused and why.

**The registry, cached and bundled.** `server/acp/registry.mjs` fetches
the published index at most once a day and only when the chooser opens
(`GET /api/acp/registry`) or Re-check is pressed (`?refresh=1`), caches it
at `<squadStateDir>/acp/registry.json`, and ships
`server/acp/bundled-registry.json` with the nine entries the person named
so the chooser works offline. Detection never spawns anything: an agent is
"installed" when its executable is on the GUI-safe PATH (a small table maps
package names to bin names, such as `@google/gemini-cli` → `gemini`),
"fetched on first use" when `npx` or `uvx` is available for its package,
and not available otherwise (a binary that is not installed says where to
get it). `/api/harnesses` lists ACP agents next to the built-in engines
with the same readiness shape, so launch preflight and the profile summary
work unchanged.

**The chooser.** HarnessSelect shows "Built-in engines" and "From the ACP
registry", each ACP row with its name, one-line description and
installed / fetched on first use. Access applies to all of them with ACP
copy (Plan only, Edit in folders, Full access); the model field is hidden
because the protocol has no model parameter the agent must honour; effort
appears only when the registry entry lists levels, which none does today.
The composer's engine chip names the agent from the registry listing, or
from the bundled names before the first fetch.

**Mixing engines.** Nothing new: engines are per member, and handoffs and
@mentions already route between members whatever runs them.

## Evidence

- `bun run check:acp` (new, in the ci chain right after `check:harness`):
  pure checks for ids, registry normalisation, launch resolution,
  permission decisions and the update → event mapping; then a real bridge
  in an isolated state dir with a fake ACP agent (a node script speaking
  the protocol). It proves: the bundled snapshot is served offline with the
  nine agents and `source: "bundled"`, a cached registry is served with
  `source: "cache"` and a failed forced refresh keeps it; `/api/harnesses`
  lists `acp:fake-agent` as ready and fetched on first use without leaking
  executable paths; a plan-mode turn replies through the bridge with the
  tool rows (`started read`, `read completed`), a `permission` row saying
  refused, a failed `edit` row, `fsread=ok` inside the workspace and
  `fswrite=refused`; the session id is on disk and the next turn calls
  `session/load` with it and sends the prompt without the instructions;
  full access answers `allow_always` and the write outside the folders
  lands; a per-message `access: plan` overrides the member's full access;
  edit access allows the edit inside the workspace and refuses the write
  outside; `/api/chat/reset` forgets the session and the next turn is a new
  one with the instructions again; Stop on a run reaches the agent as
  `session/cancel`; and a DM handoff from a Claude Code member (the
  disposable fixture from `check-chats`) reaches the ACP member as a
  completed run whose context manifest records the collaboration.
  Result on 2026-10-14: "ACP pure checks passed" and "ACP bridge checks
  passed".
- `bun run check:harness`, `bun run check:chats`,
  `bun run check:bridge-imports`, `bun run check:harness-timeouts`,
  `bun run build`, `node scripts/check-render.mjs`: all passed on
  2026-10-14 (see the commit message for the exact output lines).
- Pi, for real. Run by hand from a scratch folder with the adapter's own
  runner (`runAcpHarness` with `npx -y pi-acp@0.0.34`, the launch the
  registry gives):

  ```
  {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"pi-acp","title":"pi ACP adapter","version":"0.0.34"},"authMethods":[{"id":"pi_terminal_login","name":"Launch pi in the terminal",…}],"agentCapabilities":{"loadSession":true,…
  {"jsonrpc":"2.0","id":2,"result":{"sessionId":"01a1351f-f25e-72a9-8d89-5a55db8035e3","configOptions":[{"type":"select","id":"model",…"currentValue":"openrouter/moonshotai/kimi-k2.6",…
  {"jsonrpc":"2.0","method":"session/update","params":{…"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"pi v0.84.4\n---\n\n## Skills\n- /Users/…/.pi/agent/skills/…
  {"jsonrpc":"2.0","method":"session/update","params":{…"update":{"sessionUpdate":"usage_update","used":0,"size":262144}}}
  ```

  The turn ended with `{"stopReason":"end_turn"}` after 7 s and `usage_update
  used: 42`, resume id `01a1351f-…`, no error. The reply text was pi-acp's
  startup block (version, skills, prompts) and nothing from the model: pi's
  own provider key is expired on this machine (`pi -p --no-session "Reply
  with exactly: PI OK"` prints `401: {"message":"API key expired",…}`), and
  pi-acp reports that as an empty turn rather than an error. A second run
  by hand that first switched the session's model with
  `session/set_config_option { configId: "model", value: "kimi-coding/k3" }`
  (pi-acp answered with the new `configOptions`, a `current_mode_update` of
  `high` and a `usage_update` with `size: 1048576`) ended the same way. So
  the protocol path (initialize, session/new, prompt, updates, end_turn,
  session id) is verified against the real adapter; a model reply is not,
  until the key is renewed.

## Consequences

- Any agent in the registry is one id away, and a new one needs no code
  in Squad; adding one that is not in the registry is a cache-file edit
  (docs/integration/acp.md).
- `harness-sessions.json` keys may now carry the `acp:` prefix;
  `normalizeHarnessSessions` accepts them.
- Replies are the text after the last tool call, as with Claude Code; an
  agent that narrates before its tools and says nothing after shows the
  narration. pi-acp's startup block is part of the first reply unless
  `quietStartup: true` is set in pi's settings.
- Left undone, knowingly:
  - **Sign-in flows.** Agents that answer `session/new` with the auth error
    get a readable failure naming their `authMethods` (pi-acp advertises a
    terminal login); Squad does not run `authenticate` or open a terminal
    for them. Readiness therefore never says "Setup required" for an ACP
    agent; a signed-out agent fails on its first turn instead.
  - **Binary downloads.** A `binary` distribution that is not on the PATH
    is "not installed" with a pointer to the website; Squad does not
    download archives or verify `sha256`.
  - **Model and effort.** No model override is sent (the protocol has
    `session/set_config_option` on some agents, such as pi-acp's `model`,
    but it is agent-specific); effort is hidden unless the registry entry
    lists levels.
  - **MCP servers.** `session/new` takes `mcpServers`, but Squad's managed
    servers (Computer Use, the vault, connectors) are not passed to ACP
    sessions yet; those members have no connectors for now.
  - **Terminals.** The client advertises no `terminal` capability; agents
    that need the client to run commands fall back to their own shell.
  - **Fetch time.** An npx agent that is not installed is downloaded by npx
    on its first turn; the first-event timeout for ACP is 180 s to cover
    that, and the person sees "Starting …" until initialize answers.
  - The registry refresh uses the bridge's outbound network; there is no
    proxy setting.
