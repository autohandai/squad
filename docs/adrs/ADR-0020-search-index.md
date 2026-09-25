# ADR-0020: Cross-surface search index

Date: 2026-09-26 · Status: accepted · Issue #33

## Context

⌘K searched members, channels, and whatever messages the browser still held.
Runs, handoffs, tasks, and older channel history were not searchable, and
the in-memory scan would not scale to months of activity. Buzz-style search
covers conversation, run, and approval in one query. The bundled runtime is
Node 24, which ships `node:sqlite` (SQLite with FTS5) and we do not ship
native npm modules.

## Decision

- **One index file**, `<squadStateDir>/search.sqlite`, opened by
  `server/search/index.mjs` through `node:sqlite`'s `DatabaseSync`. A `docs`
  table holds `{ id, type, title, body, memberId, channelId, runId, route, at }`
  keyed by a stable `id` (`message:<id>`, `run:<id>`, …). An external-content
  FTS5 table (`docs_fts`, unicode61 with diacritics folded) is kept in sync by
  triggers; queries rank with `bm25` (title weighted 4×) and return
  `snippet()` text with `<mark>` around hits. `upsert` is an
  `INSERT … ON CONFLICT DO UPDATE` guarded by a change test, so re-pushing an
  unchanged record writes nothing and idempotence costs one row read.
- **FTS5 is probed at open**, not assumed: if creating a virtual table fails,
  the same `docs` table is queried with `LIKE` per term and the snippet is
  built in JavaScript. The mode is stored in `meta`; opening in a different
  mode (or a new schema version) drops the tables and lets a rebuild
  repopulate them. `AUTOHAND_SEARCH_FTS=0` forces the fallback for diagnosis.
- **Who indexes what.** The bridge indexes what it owns and can watch:
  channels and channel messages from `channels.json` (refreshed on
  `chat.finished` / `mention.received`), and runs from `ctx.runs` including a
  6 kB log tail (refreshed on `run.finished`). The browser owns members, DM
  messages, tasks, handoffs, canvases, and workflow runs, and pushes them to
  `POST /api/search/index` when they change. A rebuild
  (`POST /api/search/rebuild { docs }`) replaces the index with the bridge's
  records plus whatever the caller pushes, so a rebuild with the same inputs
  is a no-op.
- **Results deep-link**, they do not describe: every doc carries the `route`
  of the surface that owns it (`/channels/:id?message=…`,
  `/mission-control?run=…`, `/squad-members/:id/task?task=…`,
  `/inbox?handoff=…`). The route parameter is the highlight contract.
- **UI** stays in the ⌘K palette. `src/lib/search-results.js` groups results
  by a fixed type order, caps each group unless one type is active, merges
  bridge results with the palette's in-memory member/channel matches (local
  wins on id), and keeps the last eight queries in
  `localStorage["autohandSquad.v1.recentSearches"]` behind try/catch.
  `SearchResults.jsx` renders a toggle-chip filter row, divider-separated
  groups, calm rows (icon, title, muted snippet with the hit in semibold), and
  handles ↑/↓/Enter with a capture-phase key listener so it works under cmdk.
- **Budget**: `scripts/check-search.mjs` generates ~50k records, requires a
  two-term query to answer under 100 ms on FTS5 (400 ms on the fallback),
  verifies routes, idempotent upsert and rebuild, persistence across reopen,
  the mode-change reset, and the route plug-in against a fake bridge context.

## Consequences

- Search is lexical (prefix on the last term, all terms required). Semantic
  search and cloud indexing stay out of scope, as the PRD says.
- The index is a cache, never the source of truth: deleting `search.sqlite`
  and rebuilding loses nothing. Messages in `localStorage` become searchable
  only after the app has pushed them once; the integration note asks for one
  batched push on first boot.
- Channel message refresh re-reads `channels.json`; with very large channel
  files this is bounded by the 400 ms coalescing window, not by message count.
- `node:sqlite` is experimental-but-stable in Node 24 (`DatabaseSync`,
  `prepare`, `exec`); the module uses only that surface and was exercised on
  Node 22.23 and 26.7 as well. If a future runtime drops FTS5 the fallback
  keeps the feature alive at LIKE speed.
