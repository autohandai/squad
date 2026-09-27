# ADR-0030: Keep the SDK system prompt stable, and warm the session early

Date: 2026-09-27
Status: Accepted

## Context

Chatting with a member felt slow and the SDK was the suspect. Measuring it
against the running app on a real account, on the member `moa` model, showed
something else.

| Session | Time to first token |
| --- | --- |
| Warm, pool hit | 4.4 s, of which 4.05 s is the model's own first token |
| Cold, pool miss | 43.7 s |

The SDK itself contributes 1 to 4 ms either way. On a warm session the answer
really is the model's first-token time and nothing on our side moves it. On a
cold session, 30 s of the 41 s inside the call is the vendored CLI trying to
start MCP servers that are not reachable on this machine, plus 6 s of the rest
of its boot.

So the defect was never per-turn latency. It was that **the warm pool missed
almost every time**, turning a 4 second turn into a 44 second one.

The pool keys on `{ agentId, workspace, options }`, and `options` carries
`appendSystemPrompt`, which is the member profile the web app builds. That
profile embedded each teammate's live presence label, which changes whenever
any run starts or finishes. So the key changed between messages and the CLI
cold-started nearly every time.

## Decision

**The system prompt carries durable facts only.** The teammate roster keeps
who exists and what they do, and drops the presence label. Whether a teammate
is busy this second is not something the member needs in a system prompt, and
it was costing 40 seconds to tell it.

The alternative, excluding `appendSystemPrompt` from the session key, is one
line and wrong: the system prompt genuinely changes behaviour, and a warm
session answering under a stale one is a correctness bug traded for speed.

`scripts/check-prompt-stability.mjs` fails the build if anything volatile
returns to that function, because the cost of this mistake is invisible: it
produces a slow app, not a broken one.

**Conversational context rides on the prompt.** The "since you were last
here" briefing (ADR-0028) is per-visit by nature. It goes in the first user
message of a fresh conversation, not in the system prompt. It was briefly in
the system prompt, which would have reintroduced exactly this bug.

**The session warms when the conversation opens.** `POST /api/chat/warm`
acquires a lease and releases it. Because `sdk.start()` returns at spawn, the
CLI boots while the person reads the briefing and types, so the cost overlaps
the time before the first message instead of landing on it. It answers 202
immediately and never blocks: a warm-up that makes you wait is the thing it
exists to prevent. A member on a break is not warmed.

**Channel replies use the SDK.** The channel dispatch pinned
`transport: "cli"`, which skipped the pool entirely and spawned a fresh CLI
for every channel message. Measured on one member with one prompt: 15 s
pinned, 4 to 6 s over the SDK. The bridge already falls back to the CLI when
the SDK cannot start, so the pin bought nothing. `check-prompt-stability`
fails if it comes back.

**A user Stop leaves a healthy session.** Cancelling a reply marked the
session unhealthy and closed it, so the next message paid a full cold start.
An abort now releases the session as healthy when it had started.

## Consequences

- A first message in a conversation should now land near the warm number,
  because the boot overlaps the time before it. Later messages in the same
  conversation were always going to be warm; the change is that they now
  actually are.
- Warming starts a CLI process for a member whose chat is merely opened. That
  is the trade: a process that may go unused against 40 seconds on the
  message that follows. The pool's idle sweep reclaims it.
- Verified on the installed app with a real account: opening a conversation
  leaves one warm session waiting, and the message that follows reached its
  first token in 5.6 s against the 43.7 s cold measurement.

## Not done, and why

Two findings from the same measurement are deliberately left alone, because
both change what a member can do or touch the person's own configuration:

- **Members inherit the user's MCP servers.** Creating a member copies the
  user's CLI config wholesale, so every member tries to start every server
  the person has configured. Three are unreachable here and cost 30.1 s on
  every cold start. Not changed, because removing inherited servers changes
  what tools members have.
- **That copied config carries a live GitHub personal access token** into
  each member's home directory. Worth the person's attention. Not touched,
  because it is their credential and their configuration.
