import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cargoProfileDirectory } from './lib/cargo-output.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const binary = process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY || join(cargoProfileDirectory(process.cwd(),'debug'),`autohand-squad-daemon${process.platform === 'win32' ? '.exe' : ''}`);
if (!process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY) run('cargo', ['build', '--manifest-path', 'daemon/Cargo.toml', '--bin', 'autohand-squad-daemon']);
const env = { ...process.env, AUTOHAND_SQUAD_MEMORY_INDEX_BINARY: binary };
run(process.execPath, ['scripts/check-memory-library.mjs'], env);
run(process.execPath, ['scripts/check-memory-browser.mjs'], env);
