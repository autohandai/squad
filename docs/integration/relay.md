# Integration: multi-user workspace and self-hosted relay

Issue #38 · ADR-0026. The module owns `relay/`, `server/relay/sync.mjs`,
`server/routes/relay.route.mjs`, `src/lib/workspaces.js`,
`src/components/shell/WorkspaceSwitcher.jsx`,
`src/components/settings/RelaySettings.jsx`, `scripts/check-relay.mjs`.
Everything below is the wiring the integrator does in `server.mjs`,
`src/App.jsx`, `package.json`, `src/locales.js`, and the packaging scripts.

## Bridge (`server.mjs`)

Routes are auto-loaded from `server/routes/relay.route.mjs`:

| Route | Purpose |
| --- | --- |
| `GET /api/relay/config` | `{ url, workspace, enabled, hasToken, tokenHint }` |
| `PUT /api/relay/config` | `{ url?, token?, workspace?, enabled? }`; an omitted or empty token keeps the stored one, `token: null` clears it. Stored at `<squadStateDir>/relay.json`, mode 0600. Enabling requires url + token + workspace. |
| `GET /api/relay/status` | `{ configured, enabled, connected, url, workspace, self, peers: [{ id, name, connections, since }], lastSync, lastError, config }` |
| `POST /api/relay/sync` | pull then push now; returns status plus `{ synced, pulled, pushed }` |
| `GET /api/relay/events` | SSE: `relay.status` once, then `relay.message`, `relay.channel`, `relay.presence` |

**One line to add.** After every `writeChannelsState(...)` (the function
itself is the right place), emit the bridge event so local changes are
pushed:

```js
async function writeChannelsState(input) {
  // ...existing body...
  emitBridgeEvent("channels.changed", { source: "bridge" });
  return state;
}
```

The relay route listens for `channels.changed` and calls `sync.push()`,
which sends only channels/messages whose `updatedAt` it has not pushed yet.
(Alternative: `import { pushRelay } from "./server/routes/relay.route.mjs"`
and call it after the write.) Messages with `status: "loading"` are never
pushed.

**Events emitted by the module** (payloads also carry `at` and `workspace`):

| Name | Payload |
| --- | --- |
| `relay.message` | `{ channelId, messageId, message, origin: { personId, personName, host } }` — a message from another bridge landed in `channels.json` |
| `relay.channel` | `{ channelId, channel }` |
| `relay.presence` | `{ people: [...], self }` |

`relay.message` is where "each person can prompt the shared members" hooks
in: when `message.role === "user"` and `origin.host !== hostname()` and the
message mentions a member this machine owns, `ctx.startRun` / the chat path
should run it locally (the reply is pushed back automatically because the
reply is a message write). Notifications and the audit trail can subscribe
to the same event.

**Packaging.** `server/relay/sync.mjs` imports the WebSocket framer from
`relay/ws.mjs`. Add `relay/` to the copy list in `scripts/stage-desktop.mjs`
and `scripts/package-squad-portable.mjs` next to `server/`. Until then the
route plug-in fails to import in a bundle and is skipped with a log line; the
bridge itself is unaffected.

## Web app (`src/App.jsx`)

Add a `relay` state slice loaded once and refreshed by the SSE stream:

```js
const [relayConfig, setRelayConfig] = useState({ url: "", workspace: "", enabled: false, hasToken: false });
const [relayStatus, setRelayStatus] = useState({ connected: false, peers: [] });
const [workspaceSelection, setWorkspaceSelection] = useState({ selectedId: "local" });
// on mount: setRelayConfig(await api("/api/relay/config")); setRelayStatus(await api("/api/relay/status"));
// EventSource("/api/relay/events"): on relay.status/relay.presence -> refresh status;
//   on relay.message / relay.channel -> re-run the existing loadChannels() so the
//   stream shows the remote message (the existing merge is already LWW by id).
```

Because the app PUTs its full snapshot to `/api/channels` after local
changes, re-running `loadChannels()` on `relay.message` is what keeps the
snapshot from dropping remote records (the bridge also reconciles them on the
next push, so nothing is lost, but the UI would lag).

**Switcher** (`src/components/shell/WorkspaceSwitcher.jsx`): render it in the
sidebar header, under the brand row, above "Search everything":

```jsx
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { buildWorkspaceList, selectWorkspace } from "@/lib/workspaces";

const workspaces = buildWorkspaceList({ relayConfig, relayStatus, hostName: runtime?.hostName, copy });
<WorkspaceSwitcher
  workspaces={workspaces}
  selectedId={workspaceSelection.selectedId}
  onSelect={(id) => setWorkspaceSelection((s) => selectWorkspace(s, workspaces, id))}
  onConnectRelay={() => navigate("/settings#settings-relay")}
  copy={copy}
/>
```

Pass it through `WorkspaceSidebar` as a new `header` slot (or place it in the
`brand` element's row). Selecting the relay workspace is a view preference
only; the channel list is the same `channels.json` either way in this first
pass.

**Settings** (`src/components/settings/RelaySettings.jsx`): a new section
`id="settings-relay"` after "Runtime bridge", with
`<SettingsSectionHeader title={copy.relay || "Relay"} description={copy.relayDescription || "Share channels with your team through a relay you host."} />` then:

```jsx
<RelaySettings
  config={relayConfig}
  status={relayStatus}
  onSave={async (patch) => setRelayConfig(await api("/api/relay/config", { method: "PUT", body: JSON.stringify(patch) }))}
  onSync={async () => setRelayStatus(await api("/api/relay/sync", { method: "POST" }))}
  copy={copy}
/>
```

Add "Relay" to the settings section list.

**Member ownership.** Members run where they were created. Show it as quiet
meta text on the member row (directory) and in the channel member popover:

```js
import { memberOwnership, ownershipLabel } from "@/lib/workspaces";
const label = ownershipLabel(memberOwnership(agent.id, Object.values(messagesByChannel).flat(), { name: runtime?.account?.name, host: runtime?.hostName }), copy);
// "Runs here" · "Runs on Noah's Mac" · "Runs on Ana's build-box"
```

`runtime.hostName` does not exist yet; add `hostName: hostname()` to
`getRuntime()` in `server.mjs` (the origin stamp uses the same value).

**People presence.** One line under the channel composer's member presence
line, only when connected and someone else is here:
`peopleSentence(relayStatus.peers, relayStatus.self, copy)` → "Noah is here"
/ "Ana, Bo and 2 others are here". Same typography as the member presence
line; no avatars needed for the first pass. The switcher already shows
"2 people here" as the relay workspace detail.

## `package.json`

```json
"check:relay": "node scripts/check-relay.mjs",
"relay": "node relay/server.mjs --port 8787 --data ./relay-data"
```

Add `bun run check:relay` to the `ci` chain after `check:recruiting`.

## Copy keys (`src/locales.js`, `en`)

Fallbacks are inline in the components; add these for translation:
`workspaces`, `switchWorkspace`, `localWorkspace` ("Local"), `onlyOn`,
`localWorkspaceDetail`, `connectRelay` ("Connect a relay…"), `relaySettings`
("Relay settings…"), `relayOff`, `connecting`, `reconnecting`, `onlyYouHere`,
`peopleHere`, `relay`, `relayDescription`, `relayUrl`, `relayUrlDetail`,
`relayToken`, `relayTokenDetail`, `relayTokenStored`, `relayTokenReplace`,
`relayWorkspace`, `relayWorkspaceDetail`, `relayEnabled`, `relayEnabledDetail`,
`save`, `saving`, `syncNow`, `relayOffSentence`, `relayIncomplete`,
`reconnectingTo`, `connectedTo`, `as`, `onlyYouOnline`, `peopleOnline`,
`synced`, `justNow`, `ago`, `runsHere`, `runsOn`, `mac`, `machine`, `isHere`,
`areHere`, `and`, `other`, `others`.

## `DESIGN.md`

Under **Workspace Shell**: "The sidebar header carries a quiet workspace
switcher (current workspace name, chevron, popover list with a status dot per
relay workspace and a 'Connect a relay…' row). Member ownership is one muted
meta phrase ('Runs on Noah's Mac'), never a badge. People presence is one
sentence under the member presence line." Under **Settings**: "Relay is a
divider-row section: URL, Token, Workspace, one Save, the enable switch, a
one-sentence status and a ghost Sync now."
