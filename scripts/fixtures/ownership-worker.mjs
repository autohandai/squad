import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumeWorkerContext, awaitWorkerStart } from '../../server/ownership/worker-context.mjs';
import { createOwnedDataService } from '../../server/ownership/data-service.mjs';
const { context, token } = consumeWorkerContext();
await awaitWorkerStart(context);
await mkdir(context.dataRoot, { recursive: true });
const file = join(context.dataRoot, 'fixture-members.json');
const data=createOwnedDataService({context,assertCurrent(){if(!process.connected||stopped)throw Object.assign(Error('Fixture context ended.'),{status:409,code:'context_changed'});},readBody:async(req,limit=128*1024)=>{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('Fixture body too large.');}return JSON.parse(text);},json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}});
const server = createServer(async (req, res) => {
  if (req.headers['x-squad-worker-token'] !== token) { res.writeHead(401); res.end('private runtime'); return; }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if(path.startsWith('/api/backups')) {
    try{if(await data.handle(req,res,new URL(req.url,'http://127.0.0.1')))return;}catch(error){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({success:false,error:error.message}));return;}
  }
  if (path === '/api/slow') { await writeFile(join(context.dataRoot, 'fixture-admitted.json'), JSON.stringify({ generation: context.generation })); await new Promise(resolve => setTimeout(resolve, 500)); }
  if (path.startsWith('/api/team/') && req.headers['x-squad-team-token'] !== `turn-${context.generation}`) { res.writeHead(401); res.end('expired member work token'); return; }
  let records;
  try { records = JSON.parse(await readFile(file, 'utf8')); } catch { records = []; }
  if (req.method === 'POST' && path === '/api/members') {
    let text = ''; for await (const chunk of req) text += chunk;
    records.push(JSON.parse(text)); await writeFile(file, JSON.stringify(records));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: true, data: { records, owner: context.owner, actor: context.actor, port: server.address().port, generation: context.generation } }));
});
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  await writeFile(join(context.dataRoot, 'fixture-stopped.json'), JSON.stringify({ generation: context.generation, actor: context.actor }));
  server.close(); process.exit(0);
}
process.on('message', message => { if (message?.type === 'ownership-deactivate') void stop(); });
process.once('SIGTERM', () => { void stop(); });
server.listen(0, '127.0.0.1', () => process.send({ type: 'ownership-ready', generation: context.generation, port: server.address().port }));
