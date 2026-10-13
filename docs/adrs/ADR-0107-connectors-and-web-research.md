# ADR-0107: Connectors and the built-in Web research server

Date: 2026-10-13. Lane L7 of the parity work
(`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`).

## Context and evidence

Squad members could only use the MCP servers a person had configured by hand
in their own Autohand config, which was copied into every member home. There
was no way to add a server from Settings, test it before a member tried it,
or switch it off; Codex and Claude members got none of them. Members also
had no way to search the web and cite what they read, although the
permission ladder already carried an `mcp.connectors` capability with a
default of "ask" (`CLI_PERMISSION_GROUPS` in `src/App.jsx`).

Three reference products were read for behaviour (never ported): OpenMausBot
saves a new MCP server switched off, tests it with the handshake and lists
its tools, keeps tokens in headers rather than addresses, and makes it
available on the next task without a restart; xiryn runs web research
through Firecrawl v2 search and scrape-to-markdown capped at 12,000
characters, with the key held server-side; CopilotKit's connected accounts
were the model for a built-in row with its own key field.

What the existing seam does was established before writing anything:

- The pinned Autohand CLI 0.9.7 reads an isolated member config's
  `mcp.servers` and ignores `--mcp-config` outside bare mode; the SDK's
  declared `mcpServers` is not forwarded (ADR-0070). Entries carry
  `name`, `transport` (`stdio`, `sse`, `http`), `command`/`args`/`env` or
  `url`/`headers`, `autoConnect`, and the Squad-specific `stdioFraming`
  (the SDK's `McpServerConfigEntry` type, and the strings in the vendored
  CLI binary).
- The CLI opens stdio servers with Content-Length framing; the MCP spec
  says newline. Computer Use shipped a proxy that reads both for this reason.
- Claude Code takes `--mcp-config <file>` (repeatable) and Codex takes
  `-c mcp_servers.<name>.<field>=<toml>`; both are already used for the
  Computer Use proxy in `prepareExternalHarness`.
- `normalizeAgentPermissions` dropped the ladder's `modes` map when writing
  `profile.json`, so an agent-less call (chat warm) would not have known the
  member's `mcp.connectors` mode.
- There is no approval path for MCP tool calls in the non-interactive modes
  Squad runs the harnesses in: Claude `-p` without a permission-prompt tool
  denies tools it cannot ask about, `codex exec` runs MCP tools without a
  prompt, and the Autohand `rules: [{ action: "prompt" }]` entries are keyed
  by built-in tool name, which an MCP tool does not have.

## Decision

**Store.** `server/connectors/store.mjs` keeps `<squadStateDir>/connectors.json`
(written through `writePersistentJson`, mode 0600) with a list of connectors.
A connector is a stdio command (`command`, `args` one per line, `env`) or a
URL (`url`, `transport` `http` for Streamable HTTP or `sse` for older
servers, `headers`). The built-in `web-research` row is synthesised on first
read and cannot be removed. New connectors are saved disabled. Every public
record masks env values and header values whose name looks like a secret
(`token`, `secret`, `key`, `password`, `auth`, `bearer`, `credential`,
`cookie`, `session`) or whose value starts with `Bearer`: the browser gets
`configured: true` and a four-character hint, never the value. A secret sent
back empty keeps the stored value; an entry left out of an update is removed.
Credentials in the address itself are refused.

**Test.** `server/connectors/probe.mjs` starts the command or connects to the
URL, completes `initialize` and `notifications/initialized`, lists tools,
and ends the child or stream. A stdio probe sends `initialize` in newline
framing and, if nothing comes back within 2.5 s, again with Content-Length;
the framing the server answers in is recorded on the connector and written
as `stdioFraming` for Autohand. Failures are one line of at most 240
characters: spawn errors (`Could not start …`), early exits with the exit
code and the stderr tail, timeouts, HTTP status plus the first 160 body
characters, and JSON-RPC errors. The built-in row's Test is a handshake
alone when no key is set, and additionally a real request to
`/v2/team/credit-usage` when one is, so a wrong key is reported before a
member hits it.

**Injection.** `server/connectors/inject.mjs` turns enabled connectors into
entries named `squad-connector-<id>`. During member provisioning
(`ensureAgentRuntime`) the member config's `mcp.servers` keeps every entry
the person configured, drops entries with that prefix, and appends the
current set; `mcp.enabled` is switched on only when something is added.
Claude members get a private `--mcp-config` file under the member home
(0600, rewritten every turn); Codex members get `-c mcp_servers.*`
overrides, with `http_headers` for URL servers. Nothing restarts: the next
turn provisions again and picks the change up. A short instruction block
tells the member which connectors it has and, for Web research, to cite
the URLs. Utility agents never receive connectors.

**Policy.** A member receives connectors only when its `mcp.connectors` mode
is `allow`. `block` receives none. **`ask` is treated as not enabled**
because there is no way to honour it per call (evidence above); connectors
never widen a blocked or asking policy. A member without a recorded mode is
treated as the ladder default, `ask`. `normalizeAgentPermissions` now keeps
`modes` so `profile.json` carries the decision and an agent-less warm call
does not strip servers a chat call added.

**Web research.** `server/connectors/web-research-mcp.mjs` is a
dependency-free stdio MCP server reading both framings and answering
`initialize` with the requested protocol version when it is one of
`2024-11-05`, `2025-03-26`, `2025-06-18`. `web_search` calls Firecrawl
`/v2/search` and returns numbered results each with a `Source:` URL;
`web_fetch` calls `/v2/scrape` with `formats: ["markdown"]` and
`onlyMainContent`, caps the markdown at 12,000 characters and starts the
text with `Source:` and `Title:` lines. The key travels in
`FIRECRAWL_API_KEY` from the bridge to the child; `FIRECRAWL_API_URL`
redirects the base URL (tests point it at a fixture). Without a key the
server still answers `tools/list`, and a call returns an `isError` result
naming Settings → Connectors. `scripts/stage-desktop.mjs` and
`scripts/package-squad-portable.mjs` require the file (ADR-0081).

**Settings.** `src/components/settings/ConnectorsSettings.jsx` is a divider
list: the built-in Web research row first (status sentence, Test, switch)
with a Firecrawl key row (stored hint, replace-by-typing), then one row per
connector (name, kind summary, last test, Test, Edit, Remove, switch) with
an inline form for editing, and an Add connector form. No cards, no drawer.
Section id `connectors` sits after Relay.

## Evidence

`node scripts/check-connectors.mjs` passed against the real bridge in an
isolated `AUTOHAND_SQUAD_HOME` with fixtures only (a stdio MCP server in
both framings, an HTTP server serving Streamable HTTP with JSON and SSE
bodies, legacy SSE, and a fake Firecrawl; fake Codex and Claude executables
that record the configuration they receive). It covers: the built-in row
first and off; create saved off with secrets masked and `connectors.json`
at 0600; Test listing `echo, time` over newline and over Content-Length with
the framing remembered; a command exiting 3 reported as `code 3` plus its
stderr within 240 characters; a missing command reported as `Could not
start`; Streamable HTTP with the stored Authorization header reaching the
server and masked to the browser, a 401 without it, an SSE-bodied response,
legacy SSE, and a closed port; update keeping a blank secret and dropping an
omitted entry, proven by the child's environment; the built-in Test as
handshake-only with no key, a rejected key, and a real credit check (4,321
credits) with a good key; the research server over both framings answering
`initialize` with `2024-11-05`, listing both tools, `web_fetch` returning
`Source: https://example.com/doc` with the body capped just above 12,000
characters and `truncated: true`, `web_search` carrying source URLs, a
`file:` URL refused, an unknown method answered with `-32601`, and the
no-key error; provisioning with `allow` producing `user-sentinel` then
`squad-connector-web-research` then the added connectors with the key, the
framing and the header in place and the member config at 0600; `block`,
`ask` and no-mode members keeping only `user-sentinel`; a warm call
keeping the servers; disabling one removing exactly it; fake Codex
receiving `-c mcp_servers.…command` and the research env; fake Claude
receiving one `--mcp-config` file (0600) with both servers and a blocked
Claude member receiving none; the state surviving a bridge restart; delete;
and no secret appearing in any response body or in the bridge log. Every
response the check reads is scanned for the three fixture secrets.

`node scripts/check-computer-use-bridge.mjs` passed on the final code,
proving the shared managed-MCP seam still carries the Computer Use proxy
(real Squad HTTP server, real proxy, fake Codex and native host). One
earlier run failed only because the main checkout's `node_modules` had
briefly become a symlink to itself; that environment fault was reported to
the orchestrator and the rerun after it was restored passed.
`node scripts/check-computer-use-portable.mjs` passed with the research
server added to its fixture, so the portable archive is required to carry
it. `bun run build` completed (Vite, 3.69 s).

`node scripts/check-jsx-imports.mjs` passed (124 files).

## Consequences and what was left undone

- Secrets are stored in clear in `connectors.json` and copied into each
  allowed member's config and Claude's per-member file, all 0600 in the
  person's own state directory. This is the same posture as the relay token
  and the copied Autohand auth token; a keychain is not introduced.
- `ask` means off. The ladder's default therefore gives nobody connectors
  until a person sets MCP connectors to Allow for a member. That is the
  conservative reading of "never widen"; a real per-call approval for MCP
  tools needs a harness that can ask, and is not built here.
- Members with no recorded `modes` (saved before the ladder stored them)
  need their Permissions opened once for the mode to be written.
- No OAuth sign-in or marketplace. A URL connector takes a static header
  only; a server answering 401 with protected-resource metadata is reported
  as a plain HTTP 401. The built-in row is the one preset; a preset list
  for hosted servers can be added to the store without changing the shape.
- Codex overrides use bare TOML keys; connector ids are `cn-` plus eight
  hex characters, so the names are always valid bare keys.
- The research server trusts Firecrawl's `sourceURL` as the citation; a
  redirecting page cites the final address, which is what a reader can open.
- The probe follows no redirects it is not given and reads at most 4 MB of a
  stream; a server that never closes its SSE response is cut off by the
  15 s probe timeout rather than hanging the bridge.
- Live harness behaviour with a real Codex or Claude binary, a real
  Firecrawl account, and the pinned Autohand CLI actually connecting to a
  URL connector are not proven by the fixtures; the config they would read
  is.
