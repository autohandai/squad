import { createOnboarding } from '../onboarding.mjs';

export const name = 'onboarding';
let setup;
export function init(ctx) { setup = createOnboarding(ctx); }
export async function handle(req, res, url, ctx) {
  if (!['/api/setup', '/api/setup/repositories', '/api/setup/complete'].includes(url.pathname)) return false;
  if (!(req.method === 'GET' && url.pathname === '/api/setup') && !(req.method === 'POST' && url.pathname !== '/api/setup')) return false;
  try {
    const result = req.method === 'GET' ? await setup.read()
      : url.pathname === '/api/setup/repositories' ? await setup.analyze((await ctx.readBody(req)).paths)
        : await setup.complete((await ctx.readBody(req)).paths);
    ctx.json(res, 200, { success: true, data: result });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
