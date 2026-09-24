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
assertNativeTarget('RELEASE_OS', os, process.platform);
assertNativeTarget('RELEASE_ARCH', cpu, process.arch);
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
      binaryName: sourceName,
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
await mergeChecksums(join(outDir, `checksums-${os}-${cpu}.txt`), checksums);

console.log(`Packaged ${artifacts.length} manifest entries in ${outDir}`);
console.log(`Release manifest: ${join(outDir, manifestName)}`);

// The portable and installer packagers append to the same checksum file, so a
// re-run of this script must replace only its own lines instead of truncating.
async function mergeChecksums(checksumPath, lines) {
  const ownNames = new Set(lines.map((line) => line.split(/\s{2,}/)[1]).filter(Boolean));
  let existing = [];
  try {
    existing = (await readFile(checksumPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !ownNames.has(line.split(/\s{2,}/)[1]));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(checksumPath, `${[...existing, ...lines].join('\n')}\n`);
}

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function assertNativeTarget(name, requested, actual) {
  if (requested === actual) return;
  throw new Error(`${name} is ${requested}, but this native build runner is ${actual}`);
}

function executableName(binaryName, osName) {
  return `${binaryName}${exeSuffix(osName)}`;
}

function exeSuffix(osName) {
  return osName === 'win32' || osName === 'windows' ? '.exe' : '';
}

function manifestTargets(osName, archName) {
  // Every launcher spelling of the same target: Node (darwin/x64, win32/x64)
  // and Rust (macos/x86_64, windows/x86_64) OS and arch names, as a full
  // cross-product so a client mixing spellings still finds its artifact.
  const normalized = new Map();
  const osAliases = { darwin: 'macos', macos: 'darwin', win32: 'windows', windows: 'win32', linux: 'linux' };
  const osNames = new Set([osName, osAliases[osName] || osName]);
  const archNames = new Set([archName, nodeArch(archName), rustArch(archName)]);
  for (const targetOs of osNames) {
    for (const targetArch of archNames) addTarget(normalized, targetOs, targetArch);
  }

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
