#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

import { existsSync } from 'node:fs';
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
const cliPath = join(sdkRoot, 'cli', cliName);
if (!existsSync(cliPath)) {
  throw new Error(`Bundled Autohand CLI is missing: ${cliPath}`);
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
  `Autohand SDK ${installedPackage.version} import and bundled CLI (${cliName}) startup passed${localSdkDir ? ` from ${localSdkDir}` : ''}.`,
);
