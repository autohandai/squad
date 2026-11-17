#!/usr/bin/env node
// Verifies the signature of the Autohand Computer Use host inside a built
// Squad (ADR-0248): the .app from a DMG or `tauri build`, a portable bundle
// directory, or the host .app itself.
//
//   node scripts/verify-macos-signature.mjs "<Autohand Squad.app>" [--team ABCDE12345]
//     [--against "~/Applications/Autohand Computer Use.app"] [--allow-adhoc]
//
// Release builds must pass with the release team: the host (and the engine
// files beside it) carry that team, the hardened runtime and a secure
// timestamp, and satisfy the Developer ID requirement macOS records for a
// privacy grant to any copy of ai.autohand.computer-use from that team.
// --against also checks the host against another copy's own designated
// requirement, e.g. the one the Autohand Code CLI installed.
// A local ad-hoc build fails unless --allow-adhoc, and then says what that
// means for the grant instead of passing silently.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPUTER_USE_HOST } from './computer-use-host.mjs';
import { parseCodesignDisplay } from './lib/macos-signing.mjs';

const ENGINE_FILES = ['cua-driver', 'cua-cursor-theme', 'libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node'];

/** The requirement tccd stores for a Developer ID app of this identity and team. */
export function developerIdRequirement(team, identifier = COMPUTER_USE_HOST.bundleId) {
  return `identifier "${identifier}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = ${team}`;
}

export function locateHost(target) {
  const path = resolve(target);
  if (basename(path) === COMPUTER_USE_HOST.bundleName) return { host: path, outer: null };
  for (const candidate of [join(path, 'Contents/Resources/runtime/vendor/computer-use'), join(path, 'vendor/computer-use')]) {
    const host = join(candidate, COMPUTER_USE_HOST.bundleName);
    if (existsSync(host)) return { host, outer: path.endsWith('.app') ? path : null };
  }
  throw new Error(`No ${COMPUTER_USE_HOST.bundleName} found in ${path}.`);
}

function codesign(args) {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

export function verifyMacSignature(target, { team: requestedTeam = '', against = '', allowAdhoc = false, log = console.log } = {}) {
  if (process.platform !== 'darwin') throw new Error('Signature verification needs macOS codesign.');
  const { host, outer } = locateHost(target);
  const problems = [];
  const read = (path) => parseCodesignDisplay(codesign(['-dvvv', path]).output);
  const strict = (path, label) => { const result = codesign(['--verify', '--deep', '--strict', '--verbose=2', path]); if (!result.ok) problems.push(`${label} fails strict verification: ${result.output.split('\n').at(-1)}`); };

  let outerSignature = null;
  if (outer) {
    strict(outer, 'The app');
    outerSignature = read(outer);
  }
  strict(host, 'The Computer Use host');
  const hostSignature = read(host);
  if (hostSignature.identifier !== COMPUTER_USE_HOST.bundleId) problems.push(`The host identifier is ${hostSignature.identifier || 'missing'}, not ${COMPUTER_USE_HOST.bundleId}.`);

  const team = requestedTeam || outerSignature?.teamId || '';
  if (!team) {
    const summary = `ad-hoc${outerSignature ? ' app and' : ''} host: macOS treats this ${COMPUTER_USE_HOST.displayName} as a different app from any Developer ID copy, so a grant given to the CLI's copy does not cover it.`;
    if (!hostSignature.adhoc && hostSignature.teamId) problems.push(`The host is signed by team ${hostSignature.teamId} but no release team was given to check it against (--team).`);
    else if (!allowAdhoc) problems.push(`Local build, ${summary} Pass --team for a release build or --allow-adhoc to accept it.`);
    else if (!problems.length) { log(`OK (local): ${summary}`); return { host, team: null, adhoc: true }; }
  } else {
    if (outerSignature && outerSignature.teamId !== team) problems.push(`The app is signed by ${outerSignature.adhoc ? 'nobody (ad-hoc)' : `team ${outerSignature.teamId || 'unknown'}`}, not ${team}.`);
    if (hostSignature.adhoc || hostSignature.teamId !== team) problems.push(`The host is signed by ${hostSignature.adhoc ? 'nobody (ad-hoc)' : `team ${hostSignature.teamId || 'unknown'}`}, not ${team}.`);
    if (!hostSignature.developerId) problems.push('The host is not signed with a Developer ID Application certificate.');
    if (!hostSignature.hardenedRuntime) problems.push('The host is missing the hardened runtime.');
    if (!hostSignature.timestamped) problems.push('The host has no secure timestamp.');
    const requirement = codesign(['--verify', '-R', `=${developerIdRequirement(team)}`, host]);
    if (!requirement.ok) problems.push(`The host does not satisfy the Developer ID requirement for team ${team}: ${requirement.output.split('\n').at(-1)}`);
    const engineDir = resolve(host, '..');
    for (const name of ENGINE_FILES) {
      const file = join(engineDir, name);
      if (!existsSync(file) || !statSync(file).isFile()) continue;
      const engine = read(file);
      if (engine.adhoc || engine.teamId !== team) problems.push(`${name} is signed by ${engine.adhoc ? 'nobody (ad-hoc)' : `team ${engine.teamId || 'unknown'}`}, not ${team}.`);
    }
  }

  if (against) {
    const designated = codesign(['-d', '-r-', resolve(against)]).output.match(/designated => (.+)$/m)?.[1];
    if (!designated) problems.push(`Could not read the designated requirement of ${against}.`);
    else {
      const result = codesign(['--verify', '-R', `=${designated}`, host]);
      if (!result.ok) problems.push(`The host does not satisfy ${basename(against)}'s designated requirement, so macOS will not share its privacy grant.`);
      else log(`The host satisfies the designated requirement of ${against}: one macOS grant covers both.`);
    }
  }

  if (problems.length) throw new Error(problems.join('\n'));
  log(`OK: ${COMPUTER_USE_HOST.bundleName} in ${target} is signed by team ${team} with the hardened runtime and a secure timestamp${outer ? ', inside an app signed by the same team' : ''}.`);
  return { host, team, adhoc: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { team: process.env.APPLE_TEAM_ID || '' };
  let target = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--team') options.team = args[++index] || '';
    else if (arg === '--against') options.against = args[++index] || '';
    else if (arg === '--allow-adhoc') options.allowAdhoc = true;
    else if (!target) target = arg;
    else { console.error(`Unknown argument: ${arg}`); process.exit(64); }
  }
  if (!target) { console.error('Usage: verify-macos-signature.mjs <Squad.app | portable dir | Autohand Computer Use.app> [--team TEAMID] [--against other.app] [--allow-adhoc]'); process.exit(64); }
  if (options.team && !/^[A-Z0-9]{10}$/.test(options.team)) { console.error('--team must be a 10-character Apple team id.'); process.exit(64); }
  try { verifyMacSignature(target, options); }
  catch (error) { console.error(`::error::${error.message.split('\n').join('\n::error::')}`); process.exitCode = 1; }
}
