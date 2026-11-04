import { spawnSync } from 'node:child_process';

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return result.stdout;
}

// Sign each nested executable before its containing bundle. A local ad-hoc
// preview cannot obtain a timestamp; Developer ID distribution must obtain one.
export function signMacCode(filename, { identity = '-', entitlements, runCommand = execute } = {}) {
  const args = ['--force', '--options', 'runtime', '--sign', identity, identity === '-' ? '--timestamp=none' : '--timestamp'];
  if (entitlements) args.push('--entitlements', entitlements);
  runCommand('/usr/bin/codesign', [...args, filename]);
  runCommand('/usr/bin/codesign', ['--verify', '--strict', filename]);
}
