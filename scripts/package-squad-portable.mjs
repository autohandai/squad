#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const nativeComponents = [
  'squad',
  'autohand-squad-daemon',
  'autohand-squad-analytics',
  'autohand-squad-tray',
  'autohand-squad-ui',
];

const releaseVersion = requiredEnv('RELEASE_VERSION');
const releaseOs = env('RELEASE_OS', process.platform);
const releaseArch = env('RELEASE_ARCH', process.arch);
const buildProfile = env('BUILD_PROFILE', 'release');
const outDir = resolve(env('RELEASE_OUT_DIR', join('release', `${releaseOs}-${releaseArch}`)));
const webRuntimeDir = resolve(env('WEB_RUNTIME_DIR', join('release', 'web-input', 'runtime')));

assertNativeTarget('RELEASE_OS', releaseOs, process.platform);
assertNativeTarget('RELEASE_ARCH', releaseArch, process.arch);
assertSafeVersion(releaseVersion);

const bundleName = `autohand-squad-${releaseVersion}-${releaseOs}-${releaseArch}`;
const archiveName = `${bundleName}.tar.gz`;
const archivePath = join(outDir, archiveName);
const scratchDir = await mkdtemp(join(tmpdir(), 'autohand-squad-portable-'));
const bundleRoot = join(scratchDir, bundleName);

try {
  await mkdir(join(bundleRoot, 'bin'), { recursive: true });
  await stageNativeRuntime();
  await stageWebRuntime();
  await stageProductionModules();
  await createArchive();
  await recordChecksum();
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}

console.log(`Portable application: ${archivePath}`);

async function stageNativeRuntime() {
  const targetDir = resolve('daemon', 'target', buildProfile);
  for (const binary of nativeComponents) {
    const fileName = executableName(binary, releaseOs);
    const source = join(targetDir, fileName);
    const destination = join(bundleRoot, 'bin', fileName);
    await assertFile(source);
    await copyFile(source, destination);
    if (releaseOs !== 'win32') await chmod(destination, 0o755);
  }
}

async function stageWebRuntime() {
  for (const fileName of ['server.mjs', 'package.json', 'bun.lock', 'README.md']) {
    const source = join(webRuntimeDir, fileName);
    await assertFile(source);
    await copyFile(source, join(bundleRoot, fileName));
  }

  const distSource = join(webRuntimeDir, 'dist');
  await assertDirectory(distSource);
  await cp(distSource, join(bundleRoot, 'dist'), {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });
  await assertFile(join(bundleRoot, 'dist', 'index.html'));
}

async function stageProductionModules() {
  const modulesRoot = resolve('node_modules');
  const sdkSource = join(modulesRoot, '@autohandai', 'agent-sdk');
  const sdkDestination = join(bundleRoot, 'node_modules', '@autohandai', 'agent-sdk');
  const sdkCli = sdkCliName(releaseOs, releaseArch);

  await mkdir(join(sdkDestination, 'cli'), { recursive: true });
  await copyRequiredFile(join(sdkSource, 'package.json'), join(sdkDestination, 'package.json'));
  await copyRequiredDirectory(join(sdkSource, 'dist'), join(sdkDestination, 'dist'));
  await copyRequiredFile(join(sdkSource, 'cli', sdkCli), join(sdkDestination, 'cli', sdkCli));
  if (releaseOs !== 'win32') await chmod(join(sdkDestination, 'cli', sdkCli), 0o755);

  for (const dependency of ['toml', 'yaml']) {
    await copyRequiredDirectory(
      join(modulesRoot, dependency),
      join(bundleRoot, 'node_modules', dependency),
    );
  }
}

async function createArchive() {
  await mkdir(outDir, { recursive: true });
  await rm(archivePath, { force: true });
  const result = spawnSync('tar', ['-czf', archivePath, bundleName], {
    cwd: scratchDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Unable to create ${archiveName}${detail ? `: ${detail}` : ''}`);
  }
  const info = await stat(archivePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Portable archive is empty: ${archivePath}`);
  }
}

async function recordChecksum() {
  const checksum = await hashFile(archivePath);
  const checksumPath = join(outDir, `checksums-${releaseOs}-${releaseArch}.txt`);
  let lines = [];
  try {
    lines = (await readFile(checksumPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.endsWith(`  ${archiveName}`));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  lines.push(`${checksum}  ${archiveName}`);
  await writeFile(checksumPath, `${lines.join('\n')}\n`);
}

async function copyRequiredFile(source, destination) {
  await assertFile(source);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyRequiredDirectory(source, destination) {
  await assertDirectory(source);
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });
}

async function assertFile(filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new Error(`Required release file is missing: ${filePath}`);
  }
  if (!info.isFile()) throw new Error(`Required release path is not a file: ${filePath}`);
}

async function assertDirectory(directoryPath) {
  let info;
  try {
    info = await stat(directoryPath);
  } catch {
    throw new Error(`Required release directory is missing: ${directoryPath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Required release path is not a directory: ${directoryPath}`);
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function sdkCliName(osName, archName) {
  const names = {
    'linux/x64': 'autohand-linux-x64',
    'darwin/arm64': 'autohand-macos-arm64',
    'darwin/x64': 'autohand-macos-x64',
    'win32/x64': 'autohand-windows-x64.exe',
  };
  const name = names[`${osName}/${archName}`];
  if (!name) throw new Error(`Unsupported portable release target: ${osName}/${archName}`);
  return name;
}

function executableName(binaryName, osName) {
  return `${binaryName}${osName === 'win32' ? '.exe' : ''}`;
}

function assertNativeTarget(name, requested, actual) {
  if (requested !== actual) {
    throw new Error(`${name} is ${requested}, but this native build runner is ${actual}`);
  }
}

function assertSafeVersion(version) {
  if (!/^[0-9A-Za-z.-]+$/.test(version) || version.includes('..')) {
    throw new Error(`Unsafe release version for portable archive: ${version}`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}
