import { proxyJson, resolveRemote } from './remote.route.mjs';

export const name = 'agent-channels';
export async function init(ctx) {
  try { await ctx.agentChannelActions.recover(); }
  catch (error) {
    // A damaged history must not unload these routes: the browser needs their
    // 409 explanation, not a 404. Interrupted purposes are recovered on the
    // next boot after the saved file is restored.
    const message = `agent channels: startup recovery skipped: ${error.message}`;
    if (ctx.logEvent && ctx.SEVERITY) ctx.logEvent(ctx.SEVERITY.WARN, message, { 'event.name': 'agent_channels.recovery_skipped' });
    else console.warn(message);
  }
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === '/api/channels/events' && req.method === 'GET') {
    const stream = ctx.startEventStream(res);
    const changed = () => stream.send('changed');
    ctx.events.on('channels.changed', changed);
    stream.send('changed');
    res.on('close', () => { ctx.events.off('channels.changed', changed); });
    return true;
  }
  if (url.pathname === '/api/channel-actions' && req.method === 'GET') {
    try { ctx.json(res, 200, { success: true, data: await ctx.agentChannelActions.list() }); }
    catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
    return true;
  }
  const access = url.pathname.match(/^\/api\/members\/([^/]+)\/channel-access$/);
  const decision = url.pathname.match(/^\/api\/channel-actions\/([^/]+)\/(approve|decline)$/);
  if (!(access && req.method === 'PUT') && !(decision && req.method === 'POST')) return false;
  try {
    if (access) {
      const remote = await resolveRemote(ctx, decodeURIComponent(access[1]), { req });
      if (remote) {
        const data = await proxyJson(remote, url.pathname, await ctx.readBody(req), { method: 'PUT' });
        ctx.json(res, 200, { success: true, data });
        return true;
      }
    }
    const data = access
      ? await ctx.agentChannelActions.setAccess(decodeURIComponent(access[1]), await ctx.readBody(req))
      : await ctx.agentChannelActions.decide(decodeURIComponent(decision[1]), decision[2] === 'approve');
    ctx.json(res, 200, { success: true, data });
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
