# Integration: cross-surface search (issue #33, ADR-0020)

One search over messages, channels, members, runs, tasks, handoffs, canvases,
and workflow runs. The bridge keeps an FTS5 index at
`~/.autohand/squad/search.sqlite` (`server/search/index.mjs`); the route
plug-in feeds it with what the bridge holds and accepts pushes for what the
browser holds. `SearchCommand` keeps its in-memory member/channel/page
matches and merges the bridge results underneath.

## Routes (`server/routes/search.route.mjs`, auto-loaded)

| Route | Body / query | Returns |
| --- | --- | --- |
| `GET /api/search?q=&types=&limit=` | `types` comma list of `message,channel,member,run,task,handoff,canvas,workflow`; `limit` ≤ 200 (default 40) | `{ query, mode: "fts5"\|"like", results: [{ id, type, title, snippet, route, at, score, memberId, channelId, runId }], tookMs }` |
| `POST /api/search/index` | `{ docs: [doc] }` | `{ indexed, changed, skipped }` |
| `POST /api/search/remove` | `{ ids: [id] }` | `{ removed }` |
| `POST /api/search/rebuild` | `{ docs?: [doc] }` | stats + `indexed`; replaces the index with bridge records + the docs in the body |
| `GET /api/search/stats` | | `{ path, mode, total, byType, updatedAt, rebuiltAt }` |

A `doc` is `{ id, type, title, body, memberId?, channelId?, runId?, route, at }`.
`id` must be stable per record (`message:<id>`, `task:<id>`, …); pushing the
same id again replaces the row, so the app can push freely. `snippet` wraps
hits in `<mark>…</mark>`; render it with `snippetSegments()` (never as HTML).

Events: the plug-in subscribes to `run.finished` (re-indexes that run from
`ctx.runs`, including the last 60 log lines), and to `chat.finished` /
`mention.received` with a `channelId` (re-reads `channels.json` and upserts
that channel's messages). Nothing new needs emitting. `AUTOHAND_SEARCH_FTS=0`
forces the LIKE fallback for diagnosis.

## What the web app pushes, and when

The bridge already indexes channels, channel messages persisted in
`channels.json`, and runs. `App.jsx` pushes the rest, fire-and-forget through
`api("/api/search/index", { method: "POST", body: { docs } })`, batched per
event (never per keystroke):

| Record | When | Doc |
| --- | --- | --- |
| DM message (`messagesByAgent`) | on append, and once a streamed reply settles (text final) | `{ id: "message:" + m.id, type: "message", title: agent.name, body: m.body, memberId: agentId, route: memberChatPath(agentId) + "&message=" + m.id, at: m.createdAt }` |
| Channel message not yet in `channels.json` (optimistic user post) | on append | same shape with `channelId`, `route: channelsPath(channelId) + "?message=" + m.id`, `title: "#" + channel.name` |
| Task | on create / status / summary change (`setTasks`) | `{ id: "task:" + task.id, type: "task", title: task.title, body: [task.summary, task.project, task.status].join("\n"), memberId: task.agentId, runId: task.runtimeId, route: memberProfilePath(task.agentId, "task") + "?task=" + task.id, at: task.updatedAt }` |
| Handoff | when `task.handoffs` gains or changes an entry | `{ id: "handoff:" + h.id, type: "handoff", title: "Handoff to " + toAgent.name + ": " + task.title, body: h.reason, memberId: h.toAgentId, route: inboxPath() + "?handoff=" + h.id, at: h.createdAt }` |
| Member | on create / rename / role change | `{ id: "member:" + agent.id, type: "member", title: agent.name, body: [agent.role, agent.description].join("\n"), memberId: agent.id, route: memberChatPath(agent.id), at: agent.updatedAt }` |
| Canvas / workflow run | when those modules land: on save / on finish | `type: "canvas"` with the canvas route; `type: "workflow"` with `missionControlPath({ workflow: id })` |

Deleting a member, task, or channel: `POST /api/search/remove { ids }`.

Rebuild (Settings → Advanced, or after a schema reset reported by `stats`):
collect every doc above from current state and `POST /api/search/rebuild
{ docs }`. The bridge adds its own records; the result is the complete index.
The first time the app runs with this feature, `stats().total` is only the
bridge records; push once from state on boot (one batched call) so history
held in `localStorage` becomes searchable.

## `SearchCommand` wiring (`src/components/shell/SearchCommand.jsx`)

Keep the component's current props and add `api`, `onNavigate.route`, and
the results component:

1. Debounce the query (180 ms, minimum 2 characters) and call
   `api("/api/search?q=" + encodeURIComponent(q) + (activeType ? "&types=" + activeType : "") + "&limit=60")`.
   Keep the latest request only (ignore responses whose query no longer
   matches). Keep `loading` while in flight.
2. Build local matches as today (members, channels, browser-held messages)
   but as docs: `{ id: "member:" + agent.id, type: "member", title, snippet: agent.role, route: memberChatPath(agent.id) }`,
   `{ id: "channel:" + channel.id, type: "channel", title: "#" + name, route: channelsPath(channel.id) }`,
   `{ id: "message:" + m.id, type: "message", ... }`. Then
   `const results = mergeResults(remote, local)` and
   `const groups = groupResults(results, { activeType, perType: 6 })`,
   `const counts = typeCounts(results)` — all from `src/lib/search-results.js`.
3. Render, inside the existing `CommandDialog` under `CommandInput`:

   ```jsx
   <SearchResults
     query={query}
     groups={groups}
     counts={counts}
     activeType={activeType}
     onTypeChange={setActiveType}
     loading={loading}
     recent={recent}
     onRecentSelect={(q) => setQuery(q)}
     onSelect={(item) => { setRecent(pushRecentSearch(query)); onOpenChange(false); onNavigate.route(item.route); }}
     copy={copy}
   />
   ```

   The Pages group stays as today when the query is empty or matches a page
   name; the component handles ↑/↓/Enter itself (capture-phase listener), so
   replace `CommandList` with `SearchResults` while `query.trim()` is
   non-empty and show pages + `SearchResults` (recent searches) when it is
   empty. `recent` comes from `readRecentSearches()` on open.
4. `onNavigate.route(route)` is `navigate(route)`. Deep links to honour in
   `App.jsx` so a hit is highlighted in place:
   - `/channels/:id?message=<id>` — scroll that message into view and give it
     a two-second `bg-muted/60` highlight.
   - `/conversations/new?member=<id>&message=<id>` — same for a DM message.
   - `/mission-control?run=<id>` — already selects the run.
   - `/squad-members/:id/task?task=<id>` — already opens the task.
   - `/inbox?handoff=<id>` — scroll the handoff row into view.

## Scripts and copy

- `package.json`: `"check:search": "node scripts/check-search.mjs"`, and add
  `bun run check:search` to `ci` after `check:recruiting`.
- `src/locales.js` (`en`), with the component's fallbacks in parentheses:
  `searchRecent` ("Recent searches"), `searchHint` ("Search messages,
  channels, members, runs, tasks, and handoffs."), `searchSearching`
  ("Searching…"), `searchNoResultsFor` ("No results for “{query}”."),
  `searchAllTypes` ("All"), `searchFilterTypes` ("Filter by type"),
  `searchResults` ("Search results"), `searchShowAll` ("Show all {count}"),
  and `searchTypeMessage`, `searchTypeChannel`, `searchTypeMember`,
  `searchTypeRun`, `searchTypeTask`, `searchTypeHandoff`,
  `searchTypeCanvas`, `searchTypeWorkflow` ("Messages", "Channels",
  "Members", "Runs", "Tasks", "Handoffs", "Canvases", "Workflow runs").
  `typeLabel()` falls back to the existing plural keys (`messages`,
  `channels`, …) when the `searchType*` keys are absent.
- `DESIGN.md`, under Workspace Shell: "Search results are grouped by type
  under a quiet filter row (toggle chips, no pills); rows are icon + title +
  muted snippet with the hit in semibold, no highlight colour; ↑/↓/Enter
  navigate; an empty query lists recent searches."
