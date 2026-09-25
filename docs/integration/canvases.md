# Canvases — integration note

Module files: `server/canvases/store.mjs`, `server/routes/canvases.route.mjs`,
`src/lib/diff.js`, `src/lib/canvases.js`, `src/components/canvases/CanvasPanel.jsx`,
`src/components/canvases/CanvasList.jsx`, `scripts/check-canvases.mjs`,
`docs/adrs/ADR-0023-canvases.md`. Nothing here touches `server.mjs`, `src/App.jsx`,
`package.json`, or `src/locales.js`; the wiring below is the integrator's.

## Routes (auto-loaded plug-in `canvases`)

| Method, path | Body / query | Returns `data` |
| --- | --- | --- |
| `GET /api/canvases?ownerType=channel|member&ownerId=` | — | `{ canvases: [...] }` newest first |
| `POST /api/canvases` | `{ ownerType, ownerId, title, body?, authorId? }` | `{ canvas }` (201) |
| `GET /api/canvases/:id` | — | `{ canvas }` |
| `PUT /api/canvases/:id` | `{ title?, body?, authorId?, summary? }` | `{ canvas, changed, revision }` — one revision only when `body` changed |
| `DELETE /api/canvases/:id` | — | `{ id }` |
| `POST /api/canvases/:id/revert` | `{ revisionId, authorId? }` | `{ canvas, changed, revision }` |
| `POST /api/canvases/:id/materialize` | — | `{ dir, path }` — `<squadStateDir>/canvas/` and `<id>.md` |
| `POST /api/canvases/:id/absorb` | `{ authorId, summary? }` | `{ changed, revision, canvas }` |

Canvas shape: `{ id, ownerType, ownerId, title, body, createdAt, updatedAt,
revisions: [{ id, authorId, at, body, summary }] }`. `authorId` is `"user"` for
the person and the member id for a squad member. State: `~/.autohand/squad/canvases.json`.

## Events

- Emits `canvas.updated { id, ownerType, ownerId, title, body, reason, revision? }`
  on create, edit, revert, and absorb, and `canvas.removed { id }` on delete.
  **Search:** subscribe in the search plug-in and index `title` + `body` under
  `kind: "canvas"`, `id`; drop the document on `canvas.removed`. The canvases
  plug-in never calls the bridge over HTTP.
- Subscribes to `run.finished`: when `ctx.runs.get(runId).canvasId` is set it
  calls `absorb(squadStateDir, canvasId, memberId)` itself, so a member run
  that edited the file becomes exactly one attributed revision with no second
  request from the web app.

## server.mjs: a run or chat with `canvasId`

The web app materializes first, then launches with two extra payload fields:
`canvasId` and `canvasDir` (the `dir` from materialize).

1. **`autohandArgs(input)`** (CLI runs): after the `associatedProjects` loop
   that pushes `--add-dir`, add
   `if (input.canvasDir) { args.push("--add-dir", input.canvasDir); displayArgs.push("--add-dir", "<canvas>"); }`.
2. **`sdkRuntimeContext(input, workspace, profile, agentRuntime)`** (SDK runs
   and chat via `startSdkRun`, `chatOnceWithSdk`, `streamChatWithSdk`): push
   `input.canvasDir` onto `addDir` and `"<canvas>"` onto `displayAddDir`.
3. **`prepareExternalHarness(payload)`** (Codex / Claude Code): push
   `payload.canvasDir` onto `addDirs`.
4. **`startRun(payload)`**: where the `run` literal is built (next to
   `recipeId`), add `canvasId: typeof payload.canvasId === "string" ? payload.canvasId : null`.
   Do the same in `startExternalHarnessRun(payload)`. That field is what the
   plug-in's `run.finished` listener reads; `runSummary` may expose it.
5. Chat has no run object, so after a chat reply completes the web app calls
   `POST /api/canvases/:id/absorb { authorId: agentId }` (see below).

Validate `canvasDir` the same way as other add-dirs: it must start with
`join(squadStateDir, "canvas")`; reject anything else.

## App.jsx

**State.** In `ChannelsPage` and `Conversation`, load
`api("/api/canvases?ownerType=channel&ownerId=" + channel.id)` (or
`ownerType=member&ownerId=` + agent.id) into `canvases`; refresh after every
mutation and on `run.finished` / `chat.finished` events for that owner.

**Canvas tab.** Channel page: add a `Canvas` tab beside the stream (the
`# name` header row gets underlined text tabs `Messages | Canvas`, `TabsList
variant="line"`). Member page: the same tab next to the chat, reachable from
the header icon row. The tab renders, in the 48rem column:

```jsx
<CanvasList canvases={canvases} activeCanvasId={activeCanvasId} members={agents}
  onSelect={setActiveCanvasId}
  onCreate={({ title }) => api("/api/canvases", { method: "POST", body: JSON.stringify({ ownerType, ownerId, title }) })}
  copy={copy} />
<CanvasPanel canvas={activeCanvas} members={agents}
  onChange={(patch) => api(`/api/canvases/${activeCanvas.id}`, { method: "PUT", body: JSON.stringify({ ...patch, authorId: "user" }) })}
  onRevert={(revisionId) => api(`/api/canvases/${activeCanvas.id}/revert`, { method: "POST", body: JSON.stringify({ revisionId, authorId: "user" }) })}
  onDelete={(canvas) => confirm-then-DELETE}
  renderMarkdown={(text) => <MarkdownBlocks text={text} />}
  renderAvatar={(agent, className) => <AgentAvatar agent={agent} className={className} />}
  copy={copy} />
```

`CanvasPanel` saves on the Save button or ⌘/Ctrl+Enter (one PUT, one
revision). Selecting a revision in the rail shows its diff against the
previous one; **Accept** closes it, **Revert** calls `onRevert(previous.id)`.

**Composer mention.** In `Conversation`'s `mentionItems` memo (and the channel
composer's equivalent), when `isCanvasMentionQuery(mentionQuery)` add
`canvasMentionItems(canvases, mentionQuery)` mapped to the picker shape
`{ type: "canvas", prefix: "@", value: item.token, title: item.label, detail: item.detail }`;
the existing `insertTriggerText` inserts `@canvas:slug`. On send, in
`sendChat(agentId, launch)` and `dispatchChannelMemberReply`:

```js
const { prompt: expandedPrompt, canvases: attached } = expandCanvasMentions(prompt, canvases, { paths });
```

For the first attached canvas: `const { dir, path } = await api(`/api/canvases/${id}/materialize`, { method: "POST" })`,
pass `paths = { [id]: path }` so the attachment tells the member to edit the
file, and add `canvasId: id, canvasDir: dir` to the `/api/chat/stream` or
`/api/runs` payload. Additional mentioned canvases are inlined read-only.
After a chat reply finishes (stream `done`), call
`POST /api/canvases/${id}/absorb { authorId: agentId }` and refresh the list;
runs are absorbed by the plug-in on `run.finished`.

**Search.** `canvas.updated` is indexed server-side (above). In the ⌘K result
list, a `kind: "canvas"` hit opens the owner page with `activeCanvasId` set.

## package.json

```json
"check:canvases": "node scripts/check-canvases.mjs"
```

## Copy keys (`src/locales.js`, `en`)

`canvases: "Canvases"`, `canvasNew: "New canvas"`, `canvasNone: "No canvases yet. Start one for a plan, a spec, or a report members can edit with you."`,
`canvasTitlePlaceholder: "Untitled canvas"`, `canvasBodyPlaceholder: "Write in Markdown. Members can edit this too; their changes show up as revisions."`,
`canvasEdit: "Edit"`, `canvasPreview: "Preview"`, `canvasSave: "Save"`, `canvasSaved: "Saved"`,
`canvasRevisions: "Revisions"`, `canvasAccept: "Accept"`, `canvasRevert: "Revert"`, `canvasRestore: "Restore this version"`,
`canvasDelete: "Delete"`, `canvasYou: "You"`, `canvasNoChanges: "No line changes"`, `canvasChanges: "{added} added · {removed} removed"`,
`canvasMemberEdit: "{name} edited this canvas"`, `canvasFirstVersion: "First version"`, `canvasEmptyPreview: "Nothing to preview yet."`,
`canvasEditedSummary: "Edited"`, `canvasLastEdit: "{name} · {time}"`, `canvasTab: "Canvas"`.
Every key has a literal fallback in the components.

## DESIGN.md

Add under Squad Channels / Agent Chat: "A Canvas tab sits beside the stream
as an underlined text tab. The canvas is title, editor, and a 224px revision
rail separated by one divider; member edits are a bold rail row with a dot,
and the diff colours only the changed lines (soft green / soft rose), never
the page."
