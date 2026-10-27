import { z } from "zod";
import type { Env } from "./env.js";
import { ApiError, body, digest, ok, requireValue, token } from "./http.js";

const profileSchema = z.object({ success: z.literal(true), profile: z.object({
  id: z.string().min(1).max(256), email: z.email(), name: z.string().nullable().optional(), status: z.string().nullable().optional(),
}) });
export interface Principal { id: string; email: string; displayName: string; sessionId: string }
export async function authenticate(request: Request, env: Env): Promise<Principal> {
  const value = request.headers.get("authorization")?.match(/^Bearer (ss_[a-f0-9]{64})$/)?.[1];
  requireValue(value, 401, "sign_in_required", "Sign in to Squad.");
  const row = await env.DB.prepare(`SELECT i.id, i.email, i.display_name AS displayName, s.id AS sessionId
    FROM sessions s JOIN identities i ON i.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await digest(value), new Date().toISOString()).first<Principal>();
  requireValue(row, 401, "session_expired", "Your Squad session expired. Sign in again.");
  return row;
}
export async function exchangeIdentity(request: Request, env: Env): Promise<Response> {
  const input = await body(request, z.object({ identityToken: z.string().min(1).max(8192), deviceName: z.string().trim().min(1).max(120) }).strict(), 12_000);
  const now = new Date();
  // Store only a short-lived hash bucket, never an IP address or identity token.
  const bucket = await digest(`${request.headers.get("cf-connecting-ip") || "local"}:${Math.floor(now.getTime() / 60_000)}`);
  const admitted = await env.DB.prepare(`INSERT INTO auth_limits(bucket,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<30`).bind(bucket, new Date(now.getTime() + 120_000).toISOString()).run();
  requireValue(admitted.meta.changes, 429, "too_many_attempts", "Too many sign-in attempts. Try again shortly.");
  const identityUrl = new URL("/v1/profile", env.IDENTITY_ORIGIN);
  requireValue(identityUrl.protocol === "https:", 503, "identity_unconfigured", "Identity service must use HTTPS.");
  let response: Response;
  try { response = await fetch(identityUrl, { headers: { authorization: `Bearer ${input.identityToken}`, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(8000) }); }
  catch { throw new ApiError(503, "identity_unavailable", "Sign-in is temporarily unavailable. Try again."); }
  requireValue(response.ok, response.status === 401 || response.status === 403 ? 401 : 503, "identity_rejected", "Sign-in could not be verified.");
  let identity: z.infer<typeof profileSchema>;
  try { identity = await body(response, profileSchema, 128 * 1024); }
  catch { throw new ApiError(503, "identity_invalid", "Identity service returned an invalid profile."); }
  requireValue(!["suspended", "disabled", "deleted"].includes(identity.profile.status || ""), 403, "identity_disabled", "This account is unavailable.");
  const profile = identity.profile;
  const issuer = identityUrl.origin;
  const stamp = now.toISOString();
  await env.DB.prepare(`INSERT INTO identities(id,issuer,subject,email,display_name,created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email, display_name=excluded.display_name`)
    .bind(crypto.randomUUID(), issuer, profile.id, profile.email.toLowerCase(), profile.name || profile.email, stamp).run();
  const user = await env.DB.prepare("SELECT id,email,display_name AS displayName FROM identities WHERE issuer=? AND subject=?")
    .bind(issuer, profile.id).first<{ id: string; email: string; displayName: string }>();
  requireValue(user, 503, "session_unavailable", "Squad could not create a session.");
  const sessionToken = token("ss_");
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions(id,token_hash,user_id,label,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(sessionId, await digest(sessionToken), user.id, input.deviceName, stamp, expiresAt).run();
  return ok({ token: sessionToken, sessionId, expiresAt, user }, 201);
}
