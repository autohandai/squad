// Local, opt-in desktop bridge for Squad's dedicated multi-tenant API.
export const name = "cloud";
export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/cloud" && !url.pathname.startsWith("/api/cloud/")) return false;
  try {
    let result;
    // Member profiles in the Autohand account (ADR-0280).
    if (url.pathname === "/api/cloud/profiles" || url.pathname.startsWith("/api/cloud/profiles/")) {
      if (!ctx.profileCloud) throw Object.assign(Error("Profiles in your account are unavailable in this runtime."), { status: 503 });
      const action = url.pathname.slice("/api/cloud/profiles".length);
      const body = req.method === "POST" ? await ctx.readBody(req) : {};
      const id = String(body.id || "");
      if (["/resolve", "/add", "/remove"].includes(action) && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw Object.assign(Error("Choose a member profile."), { status: 400 });
      if (action === "" && req.method === "GET") result = await ctx.profileCloud.status();
      else if (action === "/sync" && req.method === "POST") result = await ctx.profileCloud.sync();
      else if (action === "/enabled" && req.method === "POST") {
        if (typeof body.enabled !== "boolean") throw Object.assign(Error("Say whether to keep profiles in your account."), { status: 400 });
        result = await ctx.profileCloud.setEnabled(body.enabled);
      } else if (action === "/resolve" && req.method === "POST") result = await ctx.profileCloud.resolve(id, body.choice);
      else if (action === "/add" && req.method === "POST") result = await ctx.profileCloud.add(id);
      else if (action === "/remove" && req.method === "POST") result = await ctx.profileCloud.remove(id);
      else throw Object.assign(Error("Profile sync route not found."), { status: 404 });
      ctx.json(res, 200, { success: true, data: result }); return true;
    }
    if (!ctx.cloud) throw Object.assign(Error("Cloud sync is unavailable in this runtime."), { status: 503 });
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
