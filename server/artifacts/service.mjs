import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { looksSecret } from '../team/store.mjs';

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = { '.html': ['html','text/html'], '.htm': ['html','text/html'], '.md': ['markdown','text/markdown'], '.txt': ['text','text/plain'], '.csv': ['text','text/csv'], '.json': ['text','application/json'], '.js': ['text','text/plain'], '.ts': ['text','text/plain'], '.css': ['text','text/plain'], '.py': ['text','text/plain'], '.rs': ['text','text/plain'], '.svg': ['image','image/svg+xml'], '.png': ['image','image/png'], '.jpg': ['image','image/jpeg'], '.jpeg': ['image','image/jpeg'], '.webp': ['image','image/webp'], '.gif': ['image','image/gif'], '.pdf': ['pdf','application/pdf'] };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, limit) => [...String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim()].slice(0, limit).join('');
const inside = (root, file) => { const path = relative(root, file); return path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path); };
const publicRecord = record => { const { contentHash, sourcePath, ...data } = record; return { ...data, href: `/squad-members/${encodeURIComponent(record.ownerId)}/library?artifact=${record.id}`, contentUrl: `/api/artifacts/${record.id}/content`, downloadUrl: `/api/artifacts/${record.id}/download` }; };

/** Immutable file snapshots, attributed to the authenticated publishing turn. */
export function createArtifactService({ stateDir, members, emit = () => {} }) {
  const root = join(stateDir, 'artifacts'), indexPath = join(root, 'library.json');
  let mutation = Promise.resolve();
  async function state() {
    const value = await readPersistentJson(indexPath, { version: 1, records: [] });
    if (value?.version !== 1 || !Array.isArray(value.records)) throw fail('The artifact library could not be read. Your saved files are kept.', 503);
    return value;
  }
  async function list({ owner = '', actor, query = '' } = {}) {
    const people = (await members()).filter(member => member?.id && !member.removed);
    const visible = new Set(people.map(member => member.id));
    const needle = clean(query, 200).toLowerCase();
    return (await state()).records.filter(record => visible.has(record.ownerId) && (!owner || record.ownerId === owner) && (!actor || record.ownerId === actor.memberId) && (!needle || `${record.title} ${record.description} ${record.filename}`.toLowerCase().includes(needle))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicRecord);
  }
  async function get(id, actor) {
    const record = (await list({ actor })).find(record => record.id === id);
    if (!record) throw fail('That artifact is not available to you.', 404);
    return record;
  }
  async function content(id, actor) {
    await get(id, actor);
    const record = (await state()).records.find(record => record.id === id);
    if (!/^[a-f0-9]{64}$/.test(record.contentHash)) throw fail('The saved artifact has an invalid file reference.', 503);
    const bytes = await readFile(join(root, 'files', record.contentHash)).catch(() => { throw fail('The saved file is unavailable. Ask this member to publish it again.', 503); });
    if (bytes.length > MAX_BYTES || createHash('sha256').update(bytes).digest('hex') !== record.contentHash) throw fail('The saved artifact failed its file check. Publish it again from the original.', 503);
    return { record: publicRecord(record), bytes };
  }
  function publish(input, actor) {
    const task = mutation.then(async () => {
      const member = (await members()).find(member => member.id === actor?.memberId && !member.removed);
      if (!member || !actor.workspace) throw fail('Publish artifacts from your active member workspace.', 403);
      if (looksSecret(String(input.title || '')) || looksSecret(String(input.description || ''))) throw fail('Keep passwords and keys out of artifact titles and descriptions.');
      const workspace = await realpath(actor.workspace);
      const requested = String(input.path || '');
      if (!requested || requested.includes('\0')) throw fail('Choose a file you created in this workspace.');
      const path = await realpath(resolve(workspace, requested));
      if (!inside(workspace, path)) throw fail('Artifacts must be files inside this turn’s workspace.', 403);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let bytes;
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > MAX_BYTES) throw fail('Choose a regular file up to 20 MB.');
        const chunks = []; let size = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          size += chunk.length;
          if (size > MAX_BYTES) throw fail('Choose a file up to 20 MB.');
          chunks.push(chunk);
        }
        const after = await stat(path);
        if (await realpath(path) !== path || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw fail('That file changed while being saved. Finish writing it, then publish again.');
        bytes = Buffer.concat(chunks);
      } finally { await handle.close(); }
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const data = await state();
      const sourcePath = relative(workspace, path);
      const previous = data.records.find(record => record.ownerId === member.id && record.workspace === workspace && record.sourcePath === sourcePath);
      const title = clean(input.title, 160) || previous?.title || basename(path);
      const description = input.description === undefined ? previous?.description || '' : clean(input.description, 2000);
      if (previous?.contentHash === contentHash && previous.title === title && previous.description === description) return publicRecord(previous);
      if (!previous && data.records.length >= 5000) throw fail('The artifact library has reached its file limit.');
      const [kind, mime] = TYPES[extname(path).toLowerCase()] || ['file','application/octet-stream'];
      const now = new Date().toISOString();
      const record = { id: previous?.id || `artifact_${randomUUID()}`, ownerId: member.id, authorName: clean(member.name, 120), title, description, filename: clean(basename(path), 200), kind, mime, size: bytes.length, contentHash, sourcePath, workspace, runId: String(actor.runId || ''), channelId: String(actor.channel?.channelId || ''), threadId: String(actor.channel?.threadId || ''), createdAt: previous?.createdAt || now, updatedAt: now, revision: (previous?.revision || 0) + 1 };
      await mkdir(join(root, 'files'), { recursive: true });
      try { await writeFile(join(root, 'files', contentHash), bytes, { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (previous) data.records[data.records.indexOf(previous)] = record; else data.records.push(record);
      await writePersistentJson(indexPath, data);
      emit('artifacts.changed', { ownerId: member.id, id: record.id });
      return publicRecord(record);
    });
    mutation = task.catch(() => {});
    return task;
  }
  async function memoryRecords() {
    return (await list()).map(item => ({ id: item.id, ownerId: item.ownerId, authorId: item.ownerId, authorName: item.authorName, scope: 'member', workspace: item.workspace, title: item.title, text: [item.title, item.description, `Saved artifact: ${item.filename} (revision ${item.revision}).`].filter(Boolean).join('\n'), kind: 'artifact', tags: ['artifact', item.kind], createdAt: item.createdAt, updatedAt: item.updatedAt, sourceType: 'artifact', sourceKey: `artifact:${item.id}`, sourceLabel: 'Member artifact', sourceRef: item.id, sourceHref: item.href, sharedWith: [] }));
  }
  return { publish, list, get, content, memoryRecords };
}
