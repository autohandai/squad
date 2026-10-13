# A member born in conversation

Date: 2026-10-14 · Lane: bot-by-chat · ADR: ADR-0126

## The ask

"create bot: we can use primarily just the instructions a human would use to
set up, but also the current way we do too; it's important to have many ways.
Define this well, spec driven and DRY, KISS on what we already have, and
finish."

What the person showed, from another app: "+" creates "New Bot" straight into
a chat. "hey" gets "Hey! I'm New Bot. What can I help you with?". "you're
going to be my GTM Leader" gets "Done, I'm your GTM Leader from here on. To
start building the plan I need a few things: 1. What's the product and who is
it for? 2. Stage … 3. Any existing assets … 4. Main goal for the next 90
days? Send what you have, even rough." The sidebar row then carries the new
identity. A member is born blank in a conversation and shapes itself from what
the person says.

## Three ways in, one member record

| Way in | Where | What it fills | Creation path |
| --- | --- | --- | --- |
| **Conversation** (new) | First row of the sidebar Direct messages "+" ("Chat with a new member"); a secondary button beside New member on the Squad page | Nothing yet: name "New member" (numbered on collision), no role | `createAgent` |
| **Form** | New member (`/members/new`, `CreateAgent`), optionally drafted from a sentence (`POST /api/members/draft`, `src/lib/member-draft.js`) or a role template (`src/lib/member-profiles.js`) | Everything, before the first message | `createAgent` |
| **Team / templates** | New team…, Templates…, Import team (`src/lib/team-builder.js`, `TeamBuildRows`) | Everything, several members at once | `createAgent` per member |

All three end in the same `createAgent(draft, options)` in `src/App.jsx`:
it assigns the id and staff id, normalises the workspace and projects, applies
the default permission state (Full access per ADR-0120 unless the caller asks
for a ladder level, as import does), provisions the member home through
`POST /api/agents/provision`, publishes the member and writes its first
message. Nothing here adds a second creation path.

A member record needs, at creation: `name`, `role` (may be empty),
`description`, `instructions`, `skills`, `brainCard`, `avatar`,
`employeeType`, `harness`, `workspace`, `profileFiles`. The conversation way
passes `role: ""`, empty description and instructions, no skills, the default
engine (`normalizeHarnessAssignment(null)`), the app's fallback workspace and
a role-neutral avatar.

## What "blank" means

`isBlankMember(agent)`: the role is empty. Nothing else marks it, so there is
no flag to keep in sync: the moment a role is set, by the member or by the
person in the editor, the member is no longer blank. A placeholder name is
`New member` or `New member N`.

## How a blank member runs

Its first message is the greeting, written at creation in place of the
role introduction (ADR-0034): `Hey! I'm New member. What can I help you
with?`

Every turn of a blank member carries the shaping instruction
(`memberShapingInstruction()` in `src/lib/member-shaping.js`): it is new and
should become what the person asks. When the person gives it a role in plain
English ("you're going to be my GTM Leader", "be our release manager"), it

1. confirms in one line ("Done, I'm your GTM Leader from here on."),
2. emits one `profile` action (below),
3. asks at most four numbered, concrete things it needs to start, and closes
   "Send what you have, even rough.",
4. then works as that role.

A member that already has a role receives the same instruction, in its
"change" form, only on a turn whose message asks for a role
(`asksForRole(prompt)`: "actually, be my QA lead", "you're now our release
manager", "act as …", "your new role is …"). Otherwise it never sees it, so
an ordinary member cannot rename itself unprompted.

The bridge adds the instruction, so every engine and every entry point gets
it the same way: `memberShapingInstructions(payload)` in `server.mjs` sits on
the three profile sites (`autohandArgs`, `sdkRuntimeContext`,
`prepareExternalHarness`) next to `workPlanInstructions` (ADR-0124), after the
12,000-character cut, on direct-message turns only, and not when the caller's
profile already carries it.

## How it updates itself: the `profile` action

One line in the reply, parsed by the existing `SQUAD_ACTION` reader:

```
SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader","instructions":"…","personality":"…","skills":["go-to-market strategy"]}
```

- Registered through `registerHandler("profile", …)` in
  `server/routes/member-shaping.route.mjs`, like ADR-0110's `schedule` and
  ADR-0124's `task`.
- **Validated** by `validateProfileAction()` in `src/lib/member-shaping.js`
  (the browser and the bridge share it): only `type`, `op`, `member`, `name`,
  `role`, `instructions`, `personality`, `skills`; `op` must be `set`; at
  least one field; strings only, one line for name and role, limits from
  `member-draft.js` (name 60, role 80, instructions 1,200, personality 600,
  at most 8 skills). A placeholder name ("New member") is dropped rather
  than refused, so a role change that repeats it still lands. A chosen name
  another member already has is numbered ("Eva 2") with the team builder's
  `uniqueName`, on the bridge from the registered roster and again in the
  browser from its own list.
- **Identity-checked**: the turn's identity must match the executing member
  (`context.identityValid`), and an optional `member` field must name that
  same member (id or current name). Naming any other member is refused:
  "a member can only change its own profile".
- **Recorded** on the bridge's registered member copy
  (`agentChannelAccess`, through `memberAccess` and `setAccess`), so a
  Telegram or channel turn sees the new identity before the browser syncs.
  Setting the same values twice is the same state, so a replayed turn is
  harmless. No new store.
- **Receipt in the reply**: the action manager appends the receipt message,
  which is the quiet line itself, e.g. `Alex is now your GTM Leader.`; a
  refusal reads `Profile not changed: <reason>.` The receipt carries the
  validated `patch`.
- **Applied in the browser** through `updateAgent`, the same path the profile
  editor's Save uses: `profilePatchFor(agent, edit)` (extracted from
  `AgentProfileEditDialog` so both share it) recomputes the brain card,
  skill install state and generated profile files; `personality` becomes the
  `PERSONALITY.md` persona file. `updateAgent` then PUTs the channel-access
  copy and broadcasts the patch to other windows, as for any edit.

## What the person sees

- The sidebar row and the chat header rename (they read `agent.name`).
- Under the reply, one quiet muted line: "Alex is now your GTM Leader". The
  receipt line is lifted out of the reply body into that line.
- The profile page shows the role, instructions, skills and personality the
  member set, because they are the member's fields.
- Edit profile changes any of it, the same as for any member; clearing the
  role makes the member blank again.
- Asking "actually, be my QA lead" later does the same again.

## Not built

- The sidebar preview line under a member's name ("New Bot — Done, I'm your
  GTM Leader fro…" with engine and workspace) from the screenshot. Rows stay
  name-only like every other direct message.
- Shaping in channels: the instruction is sent on direct-message turns only,
  and the browser applies receipts from its own chat stream only.
- A change made on a turn the browser did not start (Telegram, queue,
  control plane) is recorded on the bridge copy but reaches the browser's
  member list only when it next talks to that member through the app; the
  browser's next settings write will overwrite the bridge copy with what the
  browser has.
- No avatar choice, no engine change, no folders from the action: those stay
  in the editor.
- No model call to design the member; the member's own engine does it in the
  conversation. The form's designer (`squad-designer`) is unchanged.
