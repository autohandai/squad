import { open, rename } from 'node:fs/promises';
import { runOwnershipHelper } from './native-helper.mjs';

// File contents are flushed by the caller. Windows has no portable directory
// fsync: use its same-directory write-through replacement, never unlink-first.
// This guarantees process-crash recovery; it is not a power-loss guarantee.
export async function replaceMetadata(from,to) {
  if (process.platform === 'win32') await runOwnershipHelper(['--ownership-replace',from,to]);
  else await rename(from,to);
}
export async function syncMetadataDirectory(path) {
  if (process.platform === 'win32') return;
  const directory=await open(path,'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
