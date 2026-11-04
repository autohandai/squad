export const name = 'artifacts';
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-downloads";
export async function handle(req, res, url, ctx) {
  if (url.pathname !== '/api/artifacts' && !url.pathname.startsWith('/api/artifacts/')) return false;
  try {
    if (!ctx.artifacts) throw Object.assign(new Error('The artifact library is unavailable.'), { status: 503 });
    if (req.method !== 'GET') throw Object.assign(new Error('Members publish artifacts through their active Squad tool.'), { status: 405 });
    if (url.pathname === '/api/artifacts') {
      ctx.json(res, 200, { success: true, data: { artifacts: await ctx.artifacts.list({ owner: url.searchParams.get('owner') || '', query: url.searchParams.get('query') || '' }) } }); return true;
    }
    const match = url.pathname.match(/^\/api\/artifacts\/(artifact_[a-f0-9-]{36})(?:\/(content|download))?$/);
    if (!match) throw Object.assign(new Error('Artifact not found.'), { status: 404 });
    const [, id, action] = match;
    if (!action) { ctx.json(res, 200, { success: true, data: await ctx.artifacts.get(id) }); return true; }
    const { record, bytes } = await ctx.artifacts.content(id);
    // srcdoc does not inherit response headers. Keep its resource policy
    // first in the document, while downloads retain the exact saved bytes.
    const metaPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; base-uri 'none'; form-action 'none'";
    const body = action === 'content' && record.kind === 'html' ? Buffer.concat([Buffer.from(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${metaPolicy}">`), bytes]) : bytes;
    const filename = encodeURIComponent(record.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.writeHead(200, { 'content-type': record.mime, 'content-length': body.length, 'content-security-policy': POLICY, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-disposition': `${action === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}` });
    res.end(body);
  } catch (error) { ctx.json(res, error.status || 500, { success: false, error: error.message }); }
  return true;
}
