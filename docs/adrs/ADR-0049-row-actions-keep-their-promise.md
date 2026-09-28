# ADR-0049: A verb on a control is a promise

Date: 2026-09-29
Status: Accepted

## Context

The owner: "check why any of these buttons are not working. I click continue,
replay doesn't work."

They were right, and it was worse than two buttons. Every action on a Work row
was a link that added a query parameter to the page you were already on:
Continue, Replay, Hand Off, Review, Approve and Archive. Measured by clicking
Continue in a browser: the URL gained `?run=…` and the page was byte-identical
before and after, 4301 characters both times. No request was made. The only
effect was selecting that row.

Six controls carrying verbs, none of which did the thing named.

## Decision

**Replay does the thing.** A failed run can be started again, so Replay is a
button that posts the member, workspace, title and original prompt to
`/api/runs`, then goes to the new run. It shows "Starting…" while the request
is in flight and cannot be pressed twice.

**Everything else names where it goes.** A running or blocked row offers
**Open chat**, which opens the member whose work it is. A row waiting on a
handoff or an approval offers **Review**, which opens the Inbox, where those
decisions actually live. A finished row offers **Details**. Each is a link,
and each label is the destination.

The rejected alternative was to implement all six. Archive has no archive,
Hand Off has no handoff from this surface, and Approve is the Inbox's job.
Building four features to justify four labels is the wrong order; the labels
were the mistake.

## Consequences

- One control on the row acts, and it is a button. The rest navigate, and they
  are links. That difference is now visible in the markup and to a screen
  reader, not only in what happens.
- Replay reuses the original prompt. A run that failed because the prompt was
  wrong will fail again, which is honest: the button repeats the attempt, it
  does not repair it.
- A replay that cannot start reports through the page's existing error line
  and the row keeps its failed state.
- Work no longer pretends to be the place where handoffs and approvals are
  decided. That is the Inbox, and ADR-0045 already drew that line.
