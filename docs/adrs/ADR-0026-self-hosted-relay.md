# ADR-0026: Multi-user workspace over a self-hosted relay

Date: 2026-09-26 · Status: accepted (first pass)

## Context

Squad is single-user: channels, threads, and messages live in one
`channels.json` on one machine, mirrored between the browser and the local
bridge. Issue #38 asks for two or more people to share channels and members
through something they host themselves, with members still running locally
on whoever owns them. Non-goals: federation, Nostr compatibility, moving
member execution off the owner's machine.

## Decision

- **Relay** (`relay/`): a Node service with no npm dependencies
  (`node:http`, `node:crypto`, a hand-rolled RFC 6455 framer in `ws.mjs`).
  One workspace is one shared document of channels and messages. REST for
  reads and writes (`GET/PUT …/channels`, `GET/POST …/channels/:id/messages`,
  `GET …/messages?since=`), a WebSocket `…/stream` that fans out `message`,
  `channel`, and `presence` events. Threads stay local in this pass.
- **Auth is per person, bearer token.** `RELAY_TOKENS="name:token,…"` for a
  self-managed team, or `RELAY_VERIFY_ACCOUNTS=1` to accept Autohand account
  tokens verified against `https://api.autohand.ai/v1/profile` (cached
  five minutes). The relay never starts without one of the two.
- **Storage is a module boundary.** `relay/store.mjs` writes one JSON file
  per workspace. It exposes five methods; a Postgres store implements the
  same five and is passed to `startRelay({ store })`. The JSON store is the
  default so a team can run the relay from a folder.
- **Conflicts: last-writer-wins per record id by `updatedAt`**, applied
  identically on the relay and in both directions on the bridge
  (`server/relay/sync.mjs`, `mergeChannelsState`). Equal timestamps keep the
  stored record, so replays are no-ops. Channels merge before messages so a
  message never references a channel the bridge's normaliser would drop.
- **The bridge is the sync point, not the browser.** `server/relay/sync.mjs`
  opens the stream, pulls with a persisted cursor, pushes records whose
  `updatedAt` it has not pushed, stamps outbound messages with
  `origin: { personName, host }`, writes inbound records into `channels.json`
  through `ctx.readChannelsState/writeChannelsState`, and emits
  `relay.message`, `relay.channel`, `relay.presence`. Reconnects with jittered
  exponential backoff (1 s → 30 s). Loading placeholders are never pushed.
  Because the web app PUTs full snapshots, `push()` first re-merges every
  record the relay has told it about, so a stale snapshot cannot delete a
  remote message.
- **Configuration lives in `<squadStateDir>/relay.json` (0600)** and is
  edited through `/api/relay/config`; the token never leaves the bridge
  except as a bearer to the relay (the API returns only a four-character
  hint). Local-only mode is the default and is untouched when no relay is
  configured: `push`/`pull` are no-ops and status reports `configured: false`.
- **Ownership is derived, not declared.** A member "runs on" the host of the
  newest agent message with its `origin` stamp; the UI phrases it as "Runs on
  Noah's Mac" / "Runs here" (`src/lib/workspaces.js`). No member record moves
  between machines.
- **UI**: a quiet workspace switcher in the sidebar header (local workspace
  plus the relay workspace with a status dot and "2 people here"), a Relay
  section in Settings (URL, token, workspace, enable switch, one status
  sentence, Sync now), and a one-line people-presence sentence.

## Consequences

- Two bridges sharing a workspace see each other's channels and messages in
  well under a second on a LAN (`scripts/check-relay.mjs` asserts 1 s);
  the relay is the only shared state, and losing it only pauses sync.
- LWW by wall clock means a machine with a skewed clock can win edits it
  should not; acceptable for a first pass, and a relay-assigned sequence can
  replace the comparison later without changing the API shape.
- Prompting a shared member from another machine needs one more hook: the
  integrator subscribes to `relay.message` and starts the run locally when
  the message targets a member this machine owns. The reply flows back as an
  ordinary message write.
- The desktop bundle must ship `relay/` next to `server/` because the bridge
  client reuses the framer; until packaging is updated the relay route is
  skipped at boot with a log line.
- Message fan-out is per workspace with no per-channel ACL; anyone with a
  workspace token sees every channel in it. Private channels across people
  are out of scope for this pass.
