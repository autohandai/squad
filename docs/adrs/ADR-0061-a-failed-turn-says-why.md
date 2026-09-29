# ADR-0061: A failed turn says why

Date: 2026-09-30
Status: Accepted

## Context

The owner: "this is not working, the basic functionality for chat and agent
responding is not working." Four members answered a channel message and all
four said the same thing — *"Autohand returned no chat text."* — each in 4.0
seconds, each with two steps: `hook post response` and `agent end`.

The sentence is a fallback in the bridge: `reply || "Autohand returned no chat
text."`. It fires whenever the extracted reply is empty, and it says nothing
about why.

**The SDK reports failure as events, not as thrown errors.** Its own type
definitions declare `error` (`{ code, message, recoverable }`),
`hook_session_error` (`{ error, code }`), `automode_error` (`{ error }`) and
`hook_context_overflow` (`{ usagePercent, … }`). `collectSdkPrompt` consumed the
stream looking only at `message_update`, `message_end` and `tool_update`. An
errored turn therefore ended *cleanly*: the loop saw nothing it recognised, the
stream closed, no exception was raised, and the empty reply fell through to the
fallback.

So a safety-check block, an oversized payload, a stalled inference stream and a
context overflow all rendered as the same seven words, with no error status, no
retry affordance and nothing in any log the app owns. The user's own
`~/.autohand/error.log` had no entry for the failing turn at all, because from
the CLI's point of view nothing had failed.

Evidence gathered before any fix: a single chat through the running bridge
returned `ok` in 6.0s with eleven events ending in an `assistant_event`; four
concurrent chats all returned `ok`; the failing turns had none of that. The
difference was not load. The difference was that something errored and nobody
looked.

## Decision

`server/sdk-events.mjs` reads failure out of a finished turn.

`firstSdkError` returns the **first** error on the stream, taking the message
from whichever field that event shape uses. First rather than last, because a
stalled stream or an aborted session usually follows the real cause. An event
of an error type carrying no text is not a reason and is skipped.

`replyFailure(events, reply)` answers the only question the caller has: this
turn produced `reply` — is there a real failure to raise instead of the
fallback? **Text present always wins.** A member that answered has answered, and
replacing its words with an error because something recoverable happened on the
way would discard the one thing that was asked for. Only an empty turn can fail.

A context overflow is informational on its own, but when the turn is *also*
empty it is precisely why, so it is reported with its usage figure and what to
do about it.

Both SDK call sites raise a `ChatRuntimeError` carrying the real message and the
trace, which the existing error path already renders as a failed message with
the reason attached. The CLI and adapter transports are untouched: their events
are a different shape, and changing them was not needed to fix this.

## Consequences

- **This makes the failure legible; it does not make it go away.** The next
  failing turn will name its cause — a safety block, a payload ceiling, a
  stalled stream, an overflowed context — instead of the same seven words. That
  is the point: the underlying fault could not be diagnosed from the app, and
  now it can.
- `check-sdk-errors.mjs` covers each declared shape and the field it carries its
  text in, first-error-wins, that an untexted error is not a reason, that a
  reply always beats a recoverable error, and that an empty overflowed turn
  reports its usage. Written before the module existed and run red first.
- The fallback sentence stays for the genuinely empty, genuinely unexplained
  turn. It is now the rare case rather than the only case.
