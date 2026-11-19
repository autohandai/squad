# ADR-0263: The phone gets an Inbox and sends feedback through the computer

Status: accepted, 2026-11-19

## Context

"in our mobile app there's no inbox for the user to see it what's important
no provide feedback and auto report bugs or report a bug like we do for the
desktop app." The desktop Inbox (ADR-0121, renamed in ADR-0258) is assembled
inside the window from app state: approvals, vault and folder requests,
proposals, unread replies, stopped work. No bridge endpoint returns it, so the
phone had nothing to read. Feedback went only through the window's Report a
bug and, since ADR-0258, the agents' MCP tools.

## Decision

- Phone contract 0.6 adds two commands, advertised as capabilities `inbox`
  and `feedback`:
  - `inbox` returns decisions waiting on the person across every member and
    the failed or stopped replies from the last 48 hours.
    - Decisions are pending permission requests (`/api/chat/permissions`)
      and proposed automations (`/api/routines/proposals`).
    - Each decision is the same card `conversation` returns, so the phone
      answers it with `card.act` and the Mac sees one decision, not two.
    - Stopped replies are one per member and question.
  - `feedback.send` relays to `submitAgentFeedback`.
- Unread replies are not in `inbox`: what the person has read is a fact
  about this phone, so the phone works it out from `lastMessageAt` and when
  it last opened each chat.
- `submitAgentFeedback` takes `via`: `agent` (default), `phone` or
  `phone-automatic`.
  - Each has its own hourly allowance: 5 for agents, 10 for a person on the
    phone, 5 automatic.
  - Before this, any new reporter would have shared the agents' five.
  - The report is labelled "from Squad for iPhone", uses route `/phone`,
    carries the computer's sanitised diagnostics, and never a screenshot or
    an email.

## What was run

- `check:mobile` (all five scripts pass). `check-mobile-cards` now asserts:
  - the capabilities are advertised;
  - a proposed automation is in `inbox` with its card, and leaves it once
    declined;
  - `inbox` refuses parameters;
  - `feedback.send` refuses short summaries and unknown kinds.
- `check-agent-feedback` sends a phone report and an automatic one after the
  agents have used up their five. Both go through, labelled "from Squad for
  iPhone", which shows the allowances are separate.

## Consequences

- The phone's Inbox shows two of the desktop's seven decision kinds:
  - shown: permissions and automation proposals;
  - not shown: vault, folder, handoff, channel and memory proposals. Those
    live in window state, and moving them to the bridge is a larger change.
- Team proposals appear in the chat where they were made, not in the Inbox.
- "Unread" on the phone and on the Mac are separate. Reading a chat on one
  does not clear it on the other.
- A valid `feedback.send` is not exercised against the real feedback
  service in checks; the stub in `check-agent-feedback` stands in for it.
