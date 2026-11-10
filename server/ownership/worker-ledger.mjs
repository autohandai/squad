import { constants } from 'node:fs';
import { open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ownedDirectory } from './datasets.mjs';
import { replaceMetadata, syncMetadataDirectory } from './metadata.mjs';
import { validateJobName, windowsJobDrained, windowsBootUptime } from './native-helper.mjs';
import { randomBytes } from 'node:crypto';

const invalid = () => Error('A previous private Squad process has not finished. Existing data was preserved. Close that process or restart this computer before retrying.');
async function durableWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await replaceMetadata(temporary, path);
  await syncMetadataDirectory(join(path, '..'));
}
export async function createWorkerLedger(serviceRoot, brokerId) {
  const directory = await ownedDirectory(serviceRoot, ['ownership-workers']);
  // A fresh broker owns the OS writer lease. It cannot assume the old broker's
  // detached workers/helpers disappeared when that lease was released.
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(directory, name), file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let entry;
    try { const info = await file.stat(); if (!info.isFile() || info.nlink !== 1 || info.size > 4096) throw invalid(); entry = JSON.parse(await file.readFile('utf8')); } finally { await file.close(); }
    if (entry.version !== 1 || !Number.isInteger(entry.brokerPid) || entry.brokerPid < 1 || (entry.group !== null && (!Number.isInteger(entry.group) || entry.group < 1))) throw invalid();
    try { process.kill(entry.brokerPid, 0); throw invalid(); } catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    if (process.platform === 'win32' && entry.jobName) {
      validateJobName(entry.jobName);
      if (!await windowsJobDrained(entry.jobName,{receiptPath:path.replace(/\.json$/,'.drained'),bootUptimeMs:entry.bootUptimeMs})) throw invalid();
    } else if (entry.group !== null) {
      if (process.platform === 'win32') throw invalid();
      const deadline = Date.now() + 5000;
      while (true) {
        try { process.kill(process.platform === 'win32' ? entry.group : -entry.group, 0); }
        catch (failure) { if (failure.code === 'ESRCH') break; if(failure.code!=='EPERM')throw failure; }
        if (Date.now() >= deadline) throw invalid();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    await unlink(path);
  }
  return {
    async pending() {
      const id = randomUUID(), path = join(directory, `${id}.json`);
      const entry = { version: 1, brokerId, brokerPid: process.pid, group: null, ...(process.platform==='win32'?{jobName:`Global\\AutohandSquad-${randomBytes(32).toString('hex')}`,bootUptimeMs:await windowsBootUptime()}:{}) };
      const receiptPath=path.replace(/\.json$/,'.drained');
      await durableWrite(path, entry);
      return { jobName:entry.jobName,receiptPath,bootUptimeMs:entry.bootUptimeMs, async launched(group) { await durableWrite(path, { ...entry, group }); }, async clear() { await unlink(path);await unlink(receiptPath).catch(error=>{if(error.code!=='ENOENT')throw error;}); await syncMetadataDirectory(directory); } };
    },
  };
}
