#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import process from 'node:process';
import { packageApp } from '@crabnebula/packager';

const nativeComponents = [
  'squad',
  'autohand-squad-daemon',
  'autohand-squad-analytics',
  'autohand-squad-tray',
  'autohand-squad-ui',
];

const releaseVersion = requiredEnv('RELEASE_VERSION');
const releaseOs = env('RELEASE_OS', process.platform);
const releaseArch = env('RELEASE_ARCH', process.arch);
const buildProfile = env('BUILD_PROFILE', 'release');
const outDir = resolve(env('RELEASE_OUT_DIR', join('release', `${releaseOs}-${releaseArch}`)));
const webRuntimeDir = resolve(env('WEB_RUNTIME_DIR', join('release', 'web-input', 'runtime')));
const nodeRuntimePath = resolve(requiredEnv('NODE_RUNTIME_PATH'));

assertNativeTarget('RELEASE_OS', releaseOs, process.platform);
assertNativeTarget('RELEASE_ARCH', releaseArch, process.arch);
assertSupportedTarget(releaseOs, releaseArch);
assertSafePathSegment('RELEASE_VERSION', releaseVersion);
assertSafePathSegment('BUILD_PROFILE', buildProfile);

const installerName = installerFileName(releaseVersion, releaseOs, releaseArch);
const installerPath = join(outDir, installerName);
const scratchDir = await mkdtemp(join(tmpdir(), 'autohand-squad-installer-'));
const binariesDir = join(scratchDir, 'binaries');
const resourcesDir = join(scratchDir, 'resources');
const packagerOutDir = join(scratchDir, 'output');

try {
  await mkdir(binariesDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  await mkdir(packagerOutDir, { recursive: true });

  await stageExecutables();
  await stageWebRuntime();
  await stageProductionModules();
  const nodeLicenseName = await stageNodeLicense();
  const configPath = await writePackagerConfig(nodeLicenseName);
  await runPackager(configPath);
  await moveGeneratedInstaller();
  await recordChecksum();
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}

console.log(`Native installer: ${installerPath}`);

async function stageExecutables() {
  const targetDir = resolve('daemon', 'target', buildProfile);
  for (const binary of nativeComponents) {
    const fileName = executableName(binary, releaseOs);
    await copyExecutable(join(targetDir, fileName), join(binariesDir, fileName));
  }

  await validateNodeRuntime(nodeRuntimePath);
  await copyExecutable(
    nodeRuntimePath,
    join(binariesDir, executableName('node', releaseOs)),
  );
}

async function stageWebRuntime() {
  for (const fileName of ['server.mjs', 'package.json', 'bun.lock', 'README.md']) {
    await copyRequiredFile(join(webRuntimeDir, fileName), join(resourcesDir, fileName));
  }

  await copyRequiredDirectory(join(webRuntimeDir, 'dist'), join(resourcesDir, 'dist'));
  await assertFile(join(resourcesDir, 'dist', 'index.html'));
}

async function stageProductionModules() {
  const modulesRoot = resolve('node_modules');
  const sdkSource = join(modulesRoot, '@autohandai', 'agent-sdk');
  const sdkDestination = join(resourcesDir, 'node_modules', '@autohandai', 'agent-sdk');
  const sdkCli = sdkCliName(releaseOs, releaseArch);

  await mkdir(join(sdkDestination, 'cli'), { recursive: true });
  await copyRequiredFile(join(sdkSource, 'package.json'), join(sdkDestination, 'package.json'));
  await copyRequiredDirectory(join(sdkSource, 'dist'), join(sdkDestination, 'dist'));
  await copyExecutable(join(sdkSource, 'cli', sdkCli), join(sdkDestination, 'cli', sdkCli));

  for (const dependency of ['toml', 'yaml']) {
    await copyRequiredDirectory(
      join(modulesRoot, dependency),
      join(resourcesDir, 'node_modules', dependency),
    );
  }
}

async function stageNodeLicense() {
  const licensePath = await findNodeLicense(nodeRuntimePath);
  if (!licensePath) return null;

  const licenseName = 'NODE-LICENSE';
  await copyRequiredFile(licensePath, join(resourcesDir, licenseName));
  return licenseName;
}

async function writePackagerConfig(nodeLicenseName) {
  const icons = await stagePlatformIcons(releaseOs);
  for (const icon of icons) await assertFile(icon);

  const resources = [
    'server.mjs',
    'package.json',
    'bun.lock',
    'README.md',
    'dist',
    'node_modules',
  ];
  if (nodeLicenseName) resources.push(nodeLicenseName);

  const packagerConfig = {
    name: 'autohand-squad',
    productName: 'Autohand Squad',
    version: releaseVersion,
    identifier: 'ai.autohand.squad',
    description: 'A native workspace for human and agent teams.',
    publisher: 'Autohand',
    category: 'Productivity',
    formats: [releaseOs === 'darwin' ? 'dmg' : 'nsis'],
    outDir: packagerOutDir,
    binariesDir,
    targetTriple: targetTriple(releaseOs, releaseArch),
    binaries: [
      ...nativeComponents.map((binary) => ({
        path: binary,
        main: binary === 'autohand-squad-ui',
      })),
      { path: 'node', main: false },
    ],
    resources: resources.map((resource) => ({
      src: join(resourcesDir, resource),
      target: resource,
    })),
    icons,
    ...(releaseOs === 'darwin'
      ? {
          macos: {
            infoPlistPath: await writeMacInfoPlist(),
          },
        }
      : {
          nsis: {
            installMode: 'currentUser',
            installerIcon: resolve('public', 'favicon.ico'),
          },
        }),
  };

  const configPath = join(scratchDir, 'packager.json');
  await writeFile(configPath, `${JSON.stringify(packagerConfig, null, 2)}\n`);
  return configPath;
}

async function writeMacInfoPlist() {
  const infoPlistPath = join(scratchDir, 'Info.plist');
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
  await writeFile(infoPlistPath, contents);
  return infoPlistPath;
}

async function runPackager(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  try {
    await packageApp(config);
  } catch (error) {
    throw new Error(`Unable to package ${installerName}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

async function moveGeneratedInstaller() {
  const extension = releaseOs === 'darwin' ? '.dmg' : '.exe';
  const generated = (await collectFiles(packagerOutDir)).filter(
    (filePath) => filePath.toLowerCase().endsWith(extension),
  );
  if (generated.length !== 1) {
    const detail = generated.length ? `: ${generated.join(', ')}` : '';
    throw new Error(
      `Expected exactly one generated ${extension} installer, found ${generated.length}${detail}`,
    );
  }

  await mkdir(outDir, { recursive: true });
  await rm(installerPath, { force: true });
  try {
    await rename(generated[0], installerPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await copyFile(generated[0], installerPath);
    await rm(generated[0], { force: true });
  }

  const info = await stat(installerPath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Generated installer is empty: ${installerPath}`);
  }
}

async function recordChecksum() {
  const checksum = await hashFile(installerPath);
  const checksumPath = join(outDir, `checksums-${releaseOs}-${releaseArch}.txt`);
  let lines = [];
  try {
    lines = (await readFile(checksumPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.endsWith(`  ${installerName}`));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  lines.push(`${checksum}  ${installerName}`);
  await writeFile(checksumPath, `${lines.join('\n')}\n`);
}

async function copyExecutable(source, destination) {
  await copyRequiredFile(source, destination);
  if (releaseOs !== 'win32') await chmod(destination, 0o755);
}

async function copyRequiredFile(source, destination) {
  await assertFile(source);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyRequiredDirectory(source, destination) {
  await assertDirectory(source);
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });
}

async function assertFile(filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new Error(`Required installer file is missing: ${filePath}`);
  }
  if (!info.isFile()) throw new Error(`Required installer path is not a file: ${filePath}`);
}

async function assertDirectory(directoryPath) {
  let info;
  try {
    info = await stat(directoryPath);
  } catch {
    throw new Error(`Required installer directory is missing: ${directoryPath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Required installer path is not a directory: ${directoryPath}`);
  }
}

async function collectFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function findNodeLicense(executablePath) {
  const roots = new Set([dirname(executablePath)]);
  try {
    roots.add(dirname(await realpath(executablePath)));
  } catch {
    // assertFile reports an actionable error when the runtime itself is staged.
  }

  for (const root of roots) {
    let directory = root;
    for (let depth = 0; depth < 4; depth += 1) {
      for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
        const candidate = join(directory, name);
        if (await isFile(candidate)) return candidate;
      }
      const parent = dirname(directory);
      if (parent === directory || parent === parse(directory).root) break;
      directory = parent;
    }
  }
  return null;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function installerFileName(version, osName, archName) {
  if (osName === 'darwin') return `autohand-squad-${version}-macos-${archName}.dmg`;
  return `autohand-squad-${version}-windows-x64-setup.exe`;
}

async function stagePlatformIcons(osName) {
  if (osName === 'darwin') {
    const iconsDir = join(scratchDir, 'icons');
    const standardIcon = join(iconsDir, 'icon-512.png');
    const retinaIcon = join(iconsDir, 'icon-512@2x.png');
    await copyRequiredFile(resolve('public', 'icon-512.png'), standardIcon);
    await copyRequiredFile(resolve('public', 'icon-1024.png'), retinaIcon);
    return [standardIcon, retinaIcon];
  }
  return [resolve('public', 'favicon.ico')];
}

async function validateNodeRuntime(executablePath) {
  await assertFile(executablePath);
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to execute NODE_RUNTIME_PATH ${executablePath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(
      `NODE_RUNTIME_PATH exited with status ${result.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  const reportedVersion = String(result.stdout || '').trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(reportedVersion);
  if (!match) {
    throw new Error(
      `NODE_RUNTIME_PATH is not a Node.js executable; expected "vMAJOR.MINOR.PATCH", received "${reportedVersion}"`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 18 || (major === 18 && minor < 17)) {
    throw new Error(`NODE_RUNTIME_PATH must be Node.js 18.17 or newer; received ${reportedVersion}`);
  }
}

function sdkCliName(osName, archName) {
  const names = {
    'darwin/arm64': 'autohand-macos-arm64',
    'darwin/x64': 'autohand-macos-x64',
    'win32/x64': 'autohand-windows-x64.exe',
  };
  const name = names[`${osName}/${archName}`];
  if (!name) throw new Error(`Unsupported native installer target: ${osName}/${archName}`);
  return name;
}

function targetTriple(osName, archName) {
  const triples = {
    'darwin/arm64': 'aarch64-apple-darwin',
    'darwin/x64': 'x86_64-apple-darwin',
    'win32/x64': 'x86_64-pc-windows-msvc',
  };
  return triples[`${osName}/${archName}`];
}

function executableName(binaryName, osName) {
  return `${binaryName}${osName === 'win32' ? '.exe' : ''}`;
}

function assertSupportedTarget(osName, archName) {
  if (osName === 'linux') {
    throw new Error('Native Linux installers are not supported yet; use the portable package');
  }
  if (!targetTriple(osName, archName)) {
    throw new Error(`Unsupported native installer target: ${osName}/${archName}`);
  }
}

function assertNativeTarget(name, requested, actual) {
  if (requested !== actual) {
    throw new Error(`${name} is ${requested}, but this native build runner is ${actual}`);
  }
}

function assertSafePathSegment(name, value) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value) || value.includes('..')) {
    throw new Error(`${name} contains unsafe path characters: ${value}`);
  }
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function env(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}
