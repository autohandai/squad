# Channel responders — integration note

Who answers a channel message that mentions nobody: Everyone (the original
fan-out), a named Lead, or Auto (one bounded model call picks). Explicit
mentions and `@here` always win (ADR-0094).

| File | Role |
| --- | --- |
| `src/lib/channel-responders.js` | Pure: `normalizeResponder`, `responderStatus`, `needsResponderPick`, `resolveResponderRecipients`, `decideFromPick`, `resolveMentions` (bridge-side mentions), `responderTagLabel`. Shared by browser and bridge. |
| `server/responders/pick.mjs` | `createResponderPicker`: provider availability and the single chat-completion call with a 3 s budget; `directEndpoint` decides which providers are callable. |
| `server.mjs` | `normalizeChannel` keeps `responder`; `updateChannel` validates the lead; routes below. |
| `server/agent-channel-actions.mjs` | Bridge-side purpose dispatch resolves recipients with the same module and records `responder` on the purpose root. |
| `src/components/channels/ResponderSettings.jsx` | `ResponderSettings` (the choice row inside the channel details form) and `AnsweredByTag`. |
| `src/components/channels/ChannelDetailsSettings.jsx` | Hosts the row; the one Save channel action sends `responder` with the other fields. |
| `scripts/check-responders.mjs` | `bun run check:responders` (in `ci`). |

## Routes

- `PATCH /api/channels/:id` with `{ responder: { mode, leadMemberId } }`.
  400 when mode is `lead` without a lead or when the lead is not a member.
  Removing the lead from the roster later keeps the saved value; read
  `responderStatus(channel).leadMissing`.
- `GET /api/responders/availability` → `{ available, reason, provider: { id, label, model } }`
  for the workspace default provider.
- `POST /api/channels/:id/responders/pick` with
  `{ message, members?: [{ id, name, role, purpose }], lines?: [string] }` →
  `{ rule, memberIds, responder, mentions, available, reason, requests, latencyMs, status }`.
  `rule` is one of `mentions`, `here`, `everyone`, `lead`, `auto`,
  `auto-everyone`, `auto-fallback`. Mentions are resolved on the bridge first,
  so `requests` is 0 for a mentioned message. Only an Auto channel's
  un-mentioned message makes one provider request.

## Browser wiring (`src/App.jsx`)

- `sendChannelPrompt`: `resolveChannelMentionTargets` → `needsResponderPick`
  → `requestResponderPick` (the route) → `resolveResponderRecipients`; the
  thread, root message and each reply carry `responder`.
- `normalizeChannelCopy` keeps `responder` so the mirrored channel list does
  not erase it.
- The thread meta row renders `<AnsweredByTag responder={rootMessage.responder} members={agents} />`.
- The composer hint reads `responderTargetHint(channel, members)` when nothing is mentioned.
- `ChannelDetailsSettings` receives `members={agents}` and
  `loadAutoAvailability={loadResponderAvailability}`.

## Message metadata

`responder: { mode, rule, memberId?, probability?, reason?, fallback? }` on the
thread root and on replies. Everyone mode records nothing, so existing
threads render unchanged.

## Limits

Auto needs a provider the bridge can call directly with an API key and an
OpenAI-compatible base URL (OpenAI, OpenRouter, DeepSeek, Z.ai, NVIDIA,
Cerebras, Ollama without a key, Autohand AI with an API key). Bedrock, LLM
Gateway and account-only Autohand AI report "Auto is unavailable…" and fall
back to the lead or everyone. Thread follow-ups keep the thread's recipients
and never pick. Bridge-created channels start on Everyone.
