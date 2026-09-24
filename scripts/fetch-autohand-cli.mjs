#!/usr/bin/env node
// Vendors the pinned Autohand Code CLI release into vendor/autohand-cli so the
// app ships the version declared in package.json (`autohand.cliVersion`)
// instead of whatever build the Agent SDK package happens to bundle.
//
//   node scripts/fetch-autohand-cli.mjs            # host platform only
//   node scripts/fetch-autohand-cli.mjs --all      # every supported target
//   node scripts/fetch-autohand-cli.mjs --target linux/arm64
//
// Each release asset is downloaded as the published archive, verified against
// its .sha256 companion, and extracted to vendor/autohand-cli/<binary name>.
// A BUILD_INFO.json beside the binaries records the version and digests so the
// bridge, the launcher preflight, and the release checks can prove what shipped.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const appPackage = require('../package.json');

export const CLI_TARGETS = {
  'darwin/arm64': { binary: 'autohand-macos-arm64', archive: 'autohand-macos-arm64.tar.gz', inner: 'autohand' },
  'darwin/x64': { binary: 'autohand-macos-x64', archive: 'autohand-macos-x64.tar.gz', inner: 'autohand' },
  'linux/x64': { binary: 'autohand-linux-x64', archive: 'autohand-linux-x64.tar.gz', inner: 'autohand' },
  'linux/arm64': { binary: 'autohand-linux-arm64', archive: 'autohand-linux-arm64.tar.gz', inner: 'autohand' },
  'win32/x64': { binary: 'autohand-windows-x64.exe', archive: 'autohand-windows-x64.zip', inner: 'autohand.exe' },
};

export function pinnedCliVersion() {
  const version = String(appPackage.autohand?.cliVersion || '').trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json autohand.cliVersion must be a semver string, found "${version}"`);
  }
  return version;
}

export function cliRepository() {
  const repository = String(appPackage.autohand?.cliRepository || 'autohandai/code-cli').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error(`package.json autohand.cliRepository must be owner/name, found "${repository}"`);
  }
  return repository;
}

export function vendorDir(root = process.cwd()) {
  return process.env.AUTOHAND_SQUAD_CLI_DIR
    ? resolve(process.env.AUTOHAND_SQUAD_CLI_DIR)
    : join(root, 'vendor', 'autohand-cli');
}

function releaseAssetUrl(repository, version, asset) {
  return `https://github.com/${repository}/releases/download/v${version}/${asset}`;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'autohand-squad-release' } });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function extractArchive(archivePath, outputDir) {
  // bsdtar on macOS and Windows (10+) and GNU tar on Linux all read both
  // gzip tarballs and zip files, so one command covers every release asset.
  const result = spawnSync('tar', ['-xf', archivePath, '-C', outputDir], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Could not extract ${archivePath}: ${(result.stderr || result.error?.message || '').trim()}`);
  }
}

async function readBuildInfo(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'BUILD_INFO.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function alreadyVendored(dir, target, version, info) {
  const binaryPath = join(dir, target.binary);
  if (!existsSync(binaryPath) || info?.version !== version) return false;
  const expected = info?.sha256?.[target.binary];
  if (!expected) return false;
  return (await sha256File(binaryPath)) === expected;
}

export async function fetchCli({ targets, root = process.cwd(), log = console.log } = {}) {
  const version = pinnedCliVersion();
  const repository = cliRepository();
  const dir = vendorDir(root);
  await mkdir(dir, { recursive: true });
  const info = (await readBuildInfo(dir)) || {};
  const sha256 = info.version === version && info.sha256 && typeof info.sha256 === 'object' ? { ...info.sha256 } : {};
  const archiveSha256 = info.version === version && info.archiveSha256 && typeof info.archiveSha256 === 'object' ? { ...info.archiveSha256 } : {};

  for (const key of targets) {
    const target = CLI_TARGETS[key];
    if (!target) throw new Error(`Unsupported Autohand CLI target: ${key}`);
    if (await alreadyVendored(dir, target, version, { version: info.version, sha256 })) {
      log(`Autohand CLI ${version} for ${key} already vendored (${target.binary}).`);
      continue;
    }

    const scratch = await mkdtemp(join(tmpdir(), 'autohand-cli-'));
    try {
      const archivePath = join(scratch, target.archive);
      const checksumUrl = releaseAssetUrl(repository, version, `${target.archive}.sha256`);
      const archiveUrl = releaseAssetUrl(repository, version, target.archive);
      log(`Downloading Autohand CLI ${version} for ${key}…`);
      await download(archiveUrl, archivePath);
      const checksumResponse = await fetch(checksumUrl, { redirect: 'follow' });
      if (!checksumResponse.ok) throw new Error(`Checksum download failed (${checksumResponse.status}): ${checksumUrl}`);
      const expectedArchiveSha = (await checksumResponse.text()).trim().split(/\s+/)[0].toLowerCase();
      const actualArchiveSha = await sha256File(archivePath);
      if (!/^[0-9a-f]{64}$/.test(expectedArchiveSha) || expectedArchiveSha !== actualArchiveSha) {
        throw new Error(`Checksum mismatch for ${target.archive}: expected ${expectedArchiveSha}, got ${actualArchiveSha}`);
      }

      const extractDir = join(scratch, 'extract');
      await mkdir(extractDir, { recursive: true });
      extractArchive(archivePath, extractDir);
      let extracted = join(extractDir, target.inner);
      if (!existsSync(extracted)) {
        // Tolerate archives that nest the binary in a single directory.
        const entries = await readdir(extractDir, { withFileTypes: true });
        const nested = entries.find((entry) => entry.isDirectory());
        if (nested && existsSync(join(extractDir, nested.name, target.inner))) {
          extracted = join(extractDir, nested.name, target.inner);
        }
      }
      if (!existsSync(extracted)) {
        throw new Error(`${target.archive} did not contain ${target.inner}`);
      }
      const destination = join(dir, target.binary);
      await rm(destination, { force: true });
      await rename(extracted, destination).catch(async () => {
        await writeFile(destination, await readFile(extracted));
      });
      if (!target.binary.endsWith('.exe')) await chmod(destination, 0o755);
      sha256[target.binary] = await sha256File(destination);
      archiveSha256[target.archive] = actualArchiveSha;
      const size = (await stat(destination)).size;
      log(`Vendored ${target.binary} (${Math.round(size / 1024 / 1024)} MB, sha256 ${sha256[target.binary].slice(0, 12)}…).`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  const buildInfo = {
    version,
    tag: `v${version}`,
    repository,
    source: `https://github.com/${repository}/releases/tag/v${version}`,
    fetchedAt: new Date().toISOString(),
    sha256,
    archiveSha256,
  };
  await writeFile(join(dir, 'BUILD_INFO.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
  return { dir, version, targets: [...targets] };
}

function hostTarget() {
  const key = `${process.platform}/${process.arch}`;
  if (!CLI_TARGETS[key]) throw new Error(`No Autohand CLI release target for ${key}`);
  return key;
}

// Compare file paths, not a URL pathname: on Windows the URL form is
// /D:/... while argv[1] is D:\..., which made this script a silent no-op there.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const targets = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--all') targets.push(...Object.keys(CLI_TARGETS));
    else if (args[index] === '--target') targets.push(args[++index]);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!targets.length) targets.push(hostTarget());
  const result = await fetchCli({ targets: Array.from(new Set(targets)) });
  console.log(`Autohand CLI ${result.version} ready in ${result.dir} (${result.targets.join(', ')}).`);
}
