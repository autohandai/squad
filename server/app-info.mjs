import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

export async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export function readSourceIdentity(rootDir) {
  const git = (args) => spawnSync('git', ['-C', rootDir, ...args], { encoding: 'utf8', timeout: 5000 });
  const head = git(['rev-parse', 'HEAD']);
  const commitHash = head.status === 0 && /^[a-f0-9]{40}$/i.test(head.stdout.trim()) ? head.stdout.trim() : null;
  const status = git(['status', '--porcelain', '--untracked-files=normal', '--', '.',
    ':(exclude)dist', ':(exclude)release', ':(exclude)node_modules', ':(exclude)src-tauri/runtime',
    ':(exclude)src-tauri/binaries', ':(exclude)src-tauri/target', ':(exclude)daemon/target']);
  return { commitHash, dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null };
}

async function optionalText(rootDir, name) {
  return readFile(join(rootDir, name), 'utf8').catch(() => '');
}

let executableCache = null;
async function installedExecutableInfo() {
  // A bundled Node sidecar lives beside the actual desktop executable. A
  // developer's Node binary is never presented as the app's checksum.
  const filename = join(dirname(process.execPath), process.platform === 'win32' ? 'autohand-squad.exe' : 'autohand-squad');
  const info = await stat(filename).catch(() => null);
  if (!info?.isFile()) return { appExecutableSha256: null, appExecutableName: null };
  const key = `${filename}:${info.size}:${info.mtimeMs}`;
  if (executableCache?.key !== key) executableCache = { key, sha256: await sha256File(filename) };
  return { appExecutableSha256: executableCache.sha256, appExecutableName: basename(filename) };
}

export async function readAppInfo({ rootDir }) {
  const [rawManifest, executable] = await Promise.all([
    readFile(join(rootDir, 'APP_INFO.json'), 'utf8').catch(() => null),
    installedExecutableInfo(),
  ]);
  const manifest = rawManifest ? JSON.parse(rawManifest) : null;
  if (manifest && manifest.schemaVersion !== 1) throw new Error('Bundled app information uses an unsupported format.');
  if (manifest) return { ...manifest, metadataSource: 'bundled', ...executable, appExecutableLabel: 'Desktop executable SHA-256' };
  const metadata = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  const [changelog, license, security] = await Promise.all(['CHANGELOG.md', 'LICENSE', 'SECURITY.md'].map((name) => optionalText(rootDir, name)));
  return {
    schemaVersion: 1,
    name: 'Autohand Squad',
    version: metadata.version || null,
    builtAt: null,
    ...readSourceIdentity(rootDir),
    repository: 'autohandai/squad',
    nodeVersion: process.version,
    cliVersion: metadata.autohand?.cliVersion || null,
    frontendSha256: null,
    frontendFiles: [],
    frontendLabel: 'Staged frontend files SHA-256',
    changelog, license, security,
    thirdPartyLicenses: [],
    licenseCoverage: ['Dependency notices are generated when the desktop runtime is staged.'],
    metadataSource: 'source',
    ...executable,
    appExecutableLabel: 'Desktop executable SHA-256',
  };
}
