#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const requiredComponents = new Set(['cli', 'daemon', 'analytics', 'tray', 'ui']);
const requiredReleaseOs = (process.env.REQUIRED_RELEASE_OS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const requiredReleaseTargets = (process.env.REQUIRED_RELEASE_TARGETS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const releaseVersion = process.env.RELEASE_VERSION?.trim();
const releaseChannel = process.env.RELEASE_CHANNEL?.trim();
const outDir = process.env.RELEASE_OUT_DIR?.trim() || 'release';
const inputs = process.argv.slice(2);
const manifestPaths = await findManifestPaths(inputs.length > 0 ? inputs : [outDir]);

if (manifestPaths.length === 0) {
  throw new Error('No manifest-*.json files were found.');
}

const manifests = [];
for (const filePath of manifestPaths) {
  const manifest = JSON.parse(await readFile(filePath, 'utf8'));
  validateManifestShape(manifest, filePath);
  manifests.push({ filePath, manifest });
}

const manifestVersion = uniqueValue(manifests, 'latestAllowedVersion');
const manifestChannel = uniqueValue(manifests, 'channel');
assertExpectedValue('latestAllowedVersion', manifestVersion, releaseVersion);
assertExpectedValue('channel', manifestChannel, releaseChannel);
const version = releaseVersion || manifestVersion;
const channel = releaseChannel || manifestChannel;
const artifacts = dedupeArtifacts(
  manifests.flatMap(({ manifest }) => manifest.artifacts),
);

validateComponentCoverage(artifacts);
validateOsCoverage(artifacts);
validateTargetCoverage(artifacts);
await mkdir(outDir, { recursive: true });

const merged = {
  latestAllowedVersion: version,
  channel,
  artifacts,
};

await writeFile(join(outDir, `manifest-${channel}.json`), `${JSON.stringify(merged, null, 2)}\n`);
await writeFile(join(outDir, 'release-summary.md'), releaseSummary(merged));
await writeFile(
  join(outDir, 'checksums.txt'),
  `${uniqueChecksumLines(artifacts).join('\n')}\n`,
);

console.log(`Merged ${manifestPaths.length} manifests into ${join(outDir, `manifest-${channel}.json`)}`);
console.log(`Artifacts: ${artifacts.length}`);

async function findManifestPaths(paths) {
  const results = [];
  for (const input of paths) {
    if (input.endsWith('.json') && isPlatformManifestName(basenameLike(input))) {
      results.push(input);
      continue;
    }
    results.push(...await scan(input));
  }
  return [...new Set(results)].sort();
}

async function scan(root) {
  const results = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const filePath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await scan(filePath));
    } else if (entry.isFile() && isPlatformManifestName(entry.name)) {
      results.push(filePath);
    }
  }
  return results;
}

function validateManifestShape(manifest, filePath) {
  if (!manifest.latestAllowedVersion) {
    throw new Error(`${filePath} is missing latestAllowedVersion`);
  }
  if (!manifest.channel) {
    throw new Error(`${filePath} is missing channel`);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error(`${filePath} has no artifacts`);
  }
  for (const artifact of manifest.artifacts) {
    for (const field of ['os', 'arch', 'component', 'binaryName', 'url', 'sha256']) {
      if (!artifact[field]) throw new Error(`${filePath} has an artifact missing ${field}`);
    }
  }
}

function uniqueValue(manifests, field) {
  const values = [...new Set(manifests.map(({ manifest }) => manifest[field]))];
  if (values.length !== 1) {
    throw new Error(`Release manifests disagree on ${field}: ${values.join(', ')}`);
  }
  return values[0];
}

function assertExpectedValue(field, actual, expected) {
  if (expected && actual !== expected) {
    throw new Error(`Release manifests use ${field} ${actual}, expected ${expected}`);
  }
}

function dedupeArtifacts(artifacts) {
  const seen = new Map();
  for (const artifact of artifacts) {
    const key = [
      artifact.os,
      artifact.arch,
      artifact.component,
      artifact.binaryName,
      artifact.url,
    ].join('|');
    const existing = seen.get(key);
    if (existing && existing.sha256 !== artifact.sha256) {
      throw new Error(`Conflicting checksum for ${artifact.binaryName} ${artifact.os}/${artifact.arch}`);
    }
    seen.set(key, artifact);
  }
  return [...seen.values()].sort((a, b) => {
    return `${a.os}/${a.arch}/${a.component}`.localeCompare(`${b.os}/${b.arch}/${b.component}`);
  });
}

function validateComponentCoverage(artifacts) {
  const groups = new Map();
  for (const artifact of artifacts) {
    const key = `${artifact.os}/${artifact.arch}`;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(artifact.component);
  }
  for (const [target, components] of groups) {
    for (const required of requiredComponents) {
      if (!components.has(required)) {
        throw new Error(`Release manifest for ${target} is missing ${required}`);
      }
    }
  }
}

function validateOsCoverage(artifacts) {
  if (requiredReleaseOs.length === 0) return;
  const present = new Set(artifacts.map((artifact) => artifact.os));
  for (const required of requiredReleaseOs) {
    if (!present.has(required)) {
      throw new Error(`Merged release manifest is missing required OS ${required}`);
    }
  }
}

function validateTargetCoverage(artifacts) {
  if (requiredReleaseTargets.length === 0) return;
  const present = new Set(artifacts.map((artifact) => `${artifact.os}/${artifact.arch}`));
  for (const required of requiredReleaseTargets) {
    if (!present.has(required)) {
      throw new Error(`Merged release manifest is missing required target ${required}`);
    }
  }
}

function releaseSummary(manifest) {
  const targets = [...new Set(manifest.artifacts.map((artifact) => `${artifact.os}/${artifact.arch}`))].sort();
  const components = [...new Set(manifest.artifacts.map((artifact) => artifact.component))].sort();
  return [
    `# Autohand Squad ${manifest.latestAllowedVersion}`,
    '',
    `Channel: ${manifest.channel}`,
    `Targets: ${targets.join(', ')}`,
    `Components: ${components.join(', ')}`,
    '',
    '## Installer Manifest',
    '',
    `Upload manifest-${manifest.channel}.json with the release assets. The Autohand CLI uses this manifest to download verified Squad runtime binaries.`,
    '',
  ].join('\n');
}

function basenameLike(filePath) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function isPlatformManifestName(fileName) {
  return /^manifest-[^-]+-.+\.json$/.test(fileName);
}

function uniqueChecksumLines(artifacts) {
  return [
    ...new Set(artifacts.map((artifact) => `${artifact.sha256}  ${artifact.url.split('/').pop()}`)),
  ].sort();
}
