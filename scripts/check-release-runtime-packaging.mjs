#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { tarCreateArgs } from './release-archive.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverStartupTimeoutMs = 20_000;
const failures = [];

try {
  assert.deepEqual(
    tarCreateArgs('autohand-squad-win32-x64.tar.gz', 'D:\\runner\\temp\\bundle', 'bundle', 'win32'),
    ['-czf', 'autohand-squad-win32-x64.tar.gz', '-C', 'D:/runner/temp/bundle', 'bundle'],
    'Windows tar must receive a relative archive name and a normalized source directory',
  );
  assert.deepEqual(
    tarCreateArgs('autohand-squad-darwin-arm64.tar.gz', '/tmp/bundle', 'bundle', 'darwin'),
    ['-czf', 'autohand-squad-darwin-arm64.tar.gz', '-C', '/tmp/bundle', 'bundle'],
    'Non-Windows tar invocation must remain compatible with BSD tar',
  );
} catch (error) {
  failures.push(error);
}

try {
  await assertTarCreatesPortableArchive();
} catch (error) {
  failures.push(error);
}

try {
  await assertPackagedServerCreatesState();
} catch (error) {
  failures.push(error);
}

if (failures.length > 0) {
  throw new AggregateError(failures, 'Release runtime packaging checks failed');
}

console.log('Release runtime packaging checks passed.');

async function assertTarCreatesPortableArchive() {
  const root = await mkdtemp(join(tmpdir(), 'autohand-squad-tar-'));
  const outDir = join(root, 'out');
  const sourceDir = join(root, 'source');
  const bundleName = 'bundle';
  const archiveName = 'portable.tar.gz';

  try {
    await mkdir(join(outDir), { recursive: true });
    await mkdir(join(sourceDir, bundleName), { recursive: true });
    await writeFile(join(sourceDir, bundleName, 'proof.txt'), 'portable\n', 'utf8');
    const result = spawnSync('tar', tarCreateArgs(archiveName, sourceDir, bundleName), {
      cwd: outDir,
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `Native tar failed: ${String(result.stderr || result.stdout || '').trim()}`,
    );
    assert.ok((await stat(join(outDir, archiveName))).size > 0, 'Native tar must create a non-empty archive');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertPackagedServerCreatesState() {
  const root = await mkdtemp(join(tmpdir(), 'autohand-squad-packaged-state-'));
  const appStateDir = join(root, 'web-state');
  let child;

  try {
    child = spawn(process.execPath, [join(repositoryRoot, 'server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        AUTOHAND_HOME: join(root, 'autohand-home'),
        AUTOHAND_SQUAD_APP_STATE_DIR: appStateDir,
        AUTOHAND_SQUAD_HOME: join(root, 'squad-home'),
        AUTOHAND_USER_CONFIG_PATH: join(root, 'missing-user-config.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForServer(child);
    const info = await stat(appStateDir);
    assert.equal(info.isDirectory(), true, 'Packaged server must initialize its writable app-state directory');
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Packaged server did not start within ${serverStartupTimeoutMs / 1000} seconds${stderr ? `: ${stderr.trim()}` : ''}`));
    }, serverStartupTimeoutMs);

    const onStdout = (chunk) => {
      stdout += String(chunk);
      if (stdout.includes('autohandSWE listening on')) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      stderr += String(chunk);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Packaged server exited before startup with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 2000);
  await once(child, 'exit');
  clearTimeout(timer);
}
