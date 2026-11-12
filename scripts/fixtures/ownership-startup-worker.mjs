import { createServer } from 'node:http';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { consumeWorkerContext, awaitWorkerStart } from '../../server/ownership/worker-context.mjs';
const { context, token } = consumeWorkerContext();
await awaitWorkerStart(context);
const mode = (await readFile(join(context.serviceRoot, 'fixture-startup-mode'), 'utf8')).trim();
await appendFile(join(context.serviceRoot, 'fixture-startup-pids'), `${process.pid}\n`);
if (mode === 'hang') {
  process.on('SIGTERM', () => {});
  process.on('message', () => {});
  setInterval(() => {}, 1000);
} else {
  const pidFile = join(context.dataRoot, 'fixture-descendant.pid');
  spawn(process.execPath, ['-e', `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`, pidFile], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await readFile(pidFile); break; } catch { await new Promise(done => setTimeout(done, 20)); } }
  const server = createServer((req, res) => {
    if (req.headers['x-squad-worker-token'] !== token) { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data: { parentPid: process.pid } }));
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('message', message => { if (message?.type === 'ownership-deactivate') process.exit(0); });
  server.listen(0, '127.0.0.1', () => process.send({ type: 'ownership-ready', generation: context.generation, port: server.address().port }));
}
