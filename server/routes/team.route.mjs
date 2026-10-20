// Team route plug-in (ADR-0134).
//
//   GET    /api/team                 { memory, deliveries } (newest last)
//   POST   /api/team/memory          body: { text, scope: team|member, memberId? } → entry
//   DELETE /api/team/memory/:id      → removed entry
//   POST   /api/team/mcp             header x-squad-team-token → MCP dispatch (members only)
//
// The service is built in server.mjs (it injects the managed MCP server into
// member work) and handed over as ctx.team.

export const name = "team";

export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/team" && !url.pathname.startsWith("/api/team/")) return false;
  const team = ctx.team;
  try {
    if (!team) throw Object.assign(new Error("The team service is not available in this runtime."), { status: 503 });
    if (url.pathname === "/api/team" && req.method === "GET") {
      const state = await team.store.read();
      ctx.json(res, 200, { success: true, data: { memory: state.memory, deliveries: state.deliveries.slice(-50) } });
      return true;
    }
    if (url.pathname === "/api/team/memory" && req.method === "POST") {
      const body = await ctx.readBody(req);
      const scope = body?.scope || "team";
      if (!["team", "member", "project"].includes(scope)) throw Object.assign(new Error("Memory scope must be team, member or project."), { status: 400 });
      const entry = await team.remember({ text: body?.text, scope, memberId: String(body?.memberId || ""), workspace: String(body?.workspace || ""), authorName: "You" });
      ctx.emit?.("team.memory.changed", { id: entry.id });
      ctx.json(res, 200, { success: true, data: entry });
      return true;
    }
    const memory = url.pathname.match(/^\/api\/team\/memory\/([^/]+)$/);
    if (memory && req.method === "PATCH") {
      const body = await ctx.readBody(req);
      const entry = await team.updateMemory(decodeURIComponent(memory[1]), body?.text);
      ctx.emit?.("team.memory.changed", { id: entry.id });
      ctx.json(res, 200, { success: true, data: entry });
      return true;
    }
    if (memory && req.method === "DELETE") {
      const entry = await team.forget(decodeURIComponent(memory[1]));
      ctx.emit?.("team.memory.changed", { id: entry.id });
      ctx.json(res, 200, { success: true, data: entry });
      return true;
    }
    if (url.pathname === "/api/team/mcp" && req.method === "POST") {
      ctx.json(res, 200, { success: true, data: await team.dispatch(req.headers["x-squad-team-token"], await ctx.readBody(req)) });
      return true;
    }
    ctx.json(res, 404, { success: false, error: "Team route not found." });
  } catch (failure) {
    ctx.json(res, failure.status || (/^(say what|keep a memory|that looks like)/.test(failure.message) ? 400 : 500), { success: false, error: failure.message });
  }
  return true;
}
