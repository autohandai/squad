import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openSignInUrl, signInUrlWithProvider } from '../server/harness/open-login.mjs';
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
const device = 'https://autohand.ai/cli-auth?code=ABC-123&source=squad';
assert.equal(signInUrlWithProvider(device, 'apple'), `${device}&provider=apple`);
assert.equal(signInUrlWithProvider(`${device}&provider=apple`, 'apple'), `${device}&provider=apple`, 'a hint the CLI already added is not repeated');
assert.equal(signInUrlWithProvider(device, 'evil'), device, 'unknown providers are dropped');
assert.equal(signInUrlWithProvider(device, ''), device);
assert.equal(signInUrlWithProvider('http://autohand.ai/cli-auth?code=A', 'apple'), 'http://autohand.ai/cli-auth?code=A', 'no hint on a non-https page');
assert.equal(signInUrlWithProvider('not a url', 'apple'), 'not a url');
console.log('PASS Apple provider hint only for known providers on https sign-in pages');
console.log('PASS fixed platform openers, no shell, Explorer delegation, invalid URLs and launch failures');
