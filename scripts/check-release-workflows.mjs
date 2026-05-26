#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const resolver = new URL('./resolve-squad-version.mjs', import.meta.url).pathname;

assertEqual(
  resolve({
    GITHUB_EVENT_NAME: 'pull_request',
    PR_NUMBER: '17',
    GITHUB_SHA: 'abcdef1234567890',
    GITHUB_RUN_NUMBER: '42',
  }, ['--mode', 'dry-run']).version,
  '0.0.0-pr.17.abcdef123456',
  'PR dry-run version',
);

const canary = resolve({
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: 'abcdef1234567890',
  GITHUB_RUN_NUMBER: '42',
}, ['--mode', 'release']);
assertEqual(canary.channel, 'canary', 'main push channel');
assertEqual(canary.prerelease, 'true', 'main push prerelease');
assertEqual(canary.latest, 'false', 'main push latest flag');

const stableTag = resolve({
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF_NAME: 'squad-v1.2.3',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release']);
assertEqual(stableTag.version, '1.2.3', 'stable tag version');
assertEqual(stableTag.channel, 'stable', 'stable tag channel');
assertEqual(stableTag.latest, 'true', 'stable tag latest flag');

const explicitStable = resolve({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  INPUT_CHANNEL: 'stable',
  INPUT_VERSION: '2.0.0',
  INPUT_DRAFT: 'true',
  INPUT_PRERELEASE: 'false',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release']);
assertEqual(explicitStable.version, '2.0.0', 'manual stable version');
assertEqual(explicitStable.draft, 'true', 'manual stable draft default');

const tempPatch = 900 + (process.pid % 50);
const tempTag = `squad-v99.88.${tempPatch}`;
try {
  execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tempTag}`], { stdio: 'ignore' });
  throw new Error(`temporary test tag already exists: ${tempTag}`);
} catch {
  // Expected when the tag does not exist.
}

try {
  execFileSync('git', ['tag', tempTag]);
  const autoStable = resolve({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    INPUT_CHANNEL: 'stable',
    GITHUB_SHA: 'abcdef1234567890',
  }, ['--mode', 'release']);
  assertEqual(autoStable.version, `99.88.${tempPatch + 1}`, 'auto-increment stable version');
} finally {
  execFileSync('git', ['tag', '-d', tempTag], { stdio: 'ignore' });
}

console.log('Release workflow metadata checks passed.');

function resolve(env, args) {
  const output = execFileSync(process.execPath, [resolver, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(output);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
