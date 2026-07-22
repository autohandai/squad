#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { tarCreateArgs } from './release-archive.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

try {
  const args = tarCreateArgs('D:\\release\\autohand-squad-win32-x64.tar.gz', 'bundle', 'win32');
  assert.equal(args[0], '--force-local', 'Windows GNU tar must treat drive-letter archives as local paths');
  assert.equal(
    tarCreateArgs('/tmp/autohand-squad-darwin-arm64.tar.gz', 'bundle', 'darwin')[0],
    '-czf',
    'Non-Windows tar invocation must remain compatible with BSD tar',
  );
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
    let stderr = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Packaged server did not start within 5 seconds${stderr ? `: ${stderr.trim()}` : ''}`));
    }, 5000);

    const onStdout = (chunk) => {
      if (String(chunk).includes('autohandSWE listening on')) {
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
