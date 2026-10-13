# ADR-0108: Channel responder rules

Status: accepted

## Context and evidence

A channel message that mentions nobody fanned out to every member of the
channel (`sendChannelPrompt` in `src/App.jsx`). The competitor audit (A7)
recorded the problem: a five-member channel answers a one-line question with
five member turns, and the only way to narrow it was to type a mention every
time. The audit also set the bar: explicit mentions select recipients, an
optional lead handles un-mentioned requests, today's everyone behaviour stays
available, and any token-saving claim must come with measured request counts.
OpenMausBot's room responder modes (`docs/decision-model.md`) were the
behavioural reference: Everyone, Lead, and Auto, where a fast model answers
"who should reply?" with a probability and anything under 0.6 goes to the
room's fallback. It routes through a third-party decision service; that part
was out of scope from the start.

Two paths dispatch into channels and had to agree. The browser dispatches
user prompts and thread follow-ups. The bridge dispatches a member's channel
purpose when a `SQUAD_ACTION` creates a channel (ADR-0075); it sent the
purpose to every member regardless of what the purpose said.

`node scripts/check-responders.mjs` (real bridge, isolated state dir, a local
fake OpenAI-compatible endpoint that counts requests) produced these numbers
on 2026-10-13:

| Scenario | Requests to the provider |
| --- | --- |
| Lead mode: un-mentioned, `@mention`, `@here` (3 messages) | 0 |
| Lead mode with the lead removed from the roster | 0 |
| Auto: one member answered at 0.8 | 1 |
| Auto: "several" at 0.9 | 1 |
| Auto: 0.4, fell back to the lead | 1 |
| Auto: 0.4 with no lead, fell back to everyone | 1 |
| Auto: non-JSON answer; HTTP 500 | 1 each |
| Auto: `@mention` and `@here` (2 messages) | 0 |
| Auto: provider hung, fell back after 3004 ms | 1 |
| Auto with Amazon Bedrock as the default provider | 0 (reported unavailable) |
| Bridge-side purposes, one with a mention and one without | 0 |

So an Auto channel costs exactly one small request (80 output tokens at most)
per un-mentioned message and nothing for mentioned ones; Lead and Everyone
never call anything. What Auto saves is member turns, not requests: a picked
member means one member turn instead of N. The check does not measure member
turn tokens because the fixture SDK returns canned text; the saving is the
turn count, which the check asserts through the recipient lists.

The same run showed the bridge-side purpose with `@asq_peer` in its text was
delivered to the peer only, while the purpose without a mention still reached
both members.

## Decision

One pure module, `src/lib/channel-responders.js`, owns the rule and is
imported by the browser, the bridge route and the bridge-side purpose
dispatch. Precedence is fixed: explicit mentions, then `@here`, then a thread's
recorded recipients, then the channel's responder mode.

- `channel.responder = { mode: "everyone" | "lead" | "auto", leadMemberId }`,
  saved through the existing channel edit route and kept by both
  normalisers so the browser's mirrored channel list cannot erase it.
  New channels and bridge-created channels start on Everyone.
- Lead: un-mentioned thread roots go to the lead only; the lead hands off
  through the existing mention relay. A lead must be on the roster to be
  chosen. A lead who later leaves is kept in the saved value, reported as
  missing, and the channel answers as Everyone until a new lead is chosen.
- Auto: `POST /api/channels/:id/responders/pick` is the only place a model is
  asked. `server/responders/pick.mjs` makes one chat-completion call
  (temperature 0, 80 output tokens, 3 s budget) to the bridge's resolved
  default provider, offering the roster (id, name, role, purpose) plus
  "several", the channel name, the last six lines and the message, and asks
  for JSON `{ choice, probability }`. At or above 0.6 for one member that
  member answers; at or above 0.6 for "several" everyone answers; below that,
  or on any failure (timeout, HTTP error, unparseable or out-of-roster
  answer), the lead answers, else everyone. The route resolves mentions
  itself first, so a mentioned message returns without a request even if a
  caller asks.
- Auto is only offered where the bridge can call the provider directly with
  an API key and an OpenAI-compatible base URL: OpenAI, OpenRouter, DeepSeek,
  Z.ai, NVIDIA, Cerebras, Ollama (no key), and Autohand AI when an API key is
  configured. `GET /api/responders/availability` says whether it can and why
  not; the settings row shows that sentence.
- Both dispatch paths record the decision as `responder` metadata on the
  thread root and on each reply (`mode`, `rule`, `memberId`, `probability`,
  `reason`), and the thread row shows "Answered by Noah (auto · 80%)",
  "Answered by Iris (lead)", or "Everyone answered (auto fell back: …)".
- Thread follow-ups keep the thread's recorded recipients and never pick; the
  mode applies when a thread starts.

## Consequences

- Auto is unavailable with Amazon Bedrock (SigV4 signing), LLM Gateway (no
  fixed request shape) and Autohand AI signed in by account only (the account
  token belongs to the CLI and is not sent from the bridge). Those channels
  fall back to the lead or everyone and the row says so; the pick route
  reports `available: false`. A per-member provider override is ignored for
  picks: the workspace default decides.
- No third-party decision service and no second key to manage; the pick uses
  the provider the squad already runs on, which means its latency and price
  are that provider's. The 3 s budget is a ceiling, not a target: a slow
  provider delays the first member turn by up to 3 s before falling back.
- A bridge-created channel is always new and therefore on Everyone, so the
  bridge-side path applies mentions and the fan-out but never reaches the
  Auto branch in practice. The shared resolver is still used there so a
  future mode on an existing channel would behave the same.
- Lead mode changes the default answer for un-mentioned follow-ups only
  through the thread's recipients; a thread opened under Everyone keeps
  answering with everyone after the channel switches to Lead.
- The pick prompt sends member names, roles, purposes and the last six
  message lines to the provider. That is the same data a member turn already
  sends, but it now also leaves the machine for a channel the chosen member
  then handles alone.
- Not done: a rendered-browser proof of the settings row (the check covers
  the bridge, the route and the pure rules; the form is the existing settings
  form with one more row), a labelled routing corpus to score the pick
  prompt's accuracy, and a per-channel log of pick decisions beyond the
  bridge's console line.
