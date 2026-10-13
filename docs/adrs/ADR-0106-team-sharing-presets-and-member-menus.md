# ADR-0106: Team sharing, presets, and one member menu

Date: 2026-10-13. Lane L6 of
`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`.

## Context

OpenMausBot shares a whole team as one file, offers imported bots as presets
in its New bot screen, and gives every bot a right-click menu. Squad had none
of these. Its member row menu in the directory had Open chat, View profile,
Automations, Pause and Remove; the sidebar row had a different menu (Chat,
Details, Take a break, Delete); the chat header had no menu at all. Nothing
let a person pin a member, mark a reply unread, hide a retired member, or
copy a member they liked.

What the code already decided, and this change had to respect:

- Members live in the browser (`localStorage`, mirrored to the bridge only
  through `web-status.json`); channels, workflows, member profile files and
  installed skills live on the bridge (`docs/integration/CONTRACT.md`).
- Every member creation goes through one confirmed path that awaits bridge
  provisioning and keeps an editable draft under
  `autohandSquad.v1.memberCreation:<workspace>` (ADR-0077). The New member
  screen restores that draft on open when it is `version: 1`, carries a
  custom role whose id starts with `custom-role-`, and names a member id not
  yet in the roster.
- Unread is not a flag on a member. `unreadCountByAgent` counts replies
  whose timestamp is newer than `agentReads[id]`, and the sidebar, the
  Needs you page and the Dock badge all read that one count.
- The bridge context handed to route plug-ins did not expose where member
  homes are (`<app state>/agents/<id>`), so no plug-in could read a member's
  `SKILL.md` text or `MEMORY.md`.
- Local skills resolve from the workspace and the person's home folder
  (`server/skills/local.mjs`); the app's own state folder was not a root.
- There is no `dropdown-menu` wrapper in `src/components/ui`; the existing
  menus are a `Popover` with plain buttons. There is no `checkbox` wrapper
  either, though `@radix-ui/react-checkbox` is installed with the other
  primitives.

## Decision

### One member menu

`src/components/members/MemberMenu.jsx` is the only member menu. It renders
on the directory row, the sidebar row and the chat header with the same
order: Open chat / View profile / Automations, then Pin / Mark unread (or
Mark read when there is something unread), then Duplicate / Share as
preset…, then Hide / the state toggle, then Remove. An item is present only
when its handler is given, so the chat header leaves out Open chat. Remove
only asks for the caller's existing confirm dialog.

- **Pin** and **Hide** are two booleans on the member record (`pinned`,
  `pinnedAt`, `hidden`, `hiddenAt`), written through `updateAgent`, so they
  persist with the roster and travel to other windows with every other
  member patch. Hiding unpins. `orderMembers` puts pinned members first in
  the order they were pinned and leaves hidden ones out; the directory shows
  hidden members in a collapsed **Hidden** group with a Show action, and the
  sidebar does not show them at all. Needs you still lists a hidden member's
  unread replies: hidden means out of the way, not out of the squad.
- **Mark unread** sets `agentReads[id]` to one millisecond before the latest
  finished reply, so the count the sidebar, Needs you and the badge show is
  exactly what a real new reply would have produced. There is no second
  unread source. When there is no finished reply the item is disabled,
  because no new reply could have produced a count either. From the chat
  header, marking unread also navigates to Needs you, since the conversation
  marks itself read again at the next message.
- **Duplicate** writes the New member screen's own draft record (the shape
  ADR-0077 restores) with the member's role, personality files, brain card,
  skills and harness as a custom role and a fresh member id, then opens the
  screen. The copy is then saved through the same confirmed creation as any
  member. Nothing about the copy bypasses provisioning.

### Share team… and Import team

A team file (`<team>-<date>.squad-team.json`) is version 1 of the format
`autohand.squad-team`, defined once in `src/lib/teams.js` as an allowlist:
members (key, name, role, description, instructions, brain card, look,
skill names, harness id, optional notes), skills (name, description,
`SKILL.md` text), channels (name, visibility, section, member names),
workflows (channel, name, dispatch, trigger without its token, steps with
member names and header names only), presets. `validateTeamFile` rebuilds
every document through that allowlist and refuses the rest: wrong format or
version, an unknown top-level field, more than 50 members / 60 skills / 50
channels / 100 workflows / 40 presets, text over the per-field limits, a file
over 4 MB, a skill carrying anything but its text, or a file with nothing to
add. There is no field for a credential, conversation, permission grant,
provider or model key, folder or computer, and the limits are refusals, not
trims.

Every string in a file passes through `src/lib/secret-scan.js` on the way
out and again on the way in. The detector is deliberately broad: known key
prefixes, bearer tokens and JWTs, private key blocks, URL credentials,
`password: …` / `token = …` lines, and any 32-character-plus run that mixes
letters and digits. A commit hash in a note is replaced too; the dialog lists
every change by path so the person can judge.

The bridge assembles what only it can read (`server/teams/package.mjs`):
`SKILL.md` text from `<agentsDir>/<id>/skills/<name>/SKILL.md`, notes from
`<agentsDir>/<id>/profile/MEMORY.md`, channels from `channels.json`,
workflows from `channel-workflows.json`. The browser brings the members and
the selection, and saves the JSON it gets back. For that, `routeContext()`
gained one read-only field, `agentsDir`, recorded in CONTRACT.md.

Import is three steps. The browser validates the file with the same
validator, asks the bridge for a plan (`POST /api/teams/import/plan`), and
shows exactly what will be created, with duplicate member names suffixed
"Name 2" and duplicate channel names "name-2", and what was dropped with the
reason. On Add, the browser creates the ticked members one at a time through
`createAgent` with `ladderLevel: "suggest-commands"` (the ladder's "Ask":
the member proposes, the person executes) and `skills: []`; starter notes
go in as a `MEMORY.md` profile file through the ordinary profile writer.
Only when every ticked member exists does it call `POST /api/teams/import`,
which writes skill text to `<squad state>/skills/<name>/SKILL.md` (now a
local skill root, so a member can install one by name), saves presets to
`presets.json`, creates the channels in one channel-store mutation with the
real member ids, and creates the workflows paused with freshly minted
webhook tokens. If a workflow cannot be kept, the route removes the channels
and workflows it just made and answers "Nothing was added: …". If a member
fails, the browser stops before the bridge call and the report names what
was created and what was not.

### Presets

A preset is the allowlist minus anything squad-specific: name, description,
role title, instructions, brain card, look, skill names, notes. Every member
in an imported team file is offered as a preset, and **Share as preset…** on
one member writes a preset file (`<name>-<date>.squad-preset.json`, the same
format with `kind: "preset"`). Presets are stored in
`<squad state>/presets.json`, served by `GET /api/teams/presets`, and merged
ahead of the built-in roles under an "Imported presets" heading in New
member's role list. A preset's skills start switched off, like every skill
that arrived in a file.

## Evidence

`bun run check:teams` (`scripts/check-teams.mjs`), run on 2026-10-13 from
this lane, against a real bridge in an isolated state directory:

- A seeded member home with `review-notes/SKILL.md` (holding an `sk-live-…`
  token), a `helper.sh` beside it, a second skill not on the member, and a
  `MEMORY.md` with a `password:` line and the same token. A private channel
  with a folder and a webhook workflow created through their own routes.
- `POST /api/teams/export` with two members (carrying permissions, a
  workspace, a model assignment and a harness executable path) produced a
  document whose top-level keys and member keys are exactly the allowed
  ones, whose JSON contains none of: the token, the password, the webhook
  token, `/Users/someone`, `ladderLevel`, `executablePath`, the folder
  path, `helper.sh`, the un-selected skill. The notes travelled with
  markers in place of both secrets; `redacted` listed 2 or more paths.
- `POST /api/teams/import/plan` with "Iris" already present named the
  member "Iris 2" and the channel "release-2".
- `POST /api/teams/import` created the channel in `channels.json` with the
  two new member ids, visibility and section, no folders; the workflow with
  `enabled: false`, no runs, the step bound to the new id, and a webhook
  token different from the exported one; `squad/skills/review-notes/SKILL.md`
  without the token; two presets. A second import added no preset or skill
  twice and named the channel "release-3".
- A 4 MB + 1 KB body was refused with 413 and "larger than 4 MB"; `{not
  json` with 400 and "not JSON"; a document with a `conversations` field
  with 400 naming the field.
- A file whose only workflow had an invalid HTTP URL was refused with
  "Nothing was added" and the channel count was unchanged afterwards.
- A preset file for one member imported, was listed, was removed with
  `DELETE`, and a second `DELETE` answered 404.
- The pure rules: pinned members sort by `pinnedAt` ahead of the rest and a
  hidden member is excluded; hiding unpins; `markUnreadReadAt` yields a
  count of exactly 1 and "" when there is no finished reply; the duplicate
  stash is `version: 1` with a `custom-role-` template and string draft
  fields, as the create form requires.

`bun run check:jsx` and `bun run check:member-draft` pass. An in-memory
esbuild bundle of `src/App.jsx` with CSS external resolved every import.
`bun run build` was not run: the disk had 1.2 GiB free and the lane rule
asks for more than 1.5 GiB.

## Consequences

- One menu, three places, one order. A sidebar row's "Take a break" and a
  directory row's "Pause member" are still different actions (break vs
  status) and keep their labels; they sit in the same slot.
- The `agentsDir` field in the bridge context is read-only by convention,
  not by enforcement. A route that writes into member homes would be going
  around provisioning.
- `<squad state>/skills` is now a local skill root for every member. A
  skill imported from a file is therefore installable by any member by name
  from its Skills page. Imported skills are switched off on arrival and
  nothing surfaces "this member came with these skills" after the import
  report closes; the member record does not keep the names. That is a known
  gap.
- The secret detector is broad on purpose and will replace a long commit
  hash or an opaque identifier in a note. The report lists every change;
  nothing is silently dropped, but a person who shares notes with hashes in
  them will see markers.
- Import creates members before the bridge call. If the bridge call then
  fails, the members exist and the channels do not; the report says so, and
  importing again creates "Name 2" copies. The bridge side is whole or
  absent; the browser side is reported, not rolled back, because a created
  member is a provisioned home the person may already be using.
- Pictures (uploaded avatars) are not in the format. A member's look travels
  only when it is a path the app serves (`/avatars/…`), and the share dialog
  lists each dropped picture. Left undone with the organisation library and
  any hosted catalogue, both out of scope in the lane spec.
- Unknown nested fields on a member or a skill are rebuilt away rather than
  refused; only unknown top-level fields refuse the file. A file with a
  stray member field still imports.
- Mark unread from the chat header leaves the conversation. Someone who
  wanted to stay and keep the dot will find it cleared on the next message.
- Locale copy for the new labels is the English fallback in the components;
  `src/locales.js` carries only the keys that already existed.
