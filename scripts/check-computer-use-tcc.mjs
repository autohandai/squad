#!/usr/bin/env node
// ADR-0247: System Settings showed Autohand Computer Use switched on while the
// host reported Accessibility and Screen Recording "NOT granted". tccd keeps
// each grant with the code requirement of the build that was granted and
// rejects a different build (status -67050). This check rebuilds that state
// with fixtures: a fixture TCC database (same schema columns tccd uses), a
// fixture app signed ad hoc as ai.autohand.computer-use, and real compiled
// requirements from /usr/bin/csreq checked by real /usr/bin/codesign. Nothing
// here reads or changes this Mac's privacy settings.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseMacGrant, hostAppPath, requirementKind, resetMacGrant, runCommand } from '../server/computer-use-tcc.mjs';
import { AUTOHAND_COMPUTER_USE_BUNDLE_ID, createComputerUse } from '../server/computer-use.mjs';
import { handle } from '../server/routes/computer-use.route.mjs';
import { computerUsePermissionMessage } from '../src/components/computer-use/model.js';

let count = 0;
async function check(name, operation) { await operation(); console.log(`ok ${++count} - ${name}`); }
const BUNDLE_ID = AUTOHAND_COMPUTER_USE_BUNDLE_ID;
const temporary = await mkdtemp(join(tmpdir(), 'squad-tcc-check-'));

try {
  await check('host app path is derived from the executable Squad launches', async () => {
    assert.equal(hostAppPath('/Users/a/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse'), '/Users/a/Applications/Autohand Computer Use.app');
    assert.equal(hostAppPath('/Users/a/.local/bin/cua-driver'), '');
    assert.equal(requirementKind('identifier "x" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: someone (ABC)"'), 'a development build');
    assert.equal(requirementKind('identifier "x" and cdhash H"00"'), 'a locally built copy');
    assert.equal(requirementKind('identifier "x" and anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */'), 'a Developer ID build');
  });

  if (process.platform === 'darwin') {
    // Fixture app: the identity Squad launches, signed ad hoc so it has a cdhash.
    const app = join(temporary, 'Autohand Computer Use.app');
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
    await copyFile('/usr/bin/true', join(app, 'Contents', 'MacOS', 'AutohandComputerUse'));
    await writeFile(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string><key>CFBundleExecutable</key><string>AutohandComputerUse</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', BUNDLE_ID, app], { stdio: 'ignore' });
    // What tccd stores for a build is that build's designated requirement.
    const designated = /designated => (.+)/.exec(spawnSync('/usr/bin/codesign', ['-d', '-r-', app], { encoding: 'utf8' }).stdout)[1].trim();
    const compile = (name, text) => { const file = join(temporary, `${name}.csreq`); execFileSync('/usr/bin/csreq', ['-r', `=${text}`, '-b', file]); return execFileSync('/usr/bin/xxd', ['-p', file], { encoding: 'utf8' }).replace(/\s/g, ''); };
    // The owner's stale row: granted to a development-signed build of the same identity.
    const stale = compile('stale', `identifier "${BUNDLE_ID}" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: Fixture Person (FIXTURE01)" and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */`);
    const current = compile('current', designated);
    const database = async (name, rows) => {
      const file = join(temporary, `${name}.db`);
      const values = rows.map(([service, auth, hex]) => `('${service}', '${BUNDLE_ID}', 0, ${auth}, 4, 1, ${hex ? `X'${hex}'` : 'NULL'})`).join(',');
      execFileSync('/usr/bin/sqlite3', [file, `create table access (service text not null, client text not null, client_type integer not null, auth_value integer not null, auth_reason integer not null, auth_version integer not null, csreq blob);${values ? ` insert into access values ${values};` : ''}`]);
      return file;
    };

    await check('switch on in System Settings, granted to another build: reported stale, not granted', async () => {
      const file = await database('stale', [['kTCCServiceAccessibility', 2, stale], ['kTCCServiceScreenCapture', 2, stale]]);
      const result = await diagnoseMacGrant({ hostApp: app, bundleId: BUNDLE_ID, database: file });
      assert.deepEqual(result, { checked: true, accessibility: 'stale', screenRecording: 'stale', stale: true, grantedTo: 'a development build' });
      assert.equal(JSON.stringify(result).includes('Fixture Person'), false, 'the certificate holder name stays out of status');
    });
    await check('grant made to the build in use is reported granted', async () => {
      const file = await database('current', [['kTCCServiceAccessibility', 2, current], ['kTCCServiceScreenCapture', 2, current]]);
      assert.deepEqual(await diagnoseMacGrant({ hostApp: app, bundleId: BUNDLE_ID, database: file }), { checked: true, accessibility: 'granted', screenRecording: 'granted', stale: false, grantedTo: null });
    });
    await check('one service switched off and one missing are denied and absent, not stale', async () => {
      const file = await database('mixed', [['kTCCServiceAccessibility', 0, current]]);
      assert.deepEqual(await diagnoseMacGrant({ hostApp: app, bundleId: BUNDLE_ID, database: file }), { checked: true, accessibility: 'denied', screenRecording: 'absent', stale: false, grantedTo: null });
    });
    await check('an unreadable privacy database is unknown, never a verdict', async () => {
      const result = await diagnoseMacGrant({ hostApp: app, bundleId: BUNDLE_ID, database: join(temporary, 'missing', 'TCC.db') });
      assert.equal(result.checked, false);
    });
  } else console.log('# macOS-only fixture checks skipped on', process.platform);

  await check('reset removes only Autohand Computer Use rows, then opens the app to ask again', async () => {
    const calls = [];
    const run = async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: '', stderr: '' }; };
    assert.deepEqual(await resetMacGrant({ hostApp: '/A/Autohand Computer Use.app', bundleId: BUNDLE_ID, run }), { reset: true, opened: true });
    assert.deepEqual(calls, [
      ['/usr/bin/tccutil', 'reset', 'Accessibility', BUNDLE_ID],
      ['/usr/bin/tccutil', 'reset', 'ScreenCapture', BUNDLE_ID],
      ['/usr/bin/open', '-n', '-a', '/A/Autohand Computer Use.app', '--args', 'permissions', 'grant'],
    ]);
    await assert.rejects(resetMacGrant({ hostApp: '/A/x.app', bundleId: "x'; drop table access; --", run }), /No Computer Use app/);
    await assert.rejects(resetMacGrant({ hostApp: '/A/x.app', bundleId: BUNDLE_ID, run: async () => ({ code: 1, stdout: '', stderr: 'denied' }) }), /did not reset Accessibility/);
  });

  await check('status carries the diagnosis only when macOS says not granted, and reset restarts the host', async () => {
    let os = { accessibility: false, screen_recording: false };
    let closed = 0; const diagnosed = []; const resets = []; const events = [];
    const nativeClient = { identity: { product: 'Autohand Computer Use', bundleId: BUNDLE_ID, source: 'autohand', host: '/U/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse' }, async request(method, params) { if (params?.name === 'check_permissions') return { structuredContent: os }; return {}; }, close() { closed += 1; } };
    const macGrant = { diagnose: async (input) => { diagnosed.push(input); return { checked: true, accessibility: 'stale', screenRecording: 'stale', stale: true, grantedTo: 'a development build' }; }, reset: async (input) => { resets.push(input); return { reset: true, opened: true }; } };
    const service = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:1', nativeClient, platform: 'darwin', macGrant, emit: (name) => events.push(name) });
    const status = await service.status('eva');
    assert.equal(status.grantDiagnosis.stale, true); assert.equal(status.canResetMacGrant, true);
    assert.deepEqual(diagnosed, [{ hostApp: '/U/Applications/Autohand Computer Use.app', bundleId: BUNDLE_ID }]);
    const message = computerUsePermissionMessage({ native: true, current: status, ready: false });
    assert.match(message, /shows Autohand Computer Use as allowed/); assert.match(message, /development build/); assert.match(message, /Reset the macOS permission/);
    // Through the route: a POST without the named action does nothing.
    const replies = [];
    const ctx = { computerUse: service, readBody: async (req) => req.body, json: (res, code, body) => replies.push({ code, body }) };
    await handle({ method: 'POST', body: {} }, {}, new URL('http://x/api/computer-use/reset-macos-permission'), ctx);
    assert.equal(replies.at(-1).code, 400); assert.equal(resets.length, 0);
    await handle({ method: 'POST', body: { confirm: 'reset-macos-permission' } }, {}, new URL('http://x/api/computer-use/reset-macos-permission'), ctx);
    assert.equal(replies.at(-1).code, 200); assert.equal(replies.at(-1).body.data.reset, true);
    assert.deepEqual(resets, [{ hostApp: '/U/Applications/Autohand Computer Use.app', bundleId: BUNDLE_ID }]);
    assert.equal(closed, 1, 'host restarts so the new grant is the one read'); assert.ok(events.includes('computer-use.macos-permission-reset'));
    os = { accessibility: true, screen_recording: true }; diagnosed.length = 0;
    const ready = await service.status('eva');
    assert.equal(ready.grantDiagnosis, null); assert.equal(diagnosed.length, 0, 'no privacy database read when macOS already says granted');
    assert.equal(computerUsePermissionMessage({ native: true, current: ready, ready: true }), 'macOS permissions are ready.');
    // Not on macOS, or no host app: no diagnosis and no reset.
    const linux = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:1', nativeClient: { ...nativeClient, async request() { return { structuredContent: { accessibility: false, screen_recording: false } }; } }, platform: 'linux', macGrant });
    const linuxStatus = await linux.status('eva');
    assert.equal(linuxStatus.grantDiagnosis, null); assert.equal(linuxStatus.canResetMacGrant, false);
    await assert.rejects(linux.resetMacPermission(), /available on macOS/);
    const plain = computerUsePermissionMessage({ native: true, current: { available: true, accessibility: true, screenRecording: false, canResetMacGrant: false, host: { product: 'Autohand Computer Use' } }, ready: false });
    assert.equal(plain, 'Allow Autohand Computer Use in System Settings → Privacy & Security → Screen Recording, then check again.');
  });

  await check('runCommand reports exit codes without a shell', async () => {
    assert.equal((await runCommand('/usr/bin/false', [])).code, 1);
    assert.equal((await runCommand('/bin/echo', ['$(id)'])).stdout.trim(), '$(id)');
  });
  console.log(`Computer Use macOS grant checks passed (${count}).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
