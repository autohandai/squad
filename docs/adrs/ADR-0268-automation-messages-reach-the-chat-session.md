# ADR-0268: What an automation posts in a chat reaches the member's chat session

Status: accepted, 2026-11-20

## Context

Reported with a screenshot:
1. An email arrived for Chief of Staff, and its email automation posted a
   summary in the chat ("This is a test email from Igor Costa…").
2. The person wrote "reply".
3. Chief of Staff answered "I'm here. What would you like to work on in
   squad-test today?". "completely ignore the session history … that's a
   massive bug".

Cause:
- Automations (schedules, webhooks, email; ADR-0254, ADR-0262) run in an
  ephemeral session of their own, and their reply is then shown in the
  member's chat (`reconcileAutomationReplies`).
- The browser sends the last twelve messages with every turn
  (`conversationContext`), and those include that summary. But the bridge
  only uses them to replay the conversation into a *fresh* engine session
  (ADR-0161).
- Chief of Staff's session was warm, so it got the person's "reply" and
  nothing else.
- The same was true for any engine: Claude Code and Codex resume their own
  sessions and never see the replay at all.

## Decision

- The app marks a context message posted by an automation as `outside`,
  with its id and the automation's title (`conversationContextMessages`).
- Where every chat turn starts, before an engine is chosen, the bridge
  prepends a `<squad_posted_in_this_chat>` block with those messages
  (`unseenOutside`, `outsideMessagesBlock` in `server/chats/replay.mjs`). It
  calls them the member's own and says the person's next message may refer
  to them.
- Each member is told about each one once (`outsideSeenByMember`), so the
  block does not repeat on every turn.
- Ephemeral turns (automations themselves) get no block.

## What was run

`scripts/check-outside-context.mjs` (new), against a real bridge with a
fixture SDK that records prompts:
- after a first turn warms the session, an automation summary appears in the
  context and the person writes "reply";
- the prompt then carries the block, with the summary and the automation's
  title, before the person's words;
- the session is the same one;
- the next turn does not repeat it.

On the old code the check fails with "the warm session is told what its
automation posted".

`check-chat-warmth`, `check-permission-approvals` (replay),
`check:automation-replies`, `check:chat-experience`, `check:server`,
`check:model-routing` and `check:agent-mail` pass.

## Consequences

- "Told once" is held in memory per member. After a bridge restart the next
  turn repeats the most recent automation messages once, which is harmless,
  and a fresh session gets them in the replay anyway.
- Only messages still among the last twelve in the chat are carried. An
  automation result further back is not.
- A message sent from the phone does not carry `conversationContext`, so a
  "reply" typed on the phone right after an automation summary still lacks
  it.
