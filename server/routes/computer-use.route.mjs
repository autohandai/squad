// Human grants are deliberately separate from agent MCP session credentials.
export const name = 'computer-use';

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/computer-use/')) return false;
  try {
    const service = ctx.computerUse;
    if (!service) throw Object.assign(new Error('Computer Use is not bundled in this runtime.'), { status: 503 });
    if (url.pathname === '/api/computer-use/status' && req.method === 'GET') {
      ctx.json(res, 200, { success: true, data: await service.status(url.searchParams.get('memberId')) });
      return true;
    }
    if (url.pathname === '/api/computer-use/evidence' && req.method === 'GET') {
      ctx.json(res, 200, { success: true, data: await service.listEvidence(url.searchParams.get('memberId')) });
      return true;
    }
    if (url.pathname === '/api/computer-use/grant' && req.method === 'POST') {
      const body = await ctx.readBody(req);
      // The native shell must confirm this exact member and scope. Browser
      // Origin and an agent bearer token are not evidence of a human decision.
      if (typeof ctx.authorizeComputerUseGrant !== 'function' || await ctx.authorizeComputerUseGrant(req, body) !== true) throw Object.assign(new Error('Confirm Computer Use access in the Squad app.'), { status: 403 });
      ctx.json(res, 200, { success: true, data: await service.setGrant(body.memberId, body.scope) });
      return true;
    }
    if (url.pathname === '/api/computer-use/grant' && req.method === 'DELETE') {
      const body = await ctx.readBody(req);
      ctx.json(res, 200, { success: true, data: await service.setGrant(body.memberId, 'none') });
      return true;
    }
    if (url.pathname === '/api/computer-use/mcp' && req.method === 'POST') {
      ctx.json(res, 200, { success: true, data: await service.dispatch(req.headers['x-squad-computer-token'], await ctx.readBody(req)) });
      return true;
    }
    const evidence = url.pathname.match(/^\/api\/computer-use\/evidence\/([^/]+)\/(.+)$/);
    if (evidence && req.method === 'GET') {
      const file = await service.readEvidence(decodeURIComponent(evidence[1]), evidence[2].split('/').map(decodeURIComponent).join('/'));
      res.writeHead(200, { 'content-type': file.mediaType, 'content-length': file.bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(file.bytes);
      return true;
    }
    ctx.json(res, 404, { success: false, error: 'Computer Use route not found.' });
  } catch (failure) { ctx.json(res, failure.status || 500, { success: false, error: failure.message }); }
  return true;
}
