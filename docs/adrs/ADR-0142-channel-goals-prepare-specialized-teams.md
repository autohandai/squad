# ADR-0142: A channel goal prepares and starts its specialized team

Date: 2026-10-22. Status: Accepted.

## Context and evidence

The person wants a new channel to ask its goal, accept a natural answer and
prepare the specialists that goal needs. The old dialog asked for a name
and existing members. An empty channel disabled its composer. The separate
team builder selected the first matching objective kit: “launch” could
select marketing before the same objective's mobile/release needs.

`check-channel-goals.mjs` first returned 404 for `/api/teams/design`. The new
designer check preserves Release Manager, Mobile Developer, UX Designer and
QA Engineer for a mobile release, and Sales Lead and Copywriter for selling
seasonal bread. These controlled responses through the real executor prove
that the operation preserves goal-specific roles rather than substituting
a fixed roster. They do not prove live-model design quality.

The first real Autohand/fantail designer returned only a planning preamble,
twice, despite its user prompt asking for JSON. This was not a JSON-fence
parser bug; there was no design to parse. Move the shape and completion
requirement into the internal system contract, keep the channel objective
as user data, and omit normal member/work-plan instructions for this utility.
The next live run returned distinct mobile, release, UX and QA specialists
and passed validation (`check-natural-workflows-live.mjs --only=design`).
There is still no generic-roster fallback. Failed design responses expose
their run id for diagnosis without presenting raw engine output as a team.

The first rendered check created and connected the right members, but Ready
could precede their registration in the managed team directory. Provisioning
now registers the saved member copy before publishing Ready, so teammates
can find each other before the initial turns start.

A second regression established that Ready only started work through the
browser. With no browser, it queued no deliveries. The bridge now commits
the initial loading messages and delivery identities before launching. The
isolated check starts all four specialists with no browser open, reports
zero replies while they are held, retries Ready without duplicate turns,
then retains all four actual answers across a bridge restart. The rendered
new-channel journey shows those answers in the original goal's thread.

## Decision

A user-created channel asks its goal in the normal composer. An atomic
bridge claim saves that message, its reply thread and the setup owner before
model work starts. Concurrent windows cannot begin duplicate builds. Resume
changes ownership; late results from an older window cannot overwrite it.

Use the existing designer engine to design 1–8 distinct specialists from
the whole objective, preserving explicitly requested roles. Runtime-validate
the JSON; accept only names, roles, responsibilities, instructions and known
catalog skills. The existing provisioner owns engine configuration and
permissions. Invalid or unavailable design offers Retry with the goal kept;
it never silently claims a generic team was designed. A goal does not invent
recurring jobs.

Use the existing team-file validator and member provisioner. Keep the same
channel, join the prepared members, choose its lead, then start each on its
own contribution in the original goal's thread. Future unmentioned messages
use the saved lead. Requested work needs no second confirmation.

Ready atomically hands the initial turns to the bridge. Execution and final
answer persistence do not depend on the HTTP connection or an open window.
Prepared and working are separate states. A repeated Ready request reuses
the same delivery identities; a restart marks unfinished work interrupted,
without replaying potentially completed external effects.

Persist a latest build snapshot per channel on the bridge, including stable
member ids and preparation outcomes. Retry/reopen continues those ids and
skips ready members. Save before each next provisioning step. Retain the
existing app team build as its presentation model; do not introduce another
member factory or agent runtime.

## Consequences and tradeoffs

- Composition depends on the designer engine's reasoning. Removing the
  first-keyword kit's false certainty means design failures stay visible
  and retryable. This path needs a working engine and account.
- Preparation remains driven by the existing app build path. Closing the
  app preserves its bridge snapshot; Resume team setup continues it. Partial
  preparation is not silently restarted after a crash.
- The workspace comes from the channel/current project and remains visible
  in channel settings. This does not grant extra folders or create Git
  worktrees for every specialist.
- Atomic writes form an ordered pipeline, not a transaction across profiles,
  channels and build snapshots. Stable ids make retry safe after a member
  was prepared just before interruption.
- One latest snapshot is retained per channel. Automatic pruning for deleted
  channels and a build-history browser remain undone.
- A prepared team and a started turn are separate outcomes. An engine
  failure after preparation is visible in its thread and run history.
