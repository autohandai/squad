export const name = 'memory';

export async function handle(req, res, url, ctx) {
  const path = url.pathname;
  if (path !== '/api/memory' && !path.startsWith('/api/memory/')) return false;
  const memory = ctx.memoryLibrary;
  try {
    if (!memory) throw Object.assign(new Error('The memory library is not available in this runtime.'), { status: 503 });
    let data, status = 200;
    if (path === '/api/memory' && req.method === 'GET') {
      const parameters = Object.fromEntries(['query', 'owner', 'scope', 'kind', 'group', 'tag', 'limit', 'offset'].map(key => [key, url.searchParams.get(key) || undefined]));
      data = await memory.list({ ...parameters, similarity: url.searchParams.get('similarity') === '1' });
    } else if (path === '/api/memory' && req.method === 'POST') { data = await memory.remember(await ctx.readBody(req)); status = 201; }
    else if (path === '/api/memory/settings' && req.method === 'GET') data = await memory.settings();
    else if (path === '/api/memory/settings' && req.method === 'PATCH') data = await memory.updateSettings(await ctx.readBody(req));
    else if (path === '/api/memory/reindex' && req.method === 'POST') data = await memory.reindex();
    else if (path === '/api/memory/groups' && req.method === 'POST') { data = await memory.group(await ctx.readBody(req)); status = 201; }
    else if (/^\/api\/memory\/groups\/[^/]+$/.test(path) && req.method === 'DELETE') data = await memory.removeGroup(decodeURIComponent(path.split('/').at(-1)));
    else if (path === '/api/memory/links' && req.method === 'POST') { data = await memory.relate(await ctx.readBody(req)); status = 201; }
    else if (/^\/api\/memory\/links\/[^/]+$/.test(path) && req.method === 'DELETE') data = await memory.removeLink(decodeURIComponent(path.split('/').at(-1)));
    else {
      const match = path.match(/^\/api\/memory\/([^/]+)(?:\/(metadata|share))?$/);
      if (!match) throw Object.assign(new Error('Memory route not found.'), { status: 404 });
      const id = decodeURIComponent(match[1]);
      if (match[2] === 'metadata' && req.method === 'PATCH') data = await memory.curate(id, await ctx.readBody(req));
      else if (match[2] === 'share' && req.method === 'POST') { const input = await ctx.readBody(req); data = await memory.share(id, input.memberId, undefined, input.revoke === true); }
      else if (!match[2] && req.method === 'GET') data = await memory.get(id);
      else if (!match[2] && req.method === 'PATCH') { const body = await ctx.readBody(req); data = await memory.update(id, body.text, undefined, { expectedText: body.expectedText }); }
      else if (!match[2] && req.method === 'DELETE') data = await memory.forget(id);
      else throw Object.assign(new Error('Memory route not found.'), { status: 404 });
    }
    ctx.json(res, status, { success: true, data });
  } catch (failure) { ctx.json(res, failure.status || 400, { success: false, error: failure.message }); }
  return true;
}
