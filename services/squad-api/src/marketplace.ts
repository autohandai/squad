// The agent marketplace (ADR-0246, docs/integration/marketplace.md).
//
// Listings live in their own D1 database (MARKETPLACE). Public reads need no
// account and are cacheable; publishing needs a Squad session, and team
// publishing a current Autohand owner/admin role with full write access.
// Admin moderation is reached only by the website's admin functions, with a
// separate bearer secret and the admin's email for the audit trail.
import { z } from "zod";
import type { Env } from "./env.js";
import { authenticate, type Principal } from "./auth.js";
import { ApiError, body, digest, equalSecret, ok, requireValue } from "./http.js";
import { accessOwner, availableOwners } from "./owners.js";
import {
  ATTRIBUTION_ID, AUTOHAND_CREATOR_NAME, CATEGORIES, CATEGORY_IDS, LISTING_ID, REPORT_REASON_IDS, TEAM_TEMPLATE_LIMITS, TEMPLATE_LIMITS,
  categoryLabel, contentHash, listingSummary, randomListingId, validateListingInput, validateListingTemplate,
  type TeamDocument,
} from "../../../src/lib/marketplace.js";

type DB = D1Database;
interface ListingRow {
  id: string; publisher_id: string; kind: string; members: number; faces: string; name: string; role: string; tagline: string; description: string; category: string; tags: string; bird: string;
  creator_kind: string; creator_name: string; version: number; content_hash: string; bytes: number; skills: number; has_memory: number;
  status: string; featured: number; featured_rank: number; adds: number; views: number; add_clicks: number; installs: number;
  created_at: string; updated_at: string; moderated_at: string | null; moderation_reason: string;
}
type ListingKind = "agent" | "team";
interface PublisherRow { id: string; kind: string; issuer: string; subject: string; display_name: string }

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const LISTING_COLUMNS = "id,publisher_id,kind,members,faces,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,version,content_hash,bytes,skills,has_memory,status,featured,featured_rank,adds,views,add_clicks,installs,created_at,updated_at,moderated_at,moderation_reason";
const MAX_REQUEST = TEAM_TEMPLATE_LIMITS.bytes * 2 + 32 * 1024;
const REPORT_HIDE_THRESHOLD = 5;
const FEATURED_LIMIT = 12;
const ATTRIBUTION_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * The public face of a listing's installs (ADR-0248): nothing under ten,
 * then a floor ("10+", "50+", "100+", "500+", "1k+", "5k+"). Exact counts
 * are for admins; a small exact number invites gaming and says little.
 */
export function installsLabel(installs: number): string {
  for (const [floor, label] of [[5000, "5k+"], [1000, "1k+"], [500, "500+"], [100, "100+"], [50, "50+"], [10, "10+"]] as const) if (installs >= floor) return label;
  return "";
}

export function publicListing(row: ListingRow) {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags); } catch { tags = []; }
  let faces: string[] = [];
  try { faces = row.kind === "team" ? JSON.parse(row.faces || "[]") : []; } catch { faces = []; }
  return {
    id: row.id, kind: row.kind === "team" ? "team" : "agent", members: row.members || 1, name: row.name, role: row.role, tagline: row.tagline, description: row.description,
    category: row.category, categoryLabel: categoryLabel(row.category), tags, bird: row.bird, ...(row.kind === "team" ? { faces } : {}),
    creator: { kind: row.creator_kind, name: row.creator_name },
    version: row.version, contentHash: row.content_hash, bytes: row.bytes, skills: row.skills, hasMemory: row.has_memory === 1,
    featured: row.featured === 1, installsLabel: installsLabel(row.installs || 0), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
const adminListing = (row: ListingRow & { open_reports?: number; attributed?: number }) => ({
  ...publicListing(row), status: row.status, moderatedAt: row.moderated_at, moderationReason: row.moderation_reason, openReports: Number(row.open_reports || 0),
  featuredRank: row.featured_rank, adds: row.adds, stats: { views: row.views, addClicks: row.add_clicks, downloads: row.adds, installs: row.installs, attributedInstalls: Number(row.attributed || 0) },
});

function cached(data: unknown, etag?: string, request?: Request): Response {
  const headers: Record<string, string> = { "cache-control": PUBLIC_CACHE };
  if (etag) {
    headers.etag = etag;
    if (request?.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return ok(data, 200, headers);
}

const encodeCursor = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeCursor<T>(value: string | null, schema: z.ZodType<T>): T | null {
  if (!value) return null;
  requireValue(value.length <= 400, 400, "cursor_invalid", "This page cursor is not valid.");
  try {
    const parsed = schema.safeParse(JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
    requireValue(parsed.success, 400, "cursor_invalid", "This page cursor is not valid.");
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "cursor_invalid", "This page cursor is not valid.");
  }
}

function searchTerms(q: string | null): string[] {
  return (q || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120).split(" ").filter(Boolean).slice(0, 6);
}
const like = (term: string) => `%${term.replace(/[\\%_]/g, character => `\\${character}`)}%`;

export function searchText(fields: { name: string; role: string; tagline: string; creatorName: string; tags: string[]; category: string; members?: Array<{ name: string; role: string }> }): string {
  const team = fields.members?.length ? ["team", ...fields.members.flatMap(member => [member.name, member.role])] : [];
  return [fields.name, fields.role, fields.tagline, fields.creatorName, ...fields.tags, categoryLabel(fields.category), fields.category, ...team].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

async function networkBucket(request: Request, scope: string, windowMs: number): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  return digest(`${scope}:${ip}:${windowMs ? Math.floor(Date.now() / windowMs) : "all"}`);
}

/** Count one hit in a bucket; refuse when it is full. No IP is ever stored. */
async function limit(db: DB, bucket: string, max: number, windowMs: number, message: string): Promise<void> {
  const result = await db.prepare(`INSERT INTO rate_limits(bucket,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?`).bind(bucket, new Date(Date.now() + windowMs).toISOString(), max).run();
  requireValue(result.meta.changes, 429, "rate_limited", message);
}

const audit = (db: DB, actorKind: string, actor: string, action: string, listingId = "", detail = "") =>
  db.prepare("INSERT INTO audit(at,actor_kind,actor,action,listing_id,detail) VALUES (?,?,?,?,?,?)").bind(new Date().toISOString(), actorKind, actor, action, listingId, detail.slice(0, 500));

async function listingRow(db: DB, id: string): Promise<ListingRow | null> {
  requireValue(LISTING_ID.test(id), 404, "listing_not_found", "This agent is not in the marketplace.");
  return db.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE id=?`).bind(id).first<ListingRow>();
}
async function publishedRow(db: DB, id: string): Promise<ListingRow> {
  const row = await listingRow(db, id);
  requireValue(row && row.status === "published", 404, "listing_not_found", "This agent is not in the marketplace.");
  return row;
}
async function versionDocument(db: DB, id: string, version: number): Promise<{ document: TeamDocument; hash: string; createdAt: string }> {
  const row = await db.prepare("SELECT document,content_hash,created_at FROM listing_versions WHERE listing_id=? AND version=?").bind(id, version).first<{ document: string | null; content_hash: string; created_at: string }>();
  requireValue(row && row.document, 404, "version_not_found", "That version of this agent is not available.");
  const document = JSON.parse(row.document) as TeamDocument;
  // Stored bytes are re-hashed on the way out: a corrupted row is refused, never served.
  requireValue(await contentHash(document) === row.content_hash, 503, "template_integrity", "This agent's stored template failed its integrity check.");
  return { document, hash: row.content_hash, createdAt: row.created_at };
}

// --- public ------------------------------------------------------------------

const listQuery = z.object({
  q: z.string().max(200).optional(), category: z.enum(CATEGORY_IDS as [string, ...string[]]).optional(), kind: z.enum(["agent", "team", "all"]).default("agent"),
  creator: z.enum(["autohand", "user", "team"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(24), cursor: z.string().optional(),
});
const listCursor = z.object({ f: z.number().int().min(0).max(1), c: z.string().max(40), i: z.string().regex(LISTING_ID) }).strict();

async function listPublic(request: Request, env: Env, url: URL): Promise<Response> {
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  requireValue(parsed.success, 400, "invalid_query", "Use q, category, creator, limit and cursor.");
  const query = parsed.data;
  // Without `kind` a list holds agents only, as clients before team templates expect.
  const where = ["status='published'"]; const params: unknown[] = [];
  if (query.kind !== "all") { where.push("kind=?"); params.push(query.kind); }
  if (query.category) { where.push("category=?"); params.push(query.category); }
  if (query.creator) { where.push("creator_kind=?"); params.push(query.creator); }
  for (const term of searchTerms(query.q || null)) { where.push("search_text LIKE ? ESCAPE '\\'"); params.push(like(term)); }
  const total = (await env.MARKETPLACE.prepare(`SELECT count(*) AS n FROM listings WHERE ${where.join(" AND ")}`).bind(...params).first<{ n: number }>())?.n || 0;
  const cursor = decodeCursor(query.cursor || null, listCursor);
  const page = [...where]; const pageParams = [...params];
  if (cursor) {
    page.push("(featured<? OR (featured=? AND (created_at<? OR (created_at=? AND id<?))))");
    pageParams.push(cursor.f, cursor.f, cursor.c, cursor.c, cursor.i);
  }
  const rows = (await env.MARKETPLACE.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE ${page.join(" AND ")} ORDER BY featured DESC, created_at DESC, id DESC LIMIT ?`)
    .bind(...pageParams, query.limit + 1).all<ListingRow>()).results;
  const more = rows.length > query.limit; const shown = rows.slice(0, query.limit); const last = shown.at(-1);
  return cached({ agents: shown.map(publicListing), total, nextCursor: more && last ? encodeCursor({ f: last.featured, c: last.created_at, i: last.id }) : null });
}

async function categoryCounts(env: Env) {
  const rows = (await env.MARKETPLACE.prepare("SELECT category, kind, count(*) AS n FROM listings WHERE status='published' GROUP BY category, kind").all<{ category: string; kind: string; n: number }>()).results;
  const agents = new Map<string, number>(); const teams = new Map<string, number>();
  for (const row of rows) (row.kind === "team" ? teams : agents).set(row.category, row.n);
  const autohand = (await env.MARKETPLACE.prepare("SELECT count(*) AS n FROM listings WHERE status='published' AND kind='agent' AND creator_kind='autohand'").first<{ n: number }>())?.n || 0;
  return {
    // `count` and `total` are agents, as before team templates; teams are counted apart.
    categories: CATEGORIES.map(category => ({ ...category, count: agents.get(category.id) || 0, teams: teams.get(category.id) || 0 })),
    total: [...agents.values()].reduce((sum, n) => sum + n, 0),
    teams: [...teams.values()].reduce((sum, n) => sum + n, 0),
    autohand,
  };
}

async function categories(env: Env): Promise<Response> {
  return cached(await categoryCounts(env));
}

async function featuredRows(env: Env): Promise<ListingRow[]> {
  return (await env.MARKETPLACE.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE status='published' AND featured=1 ORDER BY featured_rank=0, featured_rank, updated_at DESC, id LIMIT ?`).bind(FEATURED_LIMIT).all<ListingRow>()).results;
}

/** The curated featured row, agents and teams, in the admins' order. */
async function featured(env: Env): Promise<Response> {
  return cached({ featured: (await featuredRows(env)).map(publicListing) });
}

const homeQuery = z.object({ per: z.coerce.number().int().min(1).max(12).default(6) });
/**
 * Everything the marketplace's first screen shows in one read: the featured
 * row, the categories with their first agents (featured first, then newest),
 * and the team templates. Each surface then pages with /agents.
 */
async function home(env: Env, url: URL): Promise<Response> {
  const parsed = homeQuery.safeParse(Object.fromEntries(url.searchParams));
  requireValue(parsed.success, 400, "invalid_query", "Use per (1 to 12).");
  const per = parsed.data.per;
  const counts = await categoryCounts(env);
  const sectionSql = `SELECT ${LISTING_COLUMNS} FROM listings WHERE status='published' AND kind='agent' AND category=? ORDER BY featured DESC, created_at DESC, id DESC LIMIT ?`;
  const [sections, teams] = await Promise.all([
    env.MARKETPLACE.batch(CATEGORIES.map(category => env.MARKETPLACE.prepare(sectionSql).bind(category.id, per))),
    env.MARKETPLACE.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE status='published' AND kind='team' ORDER BY featured DESC, featured_rank=0, featured_rank, created_at DESC, id DESC LIMIT ?`).bind(Math.max(per, 6)).all<ListingRow>(),
  ]);
  return cached({
    featured: (await featuredRows(env)).map(publicListing),
    sections: counts.categories.map((category, index) => ({ ...category, agents: ((sections[index].results || []) as ListingRow[]).map(publicListing) })),
    teams: teams.results.map(publicListing),
    total: counts.total, teamsTotal: counts.teams, autohand: counts.autohand,
  });
}

async function detail(request: Request, env: Env, id: string): Promise<Response> {
  const row = await publishedRow(env.MARKETPLACE, id);
  const { document } = await versionDocument(env.MARKETPLACE, id, row.version);
  const summary = listingSummary(row.kind, document);
  const versions = (await env.MARKETPLACE.prepare("SELECT version,content_hash AS contentHash,note,created_at AS createdAt FROM listing_versions WHERE listing_id=? AND document IS NOT NULL ORDER BY version DESC LIMIT 20").bind(id).all()).results;
  const preview = row.kind === "team"
    ? { members: summary.members, channels: summary.channels, skills: summary.skills, hasMemory: summary.hasMemory, lead: document.team?.lead || "" }
    : { instructions: summary.instructions, brainCard: summary.brainCard, skills: summary.skills, hasMemory: summary.hasMemory };
  return cached({ agent: publicListing(row), preview, versions },
    `"${row.id}-${row.version}-${row.content_hash.slice(0, 16)}"`, request);
}

async function template(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const row = await publishedRow(env.MARKETPLACE, id);
  const requested = url.searchParams.get("version");
  const version = requested === null ? row.version : Number(requested);
  requireValue(Number.isInteger(version) && version >= 1 && version <= row.version, 400, "version_invalid", "Ask for a published version of this agent.");
  await limit(env.MARKETPLACE, await networkBucket(request, "template", 600_000), 60, 600_000, "Too many agents added from this network. Try again in a few minutes.");
  const { document, hash, createdAt } = await versionDocument(env.MARKETPLACE, id, version);
  const day = await networkBucket(request, `add:${id}`, DAY_MS);
  const counted = await env.MARKETPLACE.prepare("INSERT OR IGNORE INTO listing_adds(listing_id,bucket,expires_at) VALUES (?,?,?)").bind(id, day, new Date(Date.now() + DAY_MS).toISOString()).run();
  if (counted.meta.changes) {
    await env.MARKETPLACE.batch([
      env.MARKETPLACE.prepare("UPDATE listings SET adds=adds+1 WHERE id=?").bind(id),
      dailyStat(env.MARKETPLACE, id, "downloads"),
    ]);
  }
  return ok({ agent: publicListing(row), version, versionCreatedAt: createdAt, contentHash: hash, document });
}

// --- events (ADR-0248) ----------------------------------------------------------

export const EVENT_TYPES = ["view", "add_click", "install"] as const;
export const EVENT_SOURCES = ["website", "website-link", "in-app", "link", "grok"] as const;
const COUNTER = { view: "views", add_click: "add_clicks", install: "installs" } as const;
const dayOf = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);
const dailyStat = (db: DB, id: string, column: "views" | "add_clicks" | "downloads" | "installs") =>
  db.prepare(`INSERT INTO listing_stats(listing_id,day,${column}) VALUES (?,?,1) ON CONFLICT(listing_id,day) DO UPDATE SET ${column}=${column}+1`).bind(id, dayOf());

const eventInput = z.object({
  type: z.enum(EVENT_TYPES),
  source: z.enum(EVENT_SOURCES).default("website"),
  attribution: z.string().regex(ATTRIBUTION_ID).optional(),
  version: z.number().int().positive().max(9_999_999).optional(),
}).strict();

/**
 * One anonymous listing event: a page view or Add click from the website,
 * or a confirmed install from Squad. Counted once per network per listing per
 * type per day, so the numbers mean networks, not reloads. An Add click may
 * carry an attribution id; the install that follows from the link carries the
 * same id, which joins the two for 30 days and is then deleted. Nothing about
 * the person is stored: the bucket is a hash of the network and the day.
 */
async function listingEvent(request: Request, env: Env, id: string): Promise<Response> {
  const input = await body(request, eventInput, 2 * 1024);
  const row = await publishedRow(env.MARKETPLACE, id);
  await limit(env.MARKETPLACE, await networkBucket(request, "events", 600_000), 120, 600_000, "Too many marketplace events from this network.");
  const bucket = await networkBucket(request, `event:${input.type}:${id}`, DAY_MS);
  const now = new Date();
  const seen = await env.MARKETPLACE.prepare("INSERT OR IGNORE INTO listing_event_seen(listing_id,type,bucket,expires_at) VALUES (?,?,?,?)").bind(id, input.type, bucket, new Date(now.getTime() + DAY_MS).toISOString()).run();
  const statements = [];
  if (seen.meta.changes) {
    statements.push(env.MARKETPLACE.prepare(`UPDATE listings SET ${COUNTER[input.type]}=${COUNTER[input.type]}+1 WHERE id=?`).bind(id));
    statements.push(dailyStat(env.MARKETPLACE, id, COUNTER[input.type]));
  }
  if (input.attribution && input.type === "add_click") {
    statements.push(env.MARKETPLACE.prepare("INSERT OR IGNORE INTO attributions(id,listing_id,clicked_at,expires_at) VALUES (?,?,?,?)")
      .bind(input.attribution, id, now.toISOString(), new Date(now.getTime() + ATTRIBUTION_DAYS * DAY_MS).toISOString()));
  }
  if (input.attribution && input.type === "install") {
    statements.push(env.MARKETPLACE.prepare("UPDATE attributions SET installed_at=?,install_source=? WHERE id=? AND listing_id=? AND installed_at IS NULL")
      .bind(now.toISOString(), input.source, input.attribution, id));
  }
  if (statements.length) await env.MARKETPLACE.batch(statements);
  return ok({ received: true, counted: Boolean(seen.meta.changes), listing: row.id }, 202);
}

async function report(request: Request, env: Env, id: string): Promise<Response> {
  const row = await publishedRow(env.MARKETPLACE, id);
  const input = await body(request, z.object({ reason: z.enum(REPORT_REASON_IDS as [string, ...string[]]), details: z.string().trim().max(1000).default("") }).strict(), 8 * 1024);
  await limit(env.MARKETPLACE, await networkBucket(request, "report", 3_600_000), 10, 3_600_000, "Too many reports from this network. Try again later.");
  const reporter = await networkBucket(request, "reporter", 0);
  const inserted = await env.MARKETPLACE.prepare("INSERT OR IGNORE INTO reports(id,listing_id,reason,details,reporter,created_at) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), id, input.reason, input.details, reporter, new Date().toISOString()).run();
  if (inserted.meta.changes) {
    await audit(env.MARKETPLACE, "public", reporter.slice(0, 12), "report.created", id, input.reason).run();
    const open = (await env.MARKETPLACE.prepare("SELECT count(DISTINCT reporter) AS n FROM reports WHERE listing_id=? AND status='open'").bind(id).first<{ n: number }>())?.n || 0;
    if (open >= REPORT_HIDE_THRESHOLD && row.status === "published") {
      await env.MARKETPLACE.batch([
        env.MARKETPLACE.prepare("UPDATE listings SET status='hidden',moderated_at=?,moderation_reason=? WHERE id=? AND status='published'").bind(new Date().toISOString(), `Hidden after ${open} reports, pending review.`, id),
        audit(env.MARKETPLACE, "system", "reports", "listing.hidden", id, `${open} open reports`),
      ]);
    }
  }
  return ok({ received: true }, 202);
}

// --- publishers ----------------------------------------------------------------

const ownerInput = z.discriminatedUnion("kind", [z.object({ kind: z.literal("user") }).strict(), z.object({ kind: z.literal("team"), id: z.string().min(1).max(256) }).strict()]);
const publishInput = z.object({ owner: ownerInput, kind: z.enum(["agent", "team"]).default("agent"), listing: z.unknown(), document: z.unknown(), creatorName: z.string().trim().max(60).optional(), note: z.string().trim().max(TEMPLATE_LIMITS.note).default("") }).strict();
// A listing's kind is fixed when it is first published.
const updateInput = publishInput.omit({ owner: true, kind: true }).extend({ baseVersion: z.number().int().positive() }).strict();

function publicName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 60);
  return name && !name.includes("@") ? name : "";
}

interface Authority { publisher: Omit<PublisherRow, "id"> & { id?: string }; actor: string; actorKind: "user" | "team" }

async function authority(request: Request, env: Env, user: Principal, owner: z.infer<typeof ownerInput>, creatorName?: string): Promise<Authority> {
  if (owner.kind === "user") {
    const name = publicName(creatorName || "") || publicName(user.displayName);
    requireValue(name, 400, "creator_name_required", "Choose the name shown as this agent's creator. It cannot be an email address.");
    return { publisher: { kind: "user", issuer: user.issuer, subject: user.subject, display_name: name }, actor: user.id, actorKind: "user" };
  }
  const access = await accessOwner(request, env, user, owner.id, true);
  requireValue(access.role === "owner" || access.role === "admin", 403, "team_publish_forbidden", "Only an owner or admin of this Autohand team can publish for it.");
  return { publisher: { kind: "team", issuer: user.issuer, subject: owner.id, display_name: publicName(access.label) || "Autohand team" }, actor: user.id, actorKind: "team" };
}

async function publisherId(db: DB, publisher: Authority["publisher"]): Promise<string> {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO publishers(id,kind,issuer,subject,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(kind,issuer,subject) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), publisher.kind, publisher.issuer, publisher.subject, publisher.display_name, now, now).run();
  const row = await db.prepare("SELECT id FROM publishers WHERE kind=? AND issuer=? AND subject=?").bind(publisher.kind, publisher.issuer, publisher.subject).first<{ id: string }>();
  requireValue(row, 503, "publisher_unavailable", "The publisher could not be recorded.");
  return row.id;
}

/** A team's member birds, lead first, for rows that show the team's faces. */
export const teamFaces = (members: Array<{ bird: string; lead: boolean }>) => [...members].sort((a, b) => Number(b.lead) - Number(a.lead)).map(member => member.bird).filter(Boolean).slice(0, 8);

async function checkedContent(kind: ListingKind, listing: unknown, document: unknown) {
  const fields = validateListingInput(listing);
  if (!fields.ok) throw new ApiError(400, "listing_invalid", fields.error);
  const template = validateListingTemplate(kind, document);
  if (!template.ok) throw new ApiError(400, template.code, template.error, template.findings);
  const hash = await contentHash(template.document);
  const summary = listingSummary(kind, template.document);
  return { kind, fields: fields.listing, document: template.document, bytes: template.bytes, hash, summary, members: kind === "team" ? summary.members.length : 1, faces: JSON.stringify(teamFaces(summary.members)) };
}

async function publishLimits(env: Env, user: Principal) {
  await limit(env.MARKETPLACE, await digest(`publish-hour:${user.id}:${Math.floor(Date.now() / 3_600_000)}`), 5, 3_600_000, "You can publish five times an hour. Try again later.");
  await limit(env.MARKETPLACE, await digest(`publish-day:${user.id}:${Math.floor(Date.now() / 86_400_000)}`), 20, 86_400_000, "You can publish twenty times a day. Try again tomorrow.");
}

async function idempotency(request: Request, env: Env, user: Principal, requestHash: string) {
  const key = request.headers.get("idempotency-key") || "";
  requireValue(/^[a-zA-Z0-9._:-]{1,128}$/.test(key), 400, "idempotency_required", "Provide an Idempotency-Key for each publish.");
  const saved = await env.MARKETPLACE.prepare("SELECT request_hash,listing_id FROM publish_receipts WHERE actor=? AND idempotency_key=?").bind(user.id, key).first<{ request_hash: string; listing_id: string }>();
  if (saved) requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another publish.");
  return { key, replay: saved?.listing_id || "" };
}

async function publish(request: Request, env: Env, user: Principal): Promise<Response> {
  const input = await body(request, publishInput, MAX_REQUEST, 60_000);
  const content = await checkedContent(input.kind, input.listing, input.document);
  const who = await authority(request, env, user, input.owner, input.creatorName);
  const requestHash = await digest(JSON.stringify({ owner: input.owner, kind: input.kind, fields: content.fields, hash: content.hash, creator: who.publisher.display_name, note: input.note }));
  const receipt = await idempotency(request, env, user, requestHash);
  if (receipt.replay) return ok({ agent: publicListing((await listingRow(env.MARKETPLACE, receipt.replay))!) });
  await publishLimits(env, user);
  const publisher = await publisherId(env.MARKETPLACE, who.publisher);
  const now = new Date().toISOString();
  const name = content.summary.name; const role = content.summary.role;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = randomListingId();
    try {
      await env.MARKETPLACE.batch([
        env.MARKETPLACE.prepare(`INSERT INTO listings(id,publisher_id,kind,members,faces,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,search_text,version,content_hash,bytes,skills,has_memory,status,featured,adds,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'published',0,0,?,?,?)`)
          .bind(id, publisher, content.kind, content.members, content.faces, name, role, content.fields.tagline, content.fields.description, content.fields.category, JSON.stringify(content.fields.tags), content.summary.bird,
            who.publisher.kind, who.publisher.display_name,
            searchText({ name, role, tagline: content.fields.tagline, creatorName: who.publisher.display_name, tags: content.fields.tags, category: content.fields.category, members: content.summary.members }),
            content.hash, content.bytes, content.summary.skills.length, content.summary.hasMemory ? 1 : 0, user.id, now, now),
        env.MARKETPLACE.prepare("INSERT INTO listing_versions(listing_id,version,document,content_hash,bytes,note,created_by,created_at) VALUES (?,1,?,?,?,?,?,?)").bind(id, JSON.stringify(content.document), content.hash, content.bytes, input.note, user.id, now),
        env.MARKETPLACE.prepare("INSERT INTO publish_receipts(actor,idempotency_key,request_hash,listing_id,version,created_at) VALUES (?,?,?,?,1,?)").bind(user.id, receipt.key, requestHash, id, now),
        audit(env.MARKETPLACE, who.actorKind, user.id, "listing.published", id, `v1 ${content.hash.slice(0, 12)}`),
      ]);
      return ok({ agent: publicListing((await listingRow(env.MARKETPLACE, id))!) }, 201);
    } catch (error) {
      // Concurrent retries of one key: the first commits, the rest replay it.
      const saved = await env.MARKETPLACE.prepare("SELECT request_hash,listing_id FROM publish_receipts WHERE actor=? AND idempotency_key=?").bind(user.id, receipt.key).first<{ request_hash: string; listing_id: string }>();
      if (saved) {
        requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another publish.");
        return ok({ agent: publicListing((await listingRow(env.MARKETPLACE, saved.listing_id))!) });
      }
      if (!String(error).includes("UNIQUE")) throw error;
    }
  }
  throw new ApiError(503, "publish_unavailable", "The agent could not be published. Try again.");
}

async function ownedListing(request: Request, env: Env, user: Principal, id: string): Promise<{ row: ListingRow; who: Authority }> {
  const row = await listingRow(env.MARKETPLACE, id);
  requireValue(row && row.status !== "removed", 404, "listing_not_found", "This agent is not in the marketplace.");
  const publisher = await env.MARKETPLACE.prepare("SELECT id,kind,issuer,subject,display_name FROM publishers WHERE id=?").bind(row.publisher_id).first<PublisherRow>();
  requireValue(publisher, 404, "listing_not_found", "This agent is not in the marketplace.");
  requireValue(publisher.kind !== "autohand", 403, "listing_forbidden", "Autohand's own agents are changed through the seed process.");
  if (publisher.kind === "user") {
    requireValue(publisher.issuer === user.issuer && publisher.subject === user.subject, 404, "listing_not_found", "This agent is not in the marketplace.");
    return { row, who: { publisher, actor: user.id, actorKind: "user" } };
  }
  return { row, who: await authority(request, env, user, { kind: "team", id: publisher.subject }) };
}

async function update(request: Request, env: Env, user: Principal, id: string): Promise<Response> {
  const input = await body(request, updateInput, MAX_REQUEST, 60_000);
  const { row, who } = await ownedListing(request, env, user, id);
  requireValue(row.status !== "hidden", 403, "listing_moderated", "This agent was hidden by a moderator and cannot be changed. Contact Autohand support.");
  const content = await checkedContent(row.kind === "team" ? "team" : "agent", input.listing, input.document);
  const creator = who.publisher.kind === "user" ? (publicName(input.creatorName || "") || row.creator_name) : who.publisher.display_name;
  const requestHash = await digest(JSON.stringify({ id, base: input.baseVersion, fields: content.fields, hash: content.hash, creator, note: input.note }));
  const receipt = await idempotency(request, env, user, requestHash);
  if (receipt.replay) return ok({ agent: publicListing((await listingRow(env.MARKETPLACE, id))!) });
  requireValue(row.version === input.baseVersion, 409, "version_conflict", "This agent changed since you opened it. Reload it before publishing again.");
  await publishLimits(env, user);
  const next = row.version + 1; const now = new Date().toISOString();
  const name = content.summary.name; const role = content.summary.role;
  try {
    await env.MARKETPLACE.batch([
      env.MARKETPLACE.prepare("INSERT INTO listing_versions(listing_id,version,document,content_hash,bytes,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, next, JSON.stringify(content.document), content.hash, content.bytes, input.note, user.id, now),
      env.MARKETPLACE.prepare(`UPDATE listings SET name=?,role=?,members=?,faces=?,tagline=?,description=?,category=?,tags=?,bird=?,creator_name=?,search_text=?,version=?,content_hash=?,bytes=?,skills=?,has_memory=?,status='published',updated_at=? WHERE id=? AND version=?`)
        .bind(name, role, content.members, content.faces, content.fields.tagline, content.fields.description, content.fields.category, JSON.stringify(content.fields.tags), content.summary.bird, creator,
          searchText({ name, role, tagline: content.fields.tagline, creatorName: creator, tags: content.fields.tags, category: content.fields.category, members: content.summary.members }),
          next, content.hash, content.bytes, content.summary.skills.length, content.summary.hasMemory ? 1 : 0, now, id, input.baseVersion),
      env.MARKETPLACE.prepare("INSERT INTO publish_receipts(actor,idempotency_key,request_hash,listing_id,version,created_at) VALUES (?,?,?,?,?,?)").bind(user.id, receipt.key, requestHash, id, next, now),
      audit(env.MARKETPLACE, who.actorKind, user.id, "listing.updated", id, `v${next} ${content.hash.slice(0, 12)}`),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY")) throw new ApiError(409, "version_conflict", "This agent changed since you opened it. Reload it before publishing again.");
    throw error;
  }
  return ok({ agent: publicListing((await listingRow(env.MARKETPLACE, id))!) });
}

async function unpublish(request: Request, env: Env, user: Principal, id: string): Promise<Response> {
  const { row, who } = await ownedListing(request, env, user, id);
  if (row.status === "published") {
    await env.MARKETPLACE.batch([
      env.MARKETPLACE.prepare("UPDATE listings SET status='unpublished',updated_at=? WHERE id=? AND status='published'").bind(new Date().toISOString(), id),
      audit(env.MARKETPLACE, who.actorKind, user.id, "listing.unpublished", id),
    ]);
  }
  return ok({ id, status: row.status === "published" ? "unpublished" : row.status });
}

async function mine(request: Request, env: Env, user: Principal): Promise<Response> {
  const subjects: Array<[string, string]> = [["user", user.subject]];
  if (request.headers.get("x-autohand-identity")) {
    for (const owner of await availableOwners(request, env, user)) {
      if (owner.owner.kind === "team" && (owner.role === "owner" || owner.role === "admin") && owner.canWrite) subjects.push(["team", owner.owner.id]);
    }
  }
  const clauses = subjects.map(() => "(p.kind=? AND p.subject=?)").join(" OR ");
  const rows = (await env.MARKETPLACE.prepare(`SELECT l.${LISTING_COLUMNS.split(",").join(",l.")} FROM listings l JOIN publishers p ON p.id=l.publisher_id
    WHERE p.issuer=? AND (${clauses}) AND l.status<>'removed' ORDER BY l.updated_at DESC LIMIT 200`).bind(user.issuer, ...subjects.flat()).all<ListingRow>()).results;
  return ok({ agents: rows.map(row => ({ ...publicListing(row), status: row.status, moderationReason: row.moderation_reason })) });
}

// --- admin ---------------------------------------------------------------------

async function admin(request: Request, env: Env): Promise<string> {
  const secret = env.MARKETPLACE_ADMIN_TOKEN || "";
  requireValue(secret.length >= 32, 503, "admin_unconfigured", "Marketplace administration is not configured.");
  const presented = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] || "";
  requireValue(presented && await equalSecret(presented, secret), 401, "admin_required", "Marketplace administration requires the admin credential.");
  const actor = (request.headers.get("x-marketplace-admin") || "").trim().toLowerCase();
  requireValue(/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(actor), 400, "admin_actor_required", "Name the admin acting, for the audit trail.");
  return actor;
}

const adminCursor = z.object({ u: z.string().max(40), i: z.string().regex(LISTING_ID) }).strict();
async function adminList(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") || "all";
  requireValue(["all", "published", "unpublished", "hidden", "removed"].includes(status), 400, "invalid_query", "Unknown status.");
  const where: string[] = []; const params: unknown[] = [];
  if (status !== "all") { where.push("l.status=?"); params.push(status); }
  for (const term of searchTerms(url.searchParams.get("q"))) { where.push("l.search_text LIKE ? ESCAPE '\\'"); params.push(like(term)); }
  if (url.searchParams.get("reported") === "1") where.push("EXISTS (SELECT 1 FROM reports r WHERE r.listing_id=l.id AND r.status='open')");
  if (url.searchParams.get("featured") === "1") where.push("l.featured=1");
  const kind = url.searchParams.get("kind");
  if (kind === "agent" || kind === "team") { where.push("l.kind=?"); params.push(kind); }
  const cursor = decodeCursor(url.searchParams.get("cursor"), adminCursor);
  const total = (await env.MARKETPLACE.prepare(`SELECT count(*) AS n FROM listings l ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).bind(...params).first<{ n: number }>())?.n || 0;
  if (cursor) { where.push("(l.updated_at<? OR (l.updated_at=? AND l.id<?))"); params.push(cursor.u, cursor.u, cursor.i); }
  const rows = (await env.MARKETPLACE.prepare(`SELECT l.${LISTING_COLUMNS.split(",").join(",l.")},(SELECT count(*) FROM reports r WHERE r.listing_id=l.id AND r.status='open') AS open_reports,
    (SELECT count(*) FROM attributions a WHERE a.listing_id=l.id AND a.installed_at IS NOT NULL) AS attributed
    FROM listings l ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.updated_at DESC, l.id DESC LIMIT 51`).bind(...params).all<ListingRow & { open_reports: number; attributed: number }>()).results;
  const shown = rows.slice(0, 50); const last = shown.at(-1);
  return ok({ agents: shown.map(adminListing), total, nextCursor: rows.length > 50 && last ? encodeCursor({ u: last.updated_at, i: last.id }) : null });
}

async function adminPatch(request: Request, env: Env, actor: string, id: string): Promise<Response> {
  const input = await body(request, z.object({ status: z.enum(["published", "hidden"]).optional(), featured: z.boolean().optional(), reason: z.string().trim().max(500).default("") }).strict(), 8 * 1024);
  const row = await listingRow(env.MARKETPLACE, id);
  requireValue(row && row.status !== "removed", 404, "listing_not_found", "This agent is not in the marketplace.");
  requireValue(input.status !== "hidden" || input.reason, 400, "reason_required", "Say why this agent is hidden. Its publisher sees the reason.");
  requireValue(!input.status || row.status !== "unpublished", 409, "listing_unpublished", "Its publisher unpublished this agent; only they can publish it again.");
  const now = new Date().toISOString(); const statements = [];
  if (input.status && input.status !== row.status) {
    statements.push(env.MARKETPLACE.prepare("UPDATE listings SET status=?,moderated_at=?,moderation_reason=?,updated_at=? WHERE id=?").bind(input.status, now, input.status === "hidden" ? input.reason : "", now, id));
    statements.push(audit(env.MARKETPLACE, "admin", actor, input.status === "hidden" ? "listing.hidden" : "listing.restored", id, input.reason));
  }
  if (input.featured !== undefined && Number(input.featured) !== row.featured) {
    // A newly featured listing goes to the end of the featured order.
    statements.push(input.featured
      ? env.MARKETPLACE.prepare("UPDATE listings SET featured=1,featured_rank=(SELECT coalesce(max(featured_rank),0)+1 FROM listings WHERE featured=1),updated_at=? WHERE id=?").bind(now, id)
      : env.MARKETPLACE.prepare("UPDATE listings SET featured=0,featured_rank=0,updated_at=? WHERE id=?").bind(now, id));
    statements.push(audit(env.MARKETPLACE, "admin", actor, input.featured ? "listing.featured" : "listing.unfeatured", id, input.reason));
  }
  if (statements.length) await env.MARKETPLACE.batch(statements);
  return ok({ agent: adminListing((await listingRow(env.MARKETPLACE, id))!) });
}

async function adminDelete(request: Request, env: Env, actor: string, id: string): Promise<Response> {
  const input = await body(request, z.object({ reason: z.string().trim().min(1).max(500) }).strict(), 8 * 1024);
  const row = await listingRow(env.MARKETPLACE, id);
  requireValue(row, 404, "listing_not_found", "This agent is not in the marketplace.");
  const now = new Date().toISOString();
  // The row stays as a tombstone for the audit trail; the content goes.
  await env.MARKETPLACE.batch([
    env.MARKETPLACE.prepare("UPDATE listing_versions SET document=NULL WHERE listing_id=?").bind(id),
    env.MARKETPLACE.prepare("UPDATE listings SET status='removed',featured=0,featured_rank=0,moderated_at=?,moderation_reason=?,updated_at=? WHERE id=?").bind(now, input.reason, now, id),
    env.MARKETPLACE.prepare("UPDATE reports SET status='resolved',resolved_by=?,resolved_at=?,resolution='Listing removed' WHERE listing_id=? AND status='open'").bind(actor, now, id),
    audit(env.MARKETPLACE, "admin", actor, "listing.removed", id, input.reason),
  ]);
  return ok({ id, status: "removed" });
}

/** Put the featured listings in this order; anything featured and not named keeps its place after them. */
async function adminFeaturedOrder(request: Request, env: Env, actor: string): Promise<Response> {
  const input = await body(request, z.object({ ids: z.array(z.string().regex(LISTING_ID)).min(1).max(FEATURED_LIMIT * 2), reason: z.string().trim().max(500).default("") }).strict(), 8 * 1024);
  requireValue(new Set(input.ids).size === input.ids.length, 400, "invalid_request", "Name each listing once.");
  const rows = (await env.MARKETPLACE.prepare(`SELECT id,featured,status FROM listings WHERE id IN (${input.ids.map(() => "?").join(",")})`).bind(...input.ids).all<{ id: string; featured: number; status: string }>()).results;
  const featuredIds = new Set(rows.filter(row => row.featured === 1 && row.status !== "removed").map(row => row.id));
  const missing = input.ids.find(id => !featuredIds.has(id));
  requireValue(!missing, 409, "not_featured", `Feature ${missing} before ordering it.`);
  const rest = (await env.MARKETPLACE.prepare(`SELECT id FROM listings WHERE featured=1 AND id NOT IN (${input.ids.map(() => "?").join(",")}) ORDER BY featured_rank=0, featured_rank, updated_at DESC, id`).bind(...input.ids).all<{ id: string }>()).results.map(row => row.id);
  const order = [...input.ids, ...rest];
  await env.MARKETPLACE.batch([
    ...order.map((id, index) => env.MARKETPLACE.prepare("UPDATE listings SET featured_rank=? WHERE id=?").bind(index + 1, id)),
    audit(env.MARKETPLACE, "admin", actor, "featured.reordered", "", order.slice(0, FEATURED_LIMIT).join(",")),
  ]);
  return ok({ featured: (await featuredRows(env)).map(adminListing) });
}

const statsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), listing: z.string().regex(LISTING_ID).optional() });
/**
 * The install funnel for admins: views, Add clicks, downloads and confirmed
 * installs per day, the listings with the most installs, and how many
 * website Add clicks led to an install (joined by attribution id).
 */
async function adminStats(env: Env, url: URL): Promise<Response> {
  const parsed = statsQuery.safeParse(Object.fromEntries(url.searchParams));
  requireValue(parsed.success, 400, "invalid_query", "Use days (1 to 365) and an optional listing.");
  const { days, listing } = parsed.data;
  const since = dayOf(Date.now() - (days - 1) * DAY_MS);
  const scope = listing ? " AND listing_id=?" : "";
  const bind = listing ? [since, listing] : [since];
  const [daily, totals, top, attributed] = await env.MARKETPLACE.batch([
    env.MARKETPLACE.prepare(`SELECT day,sum(views) AS views,sum(add_clicks) AS addClicks,sum(downloads) AS downloads,sum(installs) AS installs FROM listing_stats WHERE day>=?${scope} GROUP BY day ORDER BY day`).bind(...bind),
    env.MARKETPLACE.prepare(`SELECT coalesce(sum(views),0) AS views,coalesce(sum(add_clicks),0) AS addClicks,coalesce(sum(downloads),0) AS downloads,coalesce(sum(installs),0) AS installs FROM listing_stats WHERE day>=?${scope}`).bind(...bind),
    env.MARKETPLACE.prepare(`SELECT s.listing_id AS id,l.name,l.kind,l.category,sum(s.views) AS views,sum(s.add_clicks) AS addClicks,sum(s.downloads) AS downloads,sum(s.installs) AS installs
      FROM listing_stats s JOIN listings l ON l.id=s.listing_id WHERE s.day>=?${listing ? " AND s.listing_id=?" : ""} GROUP BY s.listing_id ORDER BY installs DESC, downloads DESC, views DESC LIMIT 20`).bind(...bind),
    env.MARKETPLACE.prepare(`SELECT count(*) AS clicks,count(installed_at) AS installs FROM attributions WHERE clicked_at>=?${scope}`).bind(`${since}T00:00:00.000Z`, ...(listing ? [listing] : [])),
  ]);
  return ok({ days, since, daily: daily.results, totals: totals.results[0], top: top.results, attribution: attributed.results[0] });
}

async function adminReports(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") || "open";
  requireValue(["open", "resolved", "dismissed"].includes(status), 400, "invalid_query", "Unknown report status.");
  const rows = (await env.MARKETPLACE.prepare(`SELECT r.id,r.listing_id AS listingId,l.name AS listingName,l.status AS listingStatus,r.reason,r.details,r.status,r.created_at AS createdAt,r.resolved_by AS resolvedBy,r.resolved_at AS resolvedAt,r.resolution
    FROM reports r JOIN listings l ON l.id=r.listing_id WHERE r.status=? ORDER BY r.created_at DESC LIMIT 200`).bind(status).all()).results;
  return ok({ reports: rows });
}

async function adminResolve(request: Request, env: Env, actor: string, reportId: string): Promise<Response> {
  const input = await body(request, z.object({ status: z.enum(["resolved", "dismissed"]), note: z.string().trim().max(500).default("") }).strict(), 8 * 1024);
  const row = await env.MARKETPLACE.prepare("SELECT listing_id,status FROM reports WHERE id=?").bind(reportId).first<{ listing_id: string; status: string }>();
  requireValue(row, 404, "report_not_found", "That report does not exist.");
  const now = new Date().toISOString();
  await env.MARKETPLACE.batch([
    env.MARKETPLACE.prepare("UPDATE reports SET status=?,resolved_by=?,resolved_at=?,resolution=? WHERE id=?").bind(input.status, actor, now, input.note, reportId),
    audit(env.MARKETPLACE, "admin", actor, `report.${input.status}`, row.listing_id, input.note),
  ]);
  return ok({ id: reportId, status: input.status });
}

async function adminAudit(env: Env, url: URL): Promise<Response> {
  const before = Number(url.searchParams.get("cursor") || 0);
  requireValue(Number.isInteger(before) && before >= 0, 400, "cursor_invalid", "This page cursor is not valid.");
  const listing = url.searchParams.get("listing");
  const where = [before ? "id<?" : "1=1"]; const params: unknown[] = before ? [before] : [];
  if (listing) { requireValue(LISTING_ID.test(listing), 400, "invalid_query", "Unknown listing."); where.push("listing_id=?"); params.push(listing); }
  const rows = (await env.MARKETPLACE.prepare(`SELECT id,at,actor_kind AS actorKind,actor,action,listing_id AS listingId,detail FROM audit WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 101`).bind(...params).all<{ id: number }>()).results;
  return ok({ events: rows.slice(0, 100), nextCursor: rows.length > 100 ? String(rows[99].id) : null });
}

// --- routing -----------------------------------------------------------------

const AGENT = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})$/;
const EVENTS = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})\/events$/;
const TEMPLATE = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})\/template$/;
const REPORTS = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})\/reports$/;
const ADMIN_AGENT = /^\/v1\/marketplace\/admin\/agents\/([a-z0-9]{12})$/;
const ADMIN_REPORT = /^\/v1\/marketplace\/admin\/reports\/([a-f0-9-]{36})$/;

/** The website's pages, which may send reports and events from the visitor's browser. */
export const MARKETPLACE_SITE_ORIGINS = ["https://autohand.ai", "https://www.autohand.ai"];
export function siteOrigins(configured?: string): string[] {
  const listed = String(configured || "").split(",").map(origin => origin.trim()).filter(origin => /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(origin));
  return listed.length ? listed : MARKETPLACE_SITE_ORIGINS;
}
/**
 * A report or listing event sent from the website. It goes straight from the
 * visitor's browser so the network bucket is the visitor's own, not the
 * website's egress shared by everyone.
 */
export function isSiteReport(method: string, path: string, origin: string | null, configured?: string): boolean {
  return Boolean(origin && siteOrigins(configured).includes(origin)) && (method === "POST" || method === "OPTIONS") && (REPORTS.test(path) || EVENTS.test(path));
}

/** GETs anyone may read, from any origin. */
export function isPublicMarketplaceRead(method: string, path: string): boolean {
  return method === "GET" && (path === "/v1/marketplace/agents" || path === "/v1/marketplace/categories" || path === "/v1/marketplace/featured" || path === "/v1/marketplace/home" || AGENT.test(path) || TEMPLATE.test(path));
}

/** Routes needing no Squad session: public reads, reports, admin. */
export async function publicMarketplaceRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/v1/marketplace/")) return null;
  if (path.startsWith("/v1/marketplace/admin/")) {
    const actor = await admin(request, env);
    if (path === "/v1/marketplace/admin/agents" && request.method === "GET") return adminList(env, url);
    const agent = path.match(ADMIN_AGENT);
    if (agent && request.method === "PATCH") return adminPatch(request, env, actor, agent[1]);
    if (agent && request.method === "DELETE") return adminDelete(request, env, actor, agent[1]);
    if (path === "/v1/marketplace/admin/reports" && request.method === "GET") return adminReports(env, url);
    const reportMatch = path.match(ADMIN_REPORT);
    if (reportMatch && request.method === "PATCH") return adminResolve(request, env, actor, reportMatch[1]);
    if (path === "/v1/marketplace/admin/audit" && request.method === "GET") return adminAudit(env, url);
    if (path === "/v1/marketplace/admin/featured" && request.method === "PUT") return adminFeaturedOrder(request, env, actor);
    if (path === "/v1/marketplace/admin/stats" && request.method === "GET") return adminStats(env, url);
    throw new ApiError(404, "route_not_found", "Squad API route not found.");
  }
  if (path === "/v1/marketplace/agents" && request.method === "GET") return listPublic(request, env, url);
  if (path === "/v1/marketplace/categories" && request.method === "GET") return categories(env);
  if (path === "/v1/marketplace/featured" && request.method === "GET") return featured(env);
  if (path === "/v1/marketplace/home" && request.method === "GET") return home(env, url);
  const agent = path.match(AGENT);
  if (agent && request.method === "GET") return detail(request, env, agent[1]);
  const templateMatch = path.match(TEMPLATE);
  if (templateMatch && request.method === "GET") return template(request, env, url, templateMatch[1]);
  const reportMatch = path.match(REPORTS);
  if (reportMatch && request.method === "POST") return report(request, env, reportMatch[1]);
  const eventMatch = path.match(EVENTS);
  if (eventMatch && request.method === "POST") return listingEvent(request, env, eventMatch[1]);
  return null;
}

/** Routes for a signed-in publisher. */
export async function publisherMarketplaceRoutes(request: Request, env: Env, user: Principal, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/v1/marketplace/")) return null;
  if (path === "/v1/marketplace/mine" && request.method === "GET") return mine(request, env, user);
  if (path === "/v1/marketplace/agents" && request.method === "POST") return publish(request, env, user);
  const agent = path.match(AGENT);
  if (agent && request.method === "PUT") return update(request, env, user, agent[1]);
  if (agent && request.method === "DELETE") return unpublish(request, env, user, agent[1]);
  return null;
}

export async function cleanMarketplace(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.MARKETPLACE.batch([
    env.MARKETPLACE.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(now),
    env.MARKETPLACE.prepare("DELETE FROM listing_adds WHERE expires_at<?").bind(now),
    env.MARKETPLACE.prepare("DELETE FROM listing_event_seen WHERE expires_at<?").bind(now),
    env.MARKETPLACE.prepare("DELETE FROM attributions WHERE expires_at<?").bind(now),
  ]);
}

export { AUTOHAND_CREATOR_NAME };
