// Local, opt-in desktop bridge for Squad's dedicated multi-tenant API.
export const name = "cloud";
export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/cloud" && !url.pathname.startsWith("/api/cloud/")) return false;
  try {
    if (!ctx.cloud) throw Object.assign(Error("Cloud sync is unavailable in this runtime."), { status: 503 });
    let result;
    if (url.pathname === "/api/cloud" && req.method === "GET") result = await ctx.cloud.status();
    else if (url.pathname === "/api/cloud/session" && req.method === "POST") result = await ctx.cloud.discover();
    else if (url.pathname === "/api/cloud/tenants" && req.method === "POST") {
      const body = await ctx.readBody(req);
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) throw Object.assign(Error("Give the team a name under 120 characters."), { status: 400 });
      result = await ctx.cloud.createTenant(body.name.trim());
    } else if (url.pathname === "/api/cloud/connect" && req.method === "POST") result = await ctx.cloud.connect(await ctx.readBody(req));
    else if (url.pathname === "/api/cloud/sync" && req.method === "POST") result = await ctx.cloud.sync();
    else if (url.pathname === "/api/cloud/disconnect" && req.method === "POST") result = await ctx.cloud.disconnect();
    else if (url.pathname === "/api/cloud/resolve" && req.method === "POST") {
      const body = await ctx.readBody(req); result = await ctx.cloud.resolve(String(body.id || ""), body.resolution);
    } else throw Object.assign(Error("Cloud sync route not found."), { status: 404 });
    ctx.json(res, 200, { success: true, data: result });
  } catch (error) { ctx.json(res, error.status && error.status >= 400 && error.status <= 599 ? error.status : 502, { success: false, error: error.message || "Cloud sync could not finish. Local data is kept." }); }
  return true;
}
