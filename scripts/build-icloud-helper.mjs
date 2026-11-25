#!/usr/bin/env node
// Builds Squad iCloud.app (ADR-0255), the nested helper that carries phone
// packets through the person's private CloudKit database (squad-mobile
// ADR-0007). Output: src-tauri/helpers/Squad iCloud.app, signed before the
// outer app exactly like the Computer Use host (ADR-0248), so the outer
// signature seals it as it is.
//
//   node scripts/build-icloud-helper.mjs [--profile <file.provisionprofile>] [--arch arm64|x86_64]
//
// Without a profile (AUTOHAND_SQUAD_ICLOUD_PROFILE) the helper is built and
// signed with no iCloud entitlements. It then only reports "unentitled":
// iCloud entitlements are restricted and AMFI kills a process that claims
// them without a profile (ADR-0007, evidence item 4). With a profile, the
// entitlements are derived from the profile, never wider than it grants.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseSignature, readMacSignature, releaseSigningIdentity, signMacCode } from './lib/macos-signing.mjs';

export const ICLOUD_HELPER = Object.freeze({
  bundleId: 'ai.autohand.squad.icloud',
  bundleName: 'Squad iCloud.app',
  executable: 'Squad iCloud',
  container: 'iCloud.ai.autohand.squad',
});

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0] || ''} failed while building the iCloud helper: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return result.stdout;
}

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function plist(entries) {
  const encode = value => Array.isArray(value) ? `<array>${value.map(encode).join('')}</array>`
    : typeof value === 'boolean' ? (value ? '<true/>' : '<false/>')
      : `<string>${xml(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${Object.entries(entries).map(([key, value]) => `  <key>${xml(key)}</key>${encode(value)}`).join('\n')}\n</dict></plist>\n`;
}

export function helperInfoPlist(version) {
  return plist({
    CFBundleIdentifier: ICLOUD_HELPER.bundleId,
    CFBundleName: 'Squad iCloud',
    CFBundleDisplayName: 'Squad iCloud',
    CFBundleExecutable: ICLOUD_HELPER.executable,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    CFBundleInfoDictionaryVersion: '6.0',
    LSMinimumSystemVersion: '13.0',
    // A background helper: no Dock icon, no menu bar.
    LSUIElement: true,
    NSPrincipalClass: 'NSApplication',
  });
}

/**
 * The entitlements to sign with, from what the profile grants. Throws when
 * the profile is for another app or does not include the container, so a
 * wrong profile fails the build instead of a launch.
 */
export function helperEntitlements(profile) {
  const granted = profile?.Entitlements || {};
  const team = profile?.TeamIdentifier?.[0] || granted['com.apple.developer.team-identifier'];
  const appID = granted['com.apple.application-identifier'] || granted['application-identifier'];
  if (!team || appID !== `${team}.${ICLOUD_HELPER.bundleId}`) throw new Error(`The provisioning profile is for ${appID || 'an unknown app'}, not ${ICLOUD_HELPER.bundleId}.`);
  const containers = granted['com.apple.developer.icloud-container-identifiers'] || [];
  if (!containers.includes(ICLOUD_HELPER.container)) throw new Error(`The provisioning profile does not include ${ICLOUD_HELPER.container}.`);
  const services = granted['com.apple.developer.icloud-services'] || [];
  if (!(services === '*' || services.includes?.('CloudKit') || services.includes?.('*'))) throw new Error('The provisioning profile does not include CloudKit.');
  // A development profile allows debugging (get-task-allow); a Developer ID
  // one does not and must talk to the Production CloudKit environment.
  const development = granted['get-task-allow'] === true;
  const entitlements = {
    'com.apple.application-identifier': appID,
    'com.apple.developer.team-identifier': team,
    'com.apple.developer.icloud-container-identifiers': [ICLOUD_HELPER.container],
    'com.apple.developer.icloud-services': ['CloudKit'],
    // Developer ID builds must name the Production CloudKit environment.
    'com.apple.developer.icloud-container-environment': development ? 'Development' : 'Production',
  };
  const aps = granted['com.apple.developer.aps-environment'];
  if (aps) entitlements['com.apple.developer.aps-environment'] = aps;
  return entitlements;
}

export async function readProfile(path, runCommand = run) {
  const decoded = runCommand('/usr/bin/security', ['cms', '-D', '-i', path]);
  return JSON.parse(runCommand('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: decoded }));
}

export async function buildICloudHelper({
  outputDir = join(rootDir, 'src-tauri', 'helpers'),
  profilePath = process.env.AUTOHAND_SQUAD_ICLOUD_PROFILE || '',
  arch = process.env.AUTOHAND_SQUAD_ICLOUD_ARCH || (process.arch === 'x64' ? 'x86_64' : 'arm64'),
  signIdentity = releaseSigningIdentity(process.env),
} = {}) {
  if (process.platform !== 'darwin') throw new Error('The iCloud helper is macOS only.');
  const version = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')).version;
  const packagePath = join(rootDir, 'native', 'icloud-helper');
  run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', packagePath, '--arch', arch, '--product', 'SquadICloud']);
  const binDir = run('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--package-path', packagePath, '--arch', arch, '--show-bin-path']).trim();
  const bundle = join(outputDir, ICLOUD_HELPER.bundleName);
  await rm(bundle, { recursive: true, force: true });
  await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  await copyFile(join(binDir, 'SquadICloud'), join(bundle, 'Contents', 'MacOS', ICLOUD_HELPER.executable));
  await chmod(join(bundle, 'Contents', 'MacOS', ICLOUD_HELPER.executable), 0o755);
  await writeFile(join(bundle, 'Contents', 'Info.plist'), helperInfoPlist(version));

  let entitlements = null;
  if (profilePath) {
    const profile = await readProfile(resolve(profilePath));
    entitlements = helperEntitlements(profile);
    await copyFile(resolve(profilePath), join(bundle, 'Contents', 'embedded.provisionprofile'));
  }
  const scratch = await mkdtemp(join(tmpdir(), 'squad-icloud-'));
  try {
    let entitlementsFile;
    if (entitlements) {
      entitlementsFile = join(scratch, 'helper.entitlements');
      await writeFile(entitlementsFile, plist(entitlements));
    }
    signMacCode(bundle, { identity: signIdentity, entitlements: entitlementsFile });
  } finally { await rm(scratch, { recursive: true, force: true }); }
  assertReleaseSignature(readMacSignature(bundle), signIdentity, 'The bundled Squad iCloud helper');
  const result = { bundle, version, arch, entitled: Boolean(entitlements), signing: signIdentity === '-' ? 'ad-hoc' : signIdentity };
  await writeFile(join(outputDir, 'ICLOUD_HELPER.json'), `${JSON.stringify({ ...result, bundle: ICLOUD_HELPER.bundleName }, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  buildICloudHelper({ ...(option('--profile') ? { profilePath: option('--profile') } : {}), ...(option('--arch') ? { arch: option('--arch') } : {}) })
    .then(result => console.log(`Built ${result.bundle} (${result.arch}, ${result.entitled ? 'iCloud entitled' : 'not entitled: reports "unentitled"'}, ${result.signing}).`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

export const helperExists = (dir = join(rootDir, 'src-tauri', 'helpers')) => existsSync(join(dir, ICLOUD_HELPER.bundleName, 'Contents', 'MacOS', ICLOUD_HELPER.executable));
