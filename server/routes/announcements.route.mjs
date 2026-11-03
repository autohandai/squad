export const name = "announcements";
export async function handle(req, res, url, ctx) {
  if (url.pathname !== "/api/announcements" && !url.pathname.startsWith("/api/announcements/")) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/announcements") {
      ctx.json(res, 200, { success: true, data: await ctx.announcements.list() });
      return true;
    }
    const match = url.pathname.match(/^\/api\/announcements\/([\w-]{1,100})\/(seen|dismiss)$/);
    if (req.method !== "POST" || !match) throw Object.assign(Error("Announcement route not found."), { status: 404 });
    const body = await ctx.readBody(req, 1024);
    ctx.json(res, 200, { success: true, data: await ctx.announcements.act(match[1], match[2], body.lastStep) });
  } catch (error) {
    ctx.json(res, error.status || 502, { success: false, error: error.message || "Squad news could not be loaded." });
  }
  return true;
}
