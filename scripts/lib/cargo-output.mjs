import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function cargoProfileDirectory(rootDir, profile, env = process.env) {
  if(!['debug','release'].includes(profile))throw Error('Choose a known Cargo profile.');
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1',
    '--manifest-path', join(rootDir, 'daemon', 'Cargo.toml')], {
    cwd: rootDir, env, encoding: 'utf8', timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not resolve Cargo's runtime output directory: ${result.error?.message || result.stderr}`);
  }
  const directory = JSON.parse(result.stdout).target_directory;
  if (typeof directory !== 'string' || !directory) throw new Error('Cargo metadata omitted target_directory.');
  return join(directory, profile);
}

export function cargoReleaseDirectory(rootDir,env=process.env){return cargoProfileDirectory(rootDir,'release',env);}
