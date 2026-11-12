import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge } from './lib/reliability-browser.mjs';
import { CLI_TARGETS } from '../server/runtime/cli-bootstrap.mjs';

const directory = await mkdtemp(join(tmpdir(), 'squad-installed-runtime-'));
let bridge;
try {
  bridge = await startBridge({ signedIn: false, development: false });
  const { checkInstalledRuntime } = await import('./check-installed-runtime.mjs');
  const runtime = join(directory, 'runtime'), vendor = join(runtime, 'vendor', 'autohand-cli');
  await mkdir(vendor, { recursive: true });
  const binary = CLI_TARGETS[`${process.platform}/${process.arch}`].binary;
  const executable = join(vendor, binary);
  const bytes = Buffer.from(`#!${process.execPath}\nif(process.cwd().includes('/runtime')||process.env.AUTOHAND_TEST_SECRET)process.exit(2);console.log('autohand 0.9.9');\n`);
  await writeFile(executable, bytes); await chmod(executable, 0o700);
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ autohand: { cliVersion: '0.9.9' } }));
  const manifest = { version: '0.9.9', sha256: { [binary]: createHash('sha256').update(bytes).digest('hex') } };
  await writeFile(join(vendor, 'BUILD_INFO.json'), JSON.stringify(manifest));
  process.env.AUTOHAND_TEST_SECRET = 'fixture-only';
  const result = await checkInstalledRuntime({ origin: bridge.origin, runtime });
  assert.equal(result.version, '0.9.9');
  const publicRuntime = await (await fetch(bridge.origin + '/api/runtime')).json();
  assert.equal(publicRuntime.data.ownership.state, 'signed_out');
  assert.equal('available' in publicRuntime.data, false, 'the smoke test must preserve the public privacy boundary');
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ autohand: { cliVersion: '0.9.8' } }));
  await assert.rejects(checkInstalledRuntime({ origin: bridge.origin, runtime }), /pinned/);
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ autohand: { cliVersion: '0.9.9' } }));
  await writeFile(executable, `${bytes}\n// corrupt payload`);
  await assert.rejects(checkInstalledRuntime({ origin: bridge.origin, runtime }), /checksum/);
  await rm(executable);
  await assert.rejects(checkInstalledRuntime({ origin: bridge.origin, runtime }), /ENOENT/);
  console.log('PASS installed runtime proof: signed-out public broker, exact bundled CLI, fresh home, checksum/pin/missing-file rejection; no system CLI fallback.');
} finally {
  delete process.env.AUTOHAND_TEST_SECRET;
  await bridge?.close(); await rm(directory, { recursive: true, force: true });
}
