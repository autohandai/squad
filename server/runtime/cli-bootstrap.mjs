import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { statSync } from 'node:fs';

const execute = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
export const CLI_TARGETS = Object.freeze({
  'darwin/arm64': { binary: 'autohand-macos-arm64', archive: 'autohand-macos-arm64.tar.gz', inner: 'autohand' },
  'darwin/x64': { binary: 'autohand-macos-x64', archive: 'autohand-macos-x64.tar.gz', inner: 'autohand' },
  'linux/x64': { binary: 'autohand-linux-x64', archive: 'autohand-linux-x64.tar.gz', inner: 'autohand' },
  'linux/arm64': { binary: 'autohand-linux-arm64', archive: 'autohand-linux-arm64.tar.gz', inner: 'autohand' },
  'win32/x64': { binary: 'autohand-windows-x64.exe', archive: 'autohand-windows-x64.zip', inner: 'autohand.exe' },
});

/** One bounded probe per file revision; an existing but broken CLI is not ready. */
export function createCliProbe() {
  const cache = new Map();
  return (path, { expectedVersion = '' } = {}) => {
    if (!path) return null;
    const previous = cache.get(path);
    let metadata;
    try { metadata = statSyncForProbe(path); } catch { cache.delete(path); return null; }
    const key = `${metadata.mtimeMs}:${metadata.ctimeMs}:${metadata.size}:${expectedVersion}`;
    if (previous?.key === key) return previous.result;
    const probe = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const output = String(probe.stdout || '').trim().replace(/\s*\(unknown\)$/i, '');
    const version = /\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/.exec(output)?.[1] || '';
    const result = probe.status === 0 && version && (!expectedVersion || version === expectedVersion) ? { path, version, output } : null;
    cache.set(path, { key, result });
    return result;
  };
}

// Kept separate from the async installer so readiness polling stays synchronous.
function statSyncForProbe(path) {
  const metadata = statSync(path);
  if (!metadata.isFile()) throw new Error('CLI is not a regular file');
  return metadata;
}

export function createCliBootstrap({ stateDir, version, repository, platform = process.platform, arch = process.arch, locate, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid pinned Autohand CLI release.');
  const target = CLI_TARGETS[`${platform}/${arch}`];
  const directory = join(stateDir, 'runtime', 'autohand-cli', version, `${platform}-${arch}`);
  const path = target ? join(directory, target.binary) : '';
  const inspect = createCliProbe();
  let current = { phase: 'idle', bytes: 0, totalBytes: null, error: '', version };
  let work = null;
  const update = patch => { current = { ...current, ...patch }; };

  function status() {
    const available = locate?.();
    return available?.path ? { ...current, phase: 'ready', error: '', source: available.source } : { ...current };
  }

  async function install() {
    if (!target) throw new Error(`Autohand Code is not available for ${platform}/${arch}.`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const scratch = await mkdtemp(join(directory, '.install-'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Downloading Autohand Code timed out. Check your connection and retry.')), timeoutMs);
    try {
      const base = `https://github.com/${repository}/releases/download/v${version}/`;
      const checksum = await fetchImpl(base+target.archive+'.sha256', { signal: controller.signal });
      if (!checksum.ok) throw new Error(`Could not download Autohand Code verification data (HTTP ${checksum.status}). Check your connection and retry.`);
      const expected = (await checksum.text()).trim().split(/\s+/)[0].toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Autohand Code verification data is invalid. Retry the download.');
      const response = await fetchImpl(base+target.archive, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Could not download Autohand Code (HTTP ${response.status}). Check your connection and retry.`);
      const size = Number(response.headers.get('content-length'));
      const totalBytes = Number.isSafeInteger(size) && size > 0 ? size : null;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('The Autohand Code download exceeds its size limit.');
      update({ phase: 'downloading', totalBytes, bytes: 0 });
      const chunks = [], hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of response.body) {
        controller.signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > MAX_ARCHIVE_BYTES) throw new Error('The Autohand Code download exceeds its size limit.');
        chunks.push(chunk); hash.update(chunk); update({ bytes });
      }
      update({ phase: 'verifying' });
      if (!bytes || (totalBytes && bytes !== totalBytes) || hash.digest('hex') !== expected) throw new Error('Autohand Code verification failed. Nothing was installed; retry the download.');
      const archive = join(scratch, target.archive), extracted = join(scratch, 'extracted');
      await writeFile(archive, Buffer.concat(chunks), { mode: 0o600 });
      await mkdir(extracted);
      const options = { signal: controller.signal, timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
      const listing = await execute('tar', ['-tf', archive], options);
      if (listing.stdout.split(/\r?\n/).filter(Boolean).some(entry => entry.startsWith('/') || entry.includes('\\') || /^[A-Za-z]:/.test(entry) || entry.split('/').includes('..'))) throw new Error('Autohand Code archive contains an invalid path.');
      update({ phase: 'installing' });
      await execute('tar', ['-xf', archive, '-C', extracted], options);
      const candidates = [];
      async function find(directory, depth = 0) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const candidate = join(directory, entry.name);
          if (entry.isFile() && entry.name === target.inner) candidates.push(candidate);
          else if (entry.isDirectory() && depth < 2) await find(candidate, depth+1);
        }
      }
      await find(extracted);
      controller.signal.throwIfAborted();
      if (candidates.length !== 1) throw new Error('Autohand Code archive does not contain the expected executable.');
      if (platform !== 'win32') await chmod(candidates[0], 0o700);
      const probe = inspect(candidates[0], { expectedVersion: version });
      if (!probe) throw new Error(`The downloaded Autohand Code ${version} cannot run on this computer. Nothing was installed.`);
      const binarySha256 = createHash('sha256').update(await readFile(candidates[0])).digest('hex');
      controller.signal.throwIfAborted();
      await rename(candidates[0], path);
      await writeFile(join(directory, 'BUILD_INFO.json'), JSON.stringify({ version, repository, source: base+target.archive, sha256: { [target.binary]: binarySha256 }, archiveSha256: expected })+'\n', { mode: 0o600 });
      update({ phase: 'ready', error: '' });
    } finally { clearTimeout(timer); await rm(scratch, { recursive: true, force: true }); }
  }

  function prepare() {
    if (locate?.()?.path) { update({ phase: 'ready', error: '' }); return status(); }
    if (!work) {
      update({ phase: 'preparing', error: '', bytes: 0, totalBytes: null });
      work = install().catch(error => { update({ phase: 'error', error: error.message || 'Autohand Code could not be prepared. Retry setup.' }); }).finally(() => { work = null; });
    }
    return status();
  }

  return { path, status, prepare, settled: () => work || Promise.resolve() };
}
