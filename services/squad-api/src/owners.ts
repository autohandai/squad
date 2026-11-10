import { z } from "zod";
import type { Owner } from "@autohand/squad-portable";
import type { Env } from "./env.js";
import { verifyIdentity, type Principal } from "./auth.js";
import { ApiError, body, digest, requireValue } from "./http.js";

const accountsSchema = z.object({ success: z.literal(true), accounts: z.array(z.object({
  account: z.object({ id: z.string().min(1).max(256), name: z.string(), type: z.enum(["personal", "team"]),
    accessMode: z.enum(["full", "read_only"]), status: z.enum(["active", "suspended", "pending", "cancelled"]) }),
  role: z.enum(["owner", "admin", "contributor"]), permissions: z.array(z.string()),
})).max(10_000) });

export interface OwnerAccess { owner: Owner; key: string; label: string; role: "owner" | "admin" | "editor"; canWrite: boolean }
export const personalOwner = (user: Principal): Owner => ({ kind: "user", issuer: user.issuer, id: user.subject });
export const ownerKey = (owner: Owner): Promise<string> => digest(JSON.stringify([owner.issuer, owner.kind, owner.id]));

export async function availableOwners(request: Request, env: Env, user: Principal): Promise<OwnerAccess[]> {
  const own = personalOwner(user);
  const result: OwnerAccess[] = [{ owner: own, key: await ownerKey(own), label: user.displayName || user.email, role: "owner", canWrite: true }];
  const identity = request.headers.get("x-autohand-identity");
  if (!identity) return result;
  const profile = await verifyIdentity(identity, env);
  requireValue(new URL(env.IDENTITY_ORIGIN).origin === user.issuer && profile.id === user.subject, 401, "identity_mismatch", "The Autohand credential belongs to another signed-in account.");
  let response: Response;
  try { response = await fetch(new URL("/v1/accounts", env.IDENTITY_ORIGIN), {
    headers: { authorization: `Bearer ${identity}`, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(8000),
  }); } catch { throw new ApiError(503, "membership_unavailable", "Current team access could not be verified."); }
  requireValue(response.ok, response.status === 401 || response.status === 403 ? 401 : 503, "membership_unavailable", "Current team access could not be verified.");
  let accounts: z.infer<typeof accountsSchema>;
  try { accounts = await body(response, accountsSchema, 1024 * 1024); }
  catch { throw new ApiError(503, "membership_invalid", "The account service returned invalid membership information."); }
  for (const context of accounts.accounts) {
    if (context.account.type !== "team") continue;
    const owner: Owner = { kind: "team", issuer: user.issuer, id: context.account.id };
    result.push({ owner, key: await ownerKey(owner), label: context.account.name,
      role: context.role === "contributor" ? "editor" : context.role,
      canWrite: context.account.accessMode === "full" && context.permissions.includes("resources:operate"),
    });
  }
  return result;
}

export async function accessOwner(request: Request, env: Env, user: Principal, teamId?: string, write = false): Promise<OwnerAccess> {
  if (teamId) requireValue(request.headers.get("x-autohand-identity"), 401, "identity_required", "Team operations require the current X-Autohand-Identity credential.");
  const owners = teamId ? await availableOwners(request, env, user) : [{ owner: personalOwner(user), key: await ownerKey(personalOwner(user)), label: user.displayName, role: "owner" as const, canWrite: true }];
  const access = owners.find(item => teamId ? item.owner.kind === "team" && item.owner.id === teamId : item.owner.kind === "user");
  requireValue(access, 404, "owner_not_found", "Squad owner not found.");
  requireValue(!write || access.canWrite, 403, "owner_read_only", "This team is read-only. Retrieval and backup remain available.");
  return access;
}
