// macOS keeps a Computer Use grant as a row keyed by bundle identifier plus
// the code requirement of the build that was granted (ADR-0247). System
// Settings shows the switch by bundle identifier, but tccd only honours the
// row when the running app satisfies that stored requirement. A grant made
// to an older build (another certificate, an ad-hoc rebuild) therefore reads
// "on" in System Settings and "not granted" to Autohand Computer Use. This
// module reads the rows (only where the system lets this process read them),
// checks them against the app Squad actually launches, and resets them on
// the person's request so macOS asks again for the build in use.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TCC_DATABASE = '/Library/Application Support/com.apple.TCC/TCC.db';
const SERVICES = { accessibility: 'kTCCServiceAccessibility', screenRecording: 'kTCCServiceScreenCapture' };
const RESET_SERVICES = { accessibility: 'Accessibility', screenRecording: 'ScreenCapture' };
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;

/** execFile without a shell; resolves with the exit code instead of throwing. */
export function runCommand(command, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (failure, stdout = '', stderr = '') => {
      resolve({ code: failure ? (typeof failure.code === 'number' ? failure.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** `/x/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse` → `/x/Autohand Computer Use.app`. */
export function hostAppPath(executable) {
  const text = String(executable || '');
  const marker = text.lastIndexOf('.app/Contents/MacOS/');
  return marker > 0 ? text.slice(0, marker + 4) : '';
}

/** Which kind of build a stored requirement names, without quoting the certificate's personal name. */
export function requirementKind(text) {
  const value = String(text || '');
  if (/cdhash/i.test(value)) return 'a locally built copy';
  if (/Apple Development|Mac Developer/.test(value)) return 'a development build';
  if (/1\.2\.840\.113635\.100\.6\.1\.13|Developer ID/.test(value)) return 'a Developer ID build';
  if (/anchor apple generic/.test(value)) return 'a signed build';
  return 'another build';
}

/**
 * Read-only: for each service, is the macOS grant for `bundleId` usable by
 * the app at `hostApp`? Each service is `granted` (row allows and the app
 * satisfies it), `stale` (row allows but this app does not satisfy it),
 * `denied` (row says no) or `absent`. Returns `{ checked: false }` when the
 * database cannot be read, which is the normal case without Full Disk Access.
 */
export async function diagnoseMacGrant({ hostApp, bundleId, database = TCC_DATABASE, run = runCommand } = {}) {
  if (!hostApp || !BUNDLE_ID.test(String(bundleId || ''))) return { checked: false, reason: 'No Computer Use app to compare.' };
  const query = `select service, auth_value, hex(csreq) from access where client = '${bundleId}' and client_type = 0 and service in ('${SERVICES.accessibility}', '${SERVICES.screenRecording}')`;
  const rows = await run('/usr/bin/sqlite3', ['-readonly', '-separator', '|', database, query]);
  if (rows.code !== 0) return { checked: false, reason: 'macOS privacy settings are not readable by Squad.' };
  const result = { checked: true, accessibility: 'absent', screenRecording: 'absent', stale: false, grantedTo: null };
  const directory = await mkdtemp(join(tmpdir(), 'squad-tcc-'));
  try {
    for (const line of rows.stdout.split('\n').filter(Boolean)) {
      const [service, authValue, hex] = line.split('|');
      const key = Object.keys(SERVICES).find((name) => SERVICES[name] === service);
      if (!key) continue;
      if (authValue !== '2') { result[key] = 'denied'; continue; }
      if (!/^[0-9A-Fa-f]+$/.test(hex || '')) { result[key] = 'granted'; continue; } // No stored requirement: tccd matches by identifier.
      const file = join(directory, `${key}.csreq`);
      await writeFile(file, Buffer.from(hex, 'hex'));
      const verified = await run('/usr/bin/codesign', ['--verify', '-R', file, hostApp]);
      if (verified.code === 0) { result[key] = 'granted'; continue; }
      result[key] = 'stale'; result.stale = true;
      if (!result.grantedTo) result.grantedTo = requirementKind((await run('/usr/bin/csreq', ['-r', file, '-t'])).stdout);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  return result;
}

/**
 * Remove macOS's Accessibility and Screen Recording rows for `bundleId`, then
 * open the app with `permissions grant` so macOS asks again and stores the
 * requirement of the build in use. Only on the person's explicit request.
 */
export async function resetMacGrant({ hostApp, bundleId, run = runCommand } = {}) {
  if (!hostApp || !BUNDLE_ID.test(String(bundleId || ''))) throw Object.assign(new Error('No Computer Use app to reset.'), { status: 409 });
  for (const service of Object.values(RESET_SERVICES)) {
    const reset = await run('/usr/bin/tccutil', ['reset', service, bundleId]);
    if (reset.code !== 0) throw Object.assign(new Error(`macOS did not reset ${service === 'ScreenCapture' ? 'Screen Recording' : service} for Autohand Computer Use (${(reset.stderr || reset.stdout).trim().slice(0, 160) || `exit ${reset.code}`}).`), { status: 502 });
  }
  const opened = await run('/usr/bin/open', ['-n', '-a', hostApp, '--args', 'permissions', 'grant']);
  if (opened.code !== 0) throw Object.assign(new Error('The permissions were reset, but Autohand Computer Use did not open to ask again. Open it from Applications.'), { status: 502 });
  return { reset: true, opened: true };
}
