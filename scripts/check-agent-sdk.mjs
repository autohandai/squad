#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const appPackage = require('../package.json');
const installedPackage = require('@autohandai/agent-sdk/package.json');
const expectedVersion = appPackage.dependencies['@autohandai/agent-sdk'];

if (expectedVersion !== '1.0.4') {
  throw new Error(`Expected the app to pin @autohandai/agent-sdk 1.0.4, found ${expectedVersion}`);
}
if (installedPackage.version !== expectedVersion) {
  throw new Error(
    `Installed @autohandai/agent-sdk is ${installedPackage.version}, expected ${expectedVersion}`,
  );
}

const { AutohandSDK } = await import('@autohandai/agent-sdk');
if (typeof AutohandSDK !== 'function') {
  throw new Error('@autohandai/agent-sdk does not export AutohandSDK');
}

for (const method of ['start', 'streamPrompt', 'interrupt', 'close']) {
  if (typeof AutohandSDK.prototype[method] !== 'function') {
    throw new Error(`AutohandSDK is missing required method ${method}()`);
  }
}

const sdk = new AutohandSDK({ cwd: process.cwd(), timeout: 15_000 });
try {
  await sdk.start();
} finally {
  await sdk.close();
}

console.log(`Autohand SDK ${installedPackage.version} import and CLI startup passed.`);
