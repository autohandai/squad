import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readSourceIdentity, sha256File } from '../server/app-info.mjs';

const require = createRequire(import.meta.url);
const toml = require('toml');

async function text(filename) { return readFile(filename, 'utf8').catch(() => ''); }
async function json(filename) { const value = await text(filename); return value ? JSON.parse(value) : null; }
function declaredLicense(value) { return typeof value === 'string' ? value : value?.type || 'Not declared'; }
function repositoryUrl(value) {
  const raw = typeof value === 'string' ? value : value?.url;
  const url = raw?.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  return url && /^https?:\/\//.test(url) ? url : null;
}

async function notices(directory, additionalName = '') {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const names = entries.filter((item) => item.isFile() && /^(licen[cs]e|notice|copying)(?:[._-]|$)/i.test(item.name)).map((item) => item.name);
  if (additionalName) names.push(additionalName);
  const result = [];
  for (const name of [...new Set(names)].sort()) {
    const filename = resolve(directory, name);
    if (!filename.startsWith(`${resolve(directory)}${sep}`)) continue;
    const content = await text(filename);
    if (content) result.push(`${name}\n\n${content}`);
  }
  return result.join('\n\n────────\n\n');
}

async function dependencyDirectory(name, start) {
  for (let current = start; ; current = dirname(current)) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpath(candidate);
    if (dirname(current) === current) return null;
  }
}

async function npmLicenses(rootDir, metadata) {
  const records = new Map();
  const visited = new Set();
  async function visit(name, from, requestedVersion, optional = false) {
    const directory = await dependencyDirectory(name, from);
    if (!directory) {
      records.set(`missing:${name}`, { ecosystem: 'npm', name, version: requestedVersion, license: 'Unavailable', text: '', repository: null,
        note: `${optional ? 'Optional dependency' : 'Required dependency'} is not installed on this build machine; no notice text was available.` });
      return;
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    const pkg = await json(join(directory, 'package.json'));
    const license = declaredLicense(pkg.license);
    const body = await notices(directory, license.startsWith('SEE LICENSE IN ') ? license.slice(15) : '');
    records.set(`${pkg.name}@${pkg.version}`, { ecosystem: 'npm', name: pkg.name, version: pkg.version || 'Not declared', license,
      text: body, repository: repositoryUrl(pkg.repository), note: body ? null : 'No license or notice text was included in the installed package.' });
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const dependency of Object.keys(dependencies).sort()) await visit(dependency, directory, dependencies[dependency], Boolean(pkg.optionalDependencies?.[dependency]));
  }
  const dependencies = { ...metadata.dependencies, ...metadata.optionalDependencies };
  for (const name of Object.keys(dependencies).sort()) await visit(name, rootDir, dependencies[name], Boolean(metadata.optionalDependencies?.[name]));
  return [...records.values()];
}

async function rustLicenses(rootDir) {
  const sourceRoot = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry', 'src');
  const registries = (await readdir(sourceRoot, { withFileTypes: true }).catch(() => [])).filter((item) => item.isDirectory()).map((item) => join(sourceRoot, item.name));
  const packages = new Map();
  for (const lockName of ['daemon/Cargo.lock', 'src-tauri/Cargo.lock']) {
    const content = await text(join(rootDir, lockName));
    if (!content) continue;
    for (const pkg of toml.parse(content).package || []) {
      if (!pkg.source) continue;
      packages.set(`${pkg.name}@${pkg.version}`, pkg);
    }
  }
  const result = [];
  for (const pkg of packages.values()) {
    const directory = registries.map((registry) => join(registry, `${pkg.name}-${pkg.version}`)).find((candidate) => existsSync(join(candidate, 'Cargo.toml')));
    const metadataText = directory ? await text(join(directory, 'Cargo.toml')) : '';
    const metadata = metadataText ? toml.parse(metadataText).package || {} : {};
    const body = directory ? await notices(directory, metadata['license-file'] || '') : '';
    result.push({ ecosystem: 'Rust', name: pkg.name, version: pkg.version, license: metadata.license || 'Not available in local registry',
      text: body, repository: repositoryUrl(metadata.repository), note: body ? null : directory
        ? 'The cached crate declares a license but contains no readable root notice text.'
        : 'This Cargo.lock entry is not cached on this build machine; it may target another platform. License text was unavailable.' });
  }
  return result;
}

async function nodeLicense(nodeVersion) {
  const version = String(nodeVersion || process.version);
  const executableCandidates = [process.env.NODE_RUNTIME_PATH, process.execPath,
    join(homedir(), '.local', 'share', 'fnm', 'node-versions', version, 'installation', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')].filter(Boolean);
  for (const executable of executableCandidates) {
    const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status !== 0 || probe.stdout.trim() !== version) continue;
    const prefix = dirname(dirname(executable));
    for (const filename of [join(prefix, 'LICENSE'), join(dirname(executable), 'LICENSE'), join(prefix, 'share', 'doc', 'node', 'LICENSE')]) {
      const body = await text(filename);
      if (body) return { ecosystem: 'Runtime', name: 'Node.js', version, license: 'MIT and bundled dependency notices', text: body,
        repository: 'https://github.com/nodejs/node', note: 'Original distribution LICENSE for the staged Node version, including its bundled dependency notices.' };
    }
  }
  return { ecosystem: 'Runtime', name: 'Node.js', version, license: 'MIT and bundled dependency notices', text: '', repository: 'https://github.com/nodejs/node',
    note: 'The original LICENSE for this exact staged Node version was not available locally.' };
}

async function cliLicense(rootDir, runtimeDir, metadata) {
  const buildInfo = await json(join(runtimeDir, 'vendor', 'autohand-cli', 'BUILD_INFO.json'));
  const version = buildInfo?.version || metadata.autohand?.cliVersion || 'Unknown';
  const repository = buildInfo?.repository || metadata.autohand?.cliRepository || 'autohandai/code-cli';
  const bundledNotice = await notices(join(runtimeDir, 'vendor', 'autohand-cli'));
  let body = '';
  let evidence = '';
  if (!body && buildInfo?.version === metadata.autohand?.cliVersion
      && metadata.autohand?.cliRepository === repository && /^[\w.+-]+$/.test(version)) {
    const pinnedNotice = `public/legal/autohand-code-cli-v${version}.LICENSE`;
    body = await text(join(rootDir, pinnedNotice));
    if (body) evidence = `Pinned notice ${pinnedNotice} for ${repository} release v${version}; version and repository match bundled BUILD_INFO and package metadata.`;
  }
  if (!body && bundledNotice) { body = bundledNotice; evidence = 'Notice bundled beside the pinned CLI binary.'; }
  // Read the exact release-tag object, never the sibling checkout's current
  // license. Only a matching repository and BUILD_INFO pin qualify.
  if (!body && buildInfo?.version === metadata.autohand?.cliVersion && /^[\w.-]+\/[\w.-]+$/.test(repository) && /^[\w.+-]+$/.test(version)) {
    for (const name of ['cli-3', 'code-cli']) {
      const sibling = resolve(rootDir, '../../..', name);
      const origin = spawnSync('git', ['-C', sibling, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000 });
      if (origin.status !== 0 || !origin.stdout.includes(`${repository}.git`) && !origin.stdout.trim().endsWith(repository)) continue;
      const notice = spawnSync('git', ['-C', sibling, 'show', `v${version}:LICENSE`], { encoding: 'utf8', timeout: 5000 });
      if (notice.status === 0 && notice.stdout.trim()) { body = notice.stdout; evidence = `License read from ${repository} release tag v${version}; version matches bundled BUILD_INFO.`; break; }
    }
  }
  const license = /Apache License/.test(body) ? 'Apache-2.0' : /MIT License|Permission is hereby granted/.test(body) ? 'MIT' : 'See notice';
  return { ecosystem: 'CLI', name: 'Autohand Code CLI', version, license: body ? license : 'Not verified', text: body,
    repository: `https://github.com/${repository}`, note: evidence || 'The pinned CLI license text was not available locally; current-checkout licenses are not assumed to match this release.' };
}

async function frontendManifest(runtimeDir) {
  const dist = join(runtimeDir, 'dist');
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile()) files.push({ path: relative(dist, filename).split(sep).join('/'), size: (await stat(filename)).size, sha256: await sha256File(filename) });
    }
  }
  await walk(dist);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { frontendSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), frontendFiles: files,
    frontendLabel: 'Staged frontend files SHA-256 (sorted filename, size and file digest manifest)' };
}

export async function stageAppInfo({ rootDir, runtimeDir, nodeVersion }) {
  const metadata = await json(join(rootDir, 'package.json'));
  if (!metadata?.version) throw new Error('App information requires a package version.');
  const runtimeMetadata = await json(join(runtimeDir, 'DESKTOP_RUNTIME.json'));
  const selectedNodeVersion = nodeVersion || runtimeMetadata?.nodeVersion || runtimeMetadata?.node || process.version;
  const documents = {};
  for (const [field, name] of [['changelog', 'CHANGELOG.md'], ['license', 'LICENSE'], ['security', 'SECURITY.md']]) {
    documents[field] = await readFile(join(rootDir, name), 'utf8');
    await writeFile(join(runtimeDir, name), documents[field]);
  }
  const [npm, rust, node, cli, frontend] = await Promise.all([
    npmLicenses(rootDir, metadata), rustLicenses(rootDir), nodeLicense(selectedNodeVersion), cliLicense(rootDir, runtimeDir, metadata), frontendManifest(runtimeDir),
  ]);
  const attribution = await text(join(rootDir, 'public', 'fonts', 'ATTRIBUTION.md'));
  const fonts = await Promise.all(['AutohandSans', 'AutohandMono'].map(async (family) => {
    const body = await text(join(rootDir, 'public', 'fonts', `OFL-${family}.txt`));
    return { ecosystem: 'Font', name: family === 'AutohandSans' ? 'Autohand Sans' : 'Autohand Mono', version: '1.000', license: 'OFL-1.1',
      text: [attribution, body].filter(Boolean).join('\n\n'), repository: null,
      note: body ? 'Bundled font attribution and upstream OFL notice.' : 'Font attribution declares OFL-1.1, but this family\'s separate upstream OFL text was not found in public/fonts.' };
  }));
  const computer = await json(join(runtimeDir, 'vendor', 'computer-use', 'BUILD_INFO.json'));
  const computerNotices = computer ? [{ ecosystem: 'Native capability', name: 'Computer Use engine', version: computer.version,
    license: 'MIT', text: await notices(join(runtimeDir, 'vendor', 'computer-use')), repository: 'https://github.com/autohandai/computer-use',
    note: `Pinned component ${computer.release}; source ${computer.sourceCommit}.` }] : [];
  if (computer?.host) computerNotices.push({ ecosystem: 'Native capability', name: 'Squad Computer Use permission host', version: computer.version,
    license: 'Apache-2.0', text: await notices(join(runtimeDir, 'vendor', 'computer-use', 'Squad Computer Use.app', 'Contents', 'Resources')),
    repository: 'https://github.com/autohandai/computer-use', note: `Permission identity ${computer.host.bundleId}; source ${computer.host.sourceCommit}.` });
  const thirdPartyLicenses = [...npm, ...rust, node, cli, ...fonts, ...computerNotices]
    .sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const manifest = { schemaVersion: 1, name: 'Autohand Squad', version: metadata.version, builtAt: new Date().toISOString(), ...readSourceIdentity(rootDir),
    repository: 'autohandai/squad', nodeVersion: selectedNodeVersion, cliVersion: cli.version,
    computerUse: computer ? { version: computer.version, prerelease: computer.prerelease, sourceCommit: computer.sourceCommit, driverSha256: computer.driver.sha256, hostSha256: computer.host?.sha256 || null } : null,
    ...frontend, ...documents, thirdPartyLicenses,
    licenseCoverage: ['npm records follow the declared production dependency closure; frontend build tools may also appear because this package declares them as production dependencies.',
      'Rust records are the union of daemon and desktop Cargo.lock registry dependencies, including other platform and build entries; unavailable local notice text is identified on each record.',
      'System-provided WebKit/WebView2 and operating-system libraries are not redistributed by this notice manifest.'] };
  await writeFile(join(runtimeDir, 'APP_INFO.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
