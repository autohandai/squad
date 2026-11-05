import { readSystemSettings } from '../system/settings.mjs';
export const name = 'harness-usage';
export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/harnesses/usage' || req.method !== 'GET') return false;
  const settings = await readSystemSettings(ctx.squadStateDir);
  if (!settings.quickChatShowUsage) { ctx.json(res, 200, { success: true, data: { harnesses: [], enabled: false } }); return true; }
  try { ctx.json(res, 200, { success: true, data: await ctx.harnessUsage({ force: url.searchParams.get('refresh') === '1' }) }); }
  catch { ctx.json(res, 503, { success: false, error: 'Harness usage is temporarily unavailable.' }); }
  return true;
}
