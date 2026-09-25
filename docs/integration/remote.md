# Remote members — integration note

Issue #36. A member can run on another machine's bridge: chat, stream, and
run requests for that member are forwarded with a bearer token; replies
stream back unchanged and carry `transport: remote`. Module files:
`server/remote/{registry,proxy,auth}.mjs`, `server/routes/remote.route.mjs`,
`src/components/members/RunsOnSettings.jsx`, `scripts/check-remote.mjs`.

## Routes the plug-in already serves (auto-loaded)

| Route | Notes |
| --- | --- |
| `GET /api/remote/members` | public shapes `{ memberId, url, label, addedAt, hasToken }` — never tokens |
| `PUT /api/remote/members/:id { url, token, label }` | probes `GET <url>/api/runtime` first; 400 `{ error, remote, retryable }` on failure, nothing saved. `token` may be blank to keep the stored one. |
| `DELETE /api/remote/members/:id` | member runs locally again |
| `POST /api/remote/members/:id/probe { url?, token?, label? }` | probe the saved remote, or a candidate before saving |
| `GET /api/remote/members/:id/presence` | proxied `/api/members/presence`; `{ available: false }` when the remote has no presence route |
| `POST /api/remote/tokens { label }` → 201 | mints a token for another machine; the clear token is in this response only, `remotes.json` keeps its SHA-256 under `_served` |
| `GET /api/remote/tokens`, `DELETE /api/remote/tokens/:id` | list / revoke served tokens |

State: `<squadStateDir>/remotes.json`, written 0600.

## server.mjs wiring (three routes + the origin guard)

```js
import { RemoteError, proxyJson, proxyStream, remoteRequestAuth, resolveRemote } from "./server/routes/remote.route.mjs";
```

`POST /api/chat`:

```js
const payload = await readBody(req);
const remote = await resolveRemote(routeContext(), payload.agentId, { req });
if (remote) {
  try {
    const reply = await proxyJson(remote, "/api/chat", payload);      // reply.transport === "remote"
    emitBridgeEvent("chat.finished", { memberId: payload.agentId, status: "completed", channelId: ..., preview: ..., transport: "remote" });
    json(res, 200, { success: true, data: reply });
  } catch (error) {
    json(res, error.status || 502, { success: false, error: error.message, remote: error.remote, retryable: error.retryable !== false });
  }
  return true;
}
```

`POST /api/chat/stream`:

```js
const remote = await resolveRemote(routeContext(), payload.agentId, { req });
if (remote) {
  try {
    await proxyStream(remote, "/api/chat/stream", payload, res);       // SSE piped through unchanged
    emitBridgeEvent("chat.finished", { memberId: payload.agentId, status: "completed", transport: "remote" });
  } catch (error) {                                                    // only before headers are sent
    json(res, error.status || 502, { success: false, error: error.message, remote: error.remote, retryable: true });
  }
  return true;
}
```

`POST /api/runs`:

```js
const remote = await resolveRemote(routeContext(), payload.agentId, { req });
if (remote) {
  json(res, 201, { success: true, data: await proxyJson(remote, "/api/runs", payload) });   // data.transport === "remote"
  return true;
}
```

Wrap those `proxyJson` calls in the same try/catch shape as `/api/chat`. The
run summary the remote returns has the remote's run id; `GET /api/runs/:id`
and `/api/runs/:id/stop` for that member should also go through
`resolveRemote` + `proxyJson(remote, url.pathname, ...)` so the trace
opens from the same UI.

`payload.workspace` is a path on *this* machine. When forwarding, drop it
unless the remote record carries one: `{ ...payload, workspace: remote.workspace || undefined }`
so the remote bridge uses its default workspace (the registry accepts an
optional `workspace` in `PUT` for a fixed path on the other machine).

Always pass `{ req }` to `resolveRemote`: a request that arrived through
another bridge's proxy (`x-autohand-transport: remote`) is never forwarded
again, which stops two machines pointing at each other from looping.

## Serving side (the machine that runs the member)

In `createServer`, before `requestOriginAllowed`:

```js
const auth = await remoteRequestAuth(routeContext(), req);   // { remote, allowed, token }
if (auth.remote && !auth.allowed) { json(res, 401, { success: false, error: "bearer token required" }); return; }
if (!auth.remote && !requestOriginAllowed(req, url)) { /* existing 403 */ }
```

A token-authenticated request skips the same-origin check (it has no
browser Origin anyway) and may only reach `/api/chat`, `/api/chat/stream`,
`/api/runs`, `/api/runs/:id`, `/api/runs/:id/stop`, `/api/runtime`, and
`/api/members/presence`; return 404 for anything else when `auth.remote`.
Log `auth.token.label` on those requests so the audit trail shows which
machine asked. Serving other machines needs the bridge reachable from
them: `--host 0.0.0.0` on a trusted network or a tunnel; the default
127.0.0.1 listener stays local.

## App.jsx

- Member profile → Harness page (`AgentHarnessPage`, below the **Runs
  with** `HarnessSelect` and its Save/Close row, above the harness `<dl>`):
  a section heading "Runs on" with one sentence, then
  `<RunsOnSettings remote={remoteByMember[agent.id] || null} onSave onRemove onProbe onMintToken copy={copy} />`.
- `remoteByMember`: state loaded once from `api("/api/remote/members")`
  (keyed by `memberId`) and refreshed after `onSave`/`onRemove`.
- `onSave(body)` → `api(\`/api/remote/members/${agent.id}\`, { method: "PUT", body })`;
  `onRemove()` → `DELETE` same path; `onProbe(body)` → `POST .../probe`;
  `onMintToken({ label })` → `POST /api/remote/tokens`. The `api` helper
  throws `Error(envelope.error)` on failure, which is the sentence the row
  shows ("Studio: refused the connection") with a Retry link.
- `ProfileHarnessSummary`: append ` / on ${remote.label}` to the summary
  line when the member is remote; the conversation meta line the same way.
- Stream consumer: the first SSE event on a proxied stream is
  `remote { transport: "remote", label, url }`; keep it on the message so the
  reply meta reads "via Studio". Error events from the proxy carry
  `retryable: true` — show the existing retry affordance.
- Presence: poll `GET /api/remote/members/:id/presence` for remote members
  at the same cadence as local presence and merge by `memberId`; when
  `available: false` fall back to run/chat activity as today.
- Directory / member list: no change; the transport is a detail on the
  profile, not a badge.

## package.json / DESIGN.md / locales

- `"check:remote": "node scripts/check-remote.mjs"` (fake remote bridge;
  no network).
- DESIGN.md, member profile section: "**Runs on** sits under Runs with as
  two divider rows (This machine / Remote bridge) with a check mark on the
  chosen one; URL, name, and token fields, a Test button, and one status
  sentence. Share this machine is a text disclosure that shows a minted
  token once with a copy button. Failures name the remote."
- `src/locales.js` (`en`), all with fallbacks in the component:
  `runsOn`, `runsOnThisMachine`, `runsOnThisMachineDetail`, `runsOnRemote`,
  `runsOnRemoteDetail`, `runsOnUrl`, `runsOnLabel`, `runsOnLabelPlaceholder`,
  `runsOnToken`, `runsOnTokenKept`, `runsOnTokenHint`, `runsOnTest`,
  `runsOnTesting`, `runsOnReached`, `runsOnNoCli`, `runsOnUnreachable`,
  `runsOnSaved`, `runsOnSaveFailed`, `runsOnNowLocal`, `runsOnUseThisMachine`,
  `runsOnShare`, `runsOnShareHint`, `runsOnCreateToken`, `runsOnSharedTokenLabel`,
  `runsOnMintFailed`, `runsOnBridgeUrlIs`, `runsOnShareReach`, `retry`,
  `copyToClipboard`, `dismiss`.

## Events

No new bridge events. `chat.finished` and `run.finished` payloads for
proxied work should carry `transport: "remote"` (the integrator adds it
where the routes emit them).
