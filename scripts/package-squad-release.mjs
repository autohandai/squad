#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const components = [
  { component: 'cli', binaryName: 'squad' },
  { component: 'daemon', binaryName: 'autohand-squad-daemon' },
  { component: 'analytics', binaryName: 'autohand-squad-analytics' },
  { component: 'tray', binaryName: 'autohand-squad-tray' },
  { component: 'ui', binaryName: 'autohand-squad-ui' },
];

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

const releaseVersion = env('RELEASE_VERSION', packageJson.version);
const releaseChannel = env('RELEASE_CHANNEL', 'stable');
const releaseTag = env('RELEASE_TAG', `squad-v${releaseVersion}`);
const releaseRepository = env('RELEASE_REPOSITORY', env('GITHUB_REPOSITORY', 'autohandai/squad'));
const buildProfile = env('BUILD_PROFILE', 'release');
const os = env('RELEASE_OS', process.platform);
const cpu = env('RELEASE_ARCH', process.arch);
const outDir = env('RELEASE_OUT_DIR', join('release', `${os}-${cpu}`));
const targetDir = join('daemon', 'target', buildProfile);
const assetBaseUrl = `https://github.com/${releaseRepository}/releases/download/${releaseTag}`;

await mkdir(outDir, { recursive: true });

const artifacts = [];
const checksums = [];

for (const item of components) {
  const sourceName = executableName(item.binaryName, os);
  const source = join(targetDir, sourceName);
  await assertFile(source);

  const assetName = `${item.binaryName}-${releaseVersion}-${os}-${cpu}${exeSuffix(os)}`;
  const destination = join(outDir, assetName);
  await copyFile(source, destination);

  const sha256 = await hashFile(destination);
  checksums.push(`${sha256}  ${assetName}`);

  for (const target of manifestTargets(os, cpu)) {
    artifacts.push({
      os: target.os,
      arch: target.arch,
      component: item.component,
      binaryName: item.binaryName,
      url: `${assetBaseUrl}/${assetName}`,
      sha256,
    });
  }
}

const manifest = {
  latestAllowedVersion: releaseVersion,
  channel: releaseChannel,
  artifacts,
};

const manifestName = `manifest-${os}-${cpu}.json`;
await writeFile(join(outDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(outDir, `checksums-${os}-${cpu}.txt`), `${checksums.join('\n')}\n`);

console.log(`Packaged ${artifacts.length} manifest entries in ${outDir}`);
console.log(`Release manifest: ${join(outDir, manifestName)}`);

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function executableName(binaryName, osName) {
  return `${binaryName}${exeSuffix(osName)}`;
}

function exeSuffix(osName) {
  return osName === 'win32' || osName === 'windows' ? '.exe' : '';
}

function manifestTargets(osName, archName) {
  const normalized = new Map();
  addTarget(normalized, osName, archName);

  if (osName === 'darwin') addTarget(normalized, 'macos', rustArch(archName));
  if (osName === 'macos') addTarget(normalized, 'darwin', nodeArch(archName));
  if (osName === 'win32') addTarget(normalized, 'windows', rustArch(archName));
  if (osName === 'windows') addTarget(normalized, 'win32', nodeArch(archName));
  if (osName === 'linux') addTarget(normalized, 'linux', rustArch(archName));
  if (osName === 'linux') addTarget(normalized, 'linux', nodeArch(archName));

  return [...normalized.values()];
}

function addTarget(targets, osName, archName) {
  targets.set(`${osName}/${archName}`, { os: osName, arch: archName });
}

function rustArch(archName) {
  if (archName === 'x64') return 'x86_64';
  if (archName === 'arm64') return 'aarch64';
  return archName;
}

function nodeArch(archName) {
  if (archName === 'x86_64') return 'x64';
  if (archName === 'aarch64') return 'arm64';
  return archName;
}

async function assertFile(filePath) {
  try {
    const info = await stat(filePath);
    if (info.isFile()) return;
  } catch {
    // Fall through to the release-focused error below.
  }
  throw new Error(
    `Missing ${filePath}. Build the runtime first with: cd daemon && cargo build ${cargoProfileFlag()} --bins -j1`,
  );
}

async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function cargoProfileFlag() {
  return buildProfile === 'release' ? '--release' : '';
}
