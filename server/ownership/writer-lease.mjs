import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';

const held = new Set();

// A local SQLite transaction is an OS-backed process lease. Never unlink or
// replace this file: its inode is the lock, and a crash releases it automatically.
// No user/agent data is stored in this database.
export async function acquireWriterLease(path) {
  path = resolve(path);
  path = join(await realpath(dirname(path)), basename(path));
  if (held.has(path)) throw Object.assign(Error('Another Squad writer already holds this directory.'), { status: 409, code: 'dataset_busy' });
  held.add(path);
  try {
  const file = await open(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
  let identity;
  try {
    identity = await file.stat();
    if (!identity.isFile() || identity.nlink !== 1) throw Error('The Squad writer lease is unsafe.');
  } finally { await file.close(); }
  let database;
  try {
    database = new DatabaseSync(path);
    const after = await lstat(path);
    if (after.isSymbolicLink() || after.ino !== identity.ino || after.dev !== identity.dev || after.nlink !== 1) throw Error('The Squad writer lease changed during startup.');
    database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
  } catch (cause) {
    database?.close();
    throw Object.assign(Error('Another Squad writer is using this data directory, or its local filesystem cannot provide a lock. Existing data was preserved.', { cause }), { status: 409, code: 'dataset_busy' });
  }
  let closed = false;
  return () => { if (!closed) { closed = true; try { database.exec('ROLLBACK'); } finally { database.close(); held.delete(path); } } };
  } catch (error) { held.delete(path); throw error; }
}
