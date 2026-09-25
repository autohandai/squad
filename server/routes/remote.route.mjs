// Remote members: which members run on another machine's bridge, tokens
// for machines that may use this one, and the helpers the chat/run routes
// call to forward a member's work (docs/integration/remote.md).

import { REMOTE_TRANSPORT_HEADER, bearerTokenFromRequest, isRemoteTransport, matchServedToken, mintToken } from "../remote/auth.mjs";
import { RemoteError, probe, proxyJson, proxyStream } from "../remote/proxy.mjs";
import { RemoteRegistryError, createRemoteRegistry, normalizeRemoteUrl } from "../remote/registry.mjs";

export const name = "remote";

const registries = new Map();

/** One registry per state dir, shared by the route and the chat/run wrappers. */
export function registryFor(ctx) {
  const dir = ctx?.squadStateDir;
  if (!dir) throw new RemoteRegistryError("bridge context has no squadStateDir", 500);
  if (!registries.has(dir)) registries.set(dir, createRemoteRegistry({ squadStateDir: dir }));
  return registries.get(dir);
}

export async function init(ctx) {
  registryFor(ctx);
}

/**
 * The remote record (with token) for a member, or null when the member runs
 * here. Pass the incoming `req` so a request that already arrived through
 * another bridge's proxy is never forwarded again (no proxy loops).
 */
export async function resolveRemote(ctx, memberId, { req } = {}) {
  const id = String(memberId || "").trim();
  if (!id || id.startsWith("_")) return null;
  if (req && isRemoteTransport(req)) return null;
  try {
    return await registryFor(ctx).get(id);
  } catch {
    return null;
  }
}

/**
 * Serving side: does this request carry a token this bridge minted?
 * `{ remote: false }` for ordinary local requests, `{ remote: true, allowed,
 * token }` when a bearer token or the transport header is present.
 */
export async function remoteRequestAuth(ctx, req) {
  const presented = bearerTokenFromRequest(req);
  if (!presented && !isRemoteTransport(req)) return { remote: false, allowed: false, token: null };
  const served = await registryFor(ctx).servedTokens();
  const match = matchServedToken(req, served);
  return { remote: true, allowed: Boolean(match), token: match ? { id: match.id, label: match.label } : null };
}

function fail(ctx, res, error) {
  const status = error instanceof RemoteError || error instanceof RemoteRegistryError ? error.status || 400 : error?.status || 400;
  ctx.json(res, status, {
    success: false,
    error: error?.message || String(error),
    ...(error instanceof RemoteError ? { remote: error.remote, retryable: error.retryable !== false } : {}),
  });
}

function bridgeUrlFor(req) {
  const host = String(req.headers.host || "").trim();
  return host ? `http://${host}` : "";
}

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith("/api/remote/")) return false;
  const registry = registryFor(ctx);

  try {
    if (url.pathname === "/api/remote/members" && req.method === "GET") {
      ctx.json(res, 200, { success: true, data: await registry.list() });
      return true;
    }

    const memberMatch = url.pathname.match(/^\/api\/remote\/members\/([^/]+)$/);
    if (memberMatch && req.method === "PUT") {
      const payload = await ctx.readBody(req);
      const existing = await registry.get(memberMatch[1]).catch(() => null);
      const candidate = {
        url: normalizeRemoteUrl(payload.url),
        token: String(payload.token || "").trim() || existing?.token || "",
        label: String(payload.label || "").trim(),
      };
      if (!candidate.token) throw new RemoteRegistryError("bridge token is required");
      let checked;
      try {
        checked = await probe(candidate);
      } catch (error) {
        ctx.json(res, 400, { success: false, error: error.message, remote: error.remote || null, retryable: error.retryable !== false });
        return true;
      }
      const saved = await registry.set(memberMatch[1], { ...candidate, workspace: payload.workspace });
      ctx.logEvent?.(ctx.SEVERITY?.INFO, `remote member ${saved.memberId} → ${saved.label}`, { "event.name": "remote.member.set", "autohand.member": saved.memberId });
      ctx.json(res, 200, { success: true, data: { ...saved, probe: checked } });
      return true;
    }
    if (memberMatch && req.method === "DELETE") {
      const removed = await registry.remove(memberMatch[1]);
      ctx.json(res, 200, { success: true, data: { memberId: memberMatch[1], removed } });
      return true;
    }
    if (memberMatch && req.method === "GET") {
      const record = await registry.get(memberMatch[1]);
      if (!record) {
        ctx.json(res, 404, { success: false, error: "member does not run remotely" });
        return true;
      }
      const { token: _token, ...rest } = record;
      ctx.json(res, 200, { success: true, data: { ...rest, hasToken: Boolean(_token) } });
      return true;
    }

    const probeMatch = url.pathname.match(/^\/api\/remote\/members\/([^/]+)\/probe$/);
    if (probeMatch && req.method === "POST") {
      // Probe the saved remote, or a candidate from the body (URL + token)
      // so the settings row can test before it saves.
      const payload = await ctx.readBody(req);
      const saved = await registry.get(probeMatch[1]).catch(() => null);
      const target = payload.url
        ? { url: normalizeRemoteUrl(payload.url), token: String(payload.token || "").trim() || saved?.token || "", label: String(payload.label || "").trim() || saved?.label }
        : saved;
      if (!target) throw new RemoteRegistryError("member does not run remotely", 404);
      ctx.json(res, 200, { success: true, data: await probe(target) });
      return true;
    }

    const presenceMatch = url.pathname.match(/^\/api\/remote\/members\/([^/]+)\/presence$/);
    if (presenceMatch && req.method === "GET") {
      const record = await registry.get(presenceMatch[1]);
      if (!record) throw new RemoteRegistryError("member does not run remotely", 404);
      try {
        const data = await proxyJson(record, "/api/members/presence");
        ctx.json(res, 200, { success: true, data: { available: true, ...(data && typeof data === "object" ? data : { presence: data }) } });
      } catch (error) {
        if (error instanceof RemoteError && error.status === 404) {
          ctx.json(res, 200, { success: true, data: { available: false, transport: "remote", remote: error.remote } });
          return true;
        }
        throw error;
      }
      return true;
    }

    if (url.pathname === "/api/remote/tokens" && req.method === "GET") {
      const served = await registry.servedTokens();
      ctx.json(res, 200, { success: true, data: served.map(({ id, label, createdAt }) => ({ id, label, createdAt })) });
      return true;
    }
    if (url.pathname === "/api/remote/tokens" && req.method === "POST") {
      const payload = await ctx.readBody(req);
      const token = mintToken();
      const record = await registry.addServedToken({ token, label: payload.label });
      ctx.logEvent?.(ctx.SEVERITY?.INFO, `minted remote token ${record.id} (${record.label})`, { "event.name": "remote.token.minted" });
      // The clear token leaves the bridge exactly once, in this response.
      ctx.json(res, 201, { success: true, data: { ...record, token, url: bridgeUrlFor(req), header: REMOTE_TRANSPORT_HEADER } });
      return true;
    }
    const tokenMatch = url.pathname.match(/^\/api\/remote\/tokens\/([^/]+)$/);
    if (tokenMatch && req.method === "DELETE") {
      ctx.json(res, 200, { success: true, data: { id: tokenMatch[1], removed: await registry.removeServedToken(tokenMatch[1]) } });
      return true;
    }
  } catch (error) {
    fail(ctx, res, error);
    return true;
  }
  return false;
}

export { RemoteError, probe, proxyJson, proxyStream };
