import { z } from "zod";
import { agentSchema, stateSchema, ownerSchema, streamBackup, MAX_FILE_BYTES, MAX_DOCUMENT_BYTES, sha256, inventory, checkStructure,
  validateAgent, validateState, type Agent, type FileRef, type Manifest, type SquadState } from "@autohand/squad-portable";
import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { accessOwner, type OwnerAccess } from "./owners.js";
import { ApiError, body, digest, ok, requireValue } from "./http.js";

const MAX_METADATA = 4 * 1024 * 1024;
const MAX_EXPORT_METADATA = 16 * 1024 * 1024;
const MAX_EXPORT_READS = 900;
const recordId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/);
const fields = {
  schemaVersion: z.literal(1), owner: ownerSchema, id: recordId,
  revision: z.number().int().positive().safe(), deleted: z.boolean(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), updatedBy: z.string(),
};
const snapshotSchema = z.discriminatedUnion("kind", [
  z.object({ ...fields, kind: z.literal("agent"), content: agentSchema.nullable() }).strict(),
  z.object({ ...fields, kind: z.literal("squad"), content: stateSchema.nullable() }).strict(),
]);
type Snapshot = z.infer<typeof snapshotSchema>;
type Kind = Snapshot["kind"];
const emptyState = (): SquadState => ({ shared: { data: {}, files: [] }, workspaces: [], omissions: [], extensions: {} });
const blobKey = (access: OwnerAccess, hash: string) => `owners/${access.key}/files/${hash}`;

async function readSnapshot(env: Env, access: OwnerAccess, key: string): Promise<Snapshot> {
  requireValue(key.startsWith(`owners/${access.key}/records/`), 500, "record_scope_invalid", "The saved record has an invalid owner.");
  const object = await env.MEMORY.get(key);
  requireValue(object && object.size <= MAX_METADATA, 503, "record_unavailable", "The saved agent record is unavailable.");
  const value = await object.json();
  try { checkStructure(value, 50_000); } catch { throw new ApiError(503, "record_invalid", "The saved record exceeds its structural limits."); }
  const parsed = snapshotSchema.safeParse(value);
  requireValue(parsed.success, 503, "record_invalid", "The saved agent record is invalid.");
  requireValue(await digest(JSON.stringify([parsed.data.owner.issuer, parsed.data.owner.kind, parsed.data.owner.id])) === access.key, 500, "record_scope_invalid", "The saved record has an invalid owner.");
  return parsed.data;
}
async function current(env: Env, access: OwnerAccess, kind: Kind, id: string): Promise<Snapshot | null> {
  const row = await env.DB.prepare("SELECT object_key,revision FROM owned_records WHERE owner_key=? AND kind=? AND id=?").bind(access.key, kind, id).first<{ object_key: string; revision: number }>();
  if (!row) return null;
  const snapshot = await readSnapshot(env, access, row.object_key);
  requireValue(snapshot.kind === kind && snapshot.id === id && snapshot.revision === row.revision, 503, "record_invalid", "The saved record does not match its revision pointer.");
  return snapshot;
}
async function checkFiles(env: Env, access: OwnerAccess, files: FileRef[]): Promise<void> {
  const expected = new Map(files.map(file => [file.sha256, file.bytes]));
  const hashes = [...expected.keys()];
  for (let offset = 0; offset < hashes.length; offset += 80) {
    const page = hashes.slice(offset, offset + 80);
    const rows = (await env.DB.prepare(`SELECT sha256,bytes FROM agent_blobs WHERE owner_key=? AND sha256 IN (${page.map(() => "?").join(",")})`)
      .bind(access.key, ...page).all<{ sha256: string; bytes: number }>()).results;
    for (const row of rows) if (expected.get(row.sha256) === row.bytes) expected.delete(row.sha256);
  }
  requireValue(!expected.size, 409, "files_missing", "Upload all referenced file contents to this owner before publishing the agent.");
}

async function publish(request: Request, env: Env, user: Principal, access: OwnerAccess, kind: Kind, id: string): Promise<Response> {
  const mutation = await body(request, z.object({ baseRevision: z.number().int().nonnegative().safe(), content: z.unknown() }).strict(), MAX_METADATA - 4096, 50_000);
  requireValue(mutation.content !== undefined, 400, "content_required", "Provide content, or null for an explicit deletion.");
  let content: Agent | SquadState | null = null;
  try { if (mutation.content !== null) content = kind === "agent" ? validateAgent(mutation.content) : validateState(mutation.content); }
  catch (error) { throw new ApiError(400, "invalid_record", error instanceof Error ? error.message : "Invalid record."); }
  if (kind === "agent" && content) {
    requireValue("profile" in content, 400, "invalid_agent", "Provide an agent document.");
    const agent = content;
    requireValue(agent.id === id, 400, "agent_id_mismatch", "The agent ID must match its URL.");
    requireValue(!["owner", "ownership", "ownerId"].some(key => Object.hasOwn(agent.profile, key)), 400, "ownership_immutable", "Ownership is defined by the authorized URL, not profile fields.");
  }
  const key = request.headers.get("idempotency-key") || "";
  requireValue(/^[a-zA-Z0-9._:-]{1,128}$/.test(key), 400, "idempotency_required", "Provide an Idempotency-Key for each mutation.");
  const requestHash = await digest(JSON.stringify({ kind, id, baseRevision: mutation.baseRevision, content }));
  const receipt = () => env.DB.prepare("SELECT request_hash,object_key FROM agent_mutations WHERE owner_key=? AND actor_id=? AND idempotency_key=?")
    .bind(access.key, user.id, key).first<{ request_hash: string; object_key: string }>();
  const replay = async (saved: { request_hash: string; object_key: string }) => {
    requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another mutation.");
    return ok(await readSnapshot(env, access, saved.object_key));
  };
  const saved = await receipt(); if (saved) return replay(saved);
  const before = await current(env, access, kind, id);
  requireValue((before?.revision || 0) === mutation.baseRevision, 409, "revision_conflict", "This record changed on another device. Read it before retrying.");
  requireValue(before || content, 404, "agent_not_found", "Agent not found.");
  if (content) await checkFiles(env, access, "files" in content ? content.files : content.shared.files);
  const profile = content && "profile" in content ? content.profile : {};
  const name = typeof profile.name === "string" ? profile.name.slice(0, 500) : id;
  const role = typeof profile.role === "string" ? profile.role.slice(0, 500) : "";
  const stamp = new Date().toISOString();
  const snapshot = { schemaVersion: 1, owner: access.owner, kind, id, revision: mutation.baseRevision + 1, deleted: content === null,
    content, createdAt: before?.createdAt || stamp, updatedAt: stamp, updatedBy: user.subject };
  const objectKey = `owners/${access.key}/records/${kind}/${id}/${crypto.randomUUID()}.json`;
  await env.MEMORY.put(objectKey, JSON.stringify(snapshot), { httpMetadata: { contentType: "application/json" } });
  const noReplay = "NOT EXISTS (SELECT 1 FROM agent_mutations WHERE owner_key=? AND actor_id=? AND idempotency_key=?)";
  const replayArgs = [access.key, user.id, key];
  const write = before
    ? env.DB.prepare(`UPDATE owned_records SET name=?,role=?,revision=?,object_key=?,deleted=?,updated_by=?,updated_at=? WHERE owner_key=? AND kind=? AND id=? AND revision=? AND ${noReplay}`)
      .bind(name, role, snapshot.revision, objectKey, Number(snapshot.deleted), user.id, stamp, access.key, kind, id, mutation.baseRevision, ...replayArgs)
    : env.DB.prepare(`INSERT OR IGNORE INTO owned_records(owner_key,kind,id,name,role,revision,object_key,deleted,created_by,updated_by,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${noReplay} AND (SELECT count(*) FROM owned_records WHERE owner_key=? AND kind=?)<10000`)
      .bind(access.key, kind, id, name, role, snapshot.revision, objectKey, 0, user.id, user.id, stamp, stamp, ...replayArgs, access.key, kind);
  const committed = await env.DB.batch([
    write,
    env.DB.prepare(`INSERT OR IGNORE INTO agent_mutations(owner_key,actor_id,idempotency_key,request_hash,object_key,created_at)
      SELECT owner_key,?,?,?,?,updated_at FROM owned_records WHERE owner_key=? AND kind=? AND id=? AND object_key=?`)
      .bind(user.id, key, requestHash, objectKey, access.key, kind, id, objectKey),
    env.DB.prepare(`INSERT INTO agent_audit(owner_key,actor_id,action,target_id,created_at)
      SELECT owner_key,updated_by,?,id,updated_at FROM owned_records WHERE owner_key=? AND kind=? AND id=? AND object_key=?`)
      .bind(`${kind}.${snapshot.deleted ? "deleted" : "updated"}`, access.key, kind, id, objectKey),
  ]);
  if (!committed[0].meta.changes) {
    await env.MEMORY.delete(objectKey);
    const winner = await receipt(); if (winner) return replay(winner);
    throw new ApiError(409, "revision_conflict", "The record changed or this owner reached its record limit. Refresh before retrying.");
  }
  return ok(snapshot, before ? 200 : 201, { etag: `"${snapshot.revision}"` });
}

async function uploadFile(request: Request, env: Env, user: Principal, access: OwnerAccess, hash: string): Promise<Response> {
  requireValue(Number(request.headers.get("content-length") || 0) <= MAX_FILE_BYTES, 413, "file_too_large", "Each managed file may be up to 25 MiB.");
  requireValue(!request.headers.get("content-encoding") || request.headers.get("content-encoding") === "identity", 415, "file_encoding_invalid", "Upload uncompressed file bytes.");
  const reader = request.body?.getReader();
  let bytes = new Uint8Array(Math.min(MAX_FILE_BYTES, Math.max(65536, Number(request.headers.get("content-length") || 0))));
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new ApiError(413, "file_too_large", "Each managed file may be up to 25 MiB."); }
        if (size > bytes.byteLength) {
          const grown = new Uint8Array(Math.min(MAX_FILE_BYTES, Math.max(size, bytes.byteLength * 2)));
          grown.set(bytes); bytes = grown;
        }
        bytes.set(next.value, size - next.value.byteLength);
      }
    } finally { reader.releaseLock(); }
  }
  bytes = bytes.subarray(0, size);
  requireValue(await sha256(bytes) === hash, 400, "file_hash_mismatch", "The uploaded file does not match its SHA-256.");
  await env.MEMORY.put(blobKey(access, hash), bytes, { httpMetadata: { contentType: "application/octet-stream" }, sha256: hash });
  await env.DB.prepare("INSERT OR IGNORE INTO agent_blobs(owner_key,sha256,bytes,created_by,created_at) VALUES (?,?,?,?,?)")
    .bind(access.key, hash, size, user.id, new Date().toISOString()).run();
  return ok({ sha256: hash, bytes: size, owner: access.owner }, 201);
}

async function fileResponse(env: Env, access: OwnerAccess, file: FileRef): Promise<Response> {
  const object = await env.MEMORY.get(blobKey(access, file.sha256));
  requireValue(object && object.size === file.bytes, 503, "file_unavailable", "The saved file is unavailable or failed its size check.");
  return new Response(object.body, { headers: {
    "content-type": file.mediaType, "content-length": String(file.bytes), "cache-control": "no-store",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split("/").at(-1) || "file")}`,
    "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff", etag: `"${file.sha256}"`,
  } });
}

type ExportPlan = { id: string; owner_key: string; include_shared: number; created_at: string; expires_at: string; request_hash: string;retained_at:string|null;label:string };
const planView = (plan: ExportPlan, access: OwnerAccess) => ({ id: plan.id, owner: access.owner,
  createdAt: plan.created_at, expiresAt:plan.retained_at?null:plan.expires_at, includeShared: Boolean(plan.include_shared),retainedAt:plan.retained_at||null,label:plan.label||'' });

async function createExportPlan(request: Request, env: Env, user: Principal, access: OwnerAccess): Promise<Response> {
  const input = await body(request, z.object({ agentIds: z.array(recordId).max(10_000).optional(), includeShared: z.boolean().optional(),state:z.unknown().optional() }).strict(), MAX_METADATA-4096, 50_000);
  const selected = input.agentIds ? [...new Set(input.agentIds)].sort() : null;
  let customState:SquadState|undefined;
  if(input.state!==undefined) {
    requireValue(access.canWrite,403,'owner_read_only','Only a writable owner may freeze uploaded backup state.');
    requireValue(input.includeShared!==false,400,'invalid_selection','Uploaded backup state must be included in the frozen export.');
    try{customState=validateState(input.state);}catch{throw new ApiError(400,'invalid_state','Provide valid portable backup state.');}
    await checkFiles(env,access,customState.shared.files);
  }
  const includeShared = customState?true:input.includeShared ?? !selected;
  const key = request.headers.get("idempotency-key") || "";
  requireValue(/^[a-zA-Z0-9._:-]{1,128}$/.test(key), 400, "idempotency_required", "Provide an Idempotency-Key for this frozen export.");
  const requestHash = await digest(JSON.stringify({ selected, includeShared,...(customState?{state:customState}:{}) }));
  const id = crypto.randomUUID(), createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const existing=await env.DB.prepare('SELECT * FROM owned_exports WHERE owner_key=? AND actor_id=? AND idempotency_key=?').bind(access.key,user.id,key).first<ExportPlan>();
  if(existing) {
    requireValue(existing.request_hash===requestHash,409,'idempotency_conflict','This Idempotency-Key belongs to another export selection.');
    requireValue(existing.retained_at||existing.expires_at>createdAt,410,'export_expired','This export expired. Use a new Idempotency-Key.');
    return ok(planView(existing,access));
  }
  const ids = selected ? JSON.stringify(selected) : null;
  let stateObject='';
  if(customState) {
    stateObject=`owners/${access.key}/records/squad/state/${crypto.randomUUID()}.json`;
    await env.MEMORY.put(stateObject,JSON.stringify({schemaVersion:1,owner:access.owner,kind:'squad',id:'state',revision:1,deleted:false,content:customState,createdAt,updatedAt:createdAt,updatedBy:user.subject}),{httpMetadata:{contentType:'application/json'}});
  }
  // D1 batch is one transaction: both the agents and shared head are captured
  // together. Validation is inside that transaction too, not a racy preflight.
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO owned_exports(id,owner_key,actor_id,idempotency_key,request_hash,include_shared,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE ? IS NULL OR
      (SELECT count(*) FROM owned_records WHERE owner_key=? AND kind='agent' AND deleted=0 AND id IN (SELECT value FROM json_each(?)))=?`)
      .bind(id, access.key, user.id, key, requestHash, Number(includeShared), createdAt, expiresAt, ids, access.key, ids, selected?.length ?? 0),
    env.DB.prepare(`INSERT OR IGNORE INTO owned_export_records(plan_id,kind,id,revision,object_key,name,role)
      SELECT ?,kind,id,revision,object_key,name,role FROM owned_records
      WHERE owner_key=? AND deleted=0 AND EXISTS (SELECT 1 FROM owned_exports WHERE id=?)
      AND ((kind='squad' AND id='state' AND ?=0) OR (kind='agent' AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))))`)
      .bind(id, access.key, id, Number(Boolean(customState)),ids, ids),
    env.DB.prepare(`INSERT OR IGNORE INTO owned_export_records(plan_id,kind,id,revision,object_key,name,role) SELECT ?,'squad','state',1,?,'','' WHERE ?<>'' AND EXISTS (SELECT 1 FROM owned_exports WHERE id=?)`).bind(id,stateObject,stateObject,id),
    env.DB.prepare(`INSERT INTO agent_audit(owner_key,actor_id,action,target_id,created_at)
      SELECT owner_key,actor_id,'export.frozen',id,created_at FROM owned_exports WHERE id=?`).bind(id),
  ]);
  const saved = await env.DB.prepare("SELECT * FROM owned_exports WHERE owner_key=? AND actor_id=? AND idempotency_key=?")
    .bind(access.key, user.id, key).first<ExportPlan>();
  requireValue(saved, 404, "agent_not_found", "An agent in this export selection was not found.");
  requireValue(saved.request_hash === requestHash, 409, "idempotency_conflict", "This Idempotency-Key belongs to another export selection.");
  requireValue(saved.retained_at||saved.expires_at > createdAt, 410, "export_expired", "This export expired. Start a new export with a new Idempotency-Key.");
  return ok(planView(saved, access), saved.id === id ? 201 : 200);
}

async function exportPlanRoutes(request: Request, env: Env, user: Principal, access: OwnerAccess, path: string, url: URL): Promise<Response> {
  if (path === "exports" && request.method === "POST") return createExportPlan(request, env, user, access);
  if(path==='exports'&&request.method==='GET') {
    const limit=Number(url.searchParams.get('limit')||50),cursor=url.searchParams.get('cursor')||'',parts=cursor.split('|');
    requireValue(Number.isInteger(limit)&&limit>0&&limit<=100&&(!cursor||parts.length===2&&z.iso.datetime().safeParse(parts[0]).success&&z.uuid().safeParse(parts[1]).success),400,'cursor_invalid','Use a valid retained-backup cursor and limit from 1 to 100.');
    const rows=(await env.DB.prepare(`SELECT e.*,(SELECT count(*) FROM owned_export_records r WHERE r.plan_id=e.id AND r.kind='agent') AS member_count FROM owned_exports e
      WHERE owner_key=? AND retained_at IS NOT NULL AND (?='' OR (created_at,id)<(?,?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
      .bind(access.key,cursor,parts[0]||'',parts[1]||'',limit+1).all<ExportPlan&{member_count:number}>()).results;
    const page=rows.slice(0,limit),last=page.at(-1);
    return ok({backups:page.map(plan=>({...planView(plan,access),memberCount:plan.member_count})),hasMore:rows.length>limit,cursor:last?`${last.created_at}|${last.id}`:cursor});
  }
  const match = path.match(/^exports\/([a-f0-9-]{36})(?:\/(.*))?$/);
  requireValue(match && z.uuid().safeParse(match[1]).success, 404, "export_not_found", "Export not found.");
  const plan = await env.DB.prepare("SELECT * FROM owned_exports WHERE owner_key=? AND id=?").bind(access.key, match[1]).first<ExportPlan>();
  requireValue(plan, 404, "export_not_found", "Export not found.");
  requireValue(plan.retained_at||plan.expires_at > new Date().toISOString(), 410, "export_expired", "This frozen export expired. Start a new export.");
  if(match[2]==='retain'&&request.method==='POST') {
    const input=await body(request,z.object({label:z.string().trim().min(1).max(120)}).strict(),1024);
    const stamp=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_audit(owner_key,actor_id,action,target_id,created_at) SELECT owner_key,?,'backup.retained',id,? FROM owned_exports WHERE owner_key=? AND id=? AND retained_at IS NULL AND expires_at>? AND (SELECT count(*) FROM owned_exports WHERE owner_key=? AND retained_at IS NOT NULL)<1000`).bind(user.id,stamp,access.key,plan.id,stamp,access.key),
      env.DB.prepare('UPDATE owned_exports SET retained_at=?,label=? WHERE owner_key=? AND id=? AND retained_at IS NULL AND expires_at>? AND (SELECT count(*) FROM owned_exports WHERE owner_key=? AND retained_at IS NOT NULL)<1000').bind(stamp,input.label,access.key,plan.id,stamp,access.key),
    ]);
    const retained=await env.DB.prepare('SELECT * FROM owned_exports WHERE owner_key=? AND id=?').bind(access.key,plan.id).first<ExportPlan>();
    requireValue(retained?.retained_at,409,'backup_not_retained','The backup was not retained. Remove an older backup if this owner has reached 1,000 retained backups, or create a fresh export if this one expired.');
    return ok(planView(retained,access));
  }
  if(!match[2]&&request.method==='DELETE') {
    const input=await body(request,z.object({confirm:z.literal('remove-cloud-backup')}).strict(),256);
    void input;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_audit(owner_key,actor_id,action,target_id,created_at) SELECT owner_key,?,'backup.removed',id,? FROM owned_exports WHERE owner_key=? AND id=?`).bind(user.id,new Date().toISOString(),access.key,plan.id),
      env.DB.prepare('DELETE FROM owned_exports WHERE owner_key=? AND id=?').bind(access.key,plan.id),
    ]);
    return ok({id:plan.id,removed:true});
  }
  requireValue(request.method === "GET", 405, "method_not_allowed", "Frozen export records are immutable. Use the explicit retain or remove operation.");
  if (!match[2]) return ok(planView(plan, access));
  if (match[2] === "agents") {
    const cursor = url.searchParams.get("cursor") || "", limit = Number(url.searchParams.get("limit") || 100);
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100 && (!cursor || recordId.safeParse(cursor).success), 400, "cursor_invalid", "Use a valid cursor and limit from 1 to 100.");
    const rows = (await env.DB.prepare("SELECT id,name,role,revision FROM owned_export_records WHERE plan_id=? AND kind='agent' AND id>? ORDER BY id LIMIT ?")
      .bind(plan.id, cursor, limit + 1).all<{ id: string; name: string; role: string; revision: number }>()).results;
    const page = rows.slice(0, limit);
    return ok({ ...planView(plan, access), agents: page, cursor: page.at(-1)?.id || cursor, hasMore: rows.length > limit });
  }
  const agentPath = match[2].match(/^agents\/([^/]+)(?:\/files\/([^/]+))?$/);
  const statePath = match[2].match(/^state(?:\/files\/([^/]+))?$/);
  requireValue(agentPath || statePath, 404, "record_not_found", "Export record not found.");
  let id: string, fileId: string | undefined;
  try {
    id = statePath ? "state" : decodeURIComponent(agentPath![1]);
    const rawFile = statePath ? statePath[1] : agentPath![2];
    fileId = rawFile ? decodeURIComponent(rawFile) : undefined;
  } catch { throw new ApiError(400, "record_invalid", "Invalid record or file ID."); }
  requireValue(recordId.safeParse(id).success && (!fileId || recordId.safeParse(fileId).success), 404, "record_not_found", "Export record not found.");
  const kind: Kind = statePath ? "squad" : "agent";
  const pointer = await env.DB.prepare("SELECT revision,object_key FROM owned_export_records WHERE plan_id=? AND kind=? AND id=?")
    .bind(plan.id, kind, id).first<{ revision: number; object_key: string }>();
  if (!pointer && kind === "squad" && !fileId) return ok({ kind, id, revision: 0, owner: access.owner, deleted: false, content: emptyState() });
  requireValue(pointer, 404, "record_not_found", "Export record not found.");
  const snapshot = await readSnapshot(env, access, pointer.object_key);
  requireValue(snapshot.kind === kind && snapshot.id === id && snapshot.revision === pointer.revision && snapshot.content && !snapshot.deleted,
    503, "record_invalid", "The frozen record does not match its pointer.");
  if (snapshot.kind === "squad" && snapshot.content && !plan.include_shared) snapshot.content.shared = { data: {}, files: [] };
  if (!fileId) return ok(snapshot);
  const files = snapshot.content && ("files" in snapshot.content ? snapshot.content.files : snapshot.content.shared.files);
  const file = files && files.find(file => file.id === fileId);
  requireValue(file, 404, "file_not_found", "Export file not found.");
  return fileResponse(env, access, file);
}

async function exportOwner(request: Request, env: Env, access: OwnerAccess, url: URL): Promise<Response> {
  const format = url.searchParams.get("format") || "json";
  requireValue(format === "json" || format === "yaml", 400, "format_invalid", "Choose json or yaml.");
  const selected = [...new Set(url.searchParams.getAll("agent"))];
  requireValue(selected.length <= 10_000 && selected.every(id => recordId.safeParse(id).success), 400, "selection_invalid", "Choose valid agent IDs.");
  // One SQL read freezes both sets of immutable object pointers. Reading the
  // shared head after fetching agent objects could mix two different revisions.
  const records = (await env.DB.prepare("SELECT kind,id,revision,object_key FROM owned_records WHERE owner_key=? AND deleted=0 ORDER BY kind,id LIMIT 10002")
    .bind(access.key).all<{ kind: Kind; id: string; revision: number; object_key: string }>()).results;
  const rows = records.filter(row => row.kind === "agent");
  requireValue(rows.length <= 10_000, 413, "export_too_large", "Select fewer agents for this backup.");
  const wanted = selected.length ? rows.filter(row => selected.includes(row.id)) : rows;
  requireValue(wanted.length + 16 <= MAX_EXPORT_READS, 413, "export_requires_plan", "Use a paginated frozen export plan for this backup; the convenience response exceeds its read budget.");
  requireValue(!selected.length || wanted.length === selected.length, 404, "agent_not_found", "An agent in the selection was not found.");
  let size = 0, structure = 0; const agents: Agent[] = [];
  for (const row of wanted) {
    const record = await readSnapshot(env, access, row.object_key);
    requireValue(record.kind === "agent" && record.content && !record.deleted, 503, "agent_unavailable", "A saved agent is unavailable.");
    requireValue(record.id === row.id && record.content.id === row.id && record.revision === row.revision, 503, "record_invalid", "An exported record does not match its saved pointer.");
    size += new TextEncoder().encode(JSON.stringify(record.content)).byteLength;
    requireValue(size <= MAX_EXPORT_METADATA, 413, "export_too_large", "Select fewer agents; backup metadata exceeds 16 MiB.");
    agents.push(record.content);
    const count = (item: unknown): number => !item || typeof item !== "object" ? 1 : 1 + Object.values(item).reduce<number>((sum, child) => sum + count(child), 0);
    structure += count(record.content);
    requireValue(structure <= 100_000, 413, "export_requires_plan", "Use a paginated frozen export plan; aggregate metadata is too complex for one response.");
  }
  const sharedRow = records.find(row => row.kind === "squad" && row.id === "state");
  const shared = sharedRow ? await readSnapshot(env, access, sharedRow.object_key) : null;
  const state = shared?.kind === "squad" && shared.content && !shared.deleted ? shared.content : emptyState();
  if (selected.length) state.shared = { data: {}, files: [] };
  const manifest: Manifest = { ...state, format: "autohand-squad", schemaVersion: 1, createdAt: new Date().toISOString(), owner: access.owner, agents };
  try { checkStructure(manifest, 100_000); } catch { throw new ApiError(413, "export_requires_plan", "Use a paginated frozen export plan for this backup's metadata."); }
  requireValue(wanted.length + inventory(manifest).length + (sharedRow ? 1 : 0) + 16 <= MAX_EXPORT_READS, 413, "export_requires_plan", "Use a paginated frozen export plan; this response exceeds its combined read budget.");
  const estimatedBytes = new TextEncoder().encode(JSON.stringify(manifest)).byteLength
    + inventory(manifest).reduce((total, file) => total + Math.ceil(file.bytes / 3) * 4 + 2048, 0);
  requireValue(estimatedBytes <= MAX_DOCUMENT_BYTES, 413, "export_too_large", "Select fewer agents; a portable document may contain up to 256 MiB. Nothing was truncated.");
  const chunks = streamBackup(manifest, format, async file => {
    if (request.signal.aborted) throw new ApiError(499, "export_cancelled", "Backup download was cancelled.");
    const object = await env.MEMORY.get(blobKey(access, file.sha256));
    requireValue(object && object.size === file.bytes, 503, "file_unavailable", "A backup file is unavailable. No complete backup was produced.");
    return { async *[Symbol.asyncIterator]() {
      const reader = object.body.getReader();
      try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } }
      finally { reader.releaseLock(); }
    } };
  }, { createDigest: () => {
    const stream = new crypto.DigestStream("SHA-256"); const writer = stream.getWriter();
    void stream.digest.catch(() => {});
    return { write: async chunk => { await writer.write(chunk); },
      finish: async () => { await writer.close(); return Array.from(new Uint8Array(await stream.digest), byte => byte.toString(16).padStart(2, "0")).join(""); },
      cancel: async () => { await writer.abort().catch(() => {}); } };
  } });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const next = await chunks.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value)); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await chunks.return(undefined); },
  });
  return new Response(stream, { headers: {
    "content-type": format === "yaml" ? "application/yaml; charset=utf-8" : "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="squad-backup.${format}"`, "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
}

export async function agentRoutes(request: Request, env: Env, user: Principal, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/v1\/(users\/me|teams\/([^/]+))\/(agents(?:\/.*)?|files\/([a-f0-9]{64})|state|export|exports(?:\/.*)?)$/);
  if (!match) return null;
  let teamId: string | undefined;
  try { teamId = match[2] ? decodeURIComponent(match[2]) : undefined; } catch { throw new ApiError(400, "owner_invalid", "Invalid team ID."); }
  const readPlan = match[3] === "exports" && request.method === "POST";
  const access = await accessOwner(request, env, user, teamId, !["GET", "HEAD"].includes(request.method) && !readPlan);
  const rest = match[3];
  if (rest === "exports" || rest.startsWith("exports/")) return exportPlanRoutes(request, env, user, access, rest, url);
  if (rest === "export" && request.method === "GET") return exportOwner(request, env, access, url);
  if (match[4] && request.method === "PUT") return uploadFile(request, env, user, access, match[4]);
  if (rest === "state") {
    if (request.method === "GET") return ok(await current(env, access, "squad", "state") || { schemaVersion: 1, owner: access.owner, kind: "squad", id: "state", revision: 0, deleted: false, content: emptyState() });
    if (request.method === "PUT") return publish(request, env, user, access, "squad", "state");
  }
  if (rest === "agents" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 100), cursor = url.searchParams.get("cursor") || "";
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100 && (!cursor || recordId.safeParse(cursor).success), 400, "cursor_invalid", "Use a valid cursor and limit from 1 to 100.");
    const rows = (await env.DB.prepare("SELECT id,name,role,revision,updated_at AS updatedAt FROM owned_records WHERE owner_key=? AND kind='agent' AND deleted=0 AND id>? ORDER BY id LIMIT ?")
      .bind(access.key, cursor, limit + 1).all<{ id: string; name: string; role: string; revision: number; updatedAt: string }>()).results;
    const page = rows.slice(0, limit);
    return ok({ owner: access.owner, agents: page, cursor: page.at(-1)?.id || cursor, hasMore: rows.length > limit });
  }
  const agentPath = rest.match(/^agents\/([^/]+)(?:\/(memories|files)(?:\/([^/]+))?)?$/);
  if (agentPath) {
    let id: string, fileId: string | undefined;
    try { id = decodeURIComponent(agentPath[1]); fileId = agentPath[3] ? decodeURIComponent(agentPath[3]) : undefined; }
    catch { throw new ApiError(400, "agent_invalid", "Invalid agent or file ID."); }
    requireValue(recordId.safeParse(id).success && (!fileId || recordId.safeParse(fileId).success), 404, "agent_not_found", "Agent not found.");
    if (!agentPath[2] && request.method === "PUT") return publish(request, env, user, access, "agent", id);
    if (request.method === "GET") {
      const snapshot = await current(env, access, "agent", id);
      requireValue(snapshot?.kind === "agent", 404, "agent_not_found", "Agent not found.");
      if (!agentPath[2]) return ok(snapshot, 200, { etag: `"${snapshot.revision}"` });
      requireValue(snapshot.content && !snapshot.deleted, 404, "agent_not_found", "Agent not found.");
      if (agentPath[2] === "memories") return ok({ owner: access.owner, id, revision: snapshot.revision, memories: snapshot.content.memories, files: snapshot.content.files.filter(file => file.kind === "memory") });
      if (!fileId) return ok({ owner: access.owner, id, revision: snapshot.revision, files: snapshot.content.files });
      const file = snapshot.content.files.find(file => file.id === fileId);
      requireValue(file, 404, "file_not_found", "File not found.");
      return fileResponse(env, access, file);
    }
  }
  throw new ApiError(405, "method_not_allowed", "This owned resource does not support that operation.");
}
