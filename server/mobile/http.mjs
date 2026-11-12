import { createServer } from 'node:http';

export function createMobileHTTP(service) {
  const server = createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
    if (req.url === '/v1/health' && req.method === 'GET') { json(200, { service: 'autohand-squad-mobile', protocolVersion: 1 }); return; }
    if (req.url !== '/v1/mobile' || req.method !== 'POST') { json(404, { error: 'Not found.' }); return; }
    if (req.headers.origin || !String(req.headers['content-type']).startsWith('application/json')) { json(403, { error: 'Native encrypted requests only.' }); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) throw Object.assign(Error('Request too large.'), { status: 413 });
        chunks.push(chunk);
      }
      json(200, await service.packet(JSON.parse(Buffer.concat(chunks, size).toString('utf8'))));
    } catch (failure) { if (!res.headersSent && !res.destroyed) json(failure.status || 401, { error: 'The encrypted request could not be accepted.' }); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;
  return server;
}
