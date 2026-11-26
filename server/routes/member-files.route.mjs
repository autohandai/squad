// A member's Files page (ADR-0287): what it made in its folders, and moving
// a file it created to the Trash. Published artifacts stay on /api/artifacts.
//
//   GET  /api/member-files/:memberId          -> { files: [...] }
//   POST /api/member-files/:memberId/trash    { path } -> { trashed }
export const name = 'member-files';
const MEMBER = /^\/api\/member-files\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})(\/trash)?$/;
export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/member-files/')) return false;
  try {
    if (!ctx.memberFiles) throw Object.assign(new Error('Member files are unavailable.'), { status: 503 });
    const match = url.pathname.match(MEMBER);
    if (!match) throw Object.assign(new Error('Member not found.'), { status: 404 });
    const [, memberId, trash] = match;
    if (!trash && req.method === 'GET') { ctx.json(res, 200, { success: true, data: { files: await ctx.memberFiles.list(memberId) } }); return true; }
    if (trash && req.method === 'POST') {
      const body = await ctx.readBody(req);
      ctx.json(res, 200, { success: true, data: await ctx.memberFiles.trash(memberId, String(body?.path || '')) }); return true;
    }
    throw Object.assign(new Error('Method not allowed.'), { status: 405 });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
