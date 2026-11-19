# ADR-0267: Members label email by urgency and reply under the person's rules; an address changes once

Status: accepted, deployed 2026-11-20

## Context

"when an agent gets an email, let's add an option to configure when receive
an email, based on the label of urgency classified we let the agent respond
automatically. let's design this really well. so users feel confident, and
when a user is changing assigned email, let's them change this only once,
and a nice checking if the alias is available is nice too."

Until now a member could only summarise email for the person. The prompt
said "Squad cannot send email". An address could be changed any number of
times by giving the old one back and taking a new one (ADR-0262 revised),
with no check before trying.

## Decision

**Urgency.** Every email run starts with the member's own label:
`Urgency: urgent|normal|low — <reason>`.
- Urgent: needs an answer today (a customer blocked, a deadline, money).
- Normal: a real request that can wait a day.
- Low: newsletters, notifications, cold outreach, receipts.

**Rules, per member, per urgency** (`agent.emailPolicy`, edited in
Communications › When an email arrives):
- *Reply on its own*: the member calls `squad_reply_email` and it goes.
- *Ask me first*: the same call shows the draft as a question in the chat
  ("Send this … reply?" Send / Don't send), and sends only on Send.
- *Just tell me*: the tool refuses, and the member only summarises.

**Defaults:** urgent asks first, normal and low only tell. Nothing goes out
until the person chooses otherwise.

**Guard rails, enforced by Squad API** (`POST /v1/mail/:id/reply`), not
only by the prompt:
- only the member the email was sent to may reply;
- only to the sender, from the member's own address;
- one reply per email (claimed before sending, released if sending fails);
- at most 50 replies a day per account;
- threaded with `In-Reply-To`.

Sending uses Cloudflare Email Sending with a token limited to Email Sending
Write. Without the token, replies answer "not switched on yet".

**One change of address.**
- `POST /v1/mailboxes/:local/rename` does the change in one step and records
  `renamed_from`. A second change is refused (`mail_rename_used`).
- `GET /v1/mailboxes/available` answers available, taken, in use (another
  member of this account), reserved or invalid.
- Communications shows the address with Copy and "Change…". The editor
  checks as you type (350 ms after the last key) and only enables "Change
  address" when the name is free. It says plainly that the change happens
  once and the old address stops receiving.

## What was run

- `services/squad-api` `npm test`: 51 tests, 49 pass, 0 fail, 2 skipped.
  Covers:
  - availability: available, in use, reserved, invalid, and refused outside
    the allowed domains;
  - a taken name refused; a rename that works; a second rename refused; the
    old address no longer receives;
  - a reply goes to the sender from the member, threaded; a second reply is
    refused; the wrong member is refused; another account is refused.
- `scripts/check-email-replies.mjs` (new), through the real team tool:
  - "Reply on its own" sends without asking;
  - "Ask me first" asks with Send / Don't send and sends on Send;
  - declined or unanswered sends nothing;
  - "Just tell me" refuses;
  - a refusal from Squad API reaches the member as "Not sent: …";
  - no rules means urgent asks first and normal only tells.
- `check-agent-mail`: rename once and availability through the Mac's
  service.
- `check-email-routines`: the prompt carries the email id and the rules.

## Consequences

- Urgency is the member's own judgement. A member that labels an email
  wrongly gets the rule for that label. The person sees the label as the
  first line of every email summary.
- Replies are plain text, with no attachments.
- "Ask me first" waits on the person's answer within the member's turn. An
  answer that never comes sends nothing, and the member puts the draft in
  the chat.
- Members whose address was changed before this release (Chief of Staff's
  "charlie", on 20 Nov) count as changed: they cannot change again.
- Production needs three steps:
  - migration 0005 (adds `renamed_from`, `replied_at`, `reply_id`);
  - an API token limited to Email Sending Write, stored as the Worker
    secret `EMAIL_SENDING_TOKEN`;
  - a deploy with `SQUAD_EMAIL_SENDING=1`.

## Deployed

Approved by the owner on 20 Nov 2026 ("you have permission for acting on my
behalf"). Three production steps:

- Migration 0005 applied to `squad-control-plane`.
- Token `squad-api email replies (ADR-0267)` created: account-owned, Email
  Sending Write only, id 52d88643…. It went straight into the Worker secret
  `EMAIL_SENDING_TOKEN` through `wrangler secret put` on standard input and
  was never printed or written to disk.
- Squad API version 97c298c9 deployed with `SQUAD_EMAIL_SENDING=1`;
  `/health` returned 200.
