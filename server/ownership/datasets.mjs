import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { acquireWriterLease } from './writer-lease.mjs';
import { replaceMetadata, syncMetadataDirectory } from './metadata.mjs';

const pointerSchema = z.object({ version: z.literal(1), ownerKey: z.string().regex(/^[a-f0-9]{64}$/), datasetId: z.uuid(), createdAt: z.iso.datetime() }).strict();
const invalid = () => Object.assign(Error('The owned data directory is unavailable or unsafe. Existing files were preserved.'), { status: 503, code: 'owned_path_invalid' });

// Root ancestors may have a legitimate macOS alias (/var -> /private/var).
// Components *within* the service root may never redirect to another owner.
export async function ownedDirectory(serviceRoot, segments, { create = true } = {}) {
  let path = resolve(serviceRoot);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const root = await lstat(path);
  if (root.isSymbolicLink() || !root.isDirectory()) throw invalid();
  const canonical = await realpath(path);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) throw invalid();
    path = join(path, segment);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw invalid();
  }
  if (await realpath(path) !== join(canonical, ...segments)) throw invalid();
  return path;
}
export function datasetPaths(serviceRoot, key, datasetId) {
  if (!/^(?:[a-f0-9]{64}|locked-[a-f0-9-]{36})$/.test(key) || !z.uuid().safeParse(datasetId).success) throw invalid();
  const root = join(resolve(serviceRoot), 'owners', key, 'datasets', datasetId);
  return { datasetId, root, dataRoot: join(root, 'state'), appRoot: join(root, 'app'), workspaceRoot: join(root, 'member-homes'), logsRoot: join(root, 'logs') };
}
export async function readDataset(serviceRoot, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw invalid();
  const base = await ownedDirectory(serviceRoot, ['owners', key]);
  let file;
  try {
    file = await open(join(base, 'current.json'), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > 4096 || info.nlink !== 1) throw invalid();
    const value = pointerSchema.parse(JSON.parse(await file.readFile('utf8')));
    if (value.ownerKey !== key) throw invalid();
    const paths = datasetPaths(serviceRoot, key, value.datasetId);
    for (const name of ['state', 'app', 'member-homes', 'logs']) await ownedDirectory(serviceRoot, ['owners', key, 'datasets', value.datasetId, name], { create: false });
    return { ...value, ...paths };
  } catch (error) { if (error.code === 'ENOENT' && !file) return null; throw error; }
  finally { await file?.close(); }
}
export async function stageDataset(serviceRoot, key) {
  const paths = datasetPaths(serviceRoot, key, randomUUID());
  for (const name of ['state', 'app', 'member-homes', 'logs']) await ownedDirectory(serviceRoot, ['owners', key, 'datasets', paths.datasetId, name]);
  return paths;
}
async function publishUnlocked(serviceRoot, key, staged, expectedId, assertCurrent) {
  const before = await readDataset(serviceRoot, key);
  if ((before?.datasetId || null) !== expectedId) throw Object.assign(Error('This Squad changed before its data could be published.'), { status: 409, code: 'dataset_changed' });
  const paths = datasetPaths(serviceRoot, key, staged.datasetId);
  for (const name of ['state', 'app', 'member-homes', 'logs']) await ownedDirectory(serviceRoot, ['owners', key, 'datasets', paths.datasetId, name], { create: false });
  const base = await ownedDirectory(serviceRoot, ['owners', key]);
  const temporary = join(base, `.current-${randomUUID()}.tmp`);
  const value = { version: 1, ownerKey: key, datasetId: paths.datasetId, createdAt: new Date().toISOString() };
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); } finally { await file.close(); }
    assertCurrent?.();
    await replaceMetadata(temporary, join(base, 'current.json'));
    await syncMetadataDirectory(base);
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
  return { ...value, ...paths };
}
// The lock survives process suspension and releases on crash without a stale
// PID-file takeover race. Its file must never be unlinked.
export async function publishDataset(serviceRoot, key, staged, expectedId = null, assertCurrent) {
  const base = await ownedDirectory(serviceRoot, ['owners', key]);
  const release = await acquireWriterLease(join(base, 'publication.sqlite'));
  try {
    return await publishUnlocked(serviceRoot, key, staged, expectedId, assertCurrent);
  } finally { release(); }
}
export async function ensureDataset(serviceRoot, key) {
  const existing = await readDataset(serviceRoot, key);
  return existing || publishDataset(serviceRoot, key, await stageDataset(serviceRoot, key));
}
