# ADR-0262: Members get email addresses on code.autohandai.com, delivered as email automations

Status: accepted, 2026-11-19

## Context

Igor asked that anyone signed in with an @autohand.ai account can give a
member its own address, `<name>@code.autohandai.com`, with Cloudflare routing
set up without manual steps, and that the offer comes from Squad's MCP tools
when a member is named ("do you want to register my email?"). Everyone else
must not be able to, for now.

What was there on 2026-11-19, read with `cf email-routing settings get` and
`rules list-account` on the `autohandai.com` zone:

- Email Routing was already enabled, with `code.autohandai.com` added as a
  subdomain (status `ready`, MX and SPF records present).
- Eight addresses on that subdomain already route to other workers:
  noah, support, igor, steve, james, luiz.moore, lucia and robert (GTM
  mailers, support replies, an investor mailer). `po-review@autohandai.com`
  forwards to a person.
- The zone catch-all existed but was disabled, with the action "drop".

A second constraint showed up when deploying: Squad API's configuration
required the marketplace database binding and its admin secret. Neither
exists in production (the marketplace rollout is not approved), so
`cf deploy` refused: "The following required secrets have not been set:
MARKETPLACE_ADMIN_TOKEN". Shipping email meant either launching the
marketplace or letting the service deploy without it.

## Decision

- **Squad API owns the addresses.** `agent_mailboxes` and `agent_mail`
  (migration 0004) record who holds which address and the mail waiting for
  them. `mailAllowed` compares the verified sign-in email's domain with
  `MAIL_ACCOUNT_DOMAINS` (`autohand.ai`). The desktop never decides this.
- **One catch-all, not a rule per address.** The zone catch-all now sends
  to the `squad-api` worker. Cloudflare evaluates literal rules first, so
  the eight existing addresses keep their workers. Squad's `email()` handler
  refuses (bounces) mail to an address nobody holds. No Cloudflare API token
  lives in the worker, and the 200-rule zone limit does not cap members.
- **Addresses other workers own are never handed out.** `MAIL_RESERVED`
  lists them, so a member named Igor is offered `igor2@…`.
- **The offer comes from MCP.** `create_member` (and `squad_create_member`
  for a member acting under its management permission) adds `email_offer`
  with the suggested address and an instruction to ask the person in one
  short, warm line. `register_member_email` registers it after a yes,
  `get_member_email` reads it, and `remove_member_email` removes it. For an
  account outside the allowed domains, or a signed-out one, no offer appears
  and registering is refused by Squad API (403 `mail_not_enabled`).
- **Mail arrives as an automation.** The computer collects waiting mail every
  minute (`server/mail/service.mjs`). The first email to an address creates
  the member's "When an email arrives at …" automation (routine trigger
  `email`). Each email starts one run of it, and the reply lands in the
  member's direct messages through the existing automation-reply path.
  Pausing it in Automations holds the mail, which waits on Squad API.
- **The email is data.** The run prompt fences the email text, names it as an
  outside sender's words, and tells the member not to act on requests in it
  or claim it replied. Squad cannot send email.
- **The marketplace stays dark until its database exists.**
  `SQUAD_MARKETPLACE_DATABASE_ID` unset means no `MARKETPLACE` binding and no
  admin secret, and every `/v1/marketplace/*` route answers 404. The desktop
  already reads 404 as "the marketplace isn't open yet" (ADR-0261).

## What was run

- `services/squad-api`: `npm test`, 48 tests, 46 passed, 2 skipped. Covers
  addresses from names, reserved names (including `MAIL_RESERVED`), the
  domain lock, register, suggest the next free address, deliver once, revoke,
  and marketplace routes returning 404 while unbound.
- Production, approved on 2026-11-19:
  - migration 0004 applied to `squad-control-plane`;
  - `squad-api` deployed (version b48aac2b), after which
    `/health` returned 200, `/v1/releases/stable/manifest` 200,
    `/v1/marketplace/home` 404, and `/v1/mailboxes` 401 without sign-in;
  - catch-all set to the worker.
- Desktop:
  - `scripts/check-agent-mail.mjs`: the offer only for allowed accounts,
    refusal passed through, one delivery and one acknowledgement per email,
    paused mail left waiting, no network call when signed out.
  - `scripts/check-email-routines.mjs`: the automation is created once,
    the prompt fences the email, the trigger survives an edit through the
    route, a paused automation is skipped.

## Consequences

- Mail to any unknown address on `autohandai.com` or its subdomain is now
  bounced by Squad's worker rather than by Cloudflare's default. The sender
  sees the same refusal; the difference is that it runs our code.
- A new address added by another team on `code.autohandai.com` needs a
  literal rule, which wins anyway, and an entry in `MAIL_RESERVED`, or Squad
  could hand the same name to a member that would never receive mail. This
  list is maintained by hand.
- Members cannot send or reply to email. The prompt says so, so a member
  never claims it replied.
- At most 20 waiting emails are fetched per poll, oldest first. Twenty
  emails waiting behind a paused automation would hold back newer mail for
  other members until it is resumed or the 90-day cleanup removes them.
- Mail is only collected while Squad runs on a computer signed in to the
  same account. It waits on Squad API, delivered mail is removed after 30
  days and anything older than 90 days is removed regardless.
- Not done: the phone does not show or register addresses yet; there is no
  settings page listing every address; registering is not available in the
  New member form, only through the MCP offer.
- An end-to-end delivery with a real inbound email has not been observed
  yet; it needs an @autohand.ai account to register a member's address.
