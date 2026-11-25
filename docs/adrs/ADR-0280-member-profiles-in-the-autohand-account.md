# ADR-0280: Member profiles in the Autohand account

Date: 2026-11-26
Status: Accepted (local and workerd evidence; the API migration and the
desktop release are not yet deployed)

## Context

The person asked for member profiles to be "stored per user associated since
they're logged in in the cloud ... and still be able to edit" from the desktop
and the phone. What existed:

- A member's profile lives in the owner's channels state on one computer
  (`agentChannelAccess[id].agent`), revision-checked by `profileRevision`
  (ADR-0279 added phone edits through the computer).
- `server/squad-cloud` syncs only shared team memories, to a tenant/workspace
  chosen in Settings (ADR-0152). It says profile sync was deliberately left out
  "until profiles ... have portable mapping contracts".
- The Squad API already stores revisioned **agent records per owner**
  (`/v1/users/me/agents/:id`, `/v1/teams/:id/agents/:id`, ADR-0193/0194). We
  first meant to build on those. Reading `server/ownership/cloud-service.mjs`
  showed why not: those records are whole portable agent documents (memories,
  conversations, routines, files) written by the explicit cloud backup, whose
  upload phase compares revisions and hashes and stops on any foreign change.
  A profile sync writing the same record every 30 seconds would either clobber
  a backup's memories and conversations (it only knows the profile) or turn
  every later backup into a conflict. Keeping profiles under a different id in
  the same table would put fake agents into exports and restores.

## Decision

**A small owner-scoped profile store in the Squad API.** Migration
`0006_member_profiles.sql` adds `member_profiles` (one row per owner and
member id: revision, JSON content, deleted, change id) and
`member_profile_mutations` (idempotency receipts). Routes
`GET/PUT /v1/users/me/profiles[/:id]` and `/v1/teams/:id/profiles[/:id]` use
the same owner resolution as agent records (`accessOwner`: personal from the
immutable identity; team only with a current `X-Autohand-Identity` and
`resources:operate`). A write names `baseRevision`; a stale one is refused with
`revision_conflict`; an Idempotency-Key replays. The content schema is strict:
name, role, description, instructions, personality, skills (ids), avatar (a
cast bird id or empty) and voice, within the desktop's own limits. Paths,
credentials, permissions, model routing and memories are not accepted. D1
only, no R2: a profile is a few kilobytes, the account limit is 500.

**What travels.** Name, role, description, instructions, the personality
sentence (PERSONALITY.md minus its "# Personality" and "Role:" lines), skill
selections, a cast bird and the voice name. Photos do not travel: a member with
an uploaded picture sends an empty avatar, and an empty avatar from the account
never replaces a picture here. Blob upload exists for backups but would need
consent and size rules of its own.

**The desktop service** `server/squad-cloud/profiles.mjs` runs serially every
30 s and 1.5 s after any profile save (`onProfileChanged`), with an
AbortController, a private `profile-cloud.json` (0600) and its own Squad session
(exchanged from the Autohand credential, checked with `/v1/me` against the
Squad's owner: a different account is refused, not synced). Account changes
are applied through the bridge's own `PATCH /api/control-plane/members/:id`
with `expectedRevision`, and a bird through the member avatar setter, so
receipts, `profileRevision` and the phone's view behave as for any edit.

**Merge rule.** Per field, three-way, against two bases kept per member: what
the account held and what this computer held when they last agreed. A field
changed on one side only is taken from that side. The same field changed
differently on both sides keeps this computer's value and records a clash that
Settings shows with **Keep this computer's** / **Use your account's**. A first
meeting with no agreed base (a member that already exists in both places with
different content) is a clash for every differing field; neither side is
overwritten. A value this computer could not take (a skill not installed here)
is reported as a note and is not pushed back as a removal; a value this
computer filled in itself (the voice it gives a member it adds) is not pushed
either, until a person changes it. Two bases replaced a first version with one:
the contract and live checks showed the single-base version sending an added
member's new voice straight back to the account.

**On by default for a personal Squad, off for a team-owned one.** A personal
Squad's profiles go to the person's own account, which nobody else reads; the
person asked for exactly this. A team-owned Squad would share instructions with
everyone in the team, so it waits for the switch. Memory sync stays an explicit
enrollment (ADR-0152) because it uploads into a workspace other people share.
The switch is **Keep member profiles in your Autohand account** at the top of
Settings › Cloud sync; off sends nothing.

**Removing a member here does not delete it from the account.** A member is
removed on one computer far more often by accident, or to tidy one machine,
than to erase it everywhere. The account copy is listed under "In your
account, not on this computer" with **Add to this computer** (created through
the ordinary member creation route, then given its bird) and **Remove from
account**, which is the only delete.

**Local development identity.** The Worker refused a non-HTTPS identity origin.
It now also accepts a loopback `http:` origin, as the desktop client already
does for the API (`squadApiUrl`). The value is a deploy binding, never request
input; this lets the live check run the real bridge against the real Worker
with the bridge's isolated fixture identity.

## Consequences

- The phone still reaches profiles only through a paired computer
  (`member.profile`/`member.update`, ADR-0279). With profiles in the account a
  phone could read them directly when no computer is awake; that needs the
  phone to hold its own Squad session and was not built.
- Avatars that are uploaded photos stay on the computer that has them.
- Members only in the account are not created automatically on other
  computers; a person adds them. A member removed everywhere stays in the
  account until Remove from account.
- Clashes are per member, not per field: a person keeps or replaces all of a
  member's clashing fields at once.
- A skill the receiving computer lacks is skipped with a note until that
  computer has it; the note does not retry by itself.
- Deployment is not done: the API needs migration 0006 applied and a deploy
  (the Squad API workflow does both), and the desktop change ships in the next
  release. Until the API has the route, a signed-in desktop shows the error in
  Settings › Cloud sync and keeps every profile local.
- The always-on `verify-work-profile-browser` full run currently fails earlier,
  at "One sidebar destination replaces Inbox and Work", unrelated to this
  change; its update-only mode, which includes the cloud settings section, is
  where the new Settings controls are verified.

## Evidence

- `node scripts/check-cloud-profiles.mjs`:
  - `services/squad-api/test/profiles.test.ts` in workerd (Miniflare): the
    store (idempotency, stale revision, strict schema refusing paths and photo
    URLs, owner isolation, team write rights), and two and three simulated
    computers running the real service: no traffic signed out or switched off,
    push, list and add on a second computer, field merge, a same-field clash
    resolved both ways, a missing skill noted and not undone, later changes
    still arriving, a removed member left in the account, a first meeting not
    overwriting, a different account refused, a team Squad off by default and
    in the team's namespace, the state file 0600.
  - The real bridge (`server.mjs`, isolated signed-in fixture owner) against
    the real Worker: a new member is pushed with its personality sentence and
    no paths; an account edit to role and bird comes back through the
    revision-checked save (revision increases) and the bird setter; an edit
    here is sent; a member from another computer is added with its bird, and
    adding it does not rewrite the account copy; the switch turns it off.
- `AUTOHAND_VERIFY_UPDATES_ONLY=1 node scripts/verify-work-profile-browser.mjs`:
  the Settings section renders a clash and an account-only member in Chrome;
  Use your account's, Add to this computer and the switch send the right
  requests (screenshot `cloud-profiles.png`).
- `services/squad-api`: `tsc --noEmit` clean; `npm test` 52 pass, 0 fail.
  `npm run check:team` passes.

## Rollout

26 Nov 2026, at the owner's request ("i autorise you to deploy"): migration
`0006_member_profiles.sql` applied to the Squad database (f645a0be…) and the
Worker deployed from aaa72bd (version 60cde614) with the CI job's bindings
(marketplace database, email sending), from the owner's Mac with `cf`: the
`Squad API` workflow's deploy job has no Cloudflare token in the repository
secrets (run 45718861057 failed at "Check deployment configuration").
Checked afterwards: `/health`, `/v1/marketplace/categories` and the stable
release manifest still answer; `/v1/users/me/profiles` asks for sign-in.
Desktops reach it from the first release carrying this ADR (0.1.26).
