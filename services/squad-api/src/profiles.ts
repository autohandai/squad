// Member profiles in the owner's Autohand account (ADR-0280). A profile is the
// part of a member a person writes: name, role, description, instructions,
// personality, skills, a cast bird and a voice. Never paths, credentials,
// permissions, model routing or memories. Each write names the revision it
// replaces, so two computers (or a phone through one) never overwrite each
// other unseen.
import { z } from "zod";
import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { accessOwner } from "./owners.js";
import { ApiError, body, digest, ok, requireValue } from "./http.js";

export const PROFILE_LIMIT = 500;
const memberId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
export const profileContentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.string().max(80),
  description: z.string().max(600),
  instructions: z.string().max(1200),
  personality: z.string().max(600),
  skills: z.array(z.string().min(1).max(500)).max(32),
  avatar: z.union([z.literal(""), z.string().regex(/^[a-z]{1,40}$/)]),
  voice: z.string().max(80),
}).strict();
type Row = { id: string; revision: number; content: string | null; deleted: number; updated_at: string };
const view = (row: Row) => ({ id: row.id, revision: row.revision, deleted: Boolean(row.deleted), content: row.content ? JSON.parse(row.content) : null, updatedAt: row.updated_at });

export async function profileRoutes(request: Request, env: Env, user: Principal, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/v1\/(users\/me|teams\/([^/]+))\/profiles(?:\/([^/]+))?$/);
  if (!match) return null;
  let teamId: string | undefined, id: string | undefined;
  try { teamId = match[2] ? decodeURIComponent(match[2]) : undefined; id = match[3] ? decodeURIComponent(match[3]) : undefined; }
  catch { throw new ApiError(400, "profile_invalid", "Invalid team or member ID."); }
  const access = await accessOwner(request, env, user, teamId, request.method !== "GET");
  if (!id) {
    requireValue(request.method === "GET", 405, "method_not_allowed", "List profiles with GET.");
    const rows = (await env.DB.prepare("SELECT id,revision,content,deleted,updated_at FROM member_profiles WHERE owner_key=? ORDER BY id LIMIT ?").bind(access.key, PROFILE_LIMIT).all<Row>()).results;
    return ok({ owner: access.owner, profiles: rows.map(view) });
  }
  requireValue(memberId.safeParse(id).success, 404, "profile_not_found", "Profile not found.");
  const read = () => env.DB.prepare("SELECT id,revision,content,deleted,updated_at FROM member_profiles WHERE owner_key=? AND id=?").bind(access.key, id).first<Row>();
  if (request.method === "GET") {
    const row = await read(); requireValue(row, 404, "profile_not_found", "Profile not found.");
    return ok(view(row), 200, { etag: `"${row.revision}"` });
  }
  requireValue(request.method === "PUT", 405, "method_not_allowed", "Replace a profile with PUT.");
  const mutation = await body(request, z.object({ baseRevision: z.number().int().nonnegative().safe(), content: profileContentSchema.nullable() }).strict(), 16 * 1024);
  const key = request.headers.get("idempotency-key") || "";
  requireValue(/^[a-zA-Z0-9._:-]{1,128}$/.test(key), 400, "idempotency_required", "Provide an Idempotency-Key for each mutation.");
  const requestHash = await digest(JSON.stringify({ id, ...mutation }));
  const receipt = () => env.DB.prepare("SELECT request_hash,revision FROM member_profile_mutations WHERE owner_key=? AND actor_id=? AND idempotency_key=?").bind(access.key, user.id, key).first<{ request_hash: string; revision: number }>();
  const replay = async (saved: { request_hash: string; revision: number }) => {
    requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another mutation.");
    const row = await read(); requireValue(row, 404, "profile_not_found", "Profile not found.");
    return ok(view(row));
  };
  const saved = await receipt(); if (saved) return replay(saved);
  const before = await read();
  if ((before?.revision || 0) !== mutation.baseRevision) throw new ApiError(409, "revision_conflict", "This profile changed on another device. Read it before retrying.", { currentRevision: before?.revision || 0 });
  requireValue(before || mutation.content, 404, "profile_not_found", "Profile not found.");
  const revision = mutation.baseRevision + 1, now = new Date().toISOString(), change = crypto.randomUUID();
  const content = mutation.content ? JSON.stringify(mutation.content) : null, deleted = Number(mutation.content === null);
  const noReplay = "NOT EXISTS (SELECT 1 FROM member_profile_mutations WHERE owner_key=? AND actor_id=? AND idempotency_key=?)";
  const write = before
    ? env.DB.prepare(`UPDATE member_profiles SET revision=?,content=?,deleted=?,change_id=?,updated_by=?,updated_at=? WHERE owner_key=? AND id=? AND revision=? AND ${noReplay}`)
      .bind(revision, content, deleted, change, user.id, now, access.key, id, mutation.baseRevision, access.key, user.id, key)
    : env.DB.prepare(`INSERT OR IGNORE INTO member_profiles(owner_key,id,revision,content,deleted,change_id,updated_by,updated_at)
      SELECT ?,?,?,?,?,?,?,? WHERE ${noReplay} AND (SELECT count(*) FROM member_profiles WHERE owner_key=?)<?`)
      .bind(access.key, id, revision, content, deleted, change, user.id, now, access.key, user.id, key, access.key, PROFILE_LIMIT);
  const committed = await env.DB.batch([
    write,
    env.DB.prepare(`INSERT OR IGNORE INTO member_profile_mutations(owner_key,actor_id,idempotency_key,request_hash,id,revision,created_at)
      SELECT owner_key,?,?,?,id,revision,updated_at FROM member_profiles WHERE owner_key=? AND id=? AND change_id=?`).bind(user.id, key, requestHash, access.key, id, change),
    env.DB.prepare(`INSERT INTO agent_audit(owner_key,actor_id,action,target_id,created_at)
      SELECT owner_key,updated_by,?,id,updated_at FROM member_profiles WHERE owner_key=? AND id=? AND change_id=?`).bind(deleted ? "profile.deleted" : "profile.updated", access.key, id, change),
  ]);
  if (!committed[0].meta.changes) {
    const winner = await receipt(); if (winner) return replay(winner);
    throw new ApiError(409, "revision_conflict", "This profile changed or this account reached its profile limit. Read it before retrying.");
  }
  return ok({ id, revision, deleted: Boolean(deleted), content: mutation.content, updatedAt: now }, before ? 200 : 201, { etag: `"${revision}"` });
}
