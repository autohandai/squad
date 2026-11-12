export const name = 'group-chats';
export async function handle(req, res, url, ctx) {
  const match = /^\/api\/group-chats(?:\/([^/]+)(?:\/(convert))?)?$/.exec(url.pathname);
  if (!match) return false;
  try {
    const scope = { actorId: url.searchParams.get('actor_id') || '' };
    let data;
    if (req.method === 'GET' && !match[2]) data = match[1]
      ? await ctx.groupChats.get(decodeURIComponent(match[1]), scope)
      : { groups: await ctx.groupChats.list(scope) };
    else if (req.method === 'POST' && !match[1]) data = await ctx.groupChats.create(await ctx.readBody(req), scope);
    else if (req.method === 'POST' && match[2] === 'convert') data = await ctx.groupChats.convert(decodeURIComponent(match[1]), await ctx.readBody(req), scope);
    else if (req.method === 'DELETE' && match[1] && !match[2]) data = await ctx.groupChats.remove(decodeURIComponent(match[1]), scope);
    else throw Object.assign(new Error('Method not allowed.'), { status: 405 });
    ctx.json(res, req.method === 'POST' && !match[1] ? 201 : 200, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 400, { success: false, error: error.message }); }
  return true;
}
