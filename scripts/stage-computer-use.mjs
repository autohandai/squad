import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { COMPUTER_USE_HOST, verifyComputerUseBranding } from './computer-use-host.mjs';

export const COMPUTER_USE_VERSION = '0.28.2';
export const COMPUTER_USE_ASSETS = Object.freeze({
  'darwin/arm64': { name: 'cua-driver-rs-0.28.2-darwin-universal-binary.tar.gz', sha256: 'e1c859785107914c3432acda574f627a028a00704ce2bb6c37b2075e6ad16512' },
  'darwin/x64': { name: 'cua-driver-rs-0.28.2-darwin-universal-binary.tar.gz', sha256: 'e1c859785107914c3432acda574f627a028a00704ce2bb6c37b2075e6ad16512' },
  'linux/arm64': { name: 'cua-driver-rs-0.28.2-linux-arm64-binary.tar.gz', sha256: 'f2a41fbd359398bd169af195e6978143376e40b16bbd6a1dd79de1f46cafee5b' },
  'linux/x64': { name: 'cua-driver-rs-0.28.2-linux-x86_64-binary.tar.gz', sha256: '55c0f93ca0687382da6fe945d6c211a7306e685bab3351824e59547445274643' },
  'win32/arm64': { name: 'cua-driver-rs-0.28.2-windows-arm64-binary.zip', sha256: '021f061a54d3d17c778f31a8da5595e270f9f170fde6d3a467b2d9557a2c2d88' },
  'win32/x64': { name: 'cua-driver-rs-0.28.2-windows-x86_64-binary.zip', sha256: 'fab00e2353ae9b93abeed5b7fef73661453c064c855ef40b1bea417aa9624fd1' },
});
const sha = async (filename) => createHash('sha256').update(await readFile(filename)).digest('hex');
function run(command, args) { const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`${command} failed while staging Computer Use: ${result.error?.message || result.stderr?.trim() || result.status}`); return result.stdout; }

export async function stageComputerUse({ rootDir, runtimeDir, platform = process.platform, arch = process.arch, sourceDir = process.env.AUTOHAND_SQUAD_COMPUTER_USE_DIR || join(rootDir, 'vendor', 'computer-use'), hostPath = process.env.AUTOHAND_SQUAD_COMPUTER_USE_HOST, hostSourceCommit = process.env.AUTOHAND_SQUAD_COMPUTER_USE_HOST_COMMIT, signIdentity = process.env.AUTOHAND_CODESIGN_IDENTITY || '-', runCommand = run, assets = COMPUTER_USE_ASSETS }) {
  const asset = assets[`${platform}/${arch}`];
  if (!asset) throw new Error(`Computer Use has no artifact for ${platform}/${arch}.`);
  const archive = resolve(sourceDir, asset.name);
  if (await sha(archive) !== asset.sha256) throw new Error('Computer Use archive does not match the immutable component checksum.');
  // On Windows runners Git Bash puts GNU tar first on PATH, and GNU tar reads
  // "D:\\…" as a remote host ("Cannot connect to D: resolve failed", release
  // run 38529019645). Windows' own bsdtar handles drive letters.
  const tar = platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const listing = platform === 'win32' ? runCommand(tar, ['-tf', archive]) : runCommand('tar', ['-tzf', archive]);
  for (const name of listing.split(/\r?\n/).filter(Boolean)) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /^[A-Za-z]:/.test(name)) throw new Error('Computer Use archive contains an unsafe path.');
  }
  const temporary = await mkdtemp(join(tmpdir(), 'squad-computer-use-'));
  try {
    runCommand(tar, platform === 'win32' ? ['-xf', archive, '-C', temporary] : ['-xzf', archive, '-C', temporary]);
    const driverName = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
    const driverPath = join(temporary, driverName);
    if (!(await stat(driverPath)).isFile()) throw new Error('Computer Use archive has no driver binary.');
    await readFile(join(temporary, 'LICENSE-CUA.md'));
    const destination = join(runtimeDir, 'vendor', 'computer-use');
    await mkdir(destination, { recursive: true });
    // Reject links and unexpected special entries before copying extracted content.
    async function verify(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isDirectory()) await verify(join(directory, entry.name)); else if (!entry.isFile()) throw new Error('Computer Use archive contains a non-file entry.'); } }
    await verify(temporary);
    await cp(temporary, destination, { recursive: true });
    let host = null;
    if (platform === 'darwin') {
      // The immutable 0.28.2 archive's arm64 engine signature is invalid.
      // Sign the staged native code before hashing it, preserving archive proof.
      for (const name of ['cua-driver', 'cua-cursor-theme', 'libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node']) {
        const filename = join(destination, name);
        runCommand('/usr/bin/codesign', ['--force', '--options', 'runtime', '--sign', signIdentity, '--timestamp=none', filename]);
        runCommand('/usr/bin/codesign', ['--verify', '--strict', filename]);
      }
      if (!hostPath) throw new Error('Set AUTOHAND_SQUAD_COMPUTER_USE_HOST to the verified Squad Computer Use.app build.');
      const source = resolve(hostPath);
      const identifier = runCommand('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(source, 'Contents', 'Info.plist')]).trim();
      if (identifier !== COMPUTER_USE_HOST.bundleId) throw new Error('The Computer Use host has an unexpected permission identity.');
      runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
      const provenance = JSON.parse(await readFile(join(source, 'Contents', 'Resources', 'BUILD_PROVENANCE.json'), 'utf8'));
      verifyComputerUseBranding(provenance.branding);
      const sourceCommit = hostSourceCommit || provenance.sourceCommit;
      if (!/^[a-f0-9]{40}$/.test(sourceCommit || '') || sourceCommit !== provenance.sourceCommit) throw new Error('The Computer Use host source provenance is missing or inconsistent.');
      runCommand('/usr/bin/lipo', [join(source, 'Contents', 'MacOS', 'AutohandComputerUse'), '-verify_arch', arch === 'arm64' ? 'arm64' : 'x86_64']);
      const hostDestination = join(destination, COMPUTER_USE_HOST.bundleName);
      // Reused staging directories must not keep the old shared CLI identity.
      // This path is inside this runtime only, never the user's Applications.
      await rm(join(destination, 'Autohand Computer Use.app'), { recursive: true, force: true });
      await cp(source, hostDestination, { recursive: true, dereference: true });
      host = { bundleId: identifier, sourceCommit, branding: provenance.branding, path: `${COMPUTER_USE_HOST.bundleName}/Contents/MacOS/${COMPUTER_USE_HOST.executable}`, sha256: await sha(join(hostDestination, 'Contents', 'MacOS', COMPUTER_USE_HOST.executable)) };
    }
    const files = [];
    async function manifest(directory) { for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const filename = join(directory, entry.name); if (entry.isDirectory()) await manifest(filename); else if (entry.isFile()) files.push({ path: relative(destination, filename).split(sep).join('/'), sha256: await sha(filename) }); } }
    await manifest(destination);
    const metadata = { version: COMPUTER_USE_VERSION, release: `computer-use-v${COMPUTER_USE_VERSION}`, sourceCommit: 'fc92b70417cdae941ba8b104a6e7b3b5b52a07e2', repository: 'autohandai/computer-use', prerelease: true, platform, arch, signing: platform === 'darwin' ? { identity: signIdentity === '-' ? 'ad-hoc' : signIdentity, hardenedRuntime: true } : null, archive: { name: asset.name, sha256: asset.sha256 }, driver: { path: driverName, sha256: await sha(join(destination, driverName)) }, host, files };
    await writeFile(join(destination, 'BUILD_INFO.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    return metadata;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
