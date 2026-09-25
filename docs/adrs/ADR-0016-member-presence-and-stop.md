# ADR-0016: Member presence from the bridge, and Stop

Date: 2026-09-26 · Status: accepted · Issue #35

## Context

Presence was inferred in the browser from tasks and chat messages
(`memberPresenceForAgent`): a member was Online unless a run or a loading
message said otherwise. That cannot distinguish "warm session, nothing to do"
from "no process at all", and it has no state for "the bridge is gone", so a
crashed bridge kept every dot green. There was also no way to end a member's
process from the UI; a runaway session lived until the pool's idle sweep or a
service restart.

The bridge already holds the truth: the warm session pool
(`server/sdk-sessions.mjs`, `stats()` reports `busy` and `idleMs` per
session) and the run table (`runs`, `isLiveRun`). Members themselves live in
the browser and reach the bridge only as `web-status.json`.

## Decision

- **Presence is derived on the bridge**, not in the browser.
  `server/members/presence.mjs` `derivePresence({ sessions, runs, members })`
  is pure and returns one entry per member: `working` (a live run, or a busy
  session), `idle` (a warm session with nothing running), `online` (no
  session, member not marked offline), `offline` (stored status `offline`,
  `archived`, or `disabled`). A busy process wins over the stored flag; the
  stored flag wins over a lingering idle session. `unknown` is a UI-side
  state: the app sets it when the poll fails, never from data.
- **`GET /api/members/presence`** (route plug-in `server/routes/members.route.mjs`)
  serves the map plus `sessions: { active, busy }`. The app polls it every
  10 s; a failed poll flips `bridgeReachable` and every dot shows the dotted
  ring instead of a stale colour.
- **`POST /api/members/:id/stop`** closes the member's sessions
  (`sdkSessions.reset(id, "stopped by user")`) and aborts its live runs:
  status `stopped`, `finishedAt`, SIGTERM to the process group with a delayed
  SIGKILL, `sdk.interrupt()`/`close()`, `abortController.abort()`. Runs are
  marked before any awaiting so the next presence read is already correct;
  the pool and SDK calls are raced against a 1.5 s budget so the response
  meets the two-second promise even when a client hangs. It emits
  `member.stopped` and one `run.finished` per run.
- **UI**: `PresenceDot` is the single dot component (accent + pulse only for
  working, green online, amber idle, grey offline, dotted ring unknown).
  `StopMemberButton` is a ghost button with a popover confirm ("Stop Kai?
  Running work will end."). Delete calls stop first.
- **Browser fallback**: `presenceFor()` returns the stored member status for
  a member the bridge has not snapshotted yet, so a freshly created member is
  Online for the first interval rather than Unknown.

## Consequences

- Presence matches `/api/sessions` within one poll (10 s) and needs no
  message or task heuristics; the old `memberPresenceForAgent` can retire
  once the integrator switches the three dot sites and the header.
- A stopped member drops to Online (no session) rather than Offline; Offline
  remains the user's stored choice. This keeps "available to talk to"
  distinct from "switched off".
- Presence adds one 10 s poll; the payload is small (one row per member).
- Kill semantics follow `server.mjs` (`terminateChildProcess`) but are
  duplicated in the route because the monolith does not export them; if the
  bridge grows a `ctx.terminateChild` helper the route should use it.
- The bridge only knows members through `web-status.json`; if the app has
  not posted a snapshot the presence map can be empty, hence the browser
  fallback above.
