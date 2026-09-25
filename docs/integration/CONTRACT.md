# Feature module contract

How a feature plugs into Autohand Squad without editing the two monoliths
(`server.mjs`, `src/App.jsx`). Modules own their files; `App.jsx` and
`server.mjs` wiring is done by the integrator from the module's
`docs/integration/<area>.md` notes.

## Repository shape

| Path | What lives there |
| --- | --- |
| `server.mjs` | Node bridge on 127.0.0.1:19821. Do not edit from a module. |
| `server/routes/*.route.mjs` | Route plug-ins, auto-loaded (see below). |
| `server/<area>/*.mjs` | Pure server-side logic for an area, unit-checkable with `node`. |
| `server/events.mjs` | `bridgeEvents` (EventEmitter) and `emitBridgeEvent(name, payload)`. |
| `src/App.jsx` | The web app. Do not edit from a module. |
| `src/components/<area>/*.jsx` | React components for an area. |
| `src/lib/<area>.js` | Pure browser logic, importable from Node checks (no React, no DOM). |
| `scripts/check-<area>.mjs` | Node check for the area; must exit 0. Add `"check:<area>"` to `package.json` scripts. |
| `docs/integration/<area>.md` | Exact wiring instructions for the integrator. |
| `docs/adrs/ADR-00NN-<slug>.md` | One ADR per module: context, decision, consequences. |

## Route plug-in

```js
// server/routes/members.route.mjs
export const name = "members";

export async function init(ctx) {
  // optional: subscribe to ctx.events, start pollers, open files
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === "/api/members/presence" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: { ... } });
    return true;
  }
  return false; // not ours
}
```

Responses are always `{ success: true, data }` or `{ success: false, error }`
with an HTTP status; `ctx.json(res, status, payload)` writes them. Read a JSON
body with `await ctx.readBody(req)` (returns an object). Server-sent events:
`const stream = ctx.startEventStream(res); stream.send("event", data); stream.end()`.

Route paths are matched with plain string comparison or a `RegExp` on
`url.pathname`; parse ids yourself (`/^\/api\/members\/([^/]+)\/stop$/`).

## `ctx` (bridge context)

| Field | Type | Notes |
| --- | --- | --- |
| `rootDir` | string | repository root (or bundle runtime dir) |
| `squadStateDir` | string | `~/.autohand/squad` — app state; put new files here |
| `squadWorkspaceRoot` | string | `~/.autohandsquad` — per-member workspaces |
| `homeDir` | string | user home |
| `packageMetadata` | object | package.json |
| `json(res, status, payload)` | fn | write a JSON response |
| `readBody(req)` | async fn | parse JSON body |
| `startEventStream(res)` | fn | SSE helper (`send`, `end`) |
| `logEvent(severity, message, attributes)` | fn | OTLP log record; `ctx.SEVERITY.{DEBUG,INFO,WARN,ERROR}` |
| `readJsonFile(path)` / `readOptionalJsonFile(path)` | async fn | parse JSON, the optional form returns `null` when missing |
| `writeJsonFile(path, data)` | async fn | pretty JSON, creates parent dirs |
| `runs` | `Map<id, run>` | live and recent runs; `ctx.runSummary(run)` gives the public shape; `ctx.isLiveRun(run)` |
| `sdkSessions` | object or null | warm session pool; `stats()` → `{ active, busy, sessions: [{ key, agentId, workspace, busy, idleMs, ... }] }`, `reset(agentId, reason)`, `closeAll(reason)` |
| `readChannelsState()` / `writeChannelsState(state)` | async fn | `channels.json` (`{ version, channels: [...] }`); channels carry `id, name, memberIds, projects, ...` and may gain new fields |
| `startRun(payload)` | async fn | start a member run (same payload as `POST /api/runs`) |
| `events` | EventEmitter | `bridgeEvents`; also `ctx.emit(name, payload)` |
| `getRuntime()` | fn | the `/api/runtime` snapshot (account, versions, paths) |
| `cleanWorkspace(path)` | async fn | validates a folder path inside the home directory, returns the normalized path or throws |
| `spawnSync` | fn | `node:child_process` |

Members (agents) live in the browser (`localStorage`) and are mirrored to the
bridge only through `web-status.json`; a route that needs member metadata
should accept it in the request body or read `ctx.readOptionalJsonFile(join(squadStateDir, "web-status.json"))`.

## Events the bridge emits

| Name | Payload |
| --- | --- |
| `run.finished` | `{ runId, memberId, status: "completed"|"failed"|"stopped", title, workspace }` |
| `chat.finished` | `{ memberId, status: "completed"|"failed", channelId?, preview }` |
| `member.stopped` | `{ memberId, closedSessions, stoppedRuns }` |
| `shell.ran` | `{ memberId?, command, exitCode, workspace }` |
| `handoff.pending` | `{ taskId, fromMemberId, toMemberId, title }` (emitted by the web app through `POST /api/events`) |
| `approval.pending` | `{ workflowId, runId, channelId, stepId }` |
| `mention.received` | `{ channelId, memberId, messageId, preview }` |

Every payload also carries `at` (ISO). `POST /api/events { name, ...payload }`
lets the web app raise the last three, which happen client-side.

## Web app conventions

- shadcn primitives from `src/components/ui` (`Button`, `Switch`, `Select`,
  `Sheet`, `Dialog`, `Input`, `Textarea`, `Badge`, `ScrollArea`, `Tooltip`).
  Icons from `lucide-react`. Utility `cn` from `@/lib/utils`.
- `DESIGN.md` is the contract: calm, Notion-like, no cards or tinted panels,
  divider-separated rows, restrained radius, accent colour only for actions
  and status. Read it before styling anything.
- Components receive data and callbacks as props; they do not fetch on their
  own unless the note says so. Call the bridge with
  `fetch("/api/...")` only inside a prop the integrator supplies (`api`).
  The app's `api(path, options)` helper returns `data` from the JSON envelope
  and throws on `success: false`.
- Copy lives in `src/locales.js` (`en` block) with a fallback literal in the
  component: `copy.workflows || "Workflows"`.
- Anything reusable and pure goes to `src/lib/<area>.js` so
  `scripts/check-<area>.mjs` can import it without a browser.

## Integration note (`docs/integration/<area>.md`)

State exactly: which routes exist; which events you subscribe to or need
emitted; which components to render where (route, section, props); which
`App.jsx` state or handlers the props map to; what `package.json` scripts
to add; what to add to `DESIGN.md`. Keep it under a page.
