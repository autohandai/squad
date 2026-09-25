// Cross-surface search index (ADR-0020). One SQLite file in the app state
// directory holds every searchable record the squad has produced: channel and
// DM messages, channels, members, runs, tasks, handoffs, canvases, and
// workflow runs. Text is matched with FTS5 when the bundled SQLite has it
// (Node 24 ships `node:sqlite` with FTS5 compiled in); otherwise the same
// table is scanned with LIKE so the feature degrades instead of breaking.
//
//   const index = openSearchIndex(squadStateDir);
//   index.upsert({ id: "run:abc", type: "run", title: "Smoke suite", body: "...", route: "/mission-control?run=abc", at });
//   index.query("smoke suite", { types: ["run", "message"], limit: 20 });
//
// Documents are keyed by `id`; upserting the same id twice replaces the row,
// so callers can push what they hold without de-duplicating first.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SEARCH_TYPES = Object.freeze(["message", "channel", "member", "run", "task", "handoff", "canvas", "workflow"]);
export const SEARCH_FILE = "search.sqlite";

const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const MAX_TITLE = 400;
const MAX_BODY = 16_000;
const SNIPPET_TOKENS = 14;
const SNIPPET_CHARS = 140;

const typeSet = new Set(SEARCH_TYPES);

function text(value, max) {
  const out = value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  return max && out.length > max ? out.slice(0, max) : out;
}

function isoTime(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Coerce an arbitrary object into an index document, or return null when it cannot be indexed. */
export function normalizeSearchDoc(input) {
  if (!input || typeof input !== "object") return null;
  const id = text(input.id, 200);
  const type = text(input.type, 32).toLowerCase();
  if (!id || !typeSet.has(type)) return null;
  const title = text(input.title, MAX_TITLE);
  const body = text(input.body, MAX_BODY);
  if (!title && !body) return null;
  return {
    id,
    type,
    title,
    body,
    memberId: text(input.memberId, 120),
    channelId: text(input.channelId, 120),
    runId: text(input.runId, 120),
    route: text(input.route, 600),
    at: isoTime(input.at),
  };
}

/** Split a raw query into lower-cased terms; drops FTS operators and stray quotes. */
export function queryTerms(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/["'`^*:(){}\[\]]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 12);
}

/** FTS5 MATCH expression: every term must appear, the last one may be a prefix. */
function ftsExpression(terms) {
  return terms.map((term, index) => `"${term.replace(/"/g, "")}"${index === terms.length - 1 ? "*" : ""}`).join(" ");
}

/** Plain-text snippet with every term wrapped in <mark>, centred on the first hit. */
export function markSnippet(body, terms, { chars = SNIPPET_CHARS } = {}) {
  const source = text(body, MAX_BODY);
  if (!source) return "";
  const lower = source.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  let start = 0;
  if (first > chars / 3) start = Math.max(0, lower.lastIndexOf(" ", first - Math.floor(chars / 3)) + 1);
  let window = source.slice(start, start + chars);
  if (start + chars < source.length) {
    const cut = window.lastIndexOf(" ");
    if (cut > chars / 2) window = window.slice(0, cut);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = start + window.length < source.length ? "…" : "";
  if (!terms.length) return `${prefix}${window}${suffix}`;
  const pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  return `${prefix}${window.replace(pattern, (hit) => `<mark>${hit}</mark>`)}${suffix}`;
}

function normalizeTypes(types) {
  const list = Array.isArray(types) ? types : String(types || "").split(",");
  return [...new Set(list.map((item) => text(item, 32).toLowerCase()).filter((item) => typeSet.has(item)))];
}

function clampLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(value));
}

function rowToResult(row, snippet, score) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    snippet,
    route: row.route,
    at: row.at,
    score,
    memberId: row.member_id || "",
    channelId: row.channel_id || "",
    runId: row.run_id || "",
  };
}

/**
 * Open (or create) the index at `<stateDir>/search.sqlite`.
 * `fts: false` forces the LIKE fallback; `fts: "auto"` (default) probes FTS5.
 * `stateDir` may be ":memory:" for throwaway indexes.
 */
export function openSearchIndex(stateDir, { fts = "auto" } = {}) {
  const inMemory = stateDir === ":memory:";
  const path = inMemory ? ":memory:" : join(stateDir, SEARCH_FILE);
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");

  let mode = fts === false ? "like" : "fts5";
  if (mode === "fts5") {
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts_probe USING fts5(x); DROP TABLE fts_probe;");
    } catch {
      mode = "like";
    }
  }

  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const meta = (key) => getMeta.get(key)?.value ?? null;

  // A schema or mode change throws the tables away; callers rebuild by
  // pushing what they hold (POST /api/search/rebuild).
  if (meta("schema") !== String(SCHEMA_VERSION) || (meta("mode") && meta("mode") !== mode)) {
    db.exec("DROP TABLE IF EXISTS docs_fts; DROP TRIGGER IF EXISTS docs_ai; DROP TRIGGER IF EXISTS docs_ad; DROP TRIGGER IF EXISTS docs_au; DROP TABLE IF EXISTS docs;");
    setMeta.run("schema", String(SCHEMA_VERSION));
    setMeta.run("mode", mode);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      rowid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      member_id TEXT NOT NULL DEFAULT '',
      channel_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_type_at ON docs (type, at DESC);
    CREATE INDEX IF NOT EXISTS docs_channel ON docs (channel_id);
    CREATE INDEX IF NOT EXISTS docs_run ON docs (run_id);
  `);
  if (mode === "fts5") {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, body, content='docs', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO docs_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
    `);
  }
  setMeta.run("schema", String(SCHEMA_VERSION));
  setMeta.run("mode", mode);

  const upsertStmt = db.prepare(`
    INSERT INTO docs (id, type, title, body, member_id, channel_id, run_id, route, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type, title = excluded.title, body = excluded.body,
      member_id = excluded.member_id, channel_id = excluded.channel_id, run_id = excluded.run_id,
      route = excluded.route, at = excluded.at
    WHERE type IS NOT excluded.type OR title IS NOT excluded.title OR body IS NOT excluded.body
      OR member_id IS NOT excluded.member_id OR channel_id IS NOT excluded.channel_id OR run_id IS NOT excluded.run_id
      OR route IS NOT excluded.route OR at IS NOT excluded.at
  `);
  const removeStmt = db.prepare("DELETE FROM docs WHERE id = ?");
  const countStmt = db.prepare("SELECT type, COUNT(*) AS n FROM docs GROUP BY type");
  const totalStmt = db.prepare("SELECT COUNT(*) AS n FROM docs");
  const getStmt = db.prepare("SELECT * FROM docs WHERE id = ?");

  const ftsQuery = new Map();
  const likeQuery = new Map();

  function preparedFor(cache, typeCount, build) {
    let stmt = cache.get(typeCount);
    if (!stmt) {
      stmt = db.prepare(build(typeCount));
      cache.set(typeCount, stmt);
    }
    return stmt;
  }

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = work();
      db.exec("COMMIT");
      return out;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function writeDoc(doc) {
    const info = upsertStmt.run(doc.id, doc.type, doc.title, doc.body, doc.memberId, doc.channelId, doc.runId, doc.route, doc.at);
    return Number(info.changes) > 0;
  }

  function touch() {
    setMeta.run("updatedAt", new Date().toISOString());
  }

  return {
    path,
    mode,

    /** Insert or replace one document or an array of documents. Returns { indexed, changed, skipped }. */
    upsert(input) {
      const list = (Array.isArray(input) ? input : [input]).map(normalizeSearchDoc);
      const docs = list.filter(Boolean);
      const result = transaction(() => {
        let changed = 0;
        for (const doc of docs) if (writeDoc(doc)) changed += 1;
        if (changed) touch();
        return { indexed: docs.length, changed, skipped: list.length - docs.length };
      });
      return result;
    },

    remove(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map((id) => text(id, 200)).filter(Boolean);
      return transaction(() => {
        let removed = 0;
        for (const id of list) removed += Number(removeStmt.run(id).changes);
        if (removed) touch();
        return { removed };
      });
    },

    get(id) {
      const row = getStmt.get(text(id, 200));
      return row ? rowToResult(row, "", 0) : null;
    },

    /** Replace the whole index with `docs`. Same input, same index: rebuilding twice is a no-op. */
    rebuild(docs) {
      const list = (Array.isArray(docs) ? docs : []).map(normalizeSearchDoc).filter(Boolean);
      const out = transaction(() => {
        db.exec("DELETE FROM docs");
        for (const doc of list) writeDoc(doc);
        const now = new Date().toISOString();
        setMeta.run("rebuiltAt", now);
        setMeta.run("updatedAt", now);
        return { indexed: list.length };
      });
      if (mode === "fts5") db.exec("INSERT INTO docs_fts (docs_fts) VALUES ('optimize')");
      return out;
    },

    /**
     * Search. Returns [{ id, type, title, snippet, route, at, score, memberId, channelId, runId }]
     * ordered by relevance (title hits first) then recency. Snippets carry
     * `<mark>` around every hit; render them as segments, never as HTML.
     */
    query(q, { types = [], limit } = {}) {
      const terms = queryTerms(q);
      if (!terms.length) return [];
      const typeList = normalizeTypes(types);
      const cap = clampLimit(limit);
      const typeClause = typeList.length ? ` AND d.type IN (${typeList.map(() => "?").join(", ")})` : "";

      if (mode === "fts5") {
        const stmt = preparedFor(
          ftsQuery,
          typeList.length,
          () => `
            SELECT d.id, d.type, d.title, d.route, d.at, d.member_id, d.channel_id, d.run_id,
                   bm25(docs_fts, 4.0, 1.0) AS rank,
                   snippet(docs_fts, 1, '<mark>', '</mark>', '…', ${SNIPPET_TOKENS}) AS body_snippet,
                   highlight(docs_fts, 0, '<mark>', '</mark>') AS title_hit
            FROM docs_fts
            JOIN docs d ON d.rowid = docs_fts.rowid
            WHERE docs_fts MATCH ?${typeClause}
            ORDER BY rank, d.at DESC
            LIMIT ?
          `
        );
        let rows;
        try {
          rows = stmt.all(ftsExpression(terms), ...typeList, cap);
        } catch {
          rows = [];
        }
        return rows.map((row) => {
          const snippet = row.body_snippet && row.body_snippet.includes("<mark>") ? row.body_snippet : row.title_hit?.includes("<mark>") ? row.title_hit : row.body_snippet || row.title;
          const score = Number.isFinite(row.rank) ? Number((-row.rank).toPrecision(6)) : 0;
          return rowToResult(row, snippet, score);
        });
      }

      const stmt = preparedFor(
        likeQuery,
        `${typeList.length}:${terms.length}`,
        () => `
          SELECT d.id, d.type, d.title, d.body, d.route, d.at, d.member_id, d.channel_id, d.run_id,
                 (${terms.map(() => "(CASE WHEN d.title LIKE ? THEN 4 ELSE 0 END)").join(" + ")}) AS title_score
          FROM docs d
          WHERE ${terms.map(() => "(d.title LIKE ? OR d.body LIKE ?)").join(" AND ")}${typeClause}
          ORDER BY title_score DESC, d.at DESC
          LIMIT ?
        `
      );
      const patterns = terms.map((term) => `%${term.replace(/[%_\\]/g, "\\$&")}%`);
      const params = [...patterns, ...patterns.flatMap((pattern) => [pattern, pattern]), ...typeList, cap];
      const rows = stmt.all(...params);
      return rows.map((row) => {
        const bodyHit = terms.some((term) => row.body.toLowerCase().includes(term));
        const snippet = bodyHit ? markSnippet(row.body, terms) : markSnippet(row.title, terms);
        return rowToResult(row, snippet, Number(row.title_score) + 1);
      });
    },

    stats() {
      const byType = {};
      for (const row of countStmt.all()) byType[row.type] = Number(row.n);
      return {
        path,
        mode,
        total: Number(totalStmt.get()?.n || 0),
        byType,
        updatedAt: meta("updatedAt"),
        rebuiltAt: meta("rebuiltAt"),
      };
    },

    close() {
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}
