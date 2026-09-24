#!/usr/bin/env node
// Turn the Tauri bundles for this platform into release assets:
//
//   src-tauri/target/release/bundle/**  →  release/desktop-<os>-<arch>/
//     autohand-squad-<version>-macos-<arch>.dmg
//     autohand-squad-<version>-windows-x64-setup.exe
//     autohand-squad-<version>-linux-x64.deb
//     autohand-squad-<version>-linux-x64.AppImage
//     checksums-desktop-<os>-<arch>.txt
//     manifest-desktop-<os>-<arch>.json   (same shape as the runtime manifests)
//
// The names are what the updater (daemon/src/install.rs::classify_asset) and
// the README download links expect, so a release is consumable by the app and
// by people without any further renaming.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const releaseVersion = requiredEnv('RELEASE_VERSION');
const releaseTag = env('RELEASE_TAG', `v${releaseVersion}`);
const releaseChannel = env('RELEASE_CHANNEL', 'stable');
const releaseRepository = env('RELEASE_REPOSITORY', 'autohandai/squad');
const os = env('RELEASE_OS', process.platform);
const cpu = env('RELEASE_ARCH', process.arch);
const bundleRoot = resolve(env('TAURI_BUNDLE_DIR', join('src-tauri', 'target', 'release', 'bundle')));
const outDir = resolve(env('RELEASE_OUT_DIR', join('release', `desktop-${os}-${cpu}`)));

const osLabel = { darwin: 'macos', win32: 'windows', linux: 'linux' }[os];
if (!osLabel) throw new Error(`Unsupported release OS ${os}`);
const assetBaseUrl = `https://github.com/${releaseRepository}/releases/download/${releaseTag}`;

// Which bundle kinds each OS must produce, and the asset name for each.
const expected = {
  darwin: [{ ext: '.dmg', component: 'dmg', asset: `autohand-squad-${releaseVersion}-macos-${cpu}.dmg` }],
  win32: [{ ext: '-setup.exe', component: 'installer', asset: `autohand-squad-${releaseVersion}-windows-${cpu}-setup.exe` }],
  linux: [
    { ext: '.deb', component: 'deb', asset: `autohand-squad-${releaseVersion}-linux-${cpu}.deb` },
    { ext: '.AppImage', component: 'appimage', asset: `autohand-squad-${releaseVersion}-linux-${cpu}.AppImage` },
  ],
}[os];

const bundles = await collectFiles(bundleRoot);
await mkdir(outDir, { recursive: true });
const artifacts = [];
const checksums = [];

for (const kind of expected) {
  const matches = bundles.filter((file) => basename(file).toLowerCase().endsWith(kind.ext.toLowerCase()));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${kind.ext} bundle under ${bundleRoot}; found ${matches.length}: ${matches.map((file) => basename(file)).join(', ') || 'none'}`);
  }
  const destination = join(outDir, kind.asset);
  await copyFile(matches[0], destination);
  const sha256 = await hashFile(destination);
  const size = (await stat(destination)).size;
  checksums.push(`${sha256}  ${kind.asset}`);
  artifacts.push({
    os,
    arch: cpu,
    component: kind.component,
    binaryName: kind.asset,
    url: `${assetBaseUrl}/${kind.asset}`,
    sha256,
    size,
  });
  console.log(`${kind.asset}  ${(size / 1_048_576).toFixed(1)} MB  ${sha256.slice(0, 12)}…`);
}

await writeFile(join(outDir, `checksums-desktop-${os}-${cpu}.txt`), `${checksums.join('\n')}\n`);
await writeFile(
  join(outDir, `manifest-desktop-${os}-${cpu}.json`),
  `${JSON.stringify({ latestAllowedVersion: releaseVersion, channel: releaseChannel, artifacts }, null, 2)}\n`,
);
console.log(`Packaged ${artifacts.length} desktop asset(s) in ${outDir}`);

async function collectFiles(root) {
  const results = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw new Error(`Tauri bundle directory is missing: ${root} (run bun run desktop:build first)`);
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) results.push(...await collectFiles(path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function env(name, fallback) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function requiredEnv(name) {
  const value = env(name, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
}
