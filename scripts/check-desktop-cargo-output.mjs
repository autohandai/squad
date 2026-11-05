import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargoReleaseDirectory } from './lib/cargo-output.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'squad-cargo-output-')));
try {
  await mkdir(join(root, 'daemon', 'src'), { recursive: true });
  await writeFile(join(root, 'daemon', 'Cargo.toml'), '[package]\nname="stage-output-fixture"\nversion="0.0.0"\nedition="2021"\n');
  await writeFile(join(root, 'daemon', 'src', 'main.rs'), 'fn main() {}');
  const env = { ...process.env };
  delete env.CARGO_TARGET_DIR;
  assert.equal(cargoReleaseDirectory(root, env), join(root, 'daemon', 'target', 'release'));
  const shared = join(root, 'shared-build-cache');
  assert.equal(cargoReleaseDirectory(root, { ...env, CARGO_TARGET_DIR: shared }), join(shared, 'release'),
    'staging must copy the same output directory Cargo built, not an old daemon/target binary');
  assert.equal(cargoReleaseDirectory(root, { ...env, CARGO_TARGET_DIR: 'relative-cache' }), join(root, 'relative-cache', 'release'));
  await mkdir(join(root, '.cargo'));
  await writeFile(join(root, '.cargo', 'config.toml'), '[build]\ntarget-dir="configured-cache"\n');
  assert.equal(cargoReleaseDirectory(root, env), join(root, 'configured-cache', 'release'));
  console.log('PASS desktop sidecars honor Cargo output metadata for default, absolute, relative and configured target directories.');
} finally {
  await rm(root, { recursive: true, force: true });
}
