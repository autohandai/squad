# ADR-0155: Discover models at the harness boundary and route configured fallbacks

Date: 2026-10-29
Status: Accepted

## Context and evidence

The member's Model page offered a provider selector followed by a text box
asking for an exact model ID. The installed Autohand catalog was already
read into provider settings, but this form did not use it.
`node scripts/check-model-fallbacks-browser.mjs` reproduced the actual page:
the assertion that an override offers supported model IDs failed. It passes
after replacing the text-only field with the catalog-backed picker.

Model discovery also had different limits per engine. ADR-0114 recorded
Codex's configured default as its entire list; that assumption no longer
holds. The [Codex app server](https://developers.openai.com/codex/app-server)
provides `model/list`, including pagination, account-specific IDs, names and
reasoning levels. The pinned Claude SDK exposes `supportedModels()` after
initialization (`sdk.d.ts`); ACP sessions can report model choices and a
model configuration option. These are engine contracts, not a shared vendor
model list. An ACP agent that reports no choices must retain its own default.

Squad previously refused an unavailable assigned engine. It has limited
Claude-only model-limit recovery, but no person-configured chain across
engines. A fallback must preserve member identity and permissions while
letting each engine authenticate with its own account.

## Decisions

### One catalog control, with explicit provenance

Model settings, engine settings and composer overrides use the same picker.
It loads IDs and display names for the selected engine/provider/workspace,
retains a saved ID absent from a changed list, and offers a deliberate custom
ID entry. Refresh failures retain usable choices and explain the failure.
Changing a provider or engine never carries another engine's model ID into
the new choice.

Autohand reads its installed provider catalog. Codex is queried with
`model/list`; Claude is initialized with an open, empty input stream before
reading `supportedModels()`. ACP initializes a session with no MCP servers
or client file/terminal capabilities. Discovery sends no user prompt or
inference request. Claude discovery uses strict empty MCP configuration and
disables ordinary configured hooks. Engine-managed policy can still apply.
Bounded caches avoid repeatedly starting probes. Autohand catalog input
accepts both the installed provider-map format and the provider-list format,
and excludes entries marked unsupported by the CLI.

### The person owns an ordered chain

Each member can save up to four fallback engine/model choices, reorder or
remove them, and select a provider for an Autohand fallback. Existing members
have no fallbacks. Only explicitly configured targets may be used. The
primary assignment is never rewritten by automatic recovery.

Usage, sign-in and startup failures can advance immediately. A connection
failure or engine that produces no answer/tool work gets one retry before
advancing. The first useful response deadline is 45 seconds. Failed routes
cool down for five minutes in persisted local health state; subsequent work
can use the next route, and expiry allows the primary to be tried again.
Model settings also offers Retry primary now.

Cancellation, permission refusal and workspace/file validation failures do
not trigger a fallback. Waiting for approval is not an unresponsive engine.
If a tool is still in flight when a run fails, automatic switching stops:
its external effects cannot safely be assumed absent. Completed work and
bounded conversation context accompany a switch; the next engine is told to
inspect and continue rather than repeat actions.

### Execution choice is separate from the member profile

The bridge passes a transient execution target to the existing engine
adapters. It keeps the same member ID, memory, profile, projects, attached
files and permission choices, and uses a separate native session per engine.
The stream shows one plain switching sentence. The completed reply and run
record the engine and model that actually answered, with attempt history.
Queues, independent threads, channels and assigned runs share this routing
boundary rather than implementing browser-only retries.

The person may enable Let this member manage fallbacks. Managed Squad MCP
tools then let the member inspect connected engines/models and update its
own list. The tool cannot enable that permission, change the primary, select
an arbitrary executable or grant broader tool access. It validates connected
engines and reported model IDs before persisting a profile revision.
Independent catalog validations run concurrently and share in-flight probes,
so a multi-engine list does not add every discovery deadline in sequence.

The serialized write checks the latest opt-in and applies only the routing
patch to the latest member. A regression first reproduced a stale tool write
changing a newly selected Claude primary back to Autohand. A check before
asynchronous model discovery was insufficient: revocation, member removal
and concurrent primary edits must be respected at commit. A removed member
cannot be restored by a tool whose model lookup was already in flight.

## Corrections established during implementation

- A pre-event SDK failure was assumed to mean the SDK bridge could not start.
  The quota fixture disproved this: a 429 reached the legacy CLI transport,
  whose setup-cancellation message could be accepted as the answer. Typed
  engine failures now reach routing before that transport retry.
- Provider configuration errors occur before the SDK starts. A real-bridge
  regression showed that a disabled primary provider stopped execution even
  with an authenticated Codex fallback saved. Setup and missing-credential
  errors now carry explicit codes; routing does not depend on matching the
  English wording of every provider's Settings message.
- A native process can also fail after producing text. The recording Codex
  process emitted a partial answer and exited with code 1; its plain exit
  message was initially unclassified, so routing stopped with HTTP 502.
  A structured chat-runtime failure with a nonzero native exit is now an
  engine failure. Its partial progress accompanies the configured fallback;
  the in-flight-tool and permission guards still take precedence.
- External adapters deliberately default to full access (ADR-0114); carrying
  `policy: restricted` alone did not preserve a restricted Autohand primary.
  Routing now carries an explicit access choice. The reverse check found
  that chat construction forced `dryRun: false`, discarding an Autohand
  fallback's read-only preview flag. Both CLI and SDK chat paths now retain
  that flag for routed read-only work. Native permission modes have different
  semantics; Autohand uses preview mode for this case, not Codex's OS sandbox.
- Aborting the first-response timer did not cancel a session still awaiting
  SDK startup. `check-sdk-sessions.mjs` reproduced a cold acquisition ignoring
  cancellation. Acquisition now observes the signal, closes its owned cold
  SDK without waiting for startup to finish, and keeps a cancelled waiter
  from releasing another active turn. A watchdog cancellation discards the
  failed session; ordinary Stop retains the existing warm-session policy.
- The first assigned-run integration reused the chat wrapper too broadly:
  it forced prompt mode, omitted the context pack and recipe/canvas identity,
  and suppressed `run.finished` as though every launch were a direct reply.
  The assigned-run regression went red on the missing context pack. Routed
  launches now keep their native Auto/goal execution mode and runtime budget,
  populate the usual run context, and emit the ordinary completion event once.
  Independent thread messages and channel-goal replies retain actual routing
  metadata when they settle from those runs.

## Consequences and limits

- A chosen fallback can use another subscription or an API-key provider's
  billing. The editor states this before saving; Squad does not enable paid
  overage or add credentials automatically.
- A model list is evidence of availability to the engine, not a guarantee
  of remaining allowance or success. Custom IDs remain an explicit escape
  hatch for new engines/private deployments; agent-authored changes require
  a reported ID.
- Native engine transcripts are not portable. Bounded conversation and
  completed-work evidence carry over; hidden engine reasoning and an
  unlimited transcript do not. External tools are not transactionally
  idempotent, so uncertainty about an in-flight tool requires a person.
- Recovery can add the first-response deadline and one retry before a new
  engine starts. Health is local and expires; there is no distributed
  account-health service, cost optimizer or silent routing outside the list.
- Discovery can start an engine process and create an empty ACP session,
  though it performs no turn. Unprepared fetch-on-use ACP engines are not
  downloaded merely to populate fallback choices.

## Validation

- `node scripts/check-model-routing.mjs` exercises ordered recovery, one
  transient retry, silent prompt/startup cancellation, persisted cooldown and
  expiry, primary and permission preservation, bounded continuation evidence,
  stop/approval/disk guards, catalog normalization, concurrent primary changes,
  grant revocation and member removal. Its short deadlines use recording fixtures.
- `node scripts/check-model-routing-bridge.mjs` runs the real bridge and
  native recording processes: paginated Codex model discovery, the pinned
  Claude SDK's empty-input initialization, ACP model negotiation and selected
  model RPC, fallback in both directions, native image bytes, access flags,
  restart recovery, missing primary credentials, queues, assigned runs,
  completed goals, independent reply threads and protected MCP
  updates. Discovery produces no user turn in those processes.
- `node scripts/check-model-fallbacks-browser.mjs` exercises the rendered
  model and fallback editor, failed saves with drafts retained, refresh
  failure with choices retained, ordered changes across reload, opt-in member
  tools and their profile receipt, actual failover answers/engine attribution
  in one chat, replacement of a failed partial answer, and the selected
  fallback engine/model in the rendered reply sheet.
- `check:model-routing` includes these checks in local CI, the web CI job and
  release validation. These fixtures do not prove live vendor
  quota exhaustion, model quality, a packaged native upgrade or publication.

The complete `bun run check:model-routing` command passed, as did the SDK
session and error checks. Thirty focused existing harness, chat, profile,
queue, goal, thread, team, archive, control-plane, attachment and staging
checks passed; their command/output record is
`.codex-artifacts/model-fallbacks-20261029/regressions.log`. The full aggregate
CI suite was not run.

Passive discovery against this machine's installed engines returned 11
Autohand catalog entries, eight Codex models and 13 Claude models without a
user prompt. The IDs/names and provenance are retained in
`.codex-artifacts/model-fallbacks-20261029/installed-models.json`; the Autohand
entries are its installed cache, rather than a live provider entitlement test.

The production build passed and the current runtime was staged. Both model
bridge and browser checks also passed with `--packaged` using Node 22.23.1
against `src-tauri/runtime` and its staged SDKs/frontend. Screenshots are under
`.codex-artifacts/model-fallbacks-20261029/packaged/`. Release runtime/portable
fixture packaging, workflow metadata, Actionlint and diff checks passed.
Native installer replacement, notarization, live vendor exhaustion/recovery
and cross-platform native UI were not exercised by this change. No new
release was committed, installed or published for this goal.
