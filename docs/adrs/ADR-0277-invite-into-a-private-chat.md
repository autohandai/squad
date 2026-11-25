# ADR-0277: Invite someone into a private chat

Status: proposed, 2026-11-24

## The request

The owner, in a direct conversation with a member: "I want to invite a new
squad member or a new human to that conversation and automatically create a
group chat and show previous message that we had there and we can interact
with it ... human connectivity requires workers ... on cloudflare that allows
us to use durable objects ... we can invite up to three people to the same
conversation ... it's a limit."

So: Invite, from a 1:1 chat, adds another member or a person who is not on
this computer. The conversation becomes a group that shows the earlier
messages and everyone keeps talking in it. People outside the computer
connect through a Cloudflare Worker and a Durable Object. At most three
invitees per conversation.

This record is a design. Nothing in it has been built or run yet; where it
says how existing code behaves, the file or ADR it was read from is named.

## Context: what exists today

Read on `origin/main` at `8ebab5d`.

**Direct conversations and groups live in different stores.**

- A member's current direct conversation is an array in
  `messagesByAgent[memberId]`, saved to `browser-state.json` with a revision
  check (`server/ownership/data-service.mjs:82-96`; DESIGN.md line 133). It
  has no conversation ID of its own; its route is
  `/conversations/new?member=<id>` (`src/lib/notifications.js:11,58`).
  Messages carry `role: "user" | "agent"` and there is only one human, the
  owner.
- Put-away chats are one JSON file each under `chats/<memberId>/`, capped at
  400 messages and 4 MiB (`server/chats/store.mjs:1-13`, ADR-0113). A merge
  of chats creates a new record with provenance on each copied message and an
  empty provider-session map, because engine resume IDs cannot be spliced
  (ADR-0188).
- Groups are rows in the serialized channel store (`channels.json`) with
  `kind: "group"` (ADR-0203, `server/group-chats.mjs`). Creation needs 2-20
  distinct saved members (`group-chats.mjs:41-43`), is idempotent by
  `requestId` (`:44-52`) and runs in one `store.mutate`. Conversion to a
  channel keeps the ID and history (`:64-85`). Group messages are channel
  messages: `role` is one of `agent | system | user` and anything else
  becomes `agent` (`server.mjs:5667`). There is no author field for a second
  human. Groups open at `/channels/<id>`.

**History replay is two-party.** A fresh engine session gets the last 12
turns, at most 12,000 characters, labelled only `person` or `you`
(`server/chats/replay.mjs:12-37`, ADR-0161), and only when the browser sends
`conversationContext` (`server.mjs:7407`). Channel and group dispatch does
not send it: the payload built in `dispatchChannelMemberReply`
(`src/App.jsx:8331-8372`) has no `conversationContext`. The channel profile
context names the roster and the thread, not earlier messages
(`buildChannelProfileContext`, `src/App.jsx:12916`). Whether the bridge adds
saved thread history for channel runs on its own was not verified; the
comment at `App.jsx:8340` says it does for the thread, not for the group's
earlier top-level messages.

**Who answers in a group.** ADR-0108: mentions, then `@here`, then a
thread's recorded recipients, then the responder mode (Everyone, Lead,
Auto). New groups start on Everyone. The phone's `group.message` uses the
same rules (ADR-0252).

**Group and channel turns run with full access.** ADR-0161 point 9: only a
direct conversation with an Interactive member whose rules contain an Ask
runs without `--yes`; "Goals, automations, channel threads and queued
follow-ups keep `--yes`: nobody is there to answer." DESIGN.md line 31 says
the same. Today the only person who can start a group turn is the owner. An
invited human would be the first person outside the computer able to start
work that runs with the owner's full access. This is the main risk in the
request.

**Cloudflare pieces already in place.** `services/squad-api` is its own
Worker at `squad.autohand.ai` with D1, R2 and one SQLite Durable Object,
`MobileRelay` (`cloudflare.config.ts`). `MobileRelay`
(`src/mobile-relay.ts`) already uses the hibernation WebSocket API
(`acceptWebSocket` with a `host` tag, `serializeAttachment`, a ten-minute
host lease renewed every five), registers rooms in D1 so a guessed URL cannot
allocate an object (`:156-158`), stores only SHA-256 hashes of capability
tokens, and carries no message bodies (ADR-0212). Sign-in is an Autohand
identity exchanged for a 24-hour Squad session (`src/auth.ts`,
`exchangeIdentity`), rate limited to 30 attempts per minute per IP bucket.
Agent email (ADR-0262, ADR-0267) gives the Worker an inbound mail handler and
Cloudflare Email Sending with a scoped token, so the Worker can already send
an email.

**Outside text as data.** Email runs fence the sender's words and tell the
member not to act on requests in them (ADR-0262). Telegram messages sit in
the chat as ordinary rows with the source as data, not a badge (DESIGN.md
line 103).

**The phone** reads groups through contract 0.4 (`squad-mobile`
`docs/host-contract.md:140-163`): `snapshot.groups`, `group.conversation`
(newest 60 messages, `role: "person" | "member"`), `group.message`.

## Decision

### 1. Invite lives in the direct chat header

- An **Invite** icon button sits in the 1:1 chat header beside the
  permissions quick menu (ADR-0274). It opens a side sheet, the same shape as
  the connectors sheet: no dialog over the conversation.
- The sheet is one column. A search field, then a divider list of squad
  members (bird face, name, role, checkbox), then a row **Invite a person by
  email** with an email input. Below the list, one muted sentence that
  counts: "2 of 3 invites used."
- The limit is three invitees per conversation, members and people counted
  together. The original member and the owner do not count. When three are
  chosen, the remaining checkboxes and the email input are disabled and the
  sentence says: "This conversation has three invited already. Remove someone
  to invite another." The bridge and the Durable Object refuse a fourth with
  the same sentence (409 `invite_limit`), so a stale window cannot exceed it.
- Before the button, the consent line, in plain text and not hidden behind a
  disclosure: "Everyone you invite will see this conversation from the start:
  42 messages since 12 Nov." When a person is invited it adds: "Messages in
  this group are stored by Autohand while people outside this computer are in
  it." The button says **Start group with Noah and Ana**. There is no
  separate confirmation step; the button is the decision, as in Share team…
  (DESIGN.md line 51).
- The new group opens at once at `/channels/<groupId>`, under Direct
  Messages with the members' faces (DESIGN.md line 54). The carried messages
  read in their original order with their original times and authors, above
  one quiet divider line: "Ana and Kiwi were invited · 24 Nov 10:02". Nothing
  marks the earlier rows as quoted or greyed: they are the conversation.
- The direct chat with Noah starts fresh, with one muted row at the top:
  "This conversation continues in Launch crew", which links to the group.
- In an invite-born group the same Invite button stays in the header and
  uses the same count. Groups made from New message keep their 2-20 member
  rule and get no Invite for people in this change.
- Removing someone is a row action in the group's settings popover (the
  existing group form), with the usual second click. A removed person keeps
  nothing new; what they already saw cannot be taken back, and the sentence
  under Remove says so.

**The phone** (contract 0.8, additive): `snapshot.groups[]` gains
`guests: [{ id, name }]`; `group.conversation` messages gain
`role: "guest"` with `authorName`. The phone shows a guest's name with a
plain initials circle, never a bird. It cannot invite in the first phases.

### 2. A new group, with the direct chat put away

Three ways to keep the history were possible:

- **Convert the direct chat in place.** Not possible as stated: a direct
  chat has no ID to keep and is the member's single current conversation, so
  converting it would leave the member with no direct chat.
- **Reference the direct messages from the group without copying.** No
  duplicate, but the group would depend on a browser-state array that is
  rewritten wholesale on every save, and backups, exports, the phone and the
  Durable Object would all need to follow the pointer.
- **Copy into a new group and put the direct chat away.** Recommended.

Invite does, in one bridge call (`POST /api/group-chats` with a new
`origin` field, or a sibling route `POST /api/members/:id/invite`):

1. Flush the window's current conversation (the existing flush before
   export, DESIGN.md line 133). A revision conflict stops the invite and keeps
   the sheet open with the conflict sentence.
2. In one `store.mutate`: create the group (`kind: "group"`, private) with
   `memberIds` = the original member plus invited members, `guests` = invited
   people, and `origin: { memberId, sharedThrough: <last message id>,
   sharedAt }`. Copy every direct message as a group message with a new ID
   `<groupId>-h-<n>` and `carriedFrom: { memberId, messageId }`; the owner's
   rows keep `role: "user"`, the member's rows `role: "agent"` with
   `agentId`. Idempotent by the existing `requestId` fingerprint.
3. After the group is committed, put the direct chat away through the
   existing New chat path (ADR-0113). The archive keeps the provider resume
   IDs, which the group cannot use (ADR-0188's reason), and survives if the
   group is later deleted.
4. If step 3 fails, the group exists and the direct chat still holds the
   messages. The direct chat shows the "continues in" row whenever a group
   with its `origin` exists, and the put-away retries on next open.

The rule creation enforces changes from "two or more members" to "at least
one member, and at least two participants besides the owner". A group of
Noah plus one person is valid.

Messages appear once in the interface. On disk the earlier part exists twice,
in the group and in the put-away archive (which is capped at 400 messages,
so a very long direct chat is complete only in the group).

**What the invited member is told.** A member joining (and the original
member, whose warm direct session is not reused by group runs) gets a new
block on the first turn of its group session,
`<squad_group_history>`: the newest turns of the group, oldest first, each
with a speaker label (`Igor`, `Noah`, `Ana (invited person)`), within the
existing budgets (12 turns, 12,000 characters, 2,400 per turn). It reuses
`replayTurns` with a speaker field instead of the two-way `person`/`you`
mapping, and the group dispatch sends it the way direct chats send
`conversationContext`. A guest's words in it are fenced as an outside
person's words, as email is.

### 3. People outside the computer: one Durable Object per shared group

**Shape.** A second SQLite Durable Object class in `services/squad-api`,
`SharedConversation`, one per group that has at least one invited person.
Members-only invites never create one; they stay on the computer. The room
is named by a random 256-bit ID registered in a new D1 table
`shared_conversations` (room ID, owner principal, owner key, team ID,
created, last activity), exactly as `mobile_relay_routes` prevents guessed
rooms (`mobile-relay.ts:156-158`). The local group ID never leaves the
computer.

**The host joins** as `MobileRelay`'s host does: an outbound WebSocket from
the bridge, authenticated with the Squad session and the computer's current
Autohand identity, tagged `host`, with the same ten-minute lease. Only one
host socket per room; a reconnect replaces the old one.

**People join by email, with an Autohand account.**

- The owner types an email. The bridge asks the Worker to create a seat; the
  Worker stores the email (lower-cased) and the SHA-256 of a one-time invite
  token, and sends the invitation through the existing Email Sending
  binding: who is inviting, the group name, the consent sentence, and a link
  `https://squad.autohand.ai/join/<token>`. The token travels in the path
  once and is exchanged for a session on first open.
- Opening the link requires signing in with an Autohand account. The seat is
  claimed only if the account's verified email (from `verifyIdentity`)
  equals the invited email. A forwarded link is useless to anyone else.
- Tokens expire after seven days and are single-use. Re-sending creates a
  new token and voids the old one.
- Recommended over a magic link with no account: the Worker already
  verifies Autohand identities, a magic link would make the Worker an email
  sign-in provider of its own, and removal needs a stable identity.
  Recommended over an open "anyone with the link" mode: it cannot be
  revoked person by person and it defeats the limit.

**Where they chat.** A plain page served by the Worker at
`squad.autohand.ai/c/<roomId>`: the messages, a composer, the participant
names. People who also have Squad see the group in their own Direct
Messages only in a later phase.

**Source of truth.** The owner's computer is the record; the Durable Object
is the sequencer and a bounded mirror for the invited people.

- Every accepted event (a person's post, a post the host publishes, a join,
  a removal) gets the next integer `seq` in the object's SQLite. That `seq`
  is the order everyone renders.
- The host publishes the owner's posts and members' finished replies with
  their local message IDs; the object stores them once per ID.
- The host acknowledges the highest `seq` it has written into
  `channels.json`. On reconnect it asks for everything after that.
- A guest post carries a client ID; the object deduplicates on it, so a
  retried send is one message.

**When the owner's computer is offline** the page says "Igor's computer is
offline. Members will answer when it is back." Invited people can still read
and post to each other. Their posts wait in the object, at most 200 or seven
days, whichever comes first; past that the composer is disabled with the
same sentence. On reconnect the host applies the waiting posts in `seq`
order and members answer the latest one per thread, not each one in turn.

**What the object stores, and for how long.** The messages the group
shared at invite (the newest 200 carried messages; older ones stay only on
the computer and the page says "Earlier messages are on Igor's computer"),
new messages, participant names and emails, token hashes. Text only; no
attachments, tool traces, run events or workspace paths, which the host
strips before publishing. Nothing goes to D1 bodies, R2 or logs. When the
last person is removed, or the owner deletes the group or converts it to a
channel, the host calls `end`, and the object runs `deleteAll()` and its D1
row is removed. A room with no activity for 30 days is purged by the
existing hourly cron (`triggers.scheduled`).

**No end-to-end encryption in this design.** The phone relay keeps keys on
devices (ADR-0212), and that would be the more private choice. It is not
chosen here because the invitee is a browser reached by email: the only
practical place for the key is the invite link, so whoever can read the
email has the key; removing someone would need a re-key delivered to each
remaining browser; and the object could no longer enforce length limits on
what it relays beyond ciphertext size. The consent sentence states the
storage plainly instead. This is the point most worth revisiting.

**Abuse limits**, enforced in the object (not only in the app):

- Three guest seats per room, counted with invited members by the host; the
  object refuses a fourth seat regardless.
- 20,000 characters per message (the phone's `group.message` bound).
- 10 posts per minute per person, 30 per minute per room.
- Ten invitation emails per owner per day (a D1 counter, like
  `auth_limits`), so the Worker cannot be used to send mail in bulk.
- Remove closes the person's sockets, deletes the seat and token hashes,
  and their next request gets 403. A person can leave from the page.
- The owner's "Stop sharing" in group settings removes every person and ends
  the room; the group stays on the computer with all its history.

**Cost.** One object per shared group, idle almost all the time. With the
hibernation API an idle object with open sockets is evicted from memory, so
the charge is mostly requests, a few kilobytes of SQLite storage and the
host's lease renewal every five minutes. This is the same pattern
`MobileRelay` already runs. No current Cloudflare price was checked for this
record; the figure belongs in the phase 2 rollout note, measured from the
deployed object's analytics, not estimated here.

### 4. Who answers, and what an invited person can make members do

**Who answers.** Invite-born groups use ADR-0108's rules unchanged, with one
different default: the responder mode starts on **Lead**, with the original
member as lead. The conversation was with Noah; adding Kiwi should not make
every message get two answers. Mentions and `@here` still win, so Ana can
write "@Kiwi what do you think?". The owner can switch to Everyone or Auto in
the existing form. Members never answer each other's or guests' small talk
unless the rule picks them: a guest post goes through the same rule as an
owner post.

**What a guest's message may start.** A turn started by a guest's post (the
thread root is the guest's) runs as a **guest turn** on the owner's
computer:

- Never with `--yes`, whatever the member's saved policy. Nobody is at the
  computer to answer, so any permission the engine asks for in a guest turn
  is declined at once (not left to time out), and the reply says the member
  needs Igor for that. A Needs you row tells the owner what was asked.
- Reads that the member's own rules allow stay allowed. Writes, shell,
  connectors that change something outside, computer use, memory writes,
  scheduling, channel proposals and team proposals are refused. The channel
  context for a guest turn leaves out `CHANNEL_ACTION_INSTRUCTION`,
  `SCHEDULE_ACTION_INSTRUCTION` and `TASK_ACTION_INSTRUCTION`.
- The guest's words are fenced as an outside person's, as email is
  (ADR-0262): data to answer, not instructions that override the member's
  brief.
- The owner can raise this per group with one switch in group settings,
  "Invited people can ask members to change things", off. When on, guest
  turns run like owner turns in the group. Its muted sentence says it gives
  invited people the owner's access on this computer.
- At most 30 guest turns per hour per group, counted on the computer, since
  they spend the owner's model usage. Past that, members do not answer
  guests until the hour turns, and the page says so.

The exact engine flags that give "reads allowed, nothing else, no prompt"
differ per harness. ADR-0273 records that Autohand's `--restricted` asks
rather than refuses. Mapping a guest turn onto each harness, and proving
that the refusal holds, is a phase 3 check, not something this record has
verified.

## Plan

**Phase 1: invite members (no Cloudflare).** Invite button and sheet, the
three-invitee count, the copy into a new group with `origin` and
`carriedFrom`, the "continues in" row, the put-away, Lead default,
`<squad_group_history>` for the first turn of each member's group session.
Groups rule relaxed for invite-born groups.

**Phase 2: invite people.** `SharedConversation` object, migration
`0006_shared_conversations.sql`, invitation email, join page with Autohand
sign-in, host socket and `seq` sync, offline waiting, removal, Stop sharing,
30-day purge. Message rows gain `role: "guest"`, `guestId`, `authorName`
in both normalisers and in backup restore (ADR-0203's restore whitelist
lost `kind` once; the same will happen to `guests` unless restore is
updated with it).

**Phase 3: guest turns.** Guest-turn policy per harness, the switch, the
hourly cap, Needs you rows. Phase 2 must not ship to anyone outside the
team without phase 3: until it exists, guest posts are shown but members do
not answer them.

**Phase 4: phone and Squad users.** Contract 0.8 fields on the phone;
invited people who use Squad see the group in their own Direct Messages.

**Checks to write.**

- `scripts/check-invite-to-chat.mjs` (owned bridge): invite copies every
  direct message once, in order, with `carriedFrom`; the same `requestId`
  twice makes one group; a fourth invitee is refused with `invite_limit`; a
  revision conflict refuses without creating a group; a failed put-away
  leaves both and recovers on reopen; the direct chat shows the pointer row;
  backup export and restore keep `origin`, `guests` and guest rows.
- `scripts/check-invite-to-chat-browser.mjs`: the sheet at desktop and phone
  widths, the count and the fourth-attempt sentence, the consent sentence
  with the real message count, the group opening with the history and the
  invitation divider.
- Replay unit test: `<squad_group_history>` labels each speaker, keeps the
  budgets, fences guest text.
- `services/squad-api/test/shared-conversation.test.ts` (workerd, like the
  relay tests): unregistered room refused; token single-use and email-bound
  (a different verified email cannot claim); fourth seat refused; `seq`
  strictly increasing across host and guest posts; duplicate client ID
  stored once; host reconnect receives everything after its ack; offline
  queue cap; rate limits; remove closes the socket and later requests 403;
  `end` deletes storage; cron purges idle rooms.
- Guest-turn check per harness: a guest asking a member to write a file in
  the work folder produces no file and a Needs you row; with the switch on,
  the same request writes it.

## Consequences

- The earlier messages exist twice on disk, in the group and in the
  put-away chat, to keep resume IDs and survive group deletion. The direct
  chat with the original member restarts empty; the owner reaches the old
  thread through the group or History.
- The group is a new conversation with a new ID. The owner's literal "turn
  this chat into a group" is met in what they see, not in identity.
- Only the newest 200 carried messages reach invited people. Longer
  histories are partial for them, and the page says so.
- Invited people's messages are readable by Autohand's service while they
  are in the group. End-to-end encryption was considered and set aside; this
  is a real privacy step down from the phone relay, stated in the consent
  line.
- Guests need an Autohand account. That is friction for a one-off guest,
  accepted to make removal and the three-seat limit mean something.
- Guest turns are weaker than owner turns by design. A guest cannot get a
  member to change a file without the owner switching that on, so some
  natural requests ("can you fix the typo?") will get "I need Igor for that".
- Members answer guests with the owner's model usage. The hourly cap bounds
  it; there is no per-guest billing.
- While the owner's computer is off, members are silent; the object is not
  a second place where members run.
- Attachments, reactions, threads for guests, read receipts, typing
  indicators and invites from the phone are left out.
- A converted channel cannot keep guests: conversion to a channel ends
  sharing first and says so, because channels have no guest model.
- One more Durable Object class and table to operate, purge and watch.

## Open questions for the owner

1. Should invited people see the whole earlier conversation, or should the
   sheet offer "Only from now on"? This record shares everything (the
   request said "show previous message") with the consent line.
2. Is three the limit on invitees (this record) or on everyone in the
   conversation apart from you?
3. Must guests sign in with an Autohand account, or is an email magic link
   acceptable for people without one? Can anyone create a free Autohand
   account today? (Not verified.)
4. Is plaintext-at-rest in the Durable Object, with a 30-day idle purge,
   acceptable, or is end-to-end encryption a requirement even at the cost of
   the key living in the invite link?
5. Should guests be able to ask members to change things at all, even with
   the per-group switch? Off by default is the recommendation.
6. Do invitation emails go only to addresses in allowed domains at first
   (as agent email does with `MAIL_ACCOUNT_DOMAINS`), or to anyone?
7. Should team Squads (ADR-0239) let teammates be invited without email,
   from the team roster?
