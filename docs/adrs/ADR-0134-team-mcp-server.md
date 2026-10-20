# ADR-0134: A member-scoped internal Squad MCP

Date: 2026-10-16; integrated and extended 2026-10-20.
Status: Accepted.

## Context and evidence

The product owner asked Eva to “change your name to Viggas”. Eva promised to
use the name, but the header and composer still said Eva. They requested a
first-party MCP for profile, memory and communication operations on every
coding engine, retaining the existing text action path.

The initial reproduction checked `needsShapingInstruction` with a populated
QA member and that exact request: it returned false. The old trigger covered
role changes but omitted “change your name”. A verbal promise had no effect
on the persisted member. Adding a phrase alone would still leave bridge-
started turns, MCP operations and browser edits with different behavior.

The earlier lane implementation supplied the managed MCP seam, shared memory
and teammate delivery. Integration exposed further gaps:

- ACP explicitly sent `mcpServers: []` on both session/new and session/load.
  A claim that the three built-in engines were covered did not establish
  support for arbitrary registry agents.
- Saved profile.json, registered channel access, incoming browser snapshots,
  resumed instructions and visible receipts could carry different names.
  A late receipt or an old tab could write the earlier identity back.
- The original eight tools omitted description, project memory, memory edits,
  channel operations and the work plan already available through text actions.
- The pinned Autohand CLI has a 30-second MCP timeout. Waiting 45 seconds for
  another member could fail the caller while the recipient continued working.
- Serializing all proxy requests meant a slow teammate wait also blocked a
  directory lookup. Independently accepting sends without serializing the
  recipient could start two deliveries at the same time.

## Decision

Use one bridge-owned service, `server/team/`, behind the managed stdio server
`autohand-squad`. The transport is an adapter to persisted Squad operations;
it is not a second settings database or an independent agent runtime.

### Operation surface

Sixteen tools cover the supported internal operations:

| Concern | Tools |
| --- | --- |
| Team directory and communication | squad_team, squad_message, squad_replies |
| Own profile | squad_get_profile, squad_set_profile |
| Shared, personal and project memory | squad_remember, squad_recall, squad_update_memory, squad_forget |
| Channels and threads | squad_channels, squad_channel_messages, squad_post_channel, squad_create_channel |
| Commitments and later work | squad_work_plan, squad_task, squad_schedule |

Profiles include name, role, description, operating instructions, personality
and selected skills. Profile, channel creation, task and schedule tools use
`agentChannelActions.perform`, the same registered handlers used by legacy
`SQUAD_ACTION` text. A receipt reflects the saved outcome before the member
confirms it. Schedule and channel proposals retain their existing approval
policies; a member cannot change another member's identity or permissions.
Unknown fields and invalid argument types return MCP `isError` results.

### Identity and convergence

The bridge binds the caller from a private per-member credential, never an
agent-supplied actor id. Credentials stay stable for warm engine sessions.
Each call snapshots the active run, workspace, channel and delegation depth;
tool execution is refused after that run finishes or the member is removed.
Stop revokes the member connection. A subsequent run refreshes its context.

The registered member copy is the canonical profile. Profile mutations pass
through the channel-store queue, assign a monotonic `profileRevision`, check
name collisions there and retain former names for routing. Explicit UI edits
send only their changed profile fields. Old launch payloads, polling results,
late receipts and other tabs cannot overwrite a higher profile revision.

profile.json and generated Markdown documents are projections. They are
updated after the canonical mutation and repaired from it at startup; every
new run also merges the canonical revision before generating instructions.
Manual/uploaded profile documents are preserved. Personality is saved as
PERSONALITY.md. This is deliberate eventual convergence across files, not a
transaction spanning independent JSON and Markdown documents.

Autohand receives the server in its managed config, Claude Code through
`--mcp-config`, Codex through `-c mcp_servers.*`, and every ACP v1 engine in
both session/new and session/load. ACP stdio is mandatory; optional HTTP/SSE
connectors require the capability advertised by the agent. Unsupported
transports fail explicitly. Resumed ACP turns refresh profile and memory;
Codex refreshes turn context every time and stable instructions when their
digest changes.

### Memory and messaging

Memory lives atomically in team.json. Team entries are shared, personal
entries are private to their owner, and project entries follow the current
normalized workspace. Agents may edit/delete their own entries; the person
can edit any entry in the Memory UI. Credential-shaped text is refused. The
200-entry limit rejects a new fact instead of silently evicting an old one.
Prompts carry bounded recent memory and explain that older entries remain
available through squad_recall.

Delivery runs on the bridge, with the recipient's own tools and permissions.
It waits for busy recipients, serializes competing sends to one recipient,
and caps delegation depth. Independent MCP requests may run concurrently.
A supplied request_id deduplicates retries within retained delivery history.
Autohand waits at most 25 seconds; other engines at most 50. Longer work
returns a delivery id and is collected with squad_replies. An empty successful
run is reported as completed without reply text. Pending deliveries become
interrupted after restart; they are never silently re-executed.

A conversation started inside a channel posts its real agent-to-agent
exchange in that same thread. squad_post_channel is publication only; it
does not dispatch every channel member. Reading/posting requires membership.
The truthful channel rendering decision is recorded separately in ADR-0135.

## Validation on this integration

Commands actually run against this implementation:

- `node scripts/check-team.mjs`: isolated real bridge and Codex protocol
  fixture; all sixteen tools, cross-member delivery, profile fields and
  revisions, old-name routing, memory, channel membership, idempotent posts,
  creation proposals, work-plan mutations, schedule proposals and resume.
- `node scripts/check-team-operations.mjs`: scoped memory CRUD, ownership,
  schema refusals, duplicate sends, recipient serialization, empty answers,
  idle/revoked identities, capacity, restart recovery, fragmented input and
  concurrent newline/Content-Length MCP framing.
- `node scripts/check-acp.mjs`: real bridge and ACP fixture; managed MCP in
  new/loaded sessions, fresh resumed instructions, transport negotiation,
  permission modes, reset, cancellation and cross-engine handoff.
- `node scripts/check-member-by-chat.mjs`: legacy text actions, preserved
  profile documents, receipts, validation and identity restrictions.
- `node scripts/check-team-channels-browser.mjs`: headless Chrome and real
  bridge. The fixture calls squad_set_profile during a chat; the delivered
  answer, header, sidebar, composer and profile.json all use Viggas. It also
  checks channel completion/failure states and restart persistence.
- `bun run build`: production frontend bundle compiled successfully.

Fixtures exercise real transports and persistence, not a live model provider.
Screenshots are in `.codex-artifacts/team-channels/`. Earlier lane live-provider
observations are not treated as proof of this integrated revision.

## Consequences and limits

- All engines share one operation model, but an engine must actually call a
  tool (or emit a legacy action). Ordinary prose cannot prove a mutation.
- One extra MCP subprocess/configuration is supplied to each engine. Stable
  credentials preserve warm sessions; current instructions still grow resumed
  context and can reduce prompt-cache reuse when the profile changes.
- Profile files and UI replicas converge by revision. A projection write
  failure is logged and repaired; the canonical operation remains committed.
  There is no cross-file atomic transaction or multi-machine replication.
- Memory is a bounded structured local store, not a semantic index or a
  Markdown directory mirror. Existing memory-inbox proposals are not migrated.
- Teammate messages are local durable delivery records, not a distributed
  broker. Deduplication is bounded by 200 retained records, not a permanent
  exactly-once guarantee. Work does not run while Squad is quit or the Mac
  sleeps. Loops are bounded rather than made arbitrarily recursive.
- The external control-plane MCP (ADR-0109) remains separate. Account
  credentials, permission grants, engine installation, member deletion and
  arbitrary settings are not exposed through this member credential. A2A,
  ADK and agents outside this Squad are not added.

Protocol references: [MCP tool results](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/schema.mdx),
[ACP v1 session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/draft/session-setup.mdx).
