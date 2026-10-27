import { z } from "zod";
import type { Env } from "./env.js";
import { authenticate, exchangeIdentity } from "./auth.js";
import { ApiError, body, ok, requireValue } from "./http.js";
import { tenantRoutes, workspace } from "./tenants.js";
import { memoryRoutes } from "./memory.js";
import { releaseRoutes } from "./releases.js";
import { idSchema, nameSchema } from "./schema.js";

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/health" && request.method === "GET") return ok({ service: "squad-api", apiVersion: 1 });
  const release = await releaseRoutes(request, env, url); if (release) return release;
  if (url.pathname === "/v1/auth/exchange" && request.method === "POST") return exchangeIdentity(request, env);
  const user = await authenticate(request, env);
  if (url.pathname === "/v1/me" && request.method === "GET") return ok({ id: user.id, email: user.email, displayName: user.displayName });
  if (url.pathname === "/v1/auth/session" && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(user.sessionId, user.id).run(); return ok({ signedOut: true });
  }
  if (url.pathname === "/v1/auth/sessions" && request.method === "GET") return ok((await env.DB.prepare("SELECT id,label,created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC").bind(user.id, new Date().toISOString()).all()).results);
  const session = url.pathname.match(/^\/v1\/auth\/sessions\/([a-f0-9-]{36})$/);
  if (session && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(session[1], user.id).run(); return ok({ id: session[1] });
  }
  const memory = await memoryRoutes(request, env, user, url); if (memory) return memory;
  const devices = url.pathname.match(/^\/v1\/tenants\/([a-f0-9-]{36})\/workspaces\/([a-f0-9-]{36})\/devices$/);
  if (devices && request.method === "POST") {
    const [, tenant, space] = devices;
    await workspace(env, user, tenant, space, true);
    const input = await body(request, z.object({ id: idSchema, label: nameSchema }).strict());
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`INSERT INTO devices(id,tenant_id,workspace_id,user_id,label,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,workspace_id,id) DO UPDATE SET label=excluded.label,last_seen_at=excluded.last_seen_at WHERE devices.user_id=excluded.user_id`)
      .bind(input.id, tenant, space, user.id, input.label, now, now).run();
    requireValue(result.meta.changes, 409, "device_conflict", "This device identity belongs to another member.");
    return ok({ ...input, tenantId: tenant, workspaceId: space, lastSeenAt: now });
  }
  if (devices && request.method === "GET") {
    await workspace(env, user, devices[1], devices[2]);
    return ok((await env.DB.prepare("SELECT id,label,user_id AS userId,last_seen_at AS lastSeenAt FROM devices WHERE tenant_id=? AND workspace_id=? ORDER BY last_seen_at DESC LIMIT 200").bind(devices[1], devices[2]).all()).results);
  }
  const tenant = await tenantRoutes(request, env, user, url.pathname); if (tenant) return tenant;
  throw new ApiError(404, "route_not_found", "Squad API route not found.");
}

export default {
  async fetch(request, env): Promise<Response> {
    const requestId = crypto.randomUUID(); const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const publicRelease = request.method === "GET" && /^\/v1\/releases\/(stable|nightly)\/manifest$/.test(url.pathname);
    let response: Response;
    try {
      requireValue(!origin || origin === env.WEB_ORIGIN || publicRelease, 403, "origin_denied", "This browser origin is not allowed.");
      response = request.method === "OPTIONS"
        ? new Response(null, { status: 204 })
        : await route(request, env, url);
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      if (status >= 500) console.error(JSON.stringify({ event: "request.failed", requestId, status }));
      response = Response.json({ success: false, error: { code: known ? error.code : "internal_error", message: known ? error.message : "Squad could not complete this request.", ...(known && error.details ? { details: error.details } : {}) }, requestId }, { status });
    }
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "no-referrer");
    if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
    if (origin === env.WEB_ORIGIN || publicRelease) {
      response.headers.set("access-control-allow-origin", publicRelease ? "*" : origin || env.WEB_ORIGIN);
      response.headers.set("vary", "Origin");
      response.headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      response.headers.set("access-control-allow-headers", "Authorization,Content-Type,Idempotency-Key,If-None-Match");
      response.headers.set("access-control-expose-headers", "ETag,X-Request-Id");
    }
    return response;
  },
  async scheduled(_event, env): Promise<void> {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_limits WHERE expires_at<?").bind(now),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now),
      env.DB.prepare("DELETE FROM invitations WHERE expires_at<?").bind(now),
    ]);
  },
} satisfies ExportedHandler<Env>;
