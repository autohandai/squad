#!/usr/bin/env node
// Build-time preparation only. Agents use the packaged engine; they never
// download it at runtime. Existing inputs are verified before being reused.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { COMPUTER_USE_ASSETS, COMPUTER_USE_VERSION } from './stage-computer-use.mjs';
import { COMPUTER_USE_HOST, verifyComputerUseBranding } from './computer-use-host.mjs';

export const COMPUTER_USE_SOURCE = Object.freeze({
  commit: 'fc92b70417cdae941ba8b104a6e7b3b5b52a07e2',
  archiveSha256: '785deff349e16b5ba7d4c90e4ab01bbb01d53ed97ede76aaa32422eaca26402c',
  files: Object.freeze({
    'autohand/macos/main.swift': 'e71d45912d93a58d42e3f35e5b242a7f86cd97f67ca70f7e27bcc92d1251dfdb',
    'autohand/scripts/build-macos-host.sh': '329c1e1bea13a80292e31da4ba72d5ed8fb9b774a7cc9dc035c417c46579cf25',
    'autohand/assets/icon.png': '79fea595f2d60a7ba1b6a451ce5b2be51c98e1792c453e7e3a23b3b8b0b4ece0',
  }),
});
const LICENSE = 'public/legal/autohand-code-cli-v0.9.7.LICENSE';
const LICENSE_SHA = '1490fbb717f9c3d21419aec21d1ca9287c9551b0f4ec2f209ecc24d1523949d3';
const HOST_NAME = COMPUTER_USE_HOST.bundleName;
const EXECUTABLE = COMPUTER_USE_HOST.executable;
const SOURCE_PREFIX = `computer-use-${COMPUTER_USE_SOURCE.commit}`;
const SOURCE_URL = `https://codeload.github.com/autohandai/computer-use/tar.gz/${COMPUTER_USE_SOURCE.commit}`;

async function sha(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return result.stdout;
}
async function regularFile(filename) {
  const info = await lstat(filename).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info && !info.isFile()) throw new Error(`Expected a regular input file: ${filename}`);
  return Boolean(info);
}
async function verifiedDownload(url, filename, expected, { check, log }) {
  if (await regularFile(filename)) {
    if (await sha(filename) !== expected) throw new Error(`Pinned checksum mismatch: ${filename}`);
    log(`Verified existing ${filename}.`);
    return;
  }
  if (check) throw new Error(`Missing prepared input: ${filename}`);
  await mkdir(resolve(filename, '..'), { recursive: true });
  const scratch = await mkdtemp(join(resolve(filename, '..'), '.computer-use-download-'));
  const download = join(scratch, 'archive');
  try {
    log(`Downloading pinned Computer Use input: ${url}`);
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
    let bytes = 0;
    const bounded = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 512 * 1024 * 1024 ? new Error('Computer Use download exceeded 512 MiB.') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(download, { flags: 'wx' }));
    if (await sha(download) !== expected) throw new Error(`Downloaded Computer Use input failed its pinned checksum: ${url}`);
    await rename(download, filename);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

async function verifyHost(host, arches, vendorDir) {
  const info = await lstat(host).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return false;
  if (!info.isDirectory()) throw new Error('Computer Use host must be a real app bundle directory.');
  const resources = join(host, 'Contents', 'Resources');
  const provenance = JSON.parse(await readFile(join(resources, 'BUILD_PROVENANCE.json'), 'utf8'));
  verifyComputerUseBranding(provenance.branding);
  if (provenance.sourceCommit !== COMPUTER_USE_SOURCE.commit
      || provenance.sourceSha256 !== COMPUTER_USE_SOURCE.files['autohand/macos/main.swift']
      || provenance.buildScriptSha256 !== COMPUTER_USE_SOURCE.files['autohand/scripts/build-macos-host.sh']) {
    throw new Error('Computer Use host source provenance does not match the pinned source.');
  }
  const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(host, 'Contents', 'Info.plist')]).trim();
  if (identifier !== COMPUTER_USE_HOST.bundleId) throw new Error('Computer Use host bundle identity is incorrect.');
  const name = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleDisplayName', join(host, 'Contents', 'Info.plist')]).trim();
  if (name !== COMPUTER_USE_HOST.displayName) throw new Error('Squad Computer Use host display name is incorrect.');
  if (await sha(join(resources, 'AutohandComputerUse.png')) !== COMPUTER_USE_HOST.iconSha256) throw new Error('Squad Computer Use host icon is incorrect.');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', host]);
  const executable = join(host, 'Contents', 'MacOS', EXECUTABLE);
  run('/usr/bin/lipo', [executable, '-verify_arch', ...arches.map((arch) => arch === 'x64' ? 'x86_64' : 'arm64')]);
  const minimums = [...run('/usr/bin/otool', ['-l', executable]).matchAll(/\bminos\s+([0-9.]+)/g)].map((match) => match[1]);
  if (!minimums.length || minimums.some((minimum) => !/^13\.0(?:\.0)?$/.test(minimum))) throw new Error('Computer Use host must target macOS 13.0 explicitly.');
  if (await sha(join(resources, 'LICENSE-Apache-2.0.txt')) !== LICENSE_SHA) throw new Error('Computer Use host Apache license is missing or incorrect.');
  const notice = await readFile(join(resources, 'NOTICE.txt'), 'utf8');
  if (!notice.includes(COMPUTER_USE_SOURCE.commit) || !notice.includes('Apache-2.0')) throw new Error('Computer Use host source NOTICE is missing.');
  const metadata = await readFile(join(vendorDir, 'PREPARED_INPUTS.json'), 'utf8').then(JSON.parse).catch(() => null);
  const initial = await readFile(join(vendorDir, 'BUILD_INPUTS.json'), 'utf8').then(JSON.parse).catch(() => null);
  const expected = metadata?.host?.executableSha256 || initial?.host?.executableSha256;
  if (!expected || await sha(executable) !== expected) throw new Error('Computer Use host executable does not match its build receipt; use --rebuild-host.');
  return true;
}

async function buildHost({ root, vendorDir, host, arches, sourceArchive, log }) {
  await verifiedDownload(SOURCE_URL, sourceArchive, COMPUTER_USE_SOURCE.archiveSha256, { check: false, log });
  if (await sha(join(root, LICENSE)) !== LICENSE_SHA) throw new Error('Pinned Apache license input does not match its checksum.');
  if (await sha(join(root, COMPUTER_USE_HOST.patchPath)) !== COMPUTER_USE_HOST.patchSha256) throw new Error('Reviewed Squad host branding patch changed.');
  if (await sha(join(root, COMPUTER_USE_HOST.iconPath)) !== COMPUTER_USE_HOST.iconSha256) throw new Error('Pinned Squad host icon changed.');
  const scratch = await mkdtemp(join(tmpdir(), 'squad-computer-use-build-'));
  const publication = await mkdtemp(join(vendorDir, '.computer-use-host-'));
  try {
    // Extract only reviewed, individually hashed files. No sibling checkout or
    // repository build output is modified; all compilation stays in scratch.
    run('tar', ['-xzf', sourceArchive, '-C', scratch, ...Object.keys(COMPUTER_USE_SOURCE.files).map((name) => `${SOURCE_PREFIX}/${name}`)]);
    const source = join(scratch, SOURCE_PREFIX);
    for (const [name, expected] of Object.entries(COMPUTER_USE_SOURCE.files)) {
      if (!await regularFile(join(source, name)) || await sha(join(source, name)) !== expected) throw new Error(`Pinned host source changed: ${name}`);
    }
    run('/usr/bin/git', ['apply', '--check', join(root, COMPUTER_USE_HOST.patchPath)], { cwd: source });
    run('/usr/bin/git', ['apply', join(root, COMPUTER_USE_HOST.patchPath)], { cwd: source });
    if (await sha(join(source, 'autohand/macos/main.swift')) !== COMPUTER_USE_HOST.patchedSourceSha256
        || await sha(join(source, 'autohand/scripts/build-macos-host.sh')) !== COMPUTER_USE_HOST.patchedBuildScriptSha256) {
      throw new Error('Squad host branding patch produced unexpected source bytes.');
    }
    const app = join(publication, HOST_NAME);
    const identity = process.env.AUTOHAND_CODESIGN_IDENTITY || process.env.APPLE_SIGNING_IDENTITY || '-';
    run('/bin/bash', [join(source, 'autohand/scripts/build-macos-host.sh'), '--output', app, '--version', COMPUTER_USE_VERSION], { env: { ...process.env, AUTOHAND_CODESIGN_IDENTITY: identity } });
    const binaries = [];
    for (const arch of arches) {
      const binary = join(scratch, `host-${arch}`);
      run('/usr/bin/swiftc', ['-O', join(source, 'autohand/macos/main.swift'), '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`, '-module-cache-path', join(scratch, `module-cache-${arch}`), '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', '-o', binary]);
      binaries.push(binary);
    }
    const executable = join(app, 'Contents', 'MacOS', EXECUTABLE);
    if (binaries.length === 1) await cp(binaries[0], executable);
    else run('/usr/bin/lipo', ['-create', ...binaries, '-output', executable]);
    const resources = join(app, 'Contents', 'Resources');
    await cp(join(root, COMPUTER_USE_HOST.iconPath), join(resources, 'AutohandComputerUse.png'));
    const branding = { ...COMPUTER_USE_HOST };
    const compiler = run('/usr/bin/swiftc', ['--version']).trim();
    // Record the SDK actually linked into each Mach-O slice. xcrun's default
    // SDK lookup can be stale even when swiftc successfully finds its SDK.
    const sdk = [...new Set([...run('/usr/bin/otool', ['-l', executable]).matchAll(/\bsdk\s+([0-9.]+)/g)].map((match) => match[1]))];
    await cp(join(root, LICENSE), join(resources, 'LICENSE-Apache-2.0.txt'));
    await writeFile(join(resources, 'NOTICE.txt'), `Squad Computer Use permission host\nCopyright 2026 Autohand AI LLC\nSPDX-License-Identifier: Apache-2.0\n\nBuilt from autohandai/computer-use commit ${COMPUTER_USE_SOURCE.commit} (computer-use-v${COMPUTER_USE_VERSION}).\nSquad branding patch ${COMPUTER_USE_HOST.patchSha256} changes only identity, name and permission text; the Squad app icon is separately pinned.\nThe separately bundled Cua engine is MIT licensed; its full notice ships as LICENSE-CUA.md.\nBuild-time preparation targets macOS 13.0. Developer ID signing and notarization are separate release steps.\n`);
    await writeFile(join(resources, 'BUILD_PROVENANCE.json'), `${JSON.stringify({ schemaVersion: 1, product: COMPUTER_USE_HOST.displayName, repository: 'autohandai/computer-use', sourceCommit: COMPUTER_USE_SOURCE.commit, release: `computer-use-v${COMPUTER_USE_VERSION}`, sourcePath: 'autohand/macos/main.swift', sourceSha256: COMPUTER_USE_SOURCE.files['autohand/macos/main.swift'], buildScriptPath: 'autohand/scripts/build-macos-host.sh', buildScriptSha256: COMPUTER_USE_SOURCE.files['autohand/scripts/build-macos-host.sh'], sourceArchiveSha256: COMPUTER_USE_SOURCE.archiveSha256, target: arches.map((arch) => `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`), compiler, sdk, branding, builtAt: new Date().toISOString(), signing: identity === '-' ? 'ad hoc, hardened runtime' : 'Developer ID, hardened runtime', notarized: false }, null, 2)}\n`);
    run('/usr/bin/codesign', ['--force', '--deep', '--options', 'runtime', '--sign', identity, '--timestamp=none', app]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const hostReceipt = { path: HOST_NAME, sourceCommit: COMPUTER_USE_SOURCE.commit, executableSha256: await sha(executable), arches, minimumMacOS: '13.0' };
    const temporaryReceipt = join(publication, 'PREPARED_INPUTS.json');
    await writeFile(temporaryReceipt, JSON.stringify({ host: hostReceipt }));
    await verifyHost(app, arches, publication);
    // Publish only a completely built and verified bundle. Prior prepared
    // artifacts stay intact if download, compilation or signing fails.
    const previous = join(publication, 'previous-host.app');
    if (await lstat(host).catch(() => null)) await rename(host, previous);
    try { await rename(app, host); } catch (error) {
      if (await lstat(previous).catch(() => null)) await rename(previous, host);
      throw error;
    }
    return hostReceipt;
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(publication, { recursive: true, force: true });
  }
}

export async function fetchComputerUse({ root = process.cwd(), targets = [`${process.platform}/${process.arch}`], check = false, rebuildHost = false, log = console.log } = {}) {
  targets = [...new Set(targets)];
  for (const target of targets) if (!COMPUTER_USE_ASSETS[target]) throw new Error(`Unsupported Computer Use target: ${target}`);
  const vendorDir = resolve(process.env.AUTOHAND_SQUAD_COMPUTER_USE_DIR || join(root, 'vendor/computer-use'));
  if (!check) await mkdir(vendorDir, { recursive: true });
  for (const name of new Set(targets.map((target) => COMPUTER_USE_ASSETS[target].name))) {
    const asset = Object.values(COMPUTER_USE_ASSETS).find((asset) => asset.name === name);
    await verifiedDownload(`https://github.com/autohandai/computer-use/releases/download/computer-use-v${COMPUTER_USE_VERSION}/${name}`, join(vendorDir, name), asset.sha256, { check, log });
  }
  const arches = targets.filter((target) => target.startsWith('darwin/')).map((target) => target.split('/')[1]);
  let hostReceipt = null;
  if (arches.length && process.platform === 'darwin') {
    const host = resolve(process.env.AUTOHAND_SQUAD_COMPUTER_USE_HOST || join(vendorDir, HOST_NAME));
    let valid = false;
    try { valid = !rebuildHost && await verifyHost(host, arches, vendorDir); } catch (error) {
      if (check || process.env.AUTOHAND_SQUAD_COMPUTER_USE_HOST) throw error;
      log(`Preparing host again: ${error.message}`);
    }
    if (!valid) {
      if (check || process.env.AUTOHAND_SQUAD_COMPUTER_USE_HOST) throw new Error('A verified macOS Computer Use host is required.');
      const sourceArchive = resolve(process.env.AUTOHAND_SQUAD_COMPUTER_USE_SOURCE_ARCHIVE || join(vendorDir, `source-${COMPUTER_USE_SOURCE.commit}.tar.gz`));
      hostReceipt = await buildHost({ root, vendorDir, host, arches, sourceArchive, log });
    } else {
      log(`Verified existing ${host}.`);
      hostReceipt = { path: HOST_NAME, sourceCommit: COMPUTER_USE_SOURCE.commit, executableSha256: await sha(join(host, 'Contents/MacOS', EXECUTABLE)), arches, minimumMacOS: '13.0' };
    }
  } else if (arches.length) {
    log('Engine archives prepared; the macOS permission host must be built on macOS before macOS staging.');
  }
  if (!check) await writeFile(join(vendorDir, 'PREPARED_INPUTS.json'), `${JSON.stringify({ schemaVersion: 1, version: COMPUTER_USE_VERSION, sourceCommit: COMPUTER_USE_SOURCE.commit, sourceArchiveSha256: COMPUTER_USE_SOURCE.archiveSha256, archives: targets.map((target) => ({ target, ...COMPUTER_USE_ASSETS[target] })), host: hostReceipt }, null, 2)}\n`);
  return { vendorDir, targets, host: hostReceipt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targets = [];
  let check = false;
  let rebuildHost = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--all') targets.push(...Object.keys(COMPUTER_USE_ASSETS));
    else if (arg === '--target') {
      if (!process.argv[index + 1]) throw new Error('--target requires platform/architecture.');
      targets.push(process.argv[++index]);
    } else if (arg === '--check') check = true;
    else if (arg === '--rebuild-host') rebuildHost = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (check && rebuildHost) throw new Error('--check cannot rebuild a host.');
  const result = await fetchComputerUse({ ...(targets.length ? { targets } : {}), check, rebuildHost });
  console.log(`Computer Use ${COMPUTER_USE_VERSION} inputs ${check ? 'verified' : 'ready'} in ${result.vendorDir}.`);
}
