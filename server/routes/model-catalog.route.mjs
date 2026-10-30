export const name = 'model-catalog';
export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/harnesses/models' || req.method !== 'GET') return false;
  try {
    const workspace = url.searchParams.get('workspace');
    const input = { id: url.searchParams.get('id') || 'autohand', provider: url.searchParams.get('provider') || '', executablePath: url.searchParams.get('executablePath') || '', refresh: url.searchParams.get('refresh') === '1', ...(workspace ? { workspace: await ctx.cleanWorkspace(workspace) } : {}) };
    const data = await ctx.modelCatalog.get(input);
    ctx.json(res, 200, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 400, { success: false, error: error.message }); }
  return true;
}
