# ADR-0135: Count actual channel answers and preserve their threads

Date: 2026-10-20. Status: Accepted.

## Context and evidence

The product owner sent a message in a channel. Its footer immediately listed
the team as having replied, while the composer correctly said they were
thinking. Later answers appeared in a flat channel rather than a reply
thread. They requested threads with a setting to show replies directly.

`repliersByUserMessage` walked every agent record between one human message
and the next. Fan-out creates loading records before a member answers. The
renderer hid those placeholders, but the footer counted them first. The same
time window also assigned a late answer to a newer, unrelated request.

A pre-change React server-render reproduction with a human root and an Eva
loading placeholder produced “Eva replied”. The existing saved records
already carried threadId and parentMessageId, so changing storage or inferring
threads from timestamps was unnecessary. ADR-0133's flat display was a product
choice; it is superseded here for the default reply presentation.

## Decision

`src/lib/channel-replies.js` indexes explicit parent/thread identities and
classifies working, failed, no-text and actual completed answers. Only an
agent's completed text or attachment contributes its replied avatar. A run
that returned no chat text is visible as an outcome, not an answer.

Thread mode is the default for existing and new channels. A root stays in the
channel with an accessible shadcn Collapsible summary such as “0 replies ·
2 working” or “1 reply · 1 failed”. It expands the saved conversation with
the existing reactions, authors, work details and Reply in thread action.
Presence beneath the composer stays independent from completion counts.

Channel settings add “Show replies”: In threads or In the channel. The saved
replyMode is normalized and preserved by the browser, bridge mutations and
snapshot sync. Direct mode renders the same records chronologically at one
level. Switching modes never copies, reruns or deletes messages.

Unknown or missing parents, cross-channel references and cycles remain
visible as standalone records. Saved thread metadata may explain unavailable
content as before; its historical replyCount never fabricates replied people.

## Validation

- `node scripts/check-channel-replies.mjs` checks pending/streaming/error/
  empty outcomes, media replies, multiple answers by one member, late and
  nested parents, legacy thread-only links, persistence, missing parents,
  cycles and channel isolation, plus rendered markup in both modes.
- `node scripts/check-team-channels-browser.mjs` submits one message through
  the actual React composer to two gated engine fixtures. Chrome shows zero
  replies with two working, then one reply with one working, then one reply
  with one failure. The actual answer appears inside its expanded thread.
  Reply targets that thread; the normal settings control saves direct mode;
  reload and bridge restart preserve both the setting and transcript.
- `node scripts/check-channel-lifecycle.mjs --api-only` verifies the reply
  setting survives bridge restart alongside existing channel persistence,
  membership and damaged-history protections.
- `node scripts/check-channel-transcript.mjs` still passes its existing
  missing-content and no-fabrication checks.

Browser screenshots: `.codex-artifacts/team-channels/`. These are fixture
transport and rendered UI checks, not live provider or installed-app proof.

## Consequences and limits

- Long responses no longer dominate a channel by default. Opening a thread
  costs one click; channels that want all answers visible can choose direct.
- Thread expansion is local view state and resets on reload. Reply display
  mode is persisted per channel. No second sidebar or modal is introduced.
- Completion counts depend on actual transcript records. Missing historical
  messages cannot supply identities or prove a response completed.
- Existing orphaned messages are kept visible. This change does not guess
  their missing relationship or repair incomplete historical transcripts.
- Nested thread content reuses the existing stream renderer. Large-history
  virtualization and per-thread read markers are separate work.
