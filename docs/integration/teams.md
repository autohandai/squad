# Teams — integration note

Share team…, Import team, presets and the member menu (ADR-0106); New team
from an objective, Templates and the non-blocking team build (ADR-0118).
Module files:

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
| `src/lib/team-builder.js` | Pure: `proposeTeam`, `updateProposal`, `proposalProblems`, `teamDocumentFromProposal`, `templateMeta`, `templateFacts`, `filterTemplates`, the build record (`createTeamBuild`, `patchBuild`, `patchBuildMember`, `resumeBuilds`, `pendingBuildMembers`, `buildProgress`, `buildFinishedEvent`, `buildMemberDraft`). |
| `server/teams/templates/*.squad-team.json` | The six built-in templates, ordinary team files. The bridge serves them; `src/data/team-templates.js` bundles the same files for the browser. |
| `src/components/teams/NewTeamDialog.jsx` | Objective → proposal → Add team. |
| `src/components/teams/TemplatesDialog.jsx` | Explore / Import / From a folder, and the template detail. |
| `src/components/teams/TeamBuildRows.jsx` | The directory rows for members being prepared. |
| `src/components/teams/CreateMenu.jsx` | The sidebar's "+": New member, New team…, Templates…. |
| `scripts/check-team-builder.mjs` | `bun run check:team-builder` (in the `ci` chain after `check:teams`). |
| `scripts/check-team-builder-browser.mjs` | `bun run check:team-builder:browser`: New team, Templates, detail and the preparing rows in headless Chrome, with screenshots under `.codex-artifacts/lanes/team-builder/`. |
| `src/components/ui/checkbox.jsx` | shadcn checkbox, written from the registry source. |
| `scripts/check-teams.mjs` | `bun run check:teams` (in the `ci` chain). |

## Routes

| Route | Body → answer |
| --- | --- |
| `POST /api/teams/export` | `{ team, description?, lead?, members: [{ id, name, role, description, instructions, brainCard, avatar, employeeType, skills, harness }], include: { skills: "all" \| [names], channels, workflows, notes, routines } }` → `{ document, filename, summary, skipped, redacted }`. Nothing written. The selected members' routines (`routines.json`) travel by member name unless `include.routines` is false. |
| `POST /api/teams/presets/export` | `{ member, presetName, description, skills: [names], notes }` → same shape, `document.kind === "preset"`. |
| `POST /api/teams/import/plan` | `{ document \| text, existingMemberNames }` → `{ plan, warnings, document }`. Nothing created. 400/413 with one sentence when refused. |
| `POST /api/teams/import` | `{ document \| text, existingMemberNames, memberIds: { [memberKey]: id }, choices: { channels, workflows, skills, presets, routines, connectors }, timeZone }` → `201 { members: [{ key, name, draft }], channels, workflows, routines: [{ id, title, memberId, enabled: false }], connectors: { added, kept }, skills: { added, kept }, presets: { added, kept }, dropped, warnings }`. Channels and workflows are whole or absent; "Nothing was added: …" on failure. Routines are created afterwards through `POST /api/routines` on the same bridge (paused, `timeZone` filling a schedule that names none); a routine that fails is listed under `dropped` and the channel stays. Connectors are saved off through the connector store with empty header and env values; one whose name exists is kept. |
| `GET /api/teams/templates` | `{ templates: [{ id, name, description, document }] }`, one per file in `server/teams/templates/`, each validated. |
| `GET /api/teams/presets` | `{ presets: [{ id, key, source, packageName, addedAt, preset }] }` |
| `DELETE /api/teams/presets/:id` | `{ id }`, 404 when gone. |

Bridge context: `ctx.agentsDir` (read-only; `<agentsDir>/<id>/skills`,
`<agentsDir>/<id>/profile/MEMORY.md`). `server/skills/local.mjs` takes
`squadStateDir` and adds `<squadStateDir>/skills` as a local skill root;
`server.mjs` passes it in both calls. `server/routes/workflows.route.mjs`
exports `importWorkflows(ctx, channelId, inputs)` (always `enabled: false`,
no runs) and `removeChannelWorkflows(ctx, channelId)`.

State files: `<squad state>/presets.json`, `<squad state>/skills/<name>/SKILL.md`.

## Team file additions (ADR-0118)

Version 1 of the format gains three optional parts, all rebuilt through the
allowlist like the rest:

- `team.description` (one line) and `team.lead` (a member name in the file).
- `routines`: `[{ member, title, instructions, schedule: { kind, time, timeZone?, days | day | month | everyMinutes | date | cron }, maxRunMinutes? }]`.
  Always paused on import; a time zone is optional and the importer's fills it.
- `connectors`: `[{ name, kind: "url" | "stdio" | "builtin", note?, url?, transport?, headers?: [names], command?, args?, env?: [names] }]`.
  Names and addresses only: a key, token, header value or env value is refused
  as an unknown field. Saved off on import; `builtin` names the Web research row.

## The team build (browser)

`addTeam(document, { trusted, source })` in `src/App.jsx` validates the
document, asks the bridge for the plan (names made unique against the squad
and the members still being prepared), turns each member into the draft
`createAgent` takes (`buildMemberDraft`: skills on for the app's own
proposals and built-in templates, off for files from a folder, which also
get the Ask ladder level), and records a build under
`autohandSquad.v1.teamBuilds`. `runTeamBuild` then prepares the members one
at a time through `createAgent` (the New member path, provisioning included),
calls `POST /api/teams/import` with `memberIds` for the channel, routines
and connectors, and raises `team.built` through `POST /api/events`. A reload
marks an in-flight build interrupted; Retry resumes from the first member
that is not ready, or from the bridge step when every member is.

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
