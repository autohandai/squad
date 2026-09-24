#!/usr/bin/env node
// Stage everything the Tauri desktop shell bundles:
//
//   src-tauri/runtime/   server.mjs, package.json, dist/, server/, the Agent
//                        SDK and its two dependencies, the vendored Autohand CLI
//   src-tauri/binaries/  Tauri sidecars named <name>-<target-triple>: the Node
//                        runtime, autohand-squad-daemon, autohand-squad-analytics, squad
//
// Prerequisites: `bun run build` (dist), `bun run cli:fetch` (vendored CLI),
// and a Node runtime (NODE_RUNTIME_PATH or the current process).

import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const tauriDir = join(rootDir, 'src-tauri');
const runtimeDir = join(tauriDir, 'runtime');
const binariesDir = join(tauriDir, 'binaries');
const appPackage = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));

const triple = rustTargetTriple();
const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

function rustTargetTriple() {
  const explicit = String(process.env.TAURI_TARGET_TRIPLE || '').trim();
  if (explicit) return explicit;
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = String(result.stdout || '').match(/^host:\s*(\S+)/m);
  if (!match) throw new Error('rustc -vV did not report a host triple; install the Rust toolchain');
  return match[1];
}

async function assertFile(path) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw new Error(`Required file is missing: ${path}`);
}

async function stageRuntime() {
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  for (const name of ['server.mjs', 'package.json']) {
    await assertFile(join(rootDir, name));
    await copyFile(join(rootDir, name), join(runtimeDir, name));
  }
  await assertFile(join(rootDir, 'dist', 'index.html'));
  await cp(join(rootDir, 'dist'), join(runtimeDir, 'dist'), { recursive: true });
  await cp(join(rootDir, 'server'), join(runtimeDir, 'server'), { recursive: true });
  await assertFile(join(runtimeDir, 'server', 'harness', 'index.mjs'));

  const modulesRoot = join(rootDir, 'node_modules');
  const sdkSource = join(modulesRoot, '@autohandai', 'agent-sdk');
  const sdkDestination = join(runtimeDir, 'node_modules', '@autohandai', 'agent-sdk');
  await mkdir(sdkDestination, { recursive: true });
  await copyFile(join(sdkSource, 'package.json'), join(sdkDestination, 'package.json'));
  await cp(join(sdkSource, 'dist'), join(sdkDestination, 'dist'), { recursive: true });
  for (const dependency of ['toml', 'yaml']) {
    await cp(join(modulesRoot, dependency), join(runtimeDir, 'node_modules', dependency), { recursive: true, dereference: true });
  }

  // Vendored Autohand CLI for this platform, verified against BUILD_INFO.
  const cliNames = {
    'darwin/arm64': 'autohand-macos-arm64',
    'darwin/x64': 'autohand-macos-x64',
    'linux/x64': 'autohand-linux-x64',
    'linux/arm64': 'autohand-linux-arm64',
    'win32/x64': 'autohand-windows-x64.exe',
  };
  const cliName = cliNames[`${process.platform}/${process.arch}`];
  if (!cliName) throw new Error(`No Autohand CLI target for ${process.platform}/${process.arch}`);
  const vendorDir = process.env.AUTOHAND_SQUAD_CLI_DIR ? resolve(process.env.AUTOHAND_SQUAD_CLI_DIR) : join(rootDir, 'vendor', 'autohand-cli');
  const info = JSON.parse(await readFile(join(vendorDir, 'BUILD_INFO.json'), 'utf8').catch(() => {
    throw new Error(`Vendored Autohand CLI is missing (${vendorDir}); run bun run cli:fetch`);
  }));
  const pinned = String(appPackage.autohand?.cliVersion || '');
  if (info.version !== pinned) throw new Error(`Vendored Autohand CLI is ${info.version}, package.json pins ${pinned}`);
  const cliSource = join(vendorDir, cliName);
  const digest = createHash('sha256').update(await readFile(cliSource)).digest('hex');
  if (digest !== info.sha256?.[cliName]) throw new Error(`Vendored Autohand CLI ${cliName} does not match its recorded sha256`);
  const cliDestination = join(runtimeDir, 'vendor', 'autohand-cli');
  await mkdir(cliDestination, { recursive: true });
  await copyFile(cliSource, join(cliDestination, cliName));
  if (!isWindows) await chmod(join(cliDestination, cliName), 0o755);
  await copyFile(join(vendorDir, 'BUILD_INFO.json'), join(cliDestination, 'BUILD_INFO.json'));
  await writeFile(join(runtimeDir, 'DESKTOP_RUNTIME.json'), `${JSON.stringify({ stagedAt: new Date().toISOString(), triple, appVersion: appPackage.version, cliVersion: info.version, node: process.version }, null, 2)}\n`);
  console.log(`Staged runtime for ${triple} (CLI ${info.version}).`);
}

async function stageSidecars({ buildRust = true } = {}) {
  await mkdir(binariesDir, { recursive: true });

  // Node runtime: the release workflow provides NODE_RUNTIME_PATH; locally the
  // current Node is used.
  const nodeSource = process.env.NODE_RUNTIME_PATH ? resolve(process.env.NODE_RUNTIME_PATH) : process.execPath;
  await assertFile(nodeSource);
  const version = spawnSync(nodeSource, ['--version'], { encoding: 'utf8' }).stdout.trim();
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 17)) throw new Error(`Node runtime must be 18.17 or newer; found ${version}`);
  const nodeTarget = join(binariesDir, `${exe(`node-${triple}`)}`.replace(`-${triple}.exe`, `-${triple}.exe`));
  await copyFile(nodeSource, nodeTarget);
  if (!isWindows) await chmod(nodeTarget, 0o755);
  // The sidecar must run on its own: a Node linked against a shared libnode
  // (Homebrew's, for example) breaks as soon as it is copied out of its
  // prefix, and the installed app then fails preflight with a dyld error.
  const standalone = spawnSync(nodeTarget, ['-e', 'process.stdout.write(process.version)'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  if (standalone.status !== 0 || !String(standalone.stdout || '').startsWith('v')) {
    await rm(nodeTarget, { force: true });
    throw new Error(
      `${nodeSource} does not run as a standalone binary (${String(standalone.stderr || '').split('\n').find(Boolean) || 'no output'}). ` +
        'Point NODE_RUNTIME_PATH at an official Node build (for example an fnm or nvm install), not a Homebrew one.'
    );
  }

  if (buildRust) {
    const result = spawnSync(
      'cargo',
      ['build', '--release', '--manifest-path', join(rootDir, 'daemon', 'Cargo.toml'), '--bin', 'autohand-squad-daemon', '--bin', 'autohand-squad-analytics', '--bin', 'squad'],
      { stdio: 'inherit', env: { ...process.env, CARGO_INCREMENTAL: '0' } },
    );
    if (result.status !== 0) throw new Error('cargo build of the runtime binaries failed');
  }
  const targetDir = join(rootDir, 'daemon', 'target', 'release');
  for (const name of ['autohand-squad-daemon', 'autohand-squad-analytics', 'squad']) {
    const source = join(targetDir, exe(name));
    await assertFile(source);
    const destination = join(binariesDir, exe(`${name}-${triple}`));
    await copyFile(source, destination);
    if (!isWindows) await chmod(destination, 0o755);
  }
  console.log(`Staged sidecars for ${triple}: node ${version}, daemon, analytics, squad.`);
}

const args = new Set(process.argv.slice(2));
if (!args.has('--sidecars-only')) await stageRuntime();
if (!args.has('--runtime-only')) await stageSidecars({ buildRust: !args.has('--no-cargo') });
if (!existsSync(join(tauriDir, 'icons', 'icon.icns'))) console.warn('Icons are missing: run `npx tauri icon public/icon-1024.png -o src-tauri/icons`.');
