# Integration: connectors and Web research

ADR-0107. The module owns `server/connectors/{framing,probe,store,inject,web-research-mcp}.mjs`,
`server/routes/connectors.route.mjs`, `src/components/settings/ConnectorsSettings.jsx`
and `scripts/check-connectors.mjs`. Everything below is the wiring already done
in `server.mjs`, `src/App.jsx`, `src/locales.js`, `package.json` and the
packaging scripts, recorded so the next change knows where it lives.

## Bridge (`server.mjs`)

The store is created beside Computer Use and handed to routes as
`ctx.connectors`; `ctx.firecrawlBaseUrl` carries `FIRECRAWL_API_URL` (empty in
production, a fixture in tests):

```js
const connectors = createConnectorStore({ stateDir: squadStateDir, rootDir, nodePath: process.execPath });
```

Routes, auto-loaded from `server/routes/connectors.route.mjs`:

| Route | Purpose |
| --- | --- |
| `GET /api/connectors` | `{ connectors: [...] }`, built-in `web-research` first. Secrets masked: an env/header entry is `{ key, value, secret, configured, hint }` and a secret's `value` is always `""`. |
| `POST /api/connectors` | `{ name, kind: "stdio", command, args: [], env: [{key,value}] }` or `{ name, kind: "url", url, transport: "http"\|"sse", headers: [{key,value}] }`. Saved with `enabled: false`. 201. |
| `GET /api/connectors/:id` | one record |
| `PUT /api/connectors/:id` | same fields; a secret sent back with an empty value keeps the stored one, an entry left out is removed. The built-in takes `{ apiKey }` (`null` clears, empty keeps). `enabled` may be included. |
| `DELETE /api/connectors/:id` | the built-in answers 400 |
| `POST /api/connectors/:id/test` | starts or connects, handshake, `tools/list`. `{ ok, tools: [names], framing?, transport?, error, keyChecked, credits?, connector }`. Persisted as `lastTest`; a stdio connector's detected framing is remembered. |
| `POST /api/connectors/:id/enable`, `/disable` | emits `connectors.changed` |

State: `<squadStateDir>/connectors.json`, mode 0600.

**Member provisioning** (`ensureAgentRuntime`): when the member is not a
utility agent and `connectorsAllowed(agent)` (its `permissions.modes["mcp.connectors"]`
is `"allow"`), `connectors.enabledSpecs()` is merged into the member config
with `mergeAutohandMcp(config.mcp, autohandServersFor(specs))`. Entries are
named `squad-connector-<id>`; existing entries are kept, stale managed ones
replaced. The specs ride on `agentRuntime.connectorServers` (they contain
secrets; do not expose them in run summaries). `connectorInstructions(specs)`
is appended to the member profile beside the Computer Use instruction.

**External harnesses** (`prepareExternalHarness`): Claude gets
`--mcp-config <agentHome>/connector-configs/claude.json` (0600, rewritten per
turn) built by `claudeMcpConfig(specs)`; Codex gets `codexConfigArgs(specs)`
unshifted as `-c` pairs. Nothing is added for a member without specs.

`normalizeAgentPermissions` keeps `permissions.modes` so `profile.json`
records the decision for agent-less calls.

## Web app (`src/App.jsx`)

- `"connectors"` is in `SETTINGS_SECTION_IDS` after `"relay"`.
- State: `connectors` (read once from `GET /api/connectors`) and
  `connectorActions` (`create`, `update`, `remove`, `test`, `toggle`), each
  patching the list with the record the route returns.
- `SettingsPage` takes `connectors` and `connectorActions`, lists the section
  (`Unplug` icon, detail "Off" / "{count} on") and renders
  `<ConnectorsSettings>` under a `SettingsSectionHeader`.
- Locale keys: `connectors`, `connectorsDescription`, `connectorsOff`,
  `connectorsOn`; the component has inline fallbacks for the rest.

## Packaging

`scripts/stage-desktop.mjs` and `scripts/package-squad-portable.mjs` assert
`server/connectors/web-research-mcp.mjs` after copying `server/`; the bridge
spawns it by absolute path with `process.execPath`.

## Check

`bun run check:connectors` (in the `ci` chain after `check:relay`). Real
bridge, fixtures only, no network.
