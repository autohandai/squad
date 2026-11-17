import { spawn } from 'node:child_process';

// Providers Squad can ask the Autohand sign-in page to go straight to. The
// page decides what a hint does; one it does not know is ignored and the
// person sees the ordinary sign-in page, so a hint can never strand sign-in.
export const SIGN_IN_PROVIDERS = new Set(['apple']);

/** The device-login URL with a provider hint, if the provider is known. */
export function signInUrlWithProvider(value, provider = '') {
  if (!SIGN_IN_PROVIDERS.has(provider)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.searchParams.has('provider')) return value;
    url.searchParams.set('provider', provider);
    return url.href;
  } catch { return value; }
}

// The caller supplies the URL held by a running login process, never a URL
// from the browser request body. Keep the opener outside the webview.
export async function openSignInUrl(value, { platform = process.platform, spawnImpl = spawn } = {}) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The sign-in URL is invalid. Start sign-in again.');
  }
  const executable = { darwin: 'open', win32: 'explorer.exe', linux: 'xdg-open' }[platform];
  if (!executable) throw new Error('Copy the sign-in URL into your browser.');
  await new Promise((resolve, reject) => {
    const waitForExit = platform !== 'win32';
    const child = spawnImpl(executable, [url.href], { shell: false, stdio: 'ignore', windowsHide: true,
      ...(waitForExit ? { timeout: 10_000 } : { detached: true }),
    });
    child.once('error', reject);
    // Match the existing desktop opener: Explorer delegates to the shell and
    // need not terminate to accept the request.
    child.once('spawn', () => { if (!waitForExit) { child.unref(); resolve(); } });
    if (waitForExit) child.once('close', code => code === 0 ? resolve() : reject(new Error('Could not open the sign-in page. Copy the link instead.')));
  });
}
