import { createMobileController } from '../mobile/controller.mjs';

export const name = 'mobile';
const controllers = new Map();
function controller(ctx) {
  const key = `${ctx.squadStateDir}:${ctx.ownedHookScope || ''}`;
  if (!controllers.has(key)) {
    const creating = createMobileController(ctx).catch(error => { controllers.delete(key); throw error; });
    controllers.set(key, creating);
  }
  return controllers.get(key);
}
export async function init(ctx) {
  if (!ctx.ownedHookScope) return;
  try { await controller(ctx); }
  catch { ctx.logEvent?.(ctx.SEVERITY?.WARN ?? 13, 'Mobile connections could not be restored. Open Computers settings to retry.', {}); }
}
export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/mobile/')) return false;
  try {
    const mobile = await controller(ctx);
    let data;
    if (url.pathname === '/api/mobile/status' && req.method === 'GET') data = mobile.status();
    else if (url.pathname === '/api/mobile/config' && req.method === 'PUT') data = await mobile.configure(await ctx.readBody(req));
    else if (url.pathname === '/api/mobile/pair' && req.method === 'POST') data = await mobile.offer();
    else if (url.pathname === '/api/mobile/approve' && req.method === 'POST') data = await mobile.approve(await ctx.readBody(req));
    else if (url.pathname === '/api/mobile/reject' && req.method === 'POST') data = await mobile.reject();
    else if (url.pathname.startsWith('/api/mobile/devices/') && req.method === 'DELETE') data = await mobile.revoke(url.pathname.slice('/api/mobile/devices/'.length));
    else return false;
    ctx.json(res, 200, { success: true, data });
  } catch (error) { ctx.json(res, 400, { success: false, error: error.message }); }
  return true;
}
