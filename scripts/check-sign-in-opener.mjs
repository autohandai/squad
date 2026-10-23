import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openSignInUrl } from '../server/harness/open-login.mjs';
const url = 'https://autohand.ai/signin?user_code=TEST-0001&client=squad';
for (const [platform, expected] of [['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'explorer.exe']]) {
  let unreferenced = false;
  await openSignInUrl(url, { platform, spawnImpl: (executable, args, options) => {
    assert.equal(executable, expected); assert.deepEqual(args, [url]); assert.equal(options.shell, false);
    const child = new EventEmitter(); child.unref = () => { unreferenced = true; };
    queueMicrotask(() => { child.emit('spawn'); child.emit('close', platform === 'win32' ? 1 : 0); });
    return child;
  } });
  assert.equal(unreferenced, platform === 'win32');
}
await assert.rejects(openSignInUrl('file:///etc/passwd'), /invalid/);
await assert.rejects(openSignInUrl('https://user:password@example.test/'), /invalid/);
for (const event of ['error', 'close']) {
  await assert.rejects(openSignInUrl(url, { platform: 'darwin', spawnImpl: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit(event, event === 'error' ? new Error('fixture missing opener') : 7));
    return child;
  } }), /fixture missing opener|Copy the link instead/);
}
console.log('PASS fixed platform openers, no shell, Explorer delegation, invalid URLs and launch failures');
