// Human grants are deliberately separate from agent MCP session credentials.
export const name = 'computer-use';

// Install or repair Autohand Computer Use through the bundled CLI
// (ADR-0162). `autohand computer install` downloads the pinned engine from
// its immutable component release, installs Autohand Computer Use.app and
// opens the macOS permission prompts; this route only runs it and reports.
async function installAutohandComputerUse(ctx) {
  const binary = typeof ctx.autohandBinary === 'function' ? ctx.autohandBinary() : '';
  if (!binary) return { ok: false, message: 'The Autohand CLI is not available to this bridge.' };
  const { spawn } = await import('node:child_process');
  return new Promise((resolveOutcome) => {
    let output = '';
    const child = spawn(binary, ['computer', 'install', '--json'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AUTOHAND_NO_IDLE_LOGOUT: '1' } });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolveOutcome({ ok: false, message: 'Autohand Computer Use installation timed out after 10 minutes.', output: output.slice(-2000) }); }, 10 * 60_000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (failure) => { clearTimeout(timer); resolveOutcome({ ok: false, message: failure?.message || 'Autohand Computer Use installation could not start.' }); });
    child.on('close', (code) => { clearTimeout(timer); resolveOutcome(code === 0 ? { ok: true, output: output.slice(-2000) } : { ok: false, message: `autohand computer install exited with code ${code}.`, output: output.slice(-2000) }); });
  });
}

export async function handle(req, res, url, ctx) {
  if (url.pathname === '/api/computer-use/install' && req.method === 'POST') {
    const outcome = await installAutohandComputerUse(ctx);
    ctx.logEvent?.(ctx.SEVERITY?.[outcome.ok ? 'INFO' : 'WARN'], `Autohand Computer Use install ${outcome.ok ? 'succeeded' : 'failed'}${outcome.message ? `: ${outcome.message}` : ''}`, { 'event.name': 'computer-use.install' });
    ctx.json(res, outcome.ok ? 200 : 502, { success: true, data: outcome });
    return true;
  }
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
