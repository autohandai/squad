# Teams — integration note

Share team…, Import team, presets and the member menu (ADR-0106). Module
files:

| File | Role |
| --- | --- |
| `src/lib/teams.js` | Pure: the team file allowlist, limits, `buildTeamFile`, `validateTeamFile`, `planImport`, `presetTemplate`. |
| `src/lib/secret-scan.js` | Pure: `redactSecrets`, `redactDeep`, `containsSecret`. Shared by bridge and browser. |
| `src/lib/member-menus.js` | Pure: `pinPatch`, `hidePatch`, `orderMembers`, `hiddenMembers`, `markUnreadReadAt`, `duplicateCreationStash`. |
| `server/teams/package.mjs` | Bridge: reads member skill text and notes, channels and workflows; writes imported skills, presets, channels, workflows. |
| `server/teams/validate.mjs` | Bridge: `parseTeamUpload` → validated document or a `TeamFileError` with status. |
| `server/routes/teams.route.mjs` | The routes below. |
| `src/components/members/MemberMenu.jsx` | The one member menu. |
| `src/components/members/HiddenMembersGroup.jsx` | The directory's collapsed Hidden group. |
| `src/components/teams/TeamMenu.jsx` | Directory header overflow: Share team…, Import team…. |
| `src/components/teams/ShareTeamDialog.jsx` | Share team / Share as preset dialog. |
| `src/components/teams/ImportTeamDialog.jsx` | Pick, review, add, report. |
| `src/components/ui/checkbox.jsx` | shadcn checkbox, written from the registry source. |
| `scripts/check-teams.mjs` | `bun run check:teams` (in the `ci` chain). |

## Routes

| Route | Body → answer |
| --- | --- |
| `POST /api/teams/export` | `{ team, members: [{ id, name, role, description, instructions, brainCard, avatar, employeeType, skills, harness }], include: { skills: "all" \| [names], channels, workflows, notes } }` → `{ document, filename, summary, skipped, redacted }`. Nothing written. |
| `POST /api/teams/presets/export` | `{ member, presetName, description, skills: [names], notes }` → same shape, `document.kind === "preset"`. |
| `POST /api/teams/import/plan` | `{ document \| text, existingMemberNames }` → `{ plan, warnings, document }`. Nothing created. 400/413 with one sentence when refused. |
| `POST /api/teams/import` | `{ document \| text, existingMemberNames, memberIds: { [memberKey]: id }, choices: { channels, workflows, skills, presets } }` → `201 { members: [{ key, name, draft }], channels, workflows, skills: { added, kept }, presets: { added, kept }, dropped, warnings }`. Channels and workflows are whole or absent; "Nothing was added: …" on failure. |
| `GET /api/teams/presets` | `{ presets: [{ id, key, source, packageName, addedAt, preset }] }` |
| `DELETE /api/teams/presets/:id` | `{ id }`, 404 when gone. |

Bridge context: `ctx.agentsDir` (read-only; `<agentsDir>/<id>/skills`,
`<agentsDir>/<id>/profile/MEMORY.md`). `server/skills/local.mjs` takes
`squadStateDir` and adds `<squadStateDir>/skills` as a local skill root;
`server.mjs` passes it in both calls. `server/routes/workflows.route.mjs`
exports `importWorkflows(ctx, channelId, inputs)` (always `enabled: false`,
no runs) and `removeChannelWorkflows(ctx, channelId)`.

State files: `<squad state>/presets.json`, `<squad state>/skills/<name>/SKILL.md`.

## App.jsx wiring (done in this lane)

- Imports: the five components, `member-menus` helpers, `presetTemplate`.
- State: `sharePreset`, `shareTeamOpen`, `importTeamOpen`, `teamPresets`
  (loaded from `GET /api/teams/presets`, refreshed after an import),
  `presetTemplates`.
- Handlers after `inboxReplies`: `pinMember`, `hideMember` (through
  `updateAgent`), `markMemberUnread(id, { leave })`, `markMemberRead`
  (through `setAgentReads`), `duplicateMember` (writes the ADR-0077 draft
  record and navigates to `/squad-members/new?workspace=…`).
- `renderMemberMenu(agent, context)` renders `MemberMenu` for the sidebar
  (`context: "sidebar"`) and the chat header (`"chat"`, passed to
  `Conversation` as `menu`).
- `SidebarContent` hands `orderMembers(visibleAgents)` to `WorkspaceSidebar`.
- `SquadDirectoryPage` gets `unreadCountByAgent, onPin, onHide, onMarkUnread,
  onMarkRead, canMarkUnread, onDuplicate, onSharePreset, onShareTeam,
  onImportTeam`; `SquadMemberRow` renders `MemberMenu`; the Hidden group
  sits under the list; `TeamMenu` sits beside New member.
- `CreateAgent` gets `presets={presetTemplates}` and lists them first.
- `createAgent(draft, { ladderLevel })` applies that ladder level's
  permission preset; the import dialog passes `"suggest-commands"`.
- Both dialogs mount beside the member delete dialog; `onImported` reloads
  channels, workflows and presets.
