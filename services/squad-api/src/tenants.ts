import { z } from "zod";
import type { Env } from "./env.js";
import type { Principal } from "./auth.js";
import { body, digest, ok, requireValue, token } from "./http.js";
import { nameSchema, roleSchema, type Role } from "./schema.js";

export async function membership(env: Env, user: Principal, tenantId: string, access: "read" | "write" | "admin" | "owner" = "read"): Promise<Role> {
  const row = await env.DB.prepare("SELECT role FROM memberships WHERE tenant_id=? AND user_id=?").bind(tenantId, user.id).first<{ role: Role }>();
  // Unknown and other tenants are deliberately indistinguishable.
  requireValue(row, 404, "tenant_not_found", "Tenant not found.");
  const allowed = access === "owner" ? ["owner"] : access === "admin" ? ["owner", "admin"] : access === "write" ? ["owner", "admin", "editor"] : ["owner", "admin", "editor", "viewer"];
  requireValue(allowed.includes(row.role), 403, "role_required", "Your role cannot perform this operation.");
  return row.role;
}
export async function workspace(env: Env, user: Principal, tenantId: string, workspaceId: string, write = false): Promise<void> {
  await membership(env, user, tenantId, write ? "write" : "read");
  const row = await env.DB.prepare("SELECT archived_at FROM workspaces WHERE tenant_id=? AND id=?").bind(tenantId, workspaceId).first<{ archived_at: string | null }>();
  requireValue(row, 404, "workspace_not_found", "Workspace not found.");
  requireValue(!row.archived_at, 410, "workspace_archived", "This workspace is archived. Local data has not been removed.");
}
export function audit(env: Env, tenant: string, actor: string, action: string, target: string): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO audit_events(tenant_id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)").bind(tenant, actor, action, target, new Date().toISOString());
}
export async function tenantRoutes(request: Request, env: Env, user: Principal, path: string): Promise<Response | null> {
  const now = new Date().toISOString();
  if (path === "/v1/tenants" && request.method === "GET") {
    return ok((await env.DB.prepare("SELECT t.id,t.name,t.created_at AS createdAt,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? ORDER BY t.created_at,t.id").bind(user.id).all()).results);
  }
  if (path === "/v1/tenants" && request.method === "POST") {
    const { name } = await body(request, z.object({ name: nameSchema }).strict()); const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tenants(id,name,created_at) VALUES (?,?,?)").bind(id, name, now),
      env.DB.prepare("INSERT INTO memberships(tenant_id,user_id,role,created_at) VALUES (?,?,'owner',?)").bind(id, user.id, now), audit(env, id, user.id, "tenant.created", id),
    ]);
    return ok({ id, name, role: "owner", createdAt: now }, 201);
  }
  if (path === "/v1/invitations/accept" && request.method === "POST") {
    const input = await body(request, z.object({ token: z.string().regex(/^si_[a-f0-9]{64}$/) }).strict());
    const invite = await env.DB.prepare("SELECT id,tenant_id,role FROM invitations WHERE token_hash=? AND email=? AND expires_at>? AND revoked_at IS NULL AND accepted_by IS NULL")
      .bind(await digest(input.token), user.email, now).first<{ id: string; tenant_id: string; role: Role }>();
    requireValue(invite, 404, "invitation_not_found", "This invitation is unavailable or belongs to another account.");
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships(tenant_id,user_id,role,created_at) SELECT tenant_id,?,role,? FROM invitations WHERE id=? AND accepted_by IS NULL AND revoked_at IS NULL
        ON CONFLICT(tenant_id,user_id) DO NOTHING`).bind(user.id, now, invite.id),
      env.DB.prepare("UPDATE invitations SET accepted_by=? WHERE id=? AND accepted_by IS NULL AND revoked_at IS NULL").bind(user.id, invite.id),
      audit(env, invite.tenant_id, user.id, "invitation.accepted", invite.id),
    ]);
    return ok({ tenantId: invite.tenant_id });
  }
  const match = path.match(/^\/v1\/tenants\/([a-f0-9-]{36})(?:\/(.*))?$/);
  if (!match) return null;
  const tenant = match[1]; const rest = match[2] || "";
  await membership(env, user, tenant);
  if (!rest && request.method === "PATCH") {
    await membership(env, user, tenant, "admin"); const { name } = await body(request, z.object({ name: nameSchema }).strict());
    await env.DB.batch([env.DB.prepare("UPDATE tenants SET name=? WHERE id=?").bind(name, tenant), audit(env, tenant, user.id, "tenant.renamed", tenant)]);
    return ok({ id: tenant, name });
  }
  if (rest === "members" && request.method === "GET") return ok((await env.DB.prepare("SELECT i.id,i.email,i.display_name AS displayName,m.role FROM memberships m JOIN identities i ON i.id=m.user_id WHERE m.tenant_id=? ORDER BY m.created_at,i.id").bind(tenant).all()).results);
  const member = rest.match(/^members\/([a-f0-9-]{36})$/);
  if (member && ["PATCH", "DELETE"].includes(request.method)) {
    const actorRole = await membership(env, user, tenant, "admin");
    const target = await env.DB.prepare("SELECT role FROM memberships WHERE tenant_id=? AND user_id=?").bind(tenant, member[1]).first<{ role: Role }>();
    requireValue(target, 404, "member_not_found", "Member not found.");
    requireValue(target.role !== "owner" && (target.role !== "admin" || actorRole === "owner"), 403, "owner_required", "Only the owner can manage administrators. Ownership cannot be removed.");
    if (request.method === "DELETE") {
      await env.DB.batch([env.DB.prepare("DELETE FROM memberships WHERE tenant_id=? AND user_id=? AND role!='owner'").bind(tenant, member[1]), audit(env, tenant, user.id, "member.removed", member[1])]);
    } else {
      const { role } = await body(request, z.object({ role: roleSchema.exclude(["owner"]) }).strict());
      requireValue(role !== "admin" || actorRole === "owner", 403, "owner_required", "Only the owner can grant administrator access.");
      await env.DB.batch([env.DB.prepare("UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=? AND role!='owner'").bind(role, tenant, member[1]), audit(env, tenant, user.id, "member.role_changed", member[1])]);
    }
    return ok({ id: member[1] });
  }
  if (rest === "invitations" && request.method === "POST") {
    const actor = await membership(env, user, tenant, "admin");
    const input = await body(request, z.object({ email: z.email().transform(value => value.toLowerCase()), role: roleSchema.exclude(["owner"]) }).strict());
    requireValue(input.role !== "admin" || actor === "owner", 403, "owner_required", "Only the owner can invite administrators.");
    const invitation = token("si_"); const id = crypto.randomUUID(); const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    await env.DB.batch([env.DB.prepare("INSERT INTO invitations(id,tenant_id,token_hash,email,role,created_by,expires_at) VALUES (?,?,?,?,?,?,?)").bind(id, tenant, await digest(invitation), input.email, input.role, user.id, expiresAt), audit(env, tenant, user.id, "invitation.created", id)]);
    return ok({ id, token: invitation, expiresAt }, 201);
  }
  const invitation = rest.match(/^invitations\/([a-f0-9-]{36})$/);
  if (invitation && request.method === "DELETE") {
    await membership(env, user, tenant, "admin");
    await env.DB.batch([env.DB.prepare("UPDATE invitations SET revoked_at=? WHERE tenant_id=? AND id=? AND accepted_by IS NULL").bind(now, tenant, invitation[1]), audit(env, tenant, user.id, "invitation.revoked", invitation[1])]);
    return ok({ id: invitation[1] });
  }
  if (rest === "workspaces" && request.method === "GET") return ok((await env.DB.prepare("SELECT id,name,created_at AS createdAt,archived_at AS archivedAt FROM workspaces WHERE tenant_id=? ORDER BY created_at,id").bind(tenant).all()).results);
  if (rest === "workspaces" && request.method === "POST") {
    await membership(env, user, tenant, "admin"); const { name } = await body(request, z.object({ name: nameSchema }).strict()); const id = crypto.randomUUID();
    await env.DB.batch([env.DB.prepare("INSERT INTO workspaces(id,tenant_id,name,created_at) VALUES (?,?,?,?)").bind(id, tenant, name, now), audit(env, tenant, user.id, "workspace.created", id)]);
    return ok({ id, tenantId: tenant, name, createdAt: now }, 201);
  }
  const archived = rest.match(/^workspaces\/([a-f0-9-]{36})$/);
  if (archived && request.method === "DELETE") {
    await membership(env, user, tenant, "admin");
    await env.DB.batch([env.DB.prepare("UPDATE workspaces SET archived_at=? WHERE tenant_id=? AND id=?").bind(now, tenant, archived[1]), audit(env, tenant, user.id, "workspace.archived", archived[1])]);
    return ok({ id: archived[1], archivedAt: now });
  }
  if (rest === "audit" && request.method === "GET") {
    await membership(env, user, tenant, "admin");
    return ok((await env.DB.prepare("SELECT id,actor_id AS actorId,action,target_id AS targetId,created_at AS createdAt FROM audit_events WHERE tenant_id=? ORDER BY id DESC LIMIT 100").bind(tenant).all()).results);
  }
  return null;
}
