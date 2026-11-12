import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createOwnedDataService } from './data-service.mjs';
import { readCredential } from './identity.mjs';
import { writePersistentJson } from '../persistent-json.mjs';
import { isRemoteTransport,bearerTokenFromRequest } from '../remote/auth.mjs';

const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function readBody(req, limit = 1024 * 1024) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(Error('Request is too large.'), { status: 413 }); parts.push(chunk); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

/** Verified readers never initialize the execution runtime or recovery stores. */
export async function runPassiveWorker({ context, token, rootDir, configPath }) {
  if (!context.owner || !context.actor || context.canWrite) throw Error('A passive worker requires verified read-only ownership.');
  let active = true;
  const assertCurrent = () => {
    if (!process.connected || !active || readCredential(configPath)?.fingerprint !== context.credentialFingerprint) throw Object.assign(Error('The signed-in account changed.'), { status: 409, code: 'context_changed' });
  };
  const service = createOwnedDataService({ context, assertCurrent, readBody, json });
  const server = createServer(async (req, res) => {
    try {
      const supplied = Buffer.from(String(req.headers['x-squad-worker-token'] || '')), expected = Buffer.from(token);
      if (!active || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(res, 401, { success: false, error: 'This private reader requires its ownership broker.' }); return; }
      assertCurrent();
      if(isRemoteTransport(req)||bearerTokenFromRequest(req)){json(res,403,{success:false,error:'Remote member serving is unavailable in the read-only data view.',code:'owner_read_only'});return;}
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/api/runtime' && req.method === 'GET') { json(res, 200, { success: true, data: { ownership: { owner: context.owner, generation: context.generation, datasetId: context.datasetId, canWrite: false }, account: { signedIn: true, ...context.actor }, readOnly: true } }); return; }
      if (url.pathname === '/api/channels' && req.method === 'GET') { json(res, 200, { success: true, data: await service.repository.channels() }); return; }
      if (url.pathname === '/api/account/logout' && req.method === 'POST') {
        const config = JSON.parse(await readFile(configPath, 'utf8')); assertCurrent();
        const { auth: _credentials, ...rest } = config; await writePersistentJson(configPath, rest);
        active = false; json(res, 200, { success: true, data: { signedOut: true } }); return;
      }
      if (await service.handle(req, res, url)) return;
      if (url.pathname.startsWith('/api/')) { json(res, 403, { success: false, error: 'This team is read-only. Browse members and create backups from its data view.', code: 'owner_read_only' }); return; }
      const publicRoot = join(rootDir, 'dist');
      let path = resolve(publicRoot, `.${decodeURIComponent(url.pathname)}`), part = relative(publicRoot, path);
      if (part === '..' || part.startsWith('../') || part.startsWith('..\\')) throw Object.assign(Error('Page not found.'), { status: 404 });
      try { if (!(await stat(path)).isFile()) path = join(publicRoot, 'index.html'); }
      catch { if (extname(path)) throw Object.assign(Error('Asset not found.'), { status: 404 }); path = join(publicRoot, 'index.html'); }
      const bytes = await readFile(path);
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes);
    } catch (error) { if (res.headersSent) res.destroy(); else json(res, error.status || 400, { success: false, error: error.message, code: error.code || 'owned_data_unavailable' }); }
  });
  let finish;
  const stopped = new Promise(resolveStopped => { finish = resolveStopped; });
  const stop = () => { if (!active && !server.listening) return; active = false; server.closeAllConnections(); server.close(finish); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  process.once('disconnect', stop);
  const message = value => { if (value?.type === 'ownership-deactivate') stop(); };
  process.on('message', message);
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  process.send?.({ type: 'ownership-ready', generation: context.generation, port: server.address().port });
  await stopped;
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); process.removeListener('message', message);
}
