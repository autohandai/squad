# ADR-0126: A member born in conversation

Date: 2026-10-14 · Status: accepted · Lane: bot-by-chat

Spec: `docs/superpowers/specs/2026-10-14-member-by-conversation-design.md`.

## Context

The person asked: "create bot: we can use primarily just the instructions a
human would use to set up, but also the current way we do too; it's
important to have many ways. Define this well, spec driven and DRY, KISS on
what we already have, and finish."

They showed another app where "+" creates "New Bot" straight into a chat,
"hey" gets "Hey! I'm New Bot. What can I help you with?", and "you're going
to be my GTM Leader" gets a one-line confirmation, four numbered questions
and "Send what you have, even rough.", after which the sidebar row carries
the new identity.

What Squad had, read from the code at `e6c636f`:

- Three creation surfaces (New member's form, optionally drafted from a
  sentence by the `squad-designer` utility agent, ADR-0031; New team /
  Templates / Import, ADR-0106 and ADR-0118; first-run onboarding,
  ADR-0013), all ending in one `createAgent(draft, options)` in
  `src/App.jsx`. Every one of them asks for the member's shape before the
  member exists.
- A member edits its own record nowhere. Members live in the browser
  (localStorage); the bridge holds a registered copy per member in
  `channels.json` → `agentChannelAccess`, written by the browser's
  `updateAgent` through `PUT /api/members/:id/channel-access`.
- A precedent for a member changing bridge state from a reply:
  `SQUAD_ACTION` lines, parsed by `server/agent-channel-actions.mjs`, with
  `registerHandler` routing `schedule` (ADR-0110) and `task` (ADR-0124) to
  their modules, and the receipt appended to the reply.
- A precedent for instructions every engine receives: ADR-0124's
  `workPlanInstructions` on the three profile sites in `server.mjs`.

## Decision

**A fourth way in that reuses the other three's record and path.** "Chat
with a new member" is the first row of the sidebar Direct messages "+"
(`CreateMenu`) and a ghost button beside New member on the Squad page. It
calls `createAgent` with `blankMemberDraft()` from the new
`src/lib/member-shaping.js`: name "New member", numbered with the team
builder's `uniqueName` on collision, no role, empty description and
instructions, no skills, the default engine, the fallback workspace, the
default permission state (Full access, ADR-0120). It is prepared exactly as
New member prepares one and opens on its chat. Its first message is
`blankGreeting()` instead of the role introduction (ADR-0034).

**Blank means no role.** `isBlankMember(agent)` is `!agent.role`. No flag:
setting a role anywhere, by the member or in Edit profile, ends it, and
clearing the role in Edit profile starts it again.

**The bridge tells the member.** `memberShapingInstructions(payload)` sits on
the three profile sites next to `workPlanInstructions`. It sends
`memberShapingInstruction(agent)` on a direct-message turn from a described
member when the member is blank, or when the prompt `asksForRole` ("actually,
be my QA lead"), in a change form that keeps the name. It says: confirm in
one line, emit one `profile` action, ask at most four numbered concrete
questions, end "Send what you have, even rough.", then work as the role.

**The member records itself with a `profile` action.**
`server/routes/member-shaping.route.mjs` registers `profile` through
`registerHandler`. `validateProfileAction()` (shared with the browser) allows
only `op: "set"` with `name`, `role`, `instructions`, `personality`,
`skills` and an optional `member`; limits follow `member-draft.js`. The turn
identity must be valid and `member`, when given, must be the executing
member; any other member is refused. A taken name is numbered. The change is
written to the registered copy through the existing `memberAccess` and
`setAccess`. The receipt's message is the quiet line itself ("Alex is now
your GTM Leader."), and it carries the validated `patch`.

**The browser applies it the way Edit profile does.** The editor's save
computation was extracted into `profilePatchFor(agent, edit)`; the editor
and the receipt both call it, then `updateAgent`. `personality` becomes the
`PERSONALITY.md` persona file. The chat lifts the receipt line out of the
reply body into one muted line under the reply.

No new model service, no new store, no new route.

## What was learnt

- **Preparing a default-engine member needs a signed-in account, and the
  first browser run said so.** `check-member-by-chat-browser.mjs` first
  failed with "Could not start a new member: Autohand AI needs a signed-in
  Autohand account (run `autohand login`) or an API key in Settings."
  (`resolveProviderForAgent` in `server.mjs`). New member has the same
  requirement; the team-builder browser check never waits for a member to
  become ready, so no existing check had met it. The check now writes a
  local fixture token to the isolated user config; preparing writes files
  and calls no service. A signed-out person who presses Chat with a new
  member sees that sentence in the error line, as with New member.
- **The menu was too narrow for its own first row.** The popover was
  `w-44`; the first build widened it to `w-52`, and the first screenshot
  still showed "Chat with a new mem…". It is `w-56` now and the screenshot
  shows the full label.
- **A role-less member is a blank member.** Fixture members in
  `check-chats` and `check-work-plans` have no role, so their turns now carry
  the shaping instruction; both checks still pass (72 and all chat checks).
  A real member created before roles were required, or one whose role was
  cleared in the editor, is treated as blank too. That is the definition
  chosen, not an accident; it is listed below as a consequence.

## Consequences and what was knowingly left undone

- **The sidebar preview line is not built.** The other app shows "New Bot —
  Done, I'm your GTM Leader fro…" with engine and workspace under the name.
  Squad's direct-message rows stay name-only; only the name changes.
- **Direct messages only.** Channel and collaboration turns never get the
  instruction, and the browser applies receipts only from its own chat
  stream. A `profile` action emitted on a Telegram, queue or control-plane
  turn is validated and recorded on the bridge copy, but the browser's
  member list does not learn of it until a later app write, which replaces
  the bridge copy with the browser's member.
- **The member decides.** The check proves the instruction is sent, the
  action is validated, recorded, receipted and applied; it does not prove a
  given model obeys the instruction or asks good questions. A model that
  ignores it stays "New member" and the person can use Edit profile.
- **The role-request detector is English and generous.** It matches "be
  my/our/the …", "you're going to be / you are now my …", "act as a …",
  "your new role is …", "become our …" and similar; it misses other
  phrasings and other languages, and a false positive only sends the
  instruction. A role-request turn changes the system prompt for that turn,
  which by ADR-0030's mechanism cold-starts a warm Autohand session once;
  not measured here.
- **No avatar, engine, folder or permission changes from the action.** The
  avatar stays the role-neutral one it was born with; those stay in the
  editor.
- **No replay ledger.** Re-applying the same patch is the same state, so a
  replayed request id simply applies again; a replay after a later manual
  edit would reapply the old values. ADR-0124's task actions keep receipts;
  this one does not.
- The greeting and labels are English literals with `copy.*` fallbacks;
  `src/locales.js` was not touched.

## Verification

Run on 2026-10-14 in the lane worktree:

- `bun run build`: passes.
- `node scripts/check-render.mjs`: passes (dist mounts, no error boundary).
- `bun run check:member-by-chat` (`scripts/check-member-by-chat.mjs`, in
  `ci` after `check:member-profiles`): 54 checks. Pure: blank and
  placeholder names, numbering, the greeting, 9 role requests and 6
  non-requests, both instruction forms, validation and 6 refusals,
  `namesSelf`, the receipt lines, the browser helpers and the bridge copy
  patch. Bridge with the fake Claude executable: (i) a blank member's turn
  carries the instruction once; (ii) a member with a role does not on an
  ordinary turn and gets the change form on "actually, be my release
  manager"; (iii) a reply with a `profile` action yields an applied receipt
  with the patch, "Alex is now your GTM Leader." at the end of the reply and
  no action line, the registered copy in `channels.json` carries the name,
  role, instructions, skills and PERSONALITY.md, the run carries the
  receipt, and a replay is the same state; (iv) naming another member by
  name or id is refused and changes nothing, a bad op and an unknown key are
  refused, naming itself is allowed; a taken name becomes "Eva 2".
- `bun run check:member-by-chat:browser`
  (`scripts/check-member-by-chat-browser.mjs`, in `ci` after
  `check:work-plans:browser`): the Squad page shows the button; the sidebar
  "+" lists Chat with a new member, New member, New team…, Templates…;
  clicking it saves a role-less "New member" and opens its chat on the
  greeting; with the member pointed at the fake Claude executable, "you're
  going to be my GTM Leader" is sent through the composer, the real bridge
  applies the action, and the page shows the confirm line and four
  questions, no action line, "Alex is now your GTM Leader" under the reply,
  the sidebar row renamed to Alex, and the member saved with role GTM
  Leader, the instructions, two skills and PERSONALITY.md. Screenshots in
  `.codex-artifacts/lanes/bot-by-chat/`: `squad-page-actions.png`,
  `sidebar-create-menu.png`, `new-member-greeting.png`,
  `member-shaped.png`.
- Unchanged and passing: `check:member-draft`, `check:member-profiles`,
  `check:agent-channel-actions`, `check:run-channel-actions`,
  `check:work-plans` (72), `check:chats`, `check:prompt-stability`,
  `check:member-introduction`, `check:team-builder`, `check:jsx`,
  `check:server`, `check:team-builder:browser`, `check:work-plans:browser`,
  `check:chats:browser`.
