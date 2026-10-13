# ADR-0095: An MCP control plane over the bridge, truthful about what the bridge holds

Date: 2026-10-13. Lane L9 of `docs/superpowers/specs/2026-10-13-parity-lanes-design.md`.

## Context and evidence

OpenMausBot ships a stdio MCP server so Claude Desktop or Cursor can list
bots and channels, read transcripts, send work, wait for it to settle and
interrupt it (`docs/mcp-server.md` in that checkout, read for behaviour
only). The product owner asked for the same for Squad: `squad mcp` with
`list_members`, `list_channels`, `get_messages`, `search`, `create_member`,
`create_channel`, `send_message`, `wait_for_reply`, `interrupt`, `set_model`,
with no approvals, deletion, credentials or computer lifecycle and no
non-loopback exposure.

What the bridge can and cannot see was established by reading it, not
assumed:

- Members live in the browser (`localStorage`) and reach the bridge only as
  the status mirror `web-status.json`, which `App.jsx` posts every 15 s
  (`buildLiveStatusSnapshot`: id, name, role, status, lastActivityAt). No
  route creates a member; `POST /api/agents/provision` prepares a runtime
  home for a member the app already has and writes `agents/<id>/profile.json`
  with its harness and projects. A member written into the mirror by anyone
  else is overwritten on the app's next post.
- A member's harness and model arrive with every turn in `payload.agent`;
  `withSavedMember` only fills gaps from the saved profile. `/api/provider-settings`
  is global, not per member. So nothing on the bridge is authoritative for a
  member's model.
- Direct-message history is browser state. The bridge holds runs (`ctx.runs`,
  with reply and logs), durable goals (`goal-manager.mjs`) and channel state
  (`channels.json`: channels, threads, messages), and nothing else about a
  conversation.
- There is no bridge-side responder for channel messages: the browser
  dispatches members on mention (`mention.received` is raised by the app).
  The bridge does record a thread and bump `replyCount` when a run or chat
  carries a channel context (`recordChannelDispatch`), and the app reloads
  channel state on the bridge's `channels.changed` event.
- The pinned CLI opens MCP with Content-Length framing and protocol
  `2024-11-05`; the native Computer Use engine uses newline framing and
  `2025-06-18` (ADR-0070). Claude Desktop and Cursor use newline framing.

Measured with `node scripts/check-control-plane.mjs` on a real bridge in a
temporary `AUTOHAND_SQUAD_HOME`, seeded with two members and one channel and
driven through the MCP server as a child process with a fake Codex
executable as the harness: 143 assertions pass. The run covers both
framings, the exact tool list, seeded roster and presence, channel threads
and messages, search over the seeded message, channel creation visible after
a bridge restart, a channel post without dispatch, a direct run that settles
with the reply and a redacted tail, a channel run whose reply is mirrored
into the thread, a run held open by the fixture that `interrupt` stops
(the fixture logs the SIGTERM), a one-second wait that reports `timed-out`,
non-loopback `--bridge` and `AUTOHAND_SQUAD_BRIDGE_URL` values refused with
exit code 2, and the two documented not-available errors. The reply fixture
embeds an `sk-live-…` and a `ghp_…` token; neither string appears anywhere
in the wait result, the member history or the mirrored thread message.

## Decision

Build `server/control-plane/mcp-server.mjs` as a dependency-free client of
the bridge's existing HTTP routes, not as a new route plug-in, so the control
plane has exactly the authority a browser tab has and nothing more. Pure
logic lives in `server/control-plane/control-plane.mjs` so the check can
import it without a bridge.

Each tool says what the bridge can do:

- `list_members` reads the mirror and presence and derives `harness` and
  `lastWorkspace` from the member's latest bridge-owned run or goal; the
  result names its sources.
- `get_messages` for a member returns runs and goals only and carries a note
  that direct-message history is not mirrored to the bridge.
- `create_member` and `set_model` always return the error code
  `not_available_from_bridge` with the reason and where to do it instead,
  rather than writing a member into a mirror the app would overwrite or a
  model the next turn would ignore.
- `send_message` to a channel appends a user message and thread through
  `PUT /api/channels/sync` (the merge route, so another window's snapshot
  does not drop it); with `member_id` it starts a bridge-owned run with the
  channel context, because that is the only dispatch the bridge offers. A
  direct message starts a run or, with `mode: "goal"`, a durable goal, and
  the result says the work appears in Mission Control rather than the
  member's chat.
- `wait_for_reply` maps run and goal states to `settled`, `needs-you`,
  `failed`, `timed-out`; a `proposed` channel action counts as `needs-you`.
  When a channel run settles or fails, the control plane posts its reply into
  the thread itself, since no bridge code does that for runs.
- `interrupt` stops a run, pauses (not cancels) a goal, or stops a member.
- Loopback only, enforced before any request; argument schemas reject
  unknown fields; replies, tails and failure reasons are redacted; reads are
  bounded.

`squad mcp` in `daemon/src/cli.rs` resolves `server.mjs` the way `squad serve`
does, takes `server/control-plane/mcp-server.mjs` beside it, and on Unix
execs the bundled Node with `--bridge http://<host>:<web-port>` and inherited
stdio; on Windows it spawns and returns the exit code. The two packaging
scripts already copy `server/` whole; they now assert the entry is present
(ADR-0081 pattern).

## Consequences

- Not reachable from this control plane, by design and stated in each
  result: member creation, per-member model changes, direct-message history,
  approvals, deletion, credentials, computer lifecycle, remote bridges.
- A channel message posted here is visible in the app after its next channel
  reload (the bridge emits `channels.changed`); a reply mirrored by the
  control plane is a plain agent message with `runId`, not a streamed turn,
  so the app shows it as a finished reply.
- A bridge-owned run started here appears in Mission Control and in
  `get_messages` for the member, not in the member's direct chat.
- The Rust change is unverified by the compiler: free disk was 868 MiB when
  the change was ready, below the 1 GiB floor set for running `cargo check`
  on this machine, so only `rustfmt --check` was run on `daemon/src/cli.rs`.
  The verified path is the Node entry (`bun run mcp`), which `squad mcp` only
  execs. `bun run check:runtime` in the merge CI compiles it.
- Redaction is pattern-based; a secret that matches none of the patterns
  (a short custom token, for example) would pass through. The check proves
  the listed shapes, not every possible one.
- The `needs-you` outcome for runs is proved only through the pure mapping
  (a `proposed` channel action); the end-to-end check does not raise a
  proposal because the fake harness emits no channel actions.
