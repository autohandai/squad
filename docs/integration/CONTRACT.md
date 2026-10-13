# Feature module contract

How a feature plugs into Autohand Squad without editing the two monoliths
(`server.mjs`, `src/App.jsx`). Modules own their files; `App.jsx` and
`server.mjs` wiring is done by the integrator from the module's
`docs/integration/<area>.md` notes.

## Repository shape

Member profiles use the shared existing catalog in `src/lib/member-profiles.js`
(ADR-0076). Bridge provisioning resolves saved data and explicit customizations
before applying absent role defaults. Warm/chat/run routing retains the saved
harness; SDK, CLI and external prompts receive the resolved role contract.
Explicit `skills: []` removes discoverable skills while retaining their files
outside the member home. Installation failures remain explicit unavailable
capabilities. Do not reconstruct personality solely from browser prompt text.
Validate runtime config before mutating profile documents; config read/write
failure must fail provisioning and preserve the last confirmed personality.
Member creation callers await provisioning before publishing or completing
setup; retries retain a stable identity and the editable draft (ADR-0077).
Reply-mention delegation retains incoming parent task context and waits for
child results before returning to its source (ADR-0078). Append handoffs against
current task state, preserve sibling results, and do not mark a parent complete
while accepted/pending handoffs remain. Browser promises are not durable workers.
On a new bridge epoch, reconcile accepted ordinary handoffs with
`recoverInterruptedHandoffs`: retain evidence, block interrupted work and do not
redispatch. Pending decisions and durable goals keep their separate contracts
(ADR-0079).

Tracked run completion uses the same bridge-owned channel-action manager as
chat. Run summaries add `reply` and `channelActions`; `run.finished` follows
their durable completion. A stopped or failed run must not execute action text.
Purpose prompts retain the originating member ID even though their thread role
is a prompt; render that member rather than substituting the signed-in account.

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
| `appStateDir` | string | member state root; each member's home is `<appStateDir>/agents/<id>/` (profile docs, memory, sessions). `~/.autohand/squad/web-state` in the installed app, `<rootDir>/.autohand` in dev (ADR-0105) |
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
| `mutateChannelsState(operation)` | async fn | Runs the callback against fresh channel state inside the shared mutation queue, then commits atomically. Use for read-modify-write changes; snapshot replacement checks a supplied `revision`. |
| `agentChannelActions` | object | Shared turn completion handler and durable proposal decisions (ADR-0075). `agentChannelAccess` and `agentChannelActions` in channel state are bridge-owned; browser snapshots cannot grant, erase or forge them. |
| `vault` | object | `store` (list/add/remove views), `requests` (pending secret and payment requests), `dispatch` for the managed MCP server; values never leave the bridge (ADR-0104) |
| `agentChannelActions` | object | Shared turn completion handler and durable proposal decisions (ADR-0075). `registerHandler(type, fn)` routes another `SQUAD_ACTION` type (ADR-0110 `schedule`, ADR-0124 `task`, ADR-0126 `profile`) to a module; `memberAccess(id)` reads a registered member copy. `agentChannelAccess` and `agentChannelActions` in channel state are bridge-owned; browser snapshots cannot grant, erase or forge them. |
| `startRun(payload)` | async fn | start a member run (same payload as `POST /api/runs`) |
| `stopRun(runId, reason)` | async fn | stop a live run the bridge started (same path as `POST /api/runs/:id/stop`); `false` when not live (ADR-0110) |
| `events` | EventEmitter | `bridgeEvents`; also `ctx.emit(name, payload)` |
| `getRuntime()` | fn | the `/api/runtime` snapshot (account, versions, paths) |
| `cleanWorkspace(path)` | async fn | validates a folder path inside the home directory, returns the normalized path or throws |
| `spawnSync` | fn | `node:child_process` |
| `agentsDir` | string | member homes: `<agentsDir>/<member id>/{skills,profile}`. Read-only for plug-ins (team export, ADR-0106); provisioning stays in `server.mjs`. |

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
| `routine.run` / `routine.finished` / `routines.changed` | `{ routineId, runId, memberId, status, dispatch?, trigger? }` (ADR-0110) |
| `mention.received` | `{ channelId, memberId, messageId, preview }` |
| `vault.request.pending` | `{ requestId, memberId, runId, channelId, type: "secret"|"payment", title }` (ADR-0104; notifies as an approval) |
| `vault.request.resolved` | `{ requestId, memberId, type, action }` |
| `team.built` | `{ status: "completed"|"failed", team, memberCount, failedCount, channels, routines, error }` (raised by the web app through `POST /api/events` when a team from an objective or a template finishes preparing; ADR-0118) |

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

Explicit checkpoint retry retains the receiving request ID and current permissions, guards rapid clicks, and reuses saved successful ancestor output after child completion (ADR-0080). Parallel mentions share a parent; busy recipients are declined before model execution in the app and bridge. Arbitrary tool effects remain inspect-before-retry; legacy dependency graphs and cross-window task conflict resolution are not promised. Portable archives include staged `src/lib` for actual bridge imports (ADR-0081).
