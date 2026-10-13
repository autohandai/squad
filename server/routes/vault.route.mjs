// Vault route plug-in (docs/integration/vault.md, ADR-0104).
//
//   GET    /api/vault                        { items (views), count, keySource, locked, error }
//   POST   /api/vault/items                  body: { kind, label?, fields } → view (values never return)
//   DELETE /api/vault/items/:id              → removed view
//   GET    /api/vault/requests?status=       { requests }
//   POST   /api/vault/requests/:id/secret    body: { fields, label? } → resolved request (id + hint)
//   POST   /api/vault/requests/:id/dismiss   → resolved request
//   POST   /api/vault/requests/:id/payment   body: { decision: approve|self|decline, itemId? }
//   GET    /api/vault/events                 SSE "changed" on every vault.request.* event
//   POST   /api/vault/mcp                    header x-squad-vault-token → MCP dispatch (members only)
//
// The service itself is built in server.mjs (it also injects the managed MCP
// server into member work) and handed over as ctx.vault.

import { VAULT_KINDS } from "../vault/crypto.mjs";

export const name = "vault";

const streams = new Set();

export async function init(ctx) {
  for (const eventName of ["vault.request.pending", "vault.request.resolved"]) {
    ctx.events?.on?.(eventName, (event) => {
      for (const stream of streams) {
        try { stream.send("changed", { name: eventName, requestId: event.requestId, memberId: event.memberId, type: event.type }); } catch { streams.delete(stream); }
      }
    });
  }
}

export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/vault" && !url.pathname.startsWith("/api/vault/")) return false;
  const vault = ctx.vault;
  try {
    if (!vault) throw Object.assign(new Error("The vault is not available in this runtime."), { status: 503 });
    if (url.pathname === "/api/vault" && req.method === "GET") {
      const [items, status] = await Promise.all([vault.store.list(), vault.store.status()]);
      ctx.json(res, 200, { success: true, data: { items, ...status } });
      return true;
    }
    if (url.pathname === "/api/vault/items" && req.method === "POST") {
      const body = await ctx.readBody(req);
      if (!VAULT_KINDS.includes(body?.kind)) throw Object.assign(new Error("kind must be login, card or identity."), { status: 400 });
      ctx.json(res, 200, { success: true, data: await vault.store.add(body.kind, body.fields, { label: body.label }) });
      return true;
    }
    const item = url.pathname.match(/^\/api\/vault\/items\/([^/]+)$/);
    if (item && req.method === "DELETE") {
      ctx.json(res, 200, { success: true, data: await vault.store.remove(decodeURIComponent(item[1])) });
      return true;
    }
    if (url.pathname === "/api/vault/requests" && req.method === "GET") {
      ctx.json(res, 200, { success: true, data: { requests: await vault.requests.list({ status: url.searchParams.get("status") || "", memberId: url.searchParams.get("memberId") || "" }) } });
      return true;
    }
    const request = url.pathname.match(/^\/api\/vault\/requests\/([^/]+)\/(secret|dismiss|payment)$/);
    if (request && req.method === "POST") {
      const id = decodeURIComponent(request[1]);
      const body = await ctx.readBody(req);
      let data;
      if (request[2] === "secret") data = await vault.requests.completeSecret(id, { fields: body?.fields, label: body?.label }, vault.store);
      else if (request[2] === "dismiss") data = await vault.requests.dismissSecret(id);
      else data = await vault.requests.decidePayment(id, { decision: body?.decision, itemId: body?.itemId }, vault.store);
      ctx.json(res, 200, { success: true, data });
      return true;
    }
    if (url.pathname === "/api/vault/events" && req.method === "GET") {
      const stream = ctx.startEventStream(res);
      streams.add(stream);
      stream.send("ready", { at: new Date().toISOString() });
      req.on("close", () => streams.delete(stream));
      return true;
    }
    if (url.pathname === "/api/vault/mcp" && req.method === "POST") {
      ctx.json(res, 200, { success: true, data: await vault.dispatch(req.headers["x-squad-vault-token"], await ctx.readBody(req)) });
      return true;
    }
    ctx.json(res, 404, { success: false, error: "Vault route not found." });
  } catch (failure) {
    ctx.json(res, failure.status || 500, { success: false, error: failure.message });
  }
  return true;
}
