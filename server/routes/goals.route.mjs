export const name = 'goals';

export async function handle(req, res, url, ctx) {
  if (url.pathname === '/api/goals' && req.method === 'GET') {
    ctx.json(res, 200, { success: true, data: await ctx.goals.list(url.searchParams.get('agentId') || '') });
    return true;
  }
  const match = url.pathname.match(/^\/api\/goals\/([^/]+)(?:\/(pause|resume|cancel))?$/);
  if (!match || (!match[2] && req.method !== 'GET') || (match[2] && req.method !== 'POST')) return false;
  try {
    const id = decodeURIComponent(match[1]);
    const goal = match[2] ? await ctx.goals.control(id, match[2]) : await ctx.goals.get(id);
    ctx.json(res, 200, { success: true, data: goal });
  } catch (error) { ctx.json(res, error.status || 400, { success: false, error: error.message }); }
  return true;
}
