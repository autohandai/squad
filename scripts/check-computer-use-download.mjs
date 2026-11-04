import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifiedDownload } from './fetch-computer-use.mjs';

const root = await mkdtemp(join(tmpdir(), 'squad-input-download-'));
const bytes = Buffer.from('immutable component bytes, completely transferred');
const checksum = createHash('sha256').update(bytes).digest('hex');
let requests = 0, mode = 'interrupted';
const server = createServer((request, response) => {
  requests += 1;
  if ((mode === 'interrupted' && requests === 1) || mode === 'exhausted') {
    response.writeHead(200, { 'content-length': bytes.length });
    response.write(bytes.subarray(0, 8));
    setTimeout(() => response.destroy(), 10);
  } else if (mode === 'busy' && requests < 3) {
    response.writeHead(503); response.end('temporarily unavailable');
  } else if (mode === 'missing') {
    response.writeHead(404); response.end('not found');
  } else response.end(mode === 'corrupt' ? 'wrong bytes' : bytes);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/pinned.tar.gz`;
const waits = [];
const options = { check: false, log() {}, wait: async milliseconds => waits.push(milliseconds) };
async function download(name, nextMode) {
  mode = nextMode; requests = 0; waits.length = 0;
  await verifiedDownload(url, join(root, name), checksum, options);
}
try {
  await download('interrupted.tar.gz', 'interrupted');
  assert.equal(requests, 2); assert.deepEqual(waits, [1000]);
  assert.deepEqual(await readFile(join(root, 'interrupted.tar.gz')), bytes, 'Partial bytes must be discarded before a retry.');
  await download('busy.tar.gz', 'busy');
  assert.equal(requests, 3); assert.deepEqual(waits, [1000, 2000]);
  await assert.rejects(download('exhausted.tar.gz', 'exhausted'), /terminated|fetch failed/);
  assert.equal(requests, 3); assert.deepEqual(waits, [1000, 2000]);
  await assert.rejects(download('corrupt.tar.gz', 'corrupt'), /pinned checksum/);
  assert.equal(requests, 1); assert.deepEqual(waits, []);
  await assert.rejects(download('missing.tar.gz', 'missing'), /HTTP 404/);
  assert.equal(requests, 1); assert.deepEqual(waits, []);
  requests = 0;
  await verifiedDownload(url, join(root, 'interrupted.tar.gz'), checksum, options);
  assert.equal(requests, 0, 'A valid cached input stays unchanged.');
  await writeFile(join(root, 'bad-cache.tar.gz'), 'bad cache');
  await assert.rejects(verifiedDownload(url, join(root, 'bad-cache.tar.gz'), checksum, options), /Pinned checksum mismatch/);
  assert.equal(await readFile(join(root, 'bad-cache.tar.gz'), 'utf8'), 'bad cache');
  await assert.rejects(verifiedDownload(url, join(root, 'not-prepared.tar.gz'), checksum, { ...options, check: true }), /Missing prepared input/);
  assert.equal(requests, 0);
  assert.deepEqual((await readdir(root)).sort(), ['bad-cache.tar.gz', 'busy.tar.gz', 'interrupted.tar.gz'], 'Failed attempts leave no final file or temporary directory.');
  console.log('PASS pinned Computer Use transfers retry interrupted streams and temporary HTTP errors with bounded backoff; checksum/404/cache failures stay fatal and partial files are never promoted.');
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(root, { recursive: true, force: true });
}
