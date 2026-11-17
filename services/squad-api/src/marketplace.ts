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
  AUTOHAND_CREATOR_NAME, CATEGORIES, CATEGORY_IDS, LISTING_ID, REPORT_REASON_IDS, TEMPLATE_LIMITS,
  categoryLabel, contentHash, randomListingId, templateSummary, validateAgentTemplate, validateListingInput,
  type TeamDocument,
} from "../../../src/lib/marketplace.js";

type DB = D1Database;
interface ListingRow {
  id: string; publisher_id: string; name: string; role: string; tagline: string; description: string; category: string; tags: string; bird: string;
  creator_kind: string; creator_name: string; version: number; content_hash: string; bytes: number; skills: number; has_memory: number;
  status: string; featured: number; adds: number; created_at: string; updated_at: string; moderated_at: string | null; moderation_reason: string;
}
interface PublisherRow { id: string; kind: string; issuer: string; subject: string; display_name: string }

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const LISTING_COLUMNS = "id,publisher_id,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,version,content_hash,bytes,skills,has_memory,status,featured,adds,created_at,updated_at,moderated_at,moderation_reason";
const MAX_REQUEST = TEMPLATE_LIMITS.bytes * 2 + 32 * 1024;
const REPORT_HIDE_THRESHOLD = 5;

export function publicListing(row: ListingRow) {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags); } catch { tags = []; }
  return {
    id: row.id, name: row.name, role: row.role, tagline: row.tagline, description: row.description,
    category: row.category, categoryLabel: categoryLabel(row.category), tags, bird: row.bird,
    creator: { kind: row.creator_kind, name: row.creator_name },
    version: row.version, contentHash: row.content_hash, bytes: row.bytes, skills: row.skills, hasMemory: row.has_memory === 1,
    featured: row.featured === 1, adds: row.adds, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
const adminListing = (row: ListingRow & { open_reports?: number }) => ({ ...publicListing(row), status: row.status, moderatedAt: row.moderated_at, moderationReason: row.moderation_reason, openReports: Number(row.open_reports || 0) });

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

export function searchText(fields: { name: string; role: string; tagline: string; creatorName: string; tags: string[]; category: string }): string {
  return [fields.name, fields.role, fields.tagline, fields.creatorName, ...fields.tags, categoryLabel(fields.category), fields.category].join(" ").toLowerCase().replace(/\s+/g, " ");
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
  q: z.string().max(200).optional(), category: z.enum(CATEGORY_IDS as [string, ...string[]]).optional(),
  creator: z.enum(["autohand", "user", "team"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(24), cursor: z.string().optional(),
});
const listCursor = z.object({ f: z.number().int().min(0).max(1), c: z.string().max(40), i: z.string().regex(LISTING_ID) }).strict();

async function listPublic(request: Request, env: Env, url: URL): Promise<Response> {
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  requireValue(parsed.success, 400, "invalid_query", "Use q, category, creator, limit and cursor.");
  const query = parsed.data;
  const where = ["status='published'"]; const params: unknown[] = [];
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

async function categories(env: Env): Promise<Response> {
  const rows = (await env.MARKETPLACE.prepare("SELECT category, count(*) AS n FROM listings WHERE status='published' GROUP BY category").all<{ category: string; n: number }>()).results;
  const counts = new Map(rows.map(row => [row.category, row.n]));
  const autohand = (await env.MARKETPLACE.prepare("SELECT count(*) AS n FROM listings WHERE status='published' AND creator_kind='autohand'").first<{ n: number }>())?.n || 0;
  return cached({ categories: CATEGORIES.map(category => ({ ...category, count: counts.get(category.id) || 0 })), total: rows.reduce((sum, row) => sum + row.n, 0), autohand });
}

async function detail(request: Request, env: Env, id: string): Promise<Response> {
  const row = await publishedRow(env.MARKETPLACE, id);
  const { document } = await versionDocument(env.MARKETPLACE, id, row.version);
  const summary = templateSummary(document);
  const versions = (await env.MARKETPLACE.prepare("SELECT version,content_hash AS contentHash,note,created_at AS createdAt FROM listing_versions WHERE listing_id=? AND document IS NOT NULL ORDER BY version DESC LIMIT 20").bind(id).all()).results;
  return cached({ agent: publicListing(row), preview: { instructions: summary.instructions, brainCard: summary.brainCard, skills: summary.skills, hasMemory: summary.hasMemory }, versions },
    `"${row.id}-${row.version}-${row.content_hash.slice(0, 16)}"`, request);
}

async function template(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const row = await publishedRow(env.MARKETPLACE, id);
  const requested = url.searchParams.get("version");
  const version = requested === null ? row.version : Number(requested);
  requireValue(Number.isInteger(version) && version >= 1 && version <= row.version, 400, "version_invalid", "Ask for a published version of this agent.");
  await limit(env.MARKETPLACE, await networkBucket(request, "template", 600_000), 60, 600_000, "Too many agents added from this network. Try again in a few minutes.");
  const { document, hash, createdAt } = await versionDocument(env.MARKETPLACE, id, version);
  const day = await networkBucket(request, `add:${id}`, 86_400_000);
  const counted = await env.MARKETPLACE.prepare("INSERT OR IGNORE INTO listing_adds(listing_id,bucket,expires_at) VALUES (?,?,?)").bind(id, day, new Date(Date.now() + 86_400_000).toISOString()).run();
  if (counted.meta.changes) await env.MARKETPLACE.prepare("UPDATE listings SET adds=adds+1 WHERE id=?").bind(id).run();
  return ok({ agent: publicListing(row), version, versionCreatedAt: createdAt, contentHash: hash, document });
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
const publishInput = z.object({ owner: ownerInput, listing: z.unknown(), document: z.unknown(), creatorName: z.string().trim().max(60).optional(), note: z.string().trim().max(TEMPLATE_LIMITS.note).default("") }).strict();
const updateInput = publishInput.omit({ owner: true }).extend({ baseVersion: z.number().int().positive() }).strict();

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

async function checkedContent(listing: unknown, document: unknown) {
  const fields = validateListingInput(listing);
  if (!fields.ok) throw new ApiError(400, "listing_invalid", fields.error);
  const template = validateAgentTemplate(document);
  if (!template.ok) throw new ApiError(400, template.code, template.error, template.findings);
  const hash = await contentHash(template.document);
  return { fields: fields.listing, document: template.document, bytes: template.bytes, hash, summary: templateSummary(template.document) };
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
  const content = await checkedContent(input.listing, input.document);
  const who = await authority(request, env, user, input.owner, input.creatorName);
  const requestHash = await digest(JSON.stringify({ owner: input.owner, fields: content.fields, hash: content.hash, creator: who.publisher.display_name, note: input.note }));
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
        env.MARKETPLACE.prepare(`INSERT INTO listings(id,publisher_id,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,search_text,version,content_hash,bytes,skills,has_memory,status,featured,adds,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'published',0,0,?,?,?)`)
          .bind(id, publisher, name, role, content.fields.tagline, content.fields.description, content.fields.category, JSON.stringify(content.fields.tags), content.summary.bird,
            who.publisher.kind, who.publisher.display_name,
            searchText({ name, role, tagline: content.fields.tagline, creatorName: who.publisher.display_name, tags: content.fields.tags, category: content.fields.category }),
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
  const content = await checkedContent(input.listing, input.document);
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
      env.MARKETPLACE.prepare(`UPDATE listings SET name=?,role=?,tagline=?,description=?,category=?,tags=?,bird=?,creator_name=?,search_text=?,version=?,content_hash=?,bytes=?,skills=?,has_memory=?,status='published',updated_at=? WHERE id=? AND version=?`)
        .bind(name, role, content.fields.tagline, content.fields.description, content.fields.category, JSON.stringify(content.fields.tags), content.summary.bird, creator,
          searchText({ name, role, tagline: content.fields.tagline, creatorName: creator, tags: content.fields.tags, category: content.fields.category }),
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
  const cursor = decodeCursor(url.searchParams.get("cursor"), adminCursor);
  const total = (await env.MARKETPLACE.prepare(`SELECT count(*) AS n FROM listings l ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).bind(...params).first<{ n: number }>())?.n || 0;
  if (cursor) { where.push("(l.updated_at<? OR (l.updated_at=? AND l.id<?))"); params.push(cursor.u, cursor.u, cursor.i); }
  const rows = (await env.MARKETPLACE.prepare(`SELECT l.${LISTING_COLUMNS.split(",").join(",l.")},(SELECT count(*) FROM reports r WHERE r.listing_id=l.id AND r.status='open') AS open_reports
    FROM listings l ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.updated_at DESC, l.id DESC LIMIT 51`).bind(...params).all<ListingRow & { open_reports: number }>()).results;
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
    statements.push(env.MARKETPLACE.prepare("UPDATE listings SET featured=?,updated_at=? WHERE id=?").bind(input.featured ? 1 : 0, now, id));
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
    env.MARKETPLACE.prepare("UPDATE listings SET status='removed',featured=0,moderated_at=?,moderation_reason=?,updated_at=? WHERE id=?").bind(now, input.reason, now, id),
    env.MARKETPLACE.prepare("UPDATE reports SET status='resolved',resolved_by=?,resolved_at=?,resolution='Listing removed' WHERE listing_id=? AND status='open'").bind(actor, now, id),
    audit(env.MARKETPLACE, "admin", actor, "listing.removed", id, input.reason),
  ]);
  return ok({ id, status: "removed" });
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
const TEMPLATE = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})\/template$/;
const REPORTS = /^\/v1\/marketplace\/agents\/([a-z0-9]{12})\/reports$/;
const ADMIN_AGENT = /^\/v1\/marketplace\/admin\/agents\/([a-z0-9]{12})$/;
const ADMIN_REPORT = /^\/v1\/marketplace\/admin\/reports\/([a-f0-9-]{36})$/;

/** The website's pages, which may send reports from the visitor's browser. */
export const MARKETPLACE_SITE_ORIGINS = ["https://autohand.ai", "https://www.autohand.ai"];
/**
 * A report sent from an agent's page on the website. It goes straight from
 * the visitor's browser so the network bucket is the visitor's own, not the
 * website's egress shared by everyone.
 */
export function isSiteReport(method: string, path: string, origin: string | null): boolean {
  return Boolean(origin && MARKETPLACE_SITE_ORIGINS.includes(origin)) && (method === "POST" || method === "OPTIONS") && REPORTS.test(path);
}

/** GETs anyone may read, from any origin. */
export function isPublicMarketplaceRead(method: string, path: string): boolean {
  return method === "GET" && (path === "/v1/marketplace/agents" || path === "/v1/marketplace/categories" || AGENT.test(path) || TEMPLATE.test(path));
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
    throw new ApiError(404, "route_not_found", "Squad API route not found.");
  }
  if (path === "/v1/marketplace/agents" && request.method === "GET") return listPublic(request, env, url);
  if (path === "/v1/marketplace/categories" && request.method === "GET") return categories(env);
  const agent = path.match(AGENT);
  if (agent && request.method === "GET") return detail(request, env, agent[1]);
  const templateMatch = path.match(TEMPLATE);
  if (templateMatch && request.method === "GET") return template(request, env, url, templateMatch[1]);
  const reportMatch = path.match(REPORTS);
  if (reportMatch && request.method === "POST") return report(request, env, reportMatch[1]);
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
  ]);
}

export { AUTOHAND_CREATOR_NAME };
