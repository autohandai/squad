// The agent marketplace (ADR-0246, docs/integration/marketplace.md).
//
//   GET    /api/marketplace/agents            browse (q, category, creator, cursor, limit)
//   GET    /api/marketplace/categories        counts per category
//   GET    /api/marketplace/home              featured, teams and each category's first agents
//   GET    /api/marketplace/agents/:id        listing, preview and versions
//   POST   /api/marketplace/agents/:id/report report abuse
//   POST   /api/marketplace/fetch             {id, version?, sha256?} → verified template
//   POST   /api/marketplace/resolve           {link} → what a pasted link points at
//   POST   /api/marketplace/grok/preview      {url, instructions?} → starter template
//   GET    /api/marketplace/imports           receipts for members still here
//   POST   /api/marketplace/imports           record one after the app added or updated a member
//   POST   /api/marketplace/skills            save an update's new skills, switched off
//   GET    /api/marketplace/publish/context   who the person can publish as
//   POST   /api/marketplace/publish/preview   the template a member would become
//   POST   /api/marketplace/publish           publish, or a new version with listingId
//   GET    /api/marketplace/mine              the person's listings
//   DELETE /api/marketplace/agents/:id        unpublish
//
// Members are created by the app through addTeam (untrusted), exactly as a
// team file; this route only ever hands back verified documents.

import { createMarketplace } from "../marketplace/service.mjs";
import { parseMarketplaceLink } from "../../src/lib/marketplace.js";

export const name = "marketplace";

const AGENT = /^\/api\/marketplace\/agents\/([a-z0-9]{12})$/;
const REPORT = /^\/api\/marketplace\/agents\/([a-z0-9]{12})\/report$/;
let service = null;

// The browser reloads the whole app on 401/409 carrying an account code
// (ownership-client.js). Nothing the marketplace says is about the Autohand
// account or the selected Squad, so no marketplace reply may take that shape.
const ACCOUNT_CODES = new Set(["sign_in_required", "context_changed", "identity_mismatch"]);
function fail(ctx, res, error) {
  let status = Number(error?.status) >= 400 && Number(error?.status) <= 599 ? Number(error.status) : 500;
  let code = error?.code || "";
  let message = error?.message || "The marketplace could not finish that.";
  if (status === 401 || ACCOUNT_CODES.has(code)) {
    status = 503; code = "marketplace_unavailable";
    message = "The marketplace isn't available right now. Squad will retry; nothing was changed.";
  }
  ctx.json(res, status, { success: false, error: message, code, ...(error?.details ? { details: error.details } : {}) });
  return true;
}
function ok(ctx, res, data, status = 200) {
  ctx.json(res, status, { success: true, data });
  return true;
}

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (!path.startsWith("/api/marketplace")) return false;
  try {
    service ||= ctx.marketplace || createMarketplace(ctx);
    if (path === "/api/marketplace/agents" && req.method === "GET") return ok(ctx, res, await service.list(Object.fromEntries(url.searchParams)));
    if (path === "/api/marketplace/categories" && req.method === "GET") return ok(ctx, res, await service.categories());
    if (path === "/api/marketplace/home" && req.method === "GET") return ok(ctx, res, await service.home());
    const agent = path.match(AGENT);
    if (agent && req.method === "GET") return ok(ctx, res, await service.detail(agent[1]));
    if (agent && req.method === "DELETE") return ok(ctx, res, await service.unpublish(agent[1]));
    const report = path.match(REPORT);
    if (report && req.method === "POST") return ok(ctx, res, await service.report(report[1], await ctx.readBody(req)), 202);
    if (path === "/api/marketplace/fetch" && req.method === "POST") {
      const body = await ctx.readBody(req);
      return ok(ctx, res, await service.fetchTemplate({ id: body?.id, version: body?.version, sha256: body?.sha256 }));
    }
    if (path === "/api/marketplace/resolve" && req.method === "POST") return ok(ctx, res, parseMarketplaceLink((await ctx.readBody(req))?.link));
    if (path === "/api/marketplace/grok/preview" && req.method === "POST") return ok(ctx, res, await service.grokPreview(await ctx.readBody(req)));
    if (path === "/api/marketplace/imports" && req.method === "GET") return ok(ctx, res, { imports: await service.imports() });
    if (path === "/api/marketplace/imports" && req.method === "POST") return ok(ctx, res, await service.recordImport(await ctx.readBody(req)), 201);
    if (path === "/api/marketplace/skills" && req.method === "POST") return ok(ctx, res, await service.saveSkills((await ctx.readBody(req))?.skills || []));
    if (path === "/api/marketplace/publish/context" && req.method === "GET") return ok(ctx, res, await service.publishContext());
    if (path === "/api/marketplace/publish/preview" && req.method === "POST") return ok(ctx, res, await service.preview(await ctx.readBody(req)));
    if (path === "/api/marketplace/publish" && req.method === "POST") return ok(ctx, res, await service.publish(await ctx.readBody(req)), 201);
    if (path === "/api/marketplace/mine" && req.method === "GET") return ok(ctx, res, await service.mine());
    ctx.json(res, 404, { success: false, error: "Marketplace route not found." });
    return true;
  } catch (error) {
    return fail(ctx, res, error);
  }
}
