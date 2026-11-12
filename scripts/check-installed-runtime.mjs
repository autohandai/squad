import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { CLI_TARGETS } from '../server/runtime/cli-bootstrap.mjs';

const run = promisify(execFile);

/** Public broker liveness and executable readiness are different contracts. */
export async function checkInstalledRuntime({ origin, runtime }) {
  const url = new URL(origin);
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Smoke-test broker must be loopback.');
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'Invalid smoke-test broker address.');
  const response = await fetch(new URL('/api/runtime', url), { redirect: 'error', signal: AbortSignal.timeout(8000) });
  assert.equal(response.ok, true, 'Installed public broker must answer.');
  const envelope = await response.json();
  assert.equal(envelope.success, true);
  assert.equal(envelope.data?.service, 'autohand-squad-bridge', 'Installed broker must identify itself.');
  assert.equal(typeof envelope.data?.ownership?.state, 'string', 'Installed broker must report ownership readiness.');
  assert.equal('autohandPath' in envelope.data, false, 'Unauthenticated broker must not disclose private runtime paths.');

  runtime = resolve(runtime);
  const metadata = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
  const pinned = metadata.autohand?.cliVersion;
  assert.match(pinned || '', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Installed package must pin its CLI.');
  const manifest = JSON.parse(await readFile(join(runtime, 'vendor', 'autohand-cli', 'BUILD_INFO.json'), 'utf8'));
  assert.equal(manifest.version, pinned, 'Installed CLI must match the pinned version.');
  const target = CLI_TARGETS[`${process.platform}/${process.arch}`];
  assert.ok(target, 'Installed CLI target must be supported.');
  const executable = join(runtime, 'vendor', 'autohand-cli', target.binary);
  const digest = createHash('sha256').update(await readFile(executable)).digest('hex');
  assert.equal(digest, manifest.sha256?.[target.binary], 'Installed CLI checksum must match the staged payload.');
  const home = await mkdtemp(join(tmpdir(), 'squad-cli-smoke-'));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('AUTOHAND_') || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)) delete env[key];
    Object.assign(env, { HOME: home, USERPROFILE: home, AUTOHAND_HOME: join(home, 'autohand'), AUTOHAND_SQUAD_HOME: join(home, 'squad'), CI: 'true' });
    const { stdout } = await run(executable, ['--version'], { cwd: home, env, timeout: 30000, maxBuffer: 65536, windowsHide: true });
    const version = /\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/.exec(stdout)?.[1];
    assert.equal(version, pinned, 'The actual installed CLI must start and report its pinned version.');
    return { version, executable, ownership: envelope.data.ownership.state };
  } finally { await rm(home, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, runtime] = process.argv.slice(2);
  if (!origin || !runtime) throw Error('Usage: node scripts/check-installed-runtime.mjs <loopback-origin> <installed-runtime-directory>');
  const result = await checkInstalledRuntime({ origin, runtime });
  console.log(`PASS installed public broker (${result.ownership}); bundled CLI ${result.version} starts with a fresh home: ${result.executable}`);
}
