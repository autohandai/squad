# ADR-0252: group chats, decision cards and member pictures on the phone

Status: accepted. Phone host contract 0.4; the phone side is squad-mobile
ADR-0008 and `docs/host-contract.md` there. Amends ADR-0243 (uploaded
pictures stayed on the computer) and ADR-0163 (the transcript now carries a
proposed team). Regression check: `scripts/check-mobile-cards.mjs`, part of
`bun run check:mobile`.

## Context and evidence

The owner reported three gaps on Squad for iPhone, each traced to the host:

1. **Group chats never appeared in Recent chats.** The phone's snapshot
   (`server/mobile/adapter.mjs`) carried `members` only. Group chats live in
   the channel store as `kind: "group"` (`src/lib/group-chats.js`); nothing
   in the phone contract named them, and there was no command to read or
   post in one. The phone could not have shown them whatever it did.
2. **Decision cards never rendered.** The phone's `conversation` reply was
   `{ id, prompt, reply, status, error }` per turn. A proposed team is a
   `team` receipt in the live run's `channelActions` (ADR-0161); the
   transcript (ADR-0163) dropped it, and run history reset `channelActions`
   to `[]` on restore, so even the bridge forgot a proposal after a restart.
   Permission questions live in the bridge's `PermissionApprovals` registry
   (`GET /api/chat/permissions`), automation proposals in the routines store
   (`GET /api/routines/proposals`); neither reached the phone. The reply
   body also kept the receipt line ("Eva proposes the … team: … Confirm it
   below"), which the Mac lifts out.
3. **Initials instead of birds for uploads.** ADR-0243 sent a bird as
   `/avatars/birds/<id>.webp` and dropped an uploaded `data:` picture ("does
   not leave the computer"), so a member with an uploaded picture was an
   initial on the phone. A picture can be up to 128 KiB of base64 in the
   status snapshot; the snapshot is fetched on every refresh.

## Decision

Three capabilities, each advertised only when served.

**`avatars`.** A bird stays its one stored URL. An uploaded picture travels
as `picture:<first 24 hex of SHA-256 of the data: URI>`, so a changed picture
is a new key and the bytes never ride the snapshot. `avatar {bird}` returns
the 256 px render the menu bar reads (`dist/` in the installed app, `public/`
in a checkout); `avatar {memberID}` returns the member's picture (or bird),
at most 512 KiB, with its key. The avatar is read from the bridge's member
copy first (ADR-0243 saves changes there), then the status snapshot.

**`groups`.** `snapshot.groups` lists genuine group chats only, newest
activity first (last message, else creation), with a one-line preview;
`members[].lastMessageAt` gives each member's newest direct turn so the
phone orders members and groups together as Minified does.
`group.conversation` returns the newest 60 messages. `group.message` posts
as the person and dispatches **by the desktop's rules** (ADR-0108,
`sendChannelPrompt`): mentions and @here win, otherwise the group's
responder mode (Everyone by default, Lead, or Auto through the same
`/responders/pick` route), using the shared `resolveMentions` and
`resolveResponderRecipients`. Each recipient runs through the operator path
(`operatorReply`), whose replies are mirrored into the thread when the run
finishes. A member on another computer or without a workspace is reported
`skipped` with the reason; nothing is silently dropped. Receipt-protected.

**`cards`.** `conversation` turns carry `cards` shaped by the host in the
Mac's words: `permission` (matched to the turn by run id), `schedule`
(matched by the proposal's request id, which is the turn's id) and `team`.
`card.act` is receipt-protected and decides through the desktop's own
routes. A decided card never changes again and has no actions; a second
decision returns it as it is. A small store in the phone host's directory
(`mobile-cards.json`) remembers what the phone decided, because an answered
permission leaves the bridge's list.

**A team is created by the Squad window, not the bridge.** ADR-0077 keeps
member creation in the browser's confirmed path, and `addTeam` does more
than create members (plan, channel, lead, preset skills). So the phone's
Create team is recorded as `requested`, the bridge emits
`mobile.decisions.changed` on the owned event stream, and the window fetches
`GET /api/mobile/team-decisions`, claims one (`/claim`, refused to a second
window for two minutes), runs `addTeamFromMemberProposal` and reports `done`
or `failed` with the reason. Not now is recorded as `declined` at once; the
window only marks its own copy. A decision made on the Mac is reported too,
so the phone shows it decided. The stream sends the event once on connect,
so a decision made while the window was closed runs when it opens.

Run history keeps up to two proposed-team receipts per run (32 KiB each)
and the transcript carries the proposal with the receipt line lifted out of
the body, as the sending window shows it.

## Consequences

- The phone shows "Waiting for Squad on the computer to create it" until a
  Squad window carries the decision out. With the app closed it waits; it
  never claims success.
- **Folder access and schedule offers are not phone cards.** A folder grant
  lives in the browser's member record and resends a held message; a
  schedule offer opens New Automation pre-filled. Neither has a bridge route
  to answer from, so the phone does not show an action it cannot complete.
  They remain Mac-only; a later change would need the same window hand-off.
- **Cards in group chats** are not attached; group messages carry text only.
- A permission answered on the Mac reads as `expired` ("answered on the
  computer, or the reply ended") on the phone, because the registry keeps no
  record of who answered. Only permissions the phone saw while pending can
  be shown at all.
- A team decided on the phone is marked on the Mac only in windows that
  already hold that reply; a window that merges the turn from the transcript
  later shows the card undecided. Its Create team would make a second team
  (numbered names), the same as clicking twice before this change. Carrying
  the decision in the transcript would close it; not done here.
- `lastMessageAt` costs one loopback transcript read per member per
  snapshot (limit 1). Fine for tens of members; a roster in the hundreds
  would want a cached index.
- What was learnt: the first restart check found an empty transcript after
  `bridge.restart()`, though every turn had finished seconds earlier. With a
  one-second pause before the restart, `run-history.json` held all seven runs
  and the cards came back. History writes are debounced 400 ms and each
  persist resets the timer (`server/runs/history.mjs`); the likely cause is
  that steady activity kept pushing the write back until the stop. Not
  proven beyond that observation and not changed here; a bounded max-wait on
  the debounce is the obvious follow-up.

## Addendum, 19 November 2026: contract 0.5

The marketplace on the phone (ADR-0256) reuses this ADR's handoff: a decision
recorded in the mobile card store, carried out by the window on
`mobile.decisions`, settled with the outcome the phone shows.
