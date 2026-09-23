#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const resolver = fileURLToPath(new URL('./resolve-squad-version.mjs', import.meta.url));
const manifestMerger = fileURLToPath(new URL('./merge-release-manifests.mjs', import.meta.url));
const releaseRefVerifier = fileURLToPath(new URL('./verify-release-ref.sh', import.meta.url));
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const smokeWorkflow = readFileSync(new URL('../.github/workflows/actions-smoke.yml', import.meta.url), 'utf8');
const releaseNotes = readFileSync(new URL('../.github/release.yml', import.meta.url), 'utf8');
const nightlyWorkflow = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const bunLock = readFileSync(new URL('../bun.lock', import.meta.url), 'utf8');
const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packager = readFileSync(new URL('./package-squad-release.mjs', import.meta.url), 'utf8');
const portablePackager = readFileSync(new URL('./package-squad-portable.mjs', import.meta.url), 'utf8');
const installerPackager = readFileSync(new URL('./package-squad-installers.mjs', import.meta.url), 'utf8');
const runtimePackagingCheck = fileURLToPath(new URL('./check-release-runtime-packaging.mjs', import.meta.url));

execFileSync(process.execPath, [runtimePackagingCheck], { stdio: 'inherit' });

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

assertEqual(
  resolve({
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: 'abcdef1234567890',
    GITHUB_RUN_NUMBER: '42',
  }, ['--mode', 'dry-run']).version,
  '0.0.0-ci.42.abcdef123456',
  'push dry-run version',
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

const betaTag = resolve({
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF_NAME: 'squad-v1.2.3-beta.1',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release']);
assertEqual(betaTag.version, '1.2.3-beta.1', 'beta tag version');
assertEqual(betaTag.channel, 'beta', 'beta tag channel');
assertEqual(betaTag.latest, 'false', 'beta tag latest flag');

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

assertThrows({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  INPUT_CHANNEL: 'nightly',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release'], 'invalid release channel');

assertThrows({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  INPUT_CHANNEL: 'stable',
  INPUT_VERSION: '1.2.3-',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release'], 'invalid release version');

assertThrows({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  INPUT_CHANNEL: 'stable',
  INPUT_VERSION: '1.2.3-beta.1',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release'], 'prerelease version on stable channel');

assertThrows({
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF_NAME: 'squad-vgarbage',
  GITHUB_REF_TYPE: 'tag',
  GITHUB_SHA: 'abcdef1234567890',
}, ['--mode', 'release'], 'invalid release tag');

const autoStable = resolve({
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  INPUT_CHANNEL: 'stable',
  GITHUB_SHA: 'abcdef1234567890',
  RELEASE_KNOWN_TAGS: 'squad-v99.88.903,v99.88.900,squad-v99.88.901-beta.1',
}, ['--mode', 'release']);
assertEqual(autoStable.version, '99.88.904', 'auto-increment stable version');

assertIncludes(ciWorkflow, 'ubuntu-24.04', 'CI matrix includes Linux x64');
assertIncludes(ciWorkflow, 'macos-26\n', 'CI matrix includes macOS Apple Silicon');
assertIncludes(ciWorkflow, 'macos-26-intel', 'CI matrix includes macOS Intel');
assertIncludes(ciWorkflow, 'windows-2025', 'CI matrix includes Windows x64');
assertIncludes(ciWorkflow, 'libxdo-dev', 'CI installs the Linux xdo linker dependency');
assertIncludes(ciWorkflow, 'bun run check:sdk', 'CI verifies the published Autohand SDK');
assertIncludes(ciWorkflow, 'bun run cli:fetch', 'CI vendors the pinned Autohand Code CLI before SDK checks');
assertIncludes(ciWorkflow, 'bun run check:otel', 'CI verifies the OpenTelemetry log format');
assertIncludes(releaseWorkflow, 'bun run check:otel', 'Release workflow verifies the OpenTelemetry log format');
assertIncludes(releaseWorkflow, 'bun run cli:fetch', 'Release workflow vendors the pinned Autohand Code CLI');
assertIncludes(releaseWorkflow, 'AUTOHAND_SQUAD_REQUIRE_VENDORED_CLI', 'Release SDK checks require the vendored CLI');
assertIncludes(installerPackager, 'stageVendoredAutohandCli', 'Installer packager ships the vendored Autohand CLI');
assertIncludes(portablePackager, 'stageVendoredAutohandCli', 'Portable packager ships the vendored Autohand CLI');
assertIncludes(ciWorkflow, 'name: Check release runtime packaging', 'CI exercises native tar and packaged state on every release target');
assertIncludes(ciWorkflow, 'name: Check native release packager', 'CI loads the native packager on every release target');
assertIncludes(ciWorkflow, "import('@crabnebula/packager')", 'CI verifies the platform-specific packager binding');
assertIncludes(ciWorkflow, 'REQUIRED_RELEASE_OS=linux,darwin,win32', 'CI validates all release OS entries');
assertIncludes(ciWorkflow, 'REQUIRED_RELEASE_TARGETS=linux/x64,darwin/arm64,darwin/x64,win32/x64', 'CI validates every native release target');
assertIncludes(releaseWorkflow, 'name: Release', 'Release workflow has the public Release name');
assertIncludes(releaseWorkflow, 'name: Desktop app (${{ matrix.id }})', 'Release workflow builds the Tauri desktop app');
assertIncludes(releaseWorkflow, 'bunx tauri "${args[@]}"', 'Release workflow runs tauri build');
assertIncludes(releaseWorkflow, 'bun run release:desktop', 'Release workflow packages the desktop bundles');
assertIncludes(releaseWorkflow, 'libwebkit2gtk-4.1-dev', 'Release workflow installs the Linux webview toolchain');
assertIncludes(releaseWorkflow, 'scripts/release-notes.mjs', 'Release workflow composes changelog-driven notes');
assertIncludes(releaseWorkflow, '--generate-notes', 'Release workflow appends the categorised pull-request list');
assertIncludes(releaseWorkflow, 'pattern: desktop-*', 'Publish job collects the desktop artifacts');
assertIncludes(nightlyWorkflow, 'cron: "0 3 * * *"', 'Nightly workflow is scheduled');
assertIncludes(nightlyWorkflow, 'gh workflow run release.yml --ref "$TAG"', 'Nightly workflow dispatches the Release workflow on the tag');
assertIncludes(nightlyWorkflow, '-canary.', 'Nightly builds publish on the canary channel');
assertIncludes(nightlyWorkflow, '--cleanup-tag', 'Nightly workflow prunes old nightlies');
assertIncludes(ciWorkflow, 'bun run desktop:check', 'CI compiles the desktop shell');
assertIncludes(changelog, '## [Unreleased]', 'CHANGELOG keeps an Unreleased section for nightly notes');
assertIncludes(releaseNotes, '- desktop', 'Release note categories cover desktop changes');
assertIncludes(releaseWorkflow, '- "v[0-9]*"', 'Release workflow handles v-prefixed SemVer tags');
assertNotIncludes(releaseWorkflow, 'branches:', 'Release workflow does not publish branch pushes');
assertNotIncludes(releaseWorkflow, '"squad-v*"', 'Release workflow rejects legacy squad tag triggers');
assertIncludes(releaseWorkflow, 'description: "Semver version matching the v-prefixed dispatch tag"', 'Manual release version documents the exact-tag contract');
assertIncludes(releaseWorkflow, 'version:\n        description:', 'Release workflow exposes a version dispatch input');
assertIncludes(releaseWorkflow, 'required: true', 'Manual release version is required');
assertIncludes(releaseWorkflow, 'name: Setup', 'Release workflow has a shared setup job');
assertIncludes(releaseWorkflow, "if: github.repository == 'autohandai/squad'", 'Release setup cannot publish from a fork');
assertIncludes(releaseWorkflow, 'source_sha: ${{ steps.source.outputs.source_sha }}', 'Release setup exports the verified source SHA');
assertCount(releaseWorkflow, 'scripts/verify-release-ref.sh v "$VERSION"', 5, 'Every release job verifies the tag-bound source');
assertCount(releaseWorkflow, 'ref: ${{ needs.setup.outputs.source_sha }}', 4, 'Every build and publish job checks out the verified source SHA');
assertCount(releaseWorkflow, 'fetch-depth: 0', 5, 'Every release checkout fetches tag history');
assertCount(releaseWorkflow, 'persist-credentials: false', 5, 'Every release checkout drops persisted credentials');
assertIncludes(releaseWorkflow, 'macos-26-intel', 'Release workflow builds macOS Intel');
assertNativeReleaseMatrix(releaseWorkflow, [
  ['linux-x64', 'ubuntu-24.04', 'linux', 'x64'],
  ['macos-arm64', 'macos-26', 'darwin', 'arm64'],
  ['macos-x64', 'macos-26-intel', 'darwin', 'x64'],
  ['windows-x64', 'windows-2025', 'win32', 'x64'],
]);
assertIncludes(releaseWorkflow, 'AUTOHAND_SQUAD_RELEASE_VERSION', 'Release binaries embed resolved release versions');
assertIncludes(releaseWorkflow, 'bun run check:sdk', 'Release workflow verifies the published Autohand SDK');
assertIncludes(releaseWorkflow, 'Download built web runtime', 'Native release jobs download the versioned web runtime');
assertIncludes(releaseWorkflow, 'WEB_RUNTIME_DIR', 'Native packaging receives the bundled web runtime');
assertIncludes(releaseWorkflow, 'bun run release:portable', 'Release workflow assembles portable application archives');
assertIncludes(releaseWorkflow, 'name: Smoke test portable application', 'Release workflow smoke-tests portable application archives');
assertIncludes(releaseWorkflow, 'smoke_root="${smoke_root//\\\\//}"', 'Windows portable smoke test normalizes the runner temp path for GNU tar');
assertIncludes(releaseWorkflow, "import('@autohandai/agent-sdk')", 'Portable smoke test imports the bundled Agent SDK');
assertIncludes(releaseWorkflow, 'NODE_VERSION: "22.23.1"', 'Release workflow pins the bundled Node.js runtime');
assertIncludes(releaseWorkflow, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'Release workflow uses current checkout action');
assertIncludes(releaseWorkflow, 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0', 'Release workflow uses current setup-node action');
assertIncludes(releaseWorkflow, 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0', 'Release workflow uses current cache action');
assertIncludes(releaseWorkflow, 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1', 'Release workflow uses current download-artifact action');
assertIncludes(releaseWorkflow, 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1', 'Release workflow uses current upload-artifact action');
assertIncludes(releaseWorkflow, 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0', 'Release workflow uses current setup-bun action');
assertNotIncludes(releaseWorkflow, 'package-manager-cache:', 'Release workflow avoids unsupported setup-node cache inputs');
assertIncludes(releaseWorkflow, 'bun run release:desktop', 'Release workflow packages the desktop installers');
assertNotIncludes(releaseWorkflow, "if: matrix.os != 'linux'", 'Release workflow packages Linux installables');
assertIncludes(releaseWorkflow, 'NODE_RUNTIME_PATH="$(node -p', 'Native installer packaging receives an explicit Node.js binary');
assertIncludes(releaseWorkflow, 'name: Mount and smoke test the macOS app', 'Release workflow mounts and tests each DMG');
assertIncludes(releaseWorkflow, 'name: Install and smoke test the Windows app', 'Release workflow installs and tests the NSIS executable');
assertIncludes(releaseWorkflow, "$installRoot = if ($entry.InstallLocation) { $entry.InstallLocation.Trim('\"') } else { Split-Path ($entry.UninstallString.Trim('\"')) -Parent }", 'Windows installer smoke test tolerates a missing NSIS InstallLocation and normalizes quoted paths');
assertIncludes(releaseWorkflow, '-mindepth 2 -maxdepth 2', 'Release publishing copies only top-level target assets, never web bundle contents');
assertIncludes(ciWorkflow, 'bun run release:portable', 'CI dry run exercises portable packaging on every target');
assertIncludes(releaseWorkflow, 'name: Inspect the Linux packages', 'Release workflow verifies Linux Debian and AppImage packages');
assertCount(releaseWorkflow, '--server-path', 1, 'Native installer smoke tests force the installed web server payload');
assertIncludes(releaseWorkflow, 'autohand-squad-${RELEASE_VERSION}-macos-${RELEASE_ARCH}.dmg', 'macOS smoke test uses the public DMG name');
assertIncludes(releaseWorkflow, 'autohand-squad-$env:RELEASE_VERSION-windows-x64-setup.exe', 'Windows smoke test uses the public installer name');
assertIncludes(releaseWorkflow, 'REQUIRED_RELEASE_TARGETS=linux/x64,darwin/arm64,darwin/x64,win32/x64', 'Release publishing requires every native target');
assertIncludes(releaseWorkflow, "-name 'autohand-squad-*'", 'Release publishing includes native installer assets');
assertIncludes(releaseWorkflow, 'contents: read', 'Release workflow defaults to read-only token permissions');
assertIncludes(releaseWorkflow, 'contents: write', 'Release publish job has scoped content write permission');
assertCount(releaseWorkflow, 'contents: write', 1, 'Only the publish job receives content write permission');
assertIncludes(releaseWorkflow, 'GH_TOKEN: ${{ secrets.RELEASE_TOKEN || github.token }}', 'Release publishing uses the job-scoped workflow token unless a RELEASE_TOKEN secret overrides it');
assertNotIncludes(releaseWorkflow, '.permissions.push', 'Release publishing does not infer job-token permissions from repository metadata');
assertNotIncludes(releaseWorkflow, 'token_can_publish', 'Release publishing does not reject valid granular job tokens with a repository permission probe');
assertNotIncludes(releaseWorkflow, 'AUTOHAND_RELEASE_TOKEN', 'Release publishing does not expose a long-lived fallback token');
assertNotIncludes(releaseWorkflow, 'attestations: write', 'Release workflow does not require org-blocked attestation permissions');
assertIncludes(releaseWorkflow, 'gh release view "$RELEASE_TAG"', 'Release publishing detects an existing release');
assertIncludes(releaseWorkflow, 'Refusing to replace published assets', 'Release publishing refuses to mutate an existing release');
assertIncludes(releaseWorkflow, 'commits/$RELEASE_TAG', 'Release publishing rechecks the remote tag immediately before publication');
assertIncludes(releaseWorkflow, 'remote_source_sha" != "$SOURCE_SHA', 'Release publishing rejects a remotely moved tag');
assertNotIncludes(releaseWorkflow, '--clobber', 'Release publishing never overwrites an asset');
assertNotIncludes(releaseWorkflow, 'gh release edit', 'Release publishing never edits an existing release');
assertIncludes(releaseWorkflow, '--verify-tag', 'Release publishing requires the remote tag');
assertIncludes(releaseWorkflow, '--target "$SOURCE_SHA"', 'Release publishing targets the verified source SHA');
assertPinnedActionUses(releaseWorkflow, 'Release workflow');
assertPinnedActionUses(ciWorkflow, 'CI workflow');
assertIncludes(smokeWorkflow, 'Runner startup', 'Actions smoke workflow checks runner startup separately');
assertIncludes(releaseNotes, 'Release Engineering', 'Release notes group release engineering changes');
assertIncludes(packager, 'autohandai/squad', 'Release packager defaults to the org repo');
assertIncludes(packager, 'binaryName: sourceName', 'Windows manifests retain executable suffixes');
assertIncludes(portablePackager, "'autohand-squad-ui'", 'Portable bundle includes every native runtime binary');
assertIncludes(portablePackager, "'autohand-windows-x64.exe'", 'Portable bundle includes the Windows Agent SDK CLI');
assertIncludes(portablePackager, "for (const dependency of ['toml', 'yaml'])", 'Portable bundle vendors production SDK dependencies');
assertIncludes(portablePackager, "spawnSync('tar'", 'Portable bundle creates one extractable archive');
assertIncludes(installerPackager, "requiredEnv('NODE_RUNTIME_PATH')", 'Native installer requires an explicit Node.js runtime');
assertIncludes(installerPackager, "binary === 'autohand-squad-ui'", 'Native installer launches the desktop UI binary');
assertIncludes(installerPackager, "['deb', 'appimage']", 'Native installer emits Debian and AppImage formats on Linux');
assertIncludes(installerPackager, "'linux/x64': 'autohand-linux-x64'", 'Linux installer vendors the Linux Agent SDK CLI');
assertIncludes(installerPackager, "'linux/arm64': 'autohand-linux-arm64'", 'Linux arm64 installer vendors the arm64 Agent SDK CLI');
assertIncludes(installerPackager, "signingIdentity: identity || '-'", 'macOS bundle is Developer ID signed when configured and ad-hoc signed otherwise');
assertIncludes(installerPackager, 'com.apple.security.cs.allow-jit', 'macOS bundle carries hardened-runtime entitlements for the bundled Node runtime');
assertIncludes(installerPackager, 'certificateThumbprint: thumbprint', 'Windows installer is Authenticode signed when a thumbprint is configured');
assertIncludes(installerPackager, "'server'", 'Native installer stages the bridge runtime modules');
assertIncludes(portablePackager, "'linux/arm64': 'autohand-linux-arm64'", 'Portable bundle knows the arm64 Agent SDK CLI');
assertIncludes(portablePackager, "join(bundleRoot, 'server')", 'Portable bundle stages the bridge runtime modules');
assertIncludes(releaseWorkflow, 'APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}', 'Release workflow hands the Apple signing certificate to tauri build when configured');
assertIncludes(releaseWorkflow, 'export APPLE_SIGNING_IDENTITY="-"', 'Release workflow ad-hoc signs the macOS bundle without a Developer ID');
assertIncludes(releaseWorkflow, 'name: Prepare Windows code signing', 'Release workflow imports the Windows signing certificate when configured');
assertIncludes(releaseWorkflow, 'codesign --verify --deep --strict', 'macOS smoke test verifies the bundle signature');
assertIncludes(releaseWorkflow, 'cp -R dist server server.mjs', 'Web bundle stages the bridge runtime modules');
assertIncludes(releaseWorkflow, 'bun run check:harness', 'Release workflow verifies harness adapters');
assertIncludes(releaseWorkflow, "'server\\harness\\index.mjs'", 'Windows smoke test checks the installed harness modules');
assertNotIncludes(installerPackager, 'Native Linux installers are not supported yet', 'Native installer supports Linux packages');
assertIncludes(installerPackager, "installMode: 'currentUser'", 'Windows installer does not require administrator access');
assertIncludes(installerPackager, "'autohand-windows-x64.exe'", 'Native installer vendors the Windows Agent SDK CLI');
assertIncludes(installerPackager, 'validateNodeRuntime(nodeRuntimePath)', 'Native installer validates the staged Node.js runtime');
assertEqual(packageMetadata.devDependencies?.['@crabnebula/packager'], '0.8.1', 'Native packager pin');
assertIncludes(
  bunLock,
  '"@crabnebula/packager-darwin-x64": ["@crabnebula/packager-darwin-x64@0.8.1"',
  'Native packager lock includes the macOS Intel binary',
);

checkManifestTargetValidation();
checkReleaseRefVerification();

console.log('Release workflow metadata checks passed.');

function checkManifestTargetValidation() {
  const root = mkdtempSync(join(tmpdir(), 'autohand-squad-release-check-'));
  const manifestPath = join(root, 'manifest-linux-x64.json');
  const components = ['cli', 'daemon', 'analytics', 'tray', 'ui'];
  const artifacts = components.map((component) => ({
    os: 'linux',
    arch: 'x64',
    component,
    binaryName: component,
    url: `https://example.test/${component}`,
    sha256: component.padEnd(64, '0'),
  }));
  writeFileSync(manifestPath, JSON.stringify({
    latestAllowedVersion: '1.2.3',
    channel: 'stable',
    artifacts,
  }));

  try {
    mergeManifests(root, {
      REQUIRED_RELEASE_TARGETS: 'linux/x64',
      RELEASE_VERSION: '1.2.3',
      RELEASE_CHANNEL: 'stable',
    });
    assertManifestMergeThrows(root, {
      REQUIRED_RELEASE_TARGETS: 'linux/x64,darwin/x64',
    }, 'missing native release target');
    assertManifestMergeThrows(root, {
      REQUIRED_RELEASE_TARGETS: 'linux/x64',
      RELEASE_VERSION: '9.9.9',
    }, 'mismatched release version');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function checkReleaseRefVerification() {
  const root = mkdtempSync(join(tmpdir(), 'autohand-squad-release-ref-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const verify = (version, ref) => execFileSync('bash', [releaseRefVerifier, 'v', version], {
    cwd: root,
    env: { ...process.env, GITHUB_REF: ref },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  try {
    git('init', '--quiet');
    writeFileSync(join(root, 'fixture.txt'), 'tagged\n');
    git('add', 'fixture.txt');
    git('-c', 'user.name=Release Check', '-c', 'user.email=release-check@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'tagged source');
    git('-c', 'tag.gpgSign=false', 'tag', 'v1.2.3');
    git('-c', 'tag.gpgSign=false', 'tag', 'v1.2.3-beta.1');

    verify('1.2.3', 'refs/tags/v1.2.3');
    verify('1.2.3-beta.1', 'refs/tags/v1.2.3-beta.1');
    assertCommandThrows(() => verify('1.2.3', 'refs/heads/main'), 'manual dispatch from a branch');
    assertCommandThrows(() => verify('01.2.3', 'refs/tags/v01.2.3'), 'leading-zero release version');
    assertCommandThrows(() => verify('1.2.3-01', 'refs/tags/v1.2.3-01'), 'leading-zero numeric prerelease');
    assertCommandThrows(() => verify('1.2.3+build.1', 'refs/tags/v1.2.3+build.1'), 'release build metadata');

    writeFileSync(join(root, 'fixture.txt'), 'moved head\n');
    git('add', 'fixture.txt');
    git('-c', 'user.name=Release Check', '-c', 'user.email=release-check@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'move head');
    assertCommandThrows(() => verify('1.2.3', 'refs/tags/v1.2.3'), 'HEAD different from release tag');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mergeManifests(input, env) {
  execFileSync(process.execPath, [manifestMerger, input], {
    env: {
      ...process.env,
      RELEASE_OUT_DIR: join(input, 'merged'),
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function assertManifestMergeThrows(input, env, label) {
  try {
    mergeManifests(input, env);
  } catch {
    return;
  }
  throw new Error(`${label}: expected manifest merge to fail`);
}

function resolve(env, args) {
  const output = execFileSync(process.execPath, [resolver, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: '',
      GITHUB_REF_NAME: '',
      GITHUB_REF_TYPE: '',
      GITHUB_RUN_NUMBER: '',
      GITHUB_SHA: '',
      INPUT_CHANNEL: '',
      INPUT_DRAFT: '',
      INPUT_PRERELEASE: '',
      INPUT_VERSION: '',
      PR_NUMBER: '',
      RELEASE_KNOWN_TAGS: '',
      ...env,
    },
  });
  return JSON.parse(output);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: expected workflow to include ${expected}`);
  }
}

function assertNotIncludes(value, expected, label) {
  if (value.includes(expected)) {
    throw new Error(`${label}: workflow must not include ${expected}`);
  }
}

function assertCount(value, expected, count, label) {
  const actual = value.split(expected).length - 1;
  if (actual !== count) {
    throw new Error(`${label}: expected ${count} occurrences of ${expected}, got ${actual}`);
  }
}

function assertNativeReleaseMatrix(workflow, expected) {
  const job = workflow.split('\n  runtime-artifacts:\n')[1]?.split('\n  publish:\n')[0];
  const matrix = job
    ?.split('\n      matrix:\n        include:\n')[1]
    ?.split('\n    steps:\n')[0];
  if (!matrix) {
    throw new Error('Native release matrix: expected runtime-artifacts include matrix');
  }

  const idRows = matrix.match(/^          - id:/gm) || [];
  const entries = [...matrix.matchAll(
    /^          - id: ([^\n]+)\n            runner: ([^\n]+)\n            os: ([^\n]+)\n            arch: ([^\n]+)$/gm,
  )].map((match) => match.slice(1));

  assertEqual(idRows.length, expected.length, 'Native release matrix entry count');
  assertEqual(entries.length, expected.length, 'Native release matrix complete entry count');
  assertEqual(JSON.stringify(entries), JSON.stringify(expected), 'Native release matrix entries');
}
function assertPinnedActionUses(workflow, label) {
  const uses = [...workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
  if (uses.length === 0) {
    throw new Error(`${label}: expected at least one action reference`);
  }
  for (const [, action, reference] of uses) {
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      throw new Error(`${label}: ${action}@${reference} must use an immutable 40-character commit SHA`);
    }
  }
}

function assertCommandThrows(command, label) {
  try {
    command();
  } catch {
    return;
  }
  throw new Error(`${label}: expected command to fail`);
}

function assertThrows(env, args, label) {
  try {
    execFileSync(process.execPath, [resolver, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return;
  }
  throw new Error(`${label}: expected resolver to fail`);
}
