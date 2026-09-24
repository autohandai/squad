#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const appPackage = require('../package.json');
const expectedVersion = appPackage.dependencies['@autohandai/agent-sdk'];
const PINNED_SDK_VERSION = '1.0.5';

// AUTOHAND_AGENT_SDK_DIR validates a local SDK checkout (tin-wrapper/typescript)
// instead of the installed package; the bridge honours the same variable.
const localSdkDir = process.env.AUTOHAND_AGENT_SDK_DIR ? resolve(process.env.AUTOHAND_AGENT_SDK_DIR) : '';
const installedPackage = localSdkDir
  ? require(join(localSdkDir, 'package.json'))
  : require('@autohandai/agent-sdk/package.json');

if (expectedVersion !== PINNED_SDK_VERSION) {
  throw new Error(`Expected the app to pin @autohandai/agent-sdk ${PINNED_SDK_VERSION}, found ${expectedVersion}`);
}
if (!localSdkDir && installedPackage.version !== expectedVersion) {
  throw new Error(
    `Installed @autohandai/agent-sdk is ${installedPackage.version}, expected ${expectedVersion}`,
  );
}

const cliTargets = {
  'darwin/arm64': 'autohand-macos-arm64',
  'darwin/x64': 'autohand-macos-x64',
  'linux/x64': 'autohand-linux-x64',
  'linux/arm64': 'autohand-linux-arm64',
  'win32/x64': 'autohand-windows-x64.exe',
};
const cliName = cliTargets[`${process.platform}/${process.arch}`];
if (!cliName) {
  throw new Error(`No bundled Autohand CLI target for ${process.platform}/${process.arch}`);
}
const sdkRoot = localSdkDir || join(process.cwd(), 'node_modules', '@autohandai', 'agent-sdk');
// The app ships the pinned Autohand Code release (package.json autohand.cliVersion)
// from vendor/autohand-cli; the SDK's bundled build is only a fallback when the
// release has not been fetched yet (bun run cli:fetch).
const pinnedCliVersion = String(appPackage.autohand?.cliVersion || '').trim();
const vendorDir = process.env.AUTOHAND_SQUAD_CLI_DIR ? resolve(process.env.AUTOHAND_SQUAD_CLI_DIR) : join(process.cwd(), 'vendor', 'autohand-cli');
const vendoredCliPath = join(vendorDir, cliName);
let cliPath = vendoredCliPath;
let cliSource = 'vendored';
if (!existsSync(vendoredCliPath)) {
  if (process.env.AUTOHAND_SQUAD_REQUIRE_VENDORED_CLI === '1') {
    throw new Error(`Vendored Autohand CLI ${pinnedCliVersion} is missing (${vendoredCliPath}); run bun run cli:fetch`);
  }
  cliPath = join(sdkRoot, 'cli', cliName);
  cliSource = 'agent-sdk';
}
if (!existsSync(cliPath)) {
  throw new Error(`Bundled Autohand CLI is missing: ${cliPath}`);
}
if (cliSource === 'vendored') {
  const info = JSON.parse(readFileSync(join(vendorDir, 'BUILD_INFO.json'), 'utf8'));
  if (info.version !== pinnedCliVersion) {
    throw new Error(`Vendored Autohand CLI is ${info.version}, package.json pins ${pinnedCliVersion}`);
  }
  const reported = spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  const reportedVersion = String(reported.stdout || '').trim().split(/\s+/)[0];
  if (reported.status !== 0 || reportedVersion !== pinnedCliVersion) {
    throw new Error(`Vendored Autohand CLI reports "${String(reported.stdout || reported.stderr || '').trim()}", expected ${pinnedCliVersion}`);
  }
}

const { AutohandSDK } = localSdkDir
  ? await import(pathToFileURL(join(localSdkDir, 'dist', 'index.js')).href)
  : await import('@autohandai/agent-sdk');
if (typeof AutohandSDK !== 'function') {
  throw new Error('@autohandai/agent-sdk does not export AutohandSDK');
}

for (const method of ['start', 'streamPrompt', 'interrupt', 'close']) {
  if (typeof AutohandSDK.prototype[method] !== 'function') {
    throw new Error(`AutohandSDK is missing required method ${method}()`);
  }
}

const sdk = new AutohandSDK({ cwd: process.cwd(), timeout: 15_000, cliPath });
try {
  await sdk.start();
} finally {
  await sdk.close();
}

console.log(
  `Autohand SDK ${installedPackage.version} import and ${cliSource === 'vendored' ? `vendored Autohand Code ${pinnedCliVersion}` : 'SDK-bundled CLI'} (${cliName}) startup passed${localSdkDir ? ` from ${localSdkDir}` : ''}.`,
);
