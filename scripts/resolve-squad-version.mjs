#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const eventName = env('GITHUB_EVENT_NAME', 'local');
const mode = option('mode', 'RELEASE_MODE', inferMode());
const refName = env('GITHUB_REF_NAME', '');
const sha = env('GITHUB_SHA', shortTimestamp());
const shortSha = sha.slice(0, 12);
const runNumber = env('GITHUB_RUN_NUMBER', '0');
const prNumber = env('PR_NUMBER', env('GITHUB_EVENT_NUMBER', runNumber));
const inputVersion = env('INPUT_VERSION', '').trim();
const inputChannel = env('INPUT_CHANNEL', '').trim();
const inputDraft = env('INPUT_DRAFT', '').trim();
const inputPrerelease = env('INPUT_PRERELEASE', '').trim();
const packageVersion = normalizeVersion(packageJson.version) || '0.0.0';
const tagVersion = versionFromTag(refName);
const latestStable = latestStableTagVersion();

const metadata = mode === 'dry-run'
  ? dryRunMetadata()
  : releaseMetadata();

writeOutputs(metadata);
console.log(JSON.stringify(metadata, null, 2));

function dryRunMetadata() {
  const version = `0.0.0-pr.${cleanIdentifier(prNumber)}.${cleanIdentifier(shortSha)}`;
  return {
    mode: 'dry-run',
    version,
    tag: `ci-${shortSha}`,
    channel: 'canary',
    draft: 'true',
    prerelease: 'true',
    latest: 'false',
    title: `Autohand Squad ${version}`,
  };
}

function releaseMetadata() {
  const channel = resolveChannel();
  const version = resolveVersion(channel);
  const prerelease = boolString(
    inputPrerelease ? inputPrerelease : channel !== 'stable' || hasPrerelease(version),
  );
  const draft = boolString(
    inputDraft ? inputDraft : eventName === 'workflow_dispatch' && channel === 'stable',
  );
  return {
    mode: 'release',
    version,
    tag: tagVersion ? refName : `squad-v${version}`,
    channel,
    draft,
    prerelease,
    latest: channel === 'stable' && prerelease !== 'true' ? 'true' : 'false',
    title: `Autohand Squad ${version}`,
  };
}

function resolveChannel() {
  if (inputChannel) return inputChannel;
  if (eventName === 'push' && refName === 'main') return 'canary';
  if (tagVersion && hasPrerelease(tagVersion)) {
    if (tagVersion.includes('-canary.')) return 'canary';
    if (tagVersion.includes('-beta.')) return 'beta';
  }
  return 'stable';
}

function resolveVersion(channel) {
  if (tagVersion) return tagVersion;
  if (inputVersion) {
    const normalized = normalizeVersion(inputVersion);
    if (!normalized) throw new Error(`Invalid release version: ${inputVersion}`);
    return normalized;
  }

  const base = nextReleaseBase();
  if (channel === 'stable') return base;
  return `${base}-${channel}.${cleanIdentifier(runNumber)}.${cleanIdentifier(shortSha)}`;
}

function nextReleaseBase() {
  if (!latestStable) return packageVersion;
  const current = parseSemver(latestStable);
  const packageSemver = parseSemver(packageVersion);
  if (compareSemver(packageSemver, current) > 0) return packageVersion;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function latestStableTagVersion() {
  let tags = [];
  try {
    tags = execFileSync('git', ['tag', '--list', 'squad-v*', 'v*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  const versions = tags
    .map(versionFromTag)
    .filter(Boolean)
    .filter((version) => !hasPrerelease(version))
    .map(parseSemver);
  versions.sort(compareSemver).reverse();
  const latest = versions[0];
  return latest ? `${latest.major}.${latest.minor}.${latest.patch}` : null;
}

function versionFromTag(tag) {
  if (!tag) return null;
  return normalizeVersion(tag.replace(/^refs\/tags\//, '').replace(/^squad-v/, '').replace(/^v/, ''));
}

function normalizeVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return `${Number(major)}.${Number(minor)}.${Number(patch)}${prerelease ? `-${prerelease}` : ''}`;
}

function parseSemver(version) {
  const [core] = version.split('-', 1);
  const [major, minor, patch] = core.split('.').map(Number);
  return { major, minor, patch };
}

function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function hasPrerelease(version) {
  return version.includes('-');
}

function cleanIdentifier(value) {
  return String(value || '0').replace(/[^0-9A-Za-z-]/g, '-').replace(/^-+|-+$/g, '') || '0';
}

function boolString(value) {
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase()) ? 'true' : 'false';
}

function parseArgs(items) {
  const parsed = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = items[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, 'true');
    }
  }
  return parsed;
}

function option(argName, envName, fallback) {
  return args.get(argName) || env(envName, fallback);
}

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function inferMode() {
  return eventName === 'pull_request' ? 'dry-run' : 'release';
}

function shortTimestamp() {
  return String(Date.now().toString(36));
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`);
}
