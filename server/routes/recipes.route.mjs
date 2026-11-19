// /api/recipes — saved recipes (ADR-0259). Suggestions spotted from run
// history are computed in the browser from /api/runs (src/lib/recipe-observations.js).
import { recipeStoreFor } from '../recipes/store.mjs';

export const name = 'recipes';

export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/recipes' && !url.pathname.startsWith('/api/recipes/')) return false;
  const store = recipeStoreFor(ctx.squadStateDir);
  try {
    if (url.pathname === '/api/recipes' && req.method === 'GET') { ctx.json(res, 200, { success: true, data: { recipes: await store.list() } }); return true; }
    if (url.pathname === '/api/recipes' && req.method === 'POST') {
      const body = await ctx.readBody(req);
      const recipe = await store.save({ ...body, source: body?.source === 'spotted' ? 'spotted' : 'person' });
      ctx.json(res, 201, { success: true, data: { recipe } }); return true;
    }
    const id = decodeURIComponent(url.pathname.slice('/api/recipes/'.length));
    if (id && req.method === 'DELETE') { ctx.json(res, 200, { success: true, data: await store.remove(id) }); return true; }
    ctx.json(res, 405, { success: false, error: 'Unsupported recipe request.' }); return true;
  } catch (error) {
    ctx.json(res, error.status || 400, { success: false, error: error.message }); return true;
  }
}
