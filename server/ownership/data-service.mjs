import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { writePersistentJson } from '../persistent-json.mjs';
import { OwnedAgentRepository } from './repository.mjs';
import { ownedDirectory } from './datasets.mjs';
import { writePortableFile } from './portable-file.mjs';
import { ownerKey } from './identity.mjs';

const exportInput = z.object({ format: z.enum(['json', 'yaml']), memberIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)).min(1).max(10_000).optional() }).strict();
const uuid = /^[a-f0-9-]{36}$/;
export function createOwnedDataService({ context, assertCurrent, readBody, json, events, startEventStream }) {
  const repository = new OwnedAgentRepository(context, { assertCurrent });
  const reply = (res, data, status = 200) => json(res, status, { success: true, data });
  const backups = join(context.dataRoot, 'backups');
  let browserWrites = Promise.resolve();
  async function createBackup(value) {
    const input = exportInput.parse(value);
    const snapshot = await repository.snapshot({ agentIds: input.memberIds });
    await ownedDirectory(context.serviceRoot, ['owners', ownerKey(context.owner), 'datasets', context.datasetId, 'state', 'backups']);
    const id = randomUUID(), filename = `${id}.${input.format}`;
    const receipt = await writePortableFile({ ...snapshot, outputPath: join(backups, filename), format: input.format, assertCurrent });
    const { path: _privatePath, ...publicReceipt } = receipt;
    const saved = { ...publicReceipt, id, filename, memberCount: snapshot.manifest.agents.length, omissions: snapshot.manifest.omissions, downloadUrl: `/api/backups/${id}/download` };
    await writePersistentJson(join(backups, `${id}.receipt.json`), saved);
    return saved;
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/owned/') && !url.pathname.startsWith('/api/backups')) return false;
    assertCurrent();
    if(url.pathname==='/api/owned/events'&&req.method==='GET') {
      if(!context.canWrite||!events||!startEventStream)throw Object.assign(Error('Live execution updates are unavailable in this data view.'),{status:403});
      const stream=startEventStream(res),listeners=[];
      const subscriptions={ 'channels.changed':'channels.changed','vault.request.pending':'vault.changed','vault.request.resolved':'vault.changed',
        'relay.message':'relay.message','relay.channel':'relay.channel','relay.presence':'relay.presence','relay.status':'relay.status' };
      for(const [source,target]of Object.entries(subscriptions)) {
        const listener=()=>{try{assertCurrent();stream.send(target);}catch{stream.end();}};
        events.on(source,listener);listeners.push([source,listener]);
      }
      res.once('close',()=>{for(const [name,listener]of listeners)events.off(name,listener);});
      stream.send('channels.changed');stream.send('vault.changed');
      return true;
    }
    if (url.pathname === '/api/owned/members' && req.method === 'GET') { reply(res, { members: await repository.list(), ownership: context.owner }); return true; }
    const memberPath = url.pathname.match(/^\/api\/owned\/members\/([^/]+)(?:\/(memories|files)(?:\/([^/]+))?)?$/);
    if (memberPath && req.method === 'GET') {
      const id = decodeURIComponent(memberPath[1]);
      const snapshot = await repository.snapshot({ agentIds: [id] }), member = snapshot.manifest.agents[0];
      if (!memberPath[2]) reply(res, { ...member, ownership: context.owner });
      else if (memberPath[2] === 'memories') reply(res, { memories: member.memories, files: member.files.filter(file => file.kind === 'memory'), omissions:snapshot.manifest.omissions });
      else if (!memberPath[3]) reply(res, { files: member.files });
      else {
        const file = member.files.find(file => file.id === decodeURIComponent(memberPath[3]));
        if (!file) throw Object.assign(Error('Managed file not found.'), { status: 404 });
        // Hash during snapshotting, then read from the same checked inode.
        const source = await snapshot.readFile({ ...file, agentId: id });
        res.writeHead(200, { 'content-type': file.mediaType, 'content-length': file.bytes, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split('/').at(-1))}`,
          'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
        for await (const chunk of source) { assertCurrent(); if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
        res.end();
      }
      return true;
    }
    if (url.pathname === '/api/backups' && req.method === 'POST') {
      reply(res, await createBackup(await readBody(req)), 201); return true;
    }
    const backupPath = url.pathname.match(/^\/api\/backups\/([a-f0-9-]{36})(?:\/(download))?$/);
    if (backupPath && uuid.test(backupPath[1]) && req.method === 'GET') {
      const receipt = await repository.json(context.dataRoot, join(backups, `${backupPath[1]}.receipt.json`), null);
      if (!receipt || !['json', 'yaml'].includes(receipt.format) || receipt.filename !== `${backupPath[1]}.${receipt.format}`) throw Object.assign(Error('Backup not found.'), { status: 404 });
      if (!backupPath[2]) { reply(res, receipt); return true; }
      const { file, info } = await repository.openFile(context.dataRoot, join(backups, receipt.filename));
      try {
        if (info.size !== receipt.bytes) throw Error('The saved backup is incomplete. Create another backup.');
        res.writeHead(200, { 'content-type': receipt.format === 'yaml' ? 'application/yaml' : 'application/json', 'content-length': info.size,
          'content-disposition': `attachment; filename="squad-backup-${backupPath[1]}.${receipt.format}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        for await (const chunk of file.createReadStream({ autoClose: false })) { assertCurrent(); if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve)); }
        res.end();
      } finally { await file.close(); }
      return true;
    }
    if (url.pathname === '/api/owned/browser-state') {
      if (req.method === 'GET') { reply(res, await repository.readState('browser-state.json', { version: 1, messagesByAgent: {} })); return true; }
      if (req.method === 'PUT' && context.canWrite) {
        const input = z.object({ baseRevision: z.number().int().nonnegative().safe(), messagesByAgent: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/), z.array(z.record(z.string(), z.json())).max(20_000)) }).strict().parse(await readBody(req, 8 * 1024 * 1024));
        const members = new Set((await repository.list()).map(member => member.id));
        if (Object.keys(input.messagesByAgent).some(id => !members.has(id))) throw Object.assign(Error('Current conversations can only belong to this Squad’s saved members.'), { status: 409 });
        const pending = browserWrites.then(async () => {
          const previous = await repository.readState('browser-state.json', { revision: 0 });
          if ((previous.revision || 0) !== input.baseRevision) throw Object.assign(Error('Saved conversations changed in another window. Reopen this Squad before saving a backup; your local draft is kept.'), { status: 409, code: 'browser_revision_conflict' });
          assertCurrent();
          const next = { version: 1, revision: input.baseRevision + 1, messagesByAgent: input.messagesByAgent, savedAt: new Date().toISOString() };
          await writePersistentJson(join(context.dataRoot, 'browser-state.json'), next); return { saved: true, revision: next.revision };
        });
        browserWrites = pending.catch(() => {});
        reply(res, await pending); return true;
      }
    }
    throw Object.assign(Error('This owned data operation is unavailable.'), { status: 405 });
  }
  return { repository, createBackup, handle };
}
