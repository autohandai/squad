import { spawnSync } from 'node:child_process';

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return result.stdout;
}

/**
 * The identity every nested Mac binary is signed with. One resolver for every
 * staging script, so a release that sets APPLE_SIGNING_IDENTITY (what
 * prepare-apple-signing.mjs exports) cannot sign the CLI with the Developer ID
 * and leave the Computer Use host ad-hoc (ADR-0248). "-" is ad-hoc, for local
 * builds without an identity.
 */
export function releaseSigningIdentity(env = process.env) {
  return String(env.AUTOHAND_CODESIGN_IDENTITY || '').trim() || String(env.APPLE_SIGNING_IDENTITY || '').trim() || '-';
}

/** "Developer ID Application: Example Ltd (ABCDE12345)" → "ABCDE12345"; ad-hoc → null. */
export function identityTeam(identity) {
  return /\(([A-Z0-9]{10})\)\s*$/.exec(String(identity || ''))?.[1] || null;
}

/** What codesign says about a signed path, without its certificate holder's name. */
export function parseCodesignDisplay(text) {
  const field = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim() || '';
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(text)?.[1]?.split(',').map((flag) => flag.trim()) || [];
  const team = field('TeamIdentifier');
  return {
    identifier: field('Identifier'),
    adhoc: field('Signature') === 'adhoc' || flags.includes('adhoc'),
    teamId: team && team !== 'not set' ? team : null,
    developerId: /^Authority=Developer ID Application: /m.test(text),
    hardenedRuntime: flags.includes('runtime'),
    timestamped: /^Timestamp=/m.test(text),
  };
}

export function readMacSignature(filename, { runCommand } = {}) {
  const display = runCommand
    ? runCommand('/usr/bin/codesign', ['-dvvv', filename])
    : (() => {
      const result = spawnSync('/usr/bin/codesign', ['-dvvv', filename], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`codesign could not read ${filename}: ${result.stderr?.trim() || result.status}`);
      return `${result.stdout}${result.stderr}`;
    })();
  return parseCodesignDisplay(display);
}

/**
 * With a real identity, the signed code must carry that identity's team, the
 * hardened runtime and a secure timestamp: what notarization and a macOS
 * privacy grant made to another copy signed by the same team both require.
 */
export function assertReleaseSignature(signature, identity, label) {
  if (!identity || identity === '-') return;
  // A certificate hash names no team; the name prepare-apple-signing exports does.
  const team = identityTeam(identity);
  if (signature.adhoc || !signature.teamId) throw new Error(`${label} was signed ad-hoc although ${team ? `team ${team}` : 'a signing identity'} was requested.`);
  if (team && signature.teamId !== team) throw new Error(`${label} is signed by team ${signature.teamId}, not ${team}.`);
  if (!signature.hardenedRuntime) throw new Error(`${label} is missing the hardened runtime.`);
  if (!signature.timestamped) throw new Error(`${label} has no secure timestamp.`);
}

// Sign each nested executable before its containing bundle. A local ad-hoc
// preview cannot obtain a timestamp; Developer ID distribution must obtain one.
export function signMacCode(filename, { identity = '-', entitlements, runCommand = execute } = {}) {
  const args = ['--force', '--options', 'runtime', '--sign', identity, identity === '-' ? '--timestamp=none' : '--timestamp'];
  if (entitlements) args.push('--entitlements', entitlements);
  runCommand('/usr/bin/codesign', [...args, filename]);
  runCommand('/usr/bin/codesign', ['--verify', '--strict', filename]);
}
