import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { ApiError, body, digest, ok, requireValue } from "./http.js";
import { idSchema, mutationSchema, snapshotSchema, type MemorySnapshot } from "./schema.js";
import { workspace } from "./tenants.js";

async function readSnapshot(env: Env, key: string, tenant: string, space: string): Promise<MemorySnapshot> {
  const object = await env.MEMORY.get(key);
  requireValue(object, 503, "memory_unavailable", "Memory data is temporarily unavailable. Keep your local copy.");
  const snapshot = snapshotSchema.parse(await object.json());
  requireValue(snapshot.tenantId === tenant && snapshot.workspaceId === space, 503, "memory_invalid", "Memory namespace is invalid.");
  return snapshot;
}
export async function memoryRoutes(request: Request, env: Env, user: Principal, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/v1\/tenants\/([a-f0-9-]{36})\/workspaces\/([a-f0-9-]{36})\/memory(?:\/(.*))?$/);
  if (!match) return null;
  const [, tenant, space] = match; const rest = match[3] || "";
  await workspace(env, user, tenant, space, request.method !== "GET");
  if ((rest === "changes" || !rest) && request.method === "GET") {
    const cursor = Number(url.searchParams.get("cursor") || 0); const limit = Number(url.searchParams.get("limit") || 100);
    requireValue(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 400, "invalid_cursor", "Use a nonnegative cursor and a limit from 1 to 100.");
    const rows = (await env.DB.prepare(`SELECT sequence,object_key FROM memory_changes WHERE tenant_id=? AND workspace_id=? AND sequence>? ORDER BY sequence LIMIT ?`)
      .bind(tenant, space, cursor, limit + 1).all<{ sequence: number; object_key: string }>()).results;
    const page = rows.slice(0, limit);
    const entries = await Promise.all(page.map(async row => ({ sequence: row.sequence, ...await readSnapshot(env, row.object_key, tenant, space) })));
    return ok({ entries, cursor: page.at(-1)?.sequence ?? cursor, hasMore: rows.length > limit });
  }
  const parsedId = idSchema.safeParse(rest);
  requireValue(parsedId.success, 404, "memory_not_found", "Memory not found."); const id = parsedId.data;
  if (request.method === "GET") {
    const entry = await env.DB.prepare("SELECT object_key FROM memory_entries WHERE tenant_id=? AND workspace_id=? AND id=?").bind(tenant, space, id).first<{ object_key: string }>();
    requireValue(entry, 404, "memory_not_found", "Memory not found.");
    const snapshot = await readSnapshot(env, entry.object_key, tenant, space);
    return ok(snapshot, 200, { etag: `"${snapshot.revision}"` });
  }
  if (request.method !== "PUT") return null;
  requireValue(id !== "changes", 400, "reserved_memory_id", "This memory ID is reserved.");
  const mutation = await body(request, mutationSchema, 24_000);
  const idempotencyKey = request.headers.get("idempotency-key") || "";
  requireValue(/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey), 400, "idempotency_required", "Provide an Idempotency-Key for each mutation.");
  const requestHash = await digest(JSON.stringify({ id, ...mutation }));
  const mutationLookup = () => env.DB.prepare("SELECT request_hash,object_key FROM mutations WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND idempotency_key=?")
    .bind(tenant, space, user.id, idempotencyKey).first<{ request_hash: string; object_key: string }>();
  const replay = async (saved: { request_hash: string; object_key: string }) => {
    requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another mutation.");
    return ok(await readSnapshot(env, saved.object_key, tenant, space));
  };
  const saved = await mutationLookup(); if (saved) return replay(saved);
  const current = await env.DB.prepare("SELECT revision,scope FROM memory_entries WHERE tenant_id=? AND workspace_id=? AND id=?").bind(tenant, space, id).first<{ revision: number; scope: MemorySnapshot["scope"] }>();
  if ((current?.revision || 0) !== mutation.baseRevision) throw new ApiError(409, "revision_conflict", "Memory changed on another device. Read it before retrying.", { currentRevision: current?.revision || 0 });
  requireValue(current || mutation.content, 404, "memory_not_found", "Memory not found.");
  const scope = mutation.content?.scope || current?.scope;
  requireValue(scope && (!current || !mutation.content || scope === current.scope), 400, "scope_immutable", "Create a new memory to change its scope.");
  const snapshot: MemorySnapshot = { schemaVersion: 1, id, tenantId: tenant, workspaceId: space, scope, revision: mutation.baseRevision + 1, deleted: mutation.content === null, content: mutation.content, updatedBy: user.id, updatedAt: new Date().toISOString() };
  const key = `tenants/${tenant}/workspaces/${space}/memory/${id}/${crypto.randomUUID()}.json`;
  // Immutable object first; only an atomic D1 transaction makes it visible.
  await env.MEMORY.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json" } });
  const noReplay = "NOT EXISTS (SELECT 1 FROM mutations WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND idempotency_key=?)";
  const replayArgs = [tenant, space, user.id, idempotencyKey];
  const write = current
    ? env.DB.prepare(`UPDATE memory_entries SET revision=?,object_key=?,deleted=?,updated_by=?,updated_at=? WHERE tenant_id=? AND workspace_id=? AND id=? AND revision=? AND ${noReplay}`)
      .bind(snapshot.revision, key, Number(snapshot.deleted), user.id, snapshot.updatedAt, tenant, space, id, mutation.baseRevision, ...replayArgs)
    : env.DB.prepare(`INSERT OR IGNORE INTO memory_entries(tenant_id,workspace_id,id,scope,revision,object_key,deleted,updated_by,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${noReplay} AND (SELECT count(*) FROM memory_entries WHERE tenant_id=? AND workspace_id=?)<2000`)
      .bind(tenant, space, id, scope, snapshot.revision, key, 0, user.id, snapshot.updatedAt, ...replayArgs, tenant, space);
  const committed = await env.DB.batch([
    write,
    env.DB.prepare(`INSERT INTO memory_changes(tenant_id,workspace_id,entry_id,revision,object_key,deleted,updated_at)
      SELECT tenant_id,workspace_id,id,revision,object_key,deleted,updated_at FROM memory_entries WHERE tenant_id=? AND workspace_id=? AND id=? AND object_key=?`)
      .bind(tenant, space, id, key),
    env.DB.prepare(`INSERT OR IGNORE INTO mutations(tenant_id,workspace_id,actor_id,idempotency_key,request_hash,object_key,created_at)
      SELECT tenant_id,workspace_id,?,?,?,object_key,updated_at FROM memory_entries WHERE tenant_id=? AND workspace_id=? AND id=? AND object_key=?`)
      .bind(user.id, idempotencyKey, requestHash, tenant, space, id, key),
    env.DB.prepare(`INSERT INTO audit_events(tenant_id,actor_id,action,target_id,created_at)
      SELECT tenant_id,updated_by,?,id,updated_at FROM memory_entries WHERE tenant_id=? AND workspace_id=? AND id=? AND object_key=?`)
      .bind(snapshot.deleted ? "memory.deleted" : "memory.updated", tenant, space, id, key),
  ]);
  if (!committed[0].meta.changes) {
    // This candidate was never referenced. Ambiguous/failed D1 commits above
    // deliberately retain their object rather than risking committed data.
    await env.MEMORY.delete(key);
    const winner = await mutationLookup(); if (winner) return replay(winner);
    throw new ApiError(409, "revision_conflict", "Memory changed or this workspace reached its memory limit. Refresh before retrying.");
  }
  return ok(snapshot, current ? 200 : 201, { etag: `"${snapshot.revision}"` });
}
