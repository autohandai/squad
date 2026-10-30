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

`POST /api/teams/design` accepts `{ objective, channelName, workspace,
existingNames }` and returns a runtime-validated `{ proposal, source: "model",
runId }` for 1–8 specialists (ADR-0142). This channel path uses the whole
objective and known skill catalog, not the New team dialog's keyword kits.
It designs only; the existing provisioner prepares the members.

Channel setup uses `POST /api/channels/:id/goal` (`objective`, `owner`,
optional `resume`), `GET/PUT .../goal/build` (the resumable build snapshot),
and `POST .../goal/progress` (`owner`, `status`, `memberIds` when ready).
The bridge stores `channel-team-builds.json`, claims one owner, retains the
original goal/thread and prepared member ids, and rejects late results from
another owner. Ready queues each first turn and its loading message before
execution; the bridge saves actual replies even without a browser. Restart
marks unfinished turns interrupted instead of replaying their side effects.

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

## Members through Squad MCP

The managed `autohand-squad` server supplies the same operations on every
engine (ADR-0134). `squad_teach({ text, recipients?, request_id? })` saves a
shared lesson and creates real teammate deliveries. `recipients` is an array
of names or ids; omit it for everyone else. Do not call it `to`: Autohand's
path authorization interprets that argument as a string file destination.
`squad_replies` collects actual answers. Receipts distinguish saved memory,
queued/running deliveries and replies. Recipients return their final text;
Squad delivers it automatically, and rejects recursive messages to a waiting
ancestor. Ordinary independent messages still use `squad_message`.

`squad_schedule` creates an enabled Automation for a requested job by
default. Its optional `mode: "propose"` records a suggestion. Saved Ask/Block
permissions remain authoritative. The Automation editor's drafting call is
bound to draft-only mode and never starts a schedule before Save (ADR-0138).

Model discovery and configured fallbacks use the same member-scoped server
(ADR-0155). `squad_models({})` lists connected engines and the member's saved
configuration. `squad_models({ engine, provider? })` returns that engine's
reported model IDs and display names without sending a prompt.

`squad_set_fallbacks({ fallbacks: [{ engine, model?, provider?, effort? }] })`
replaces the member's ordered list, up to four choices. It requires **Let this
member manage fallbacks** in Model settings; the tool cannot enable that
permission or change the primary. Provider applies to Autohand choices.
Models must come from discovery, and engines must already be connected.
Independent catalog checks run concurrently. The final serialized write
rechecks the person's opt-in and preserves any concurrent primary edits.
An applied profile receipt includes the saved revision, so the UI reflects
the change. The external `squad mcp` control plane retains its separate,
limited tool set; these operations belong to managed member work.

The app reads `GET /api/harnesses/models?id=<engine>&provider=<provider>`
(optional workspace, executablePath and `refresh=1`) for the same catalog.
`GET /api/members/:id/model-routing` returns configuration and local recovery
health; `POST .../model-routing/reset` clears its cooldown. Human edits use
the existing channel-access profile patch with `modelRouting: { version: 1,
fallbacks: [{ harness: { id, model?, effort? }, provider? }],
allowAgentChanges: false }`. These remain local bridge routes.

## Collective memory (ADR-0156)

The existing managed server also exposes:

| Tool | Arguments and behavior |
| --- | --- |
| `squad_search_memory` | `{ query, limit?: 1..20 }` searches authorized collected memories using exact words plus local TurboVec text features. |
| `squad_memory_graph` | `{ query?, similarity? }` returns bounded memory excerpts and saved links; computed similarity links are explicitly derived. |
| `squad_read_memory` | `{ id }` returns one complete source record when visible. |
| `squad_share_memory` | `{ id, teammate_id, revoke? }` adds/removes an explicit grant for a memory the actor owns/authored. No message is sent. |
| `squad_relate_memories` | `{ from, to, relation: references|supports|contradicts, evidence }` saves a typed link between visible endpoints; actor must own/author `from`. |
| `squad_organize_memory` | `{ id, groupId?, title?, kind?, tags? }` curates an owned memory without changing its source or visibility. |

`squad_recall` reads the same collection. Search/recall/graph responses have a
total excerpt budget and `hasMore`; follow an ID with `squad_read_memory` for
full text. Existing remember/update/forget operate on canonical team records.
Imported source content is read-only. Identity and project are derived from
the per-work credential, never caller arguments. Private memories require
ownership or an explicit grant; project access uses the current workspace.
The person's all-member graph is not the graph an individual agent receives.

The local app uses `GET/POST /api/memory`, `GET/PATCH/DELETE /api/memory/:id`,
`PATCH /api/memory/:id/metadata`, `POST /api/memory/:id/share`,
`POST /api/memory/links`, `DELETE /api/memory/links/:id`,
`POST /api/memory/groups`, `DELETE /api/memory/groups/:id`,
`GET/PATCH /api/memory/settings` and `POST /api/memory/reindex`.
List accepts query, owner, kind, scope, group, tag, offset, limit and similarity.
Settings select team/member/profile/isolated-CLI sources, explicit shared
Markdown folders and member colors. Folder collection never edits originals.
Library metadata lives in `<squad state>/memory/library.json`; the vector cache
is a derived sibling under `memory/vectors`. These additions are local and do
not change the separate cloud-sync upload contract.

The packaged Rust daemon implements a private NDJSON worker mode:
`autohand-squad-daemon --memory-index --index-dir <path>`. Requests include an
`id` and `op` of `sync` (documents `{id,text}`), `search` (query, allowedIds,
limit) or `status`. Empty/missing allowlists yield no search hits. Responses
echo `id`, `success`, and `data` or `error`. The bridge owns visibility; the
worker never resolves paths or grants from an agent tool. TurboVec 1.1.2 uses
1536-dimensional normalized lexical token/bigram features and four-bit
quantization, with no embedding network request.

Run `RUSTUP_TOOLCHAIN=1.93.1 bun run check:memory` locally with Rust >=1.89 and
Chrome installed. The command builds the native daemon and verifies library,
MCP and browser paths. CI runs native library checks after the runtime build
on each target; Linux also runs the browser check. Release checks use the
freshly compiled release executable before packaging.

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
