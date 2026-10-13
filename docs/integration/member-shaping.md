# Members: born in conversation (ADR-0126)

A member can be created blank and shape itself from what the person says.
Spec: `docs/superpowers/specs/2026-10-14-member-by-conversation-design.md`.

Module files:

- `src/lib/member-shaping.js` — pure, shared by browser and bridge:
  `isBlankMember`, `isPlaceholderName`, `blankMemberDraft`, `blankGreeting`,
  `asksForRole`, `needsShapingInstruction`, `memberShapingInstruction`,
  `validateProfileAction`, `namesSelf`, `profileChangeLine`,
  `profileReceipts`, `replyWithoutReceipts`, `personalityFileContent`.
- `server/routes/member-shaping.route.mjs` — registers the `profile`
  `SQUAD_ACTION` handler at `init`; no routes of its own.
- `scripts/check-member-by-chat.mjs`, `scripts/check-member-by-chat-browser.mjs`.

## The `profile` action

```
SQUAD_ACTION: {"type":"profile","op":"set","name":"Alex","role":"GTM Leader","instructions":"…","personality":"…","skills":["go-to-market strategy"]}
```

| Key | Rule |
| --- | --- |
| `op` | `set`, required |
| `member` | optional; must be the executing member's id or current name, otherwise refused |
| `name` | ≤60 chars, one line; "New member" / "New member N" is dropped; a name another member has is numbered ("Eva 2") |
| `role` | ≤80 chars, one line |
| `instructions` | ≤1,200 chars |
| `personality` | ≤600 chars; becomes the `PERSONALITY.md` persona profile file |
| `skills` | ≤8 strings, de-duplicated |

Any other key, another `op`, no fields, or a turn whose identity does not
match is refused. The receipt `{ id, type: "profile", actorId, status:
"applied" | "failed", message, patch }` is appended to the reply by the
action manager; `message` is "Alex is now your GTM Leader." or "Profile not
changed: <reason>.". An applied action also rewrites the member's registered
copy in `channels.json` → `agentChannelAccess` (via `memberAccess` and
`setAccess`). Applying the same values twice is the same state.

## The instruction

`memberShapingInstructions(payload)` in `server.mjs` adds
`memberShapingInstruction(agent)` on the three profile sites (`autohandArgs`,
`sdkRuntimeContext`, `prepareExternalHarness`) when the turn is a direct
message from a described member (not the `squad-designer` utility agent, not
a channel or collaboration turn) and either the member has no role or the
prompt `asksForRole`. Skipped when the caller's profile already carries
`"type":"profile"`.

## `App.jsx` wiring

- `startBlankMember()` → `createAgent(blankMemberDraft(…))`; passed as
  `onChatNewMember` to `SidebarContent` (→ `onNavigate.chatNewMember` →
  `CreateMenu`) and to `SquadDirectoryPage`.
- `createAgent`'s first message is `blankGreeting` for a blank member.
- The chat stream's `done` handler takes `profileReceipts(data.channelActions)`,
  lifts the lines out of the body into `message.profileNote`, and applies each
  `patch` through `updateAgent(id, profilePatchFor(agent, patch))`;
  `profilePatchFor` is the function Edit profile's Save uses.

## Scripts

`check:member-by-chat` (in `ci` after `check:member-profiles`) and
`check:member-by-chat:browser` (after `check:work-plans:browser`).
