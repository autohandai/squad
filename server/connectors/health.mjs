// One plain-language status per connector with the single action that fixes
// it (ADR-0244). Pure: built from the public record, so the browser, the
// list route and checks agree on what "healthy" means.

const RUNTIMES = { npx: 'Node.js', node: 'Node.js', uvx: 'uv', docker: 'Docker', dnx: '.NET 10' };

/** A test or runtime error in words a person can act on, plus what fixes it. */
export function plainError(raw, { name = 'The server', command = '', signedIn = false } = {}) {
  const error = String(raw || '').trim();
  const missing = error.match(/(?:Could not start|couldn't find|Squad couldn't find) ([^\s:]+)/i) || (/ENOENT/.test(error) ? [null, command] : null);
  if (missing || /isn't installed on this computer/.test(error)) {
    const binary = String(missing?.[1] || command || '').split(/[\\/]/).pop();
    const runtime = RUNTIMES[binary];
    if (runtime) return { message: `${binary} isn't installed on this computer. Install ${runtime}, then test again.`, action: 'install-runtime', runtime };
    return { message: error || `Squad couldn't start ${binary}.`, action: 'edit' };
  }
  if (/HTTP 401/.test(error)) return signedIn ? { message: `${name} no longer accepts the sign-in. Sign in again.`, action: 'sign-in' } : { message: `${name} refused the key or token. Update it, then test again.`, action: 'edit' };
  if (/HTTP 403/.test(error)) return { message: `${name} refused access with the stored credentials.`, action: 'edit' };
  if (/HTTP 404|HTTP 405/.test(error)) return { message: 'Nothing at that address speaks MCP. Check the address.', action: 'edit' };
  if (/HTTP 5\d\d/.test(error)) return { message: `${name} is having trouble right now (${error.match(/HTTP \d+/)[0]}). Try again shortly.`, action: 'test' };
  if (/ENOTFOUND|EAI_AGAIN|Can't find/i.test(error)) return { message: 'Can\'t find that server. Check the address and this computer\'s connection.', action: 'test' };
  if (/ECONNREFUSED|fetch failed|Can't reach|ECONNRESET/i.test(error)) return { message: 'Nothing is answering at that address. Check it is running, then test again.', action: 'test' };
  if (/within \d+ ?s|didn't answer within|timed out/i.test(error)) return { message: `${name} didn't answer in time. Test again; if it keeps happening, check the server.`, action: 'test' };
  if (/exited \(code|stopped unexpectedly/.test(error)) return { message: error, action: 'edit' };
  return { message: error || 'The check failed.', action: 'test' };
}

function relative(iso, now) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * `{ state, tone, message, action: { kind, label } | null, update }`.
 * States: ready, needs-sign-in, needs-setup, failing, unstable, untested.
 */
export function connectorHealth(connector, { now = Date.now(), googleClientReady = false, signingIn = false } = {}) {
  const update = connector.registry?.latest && connector.registry.latest !== connector.registry.version ? { latest: connector.registry.latest } : null;
  const test = connector.lastTest;
  const oauth = connector.oauth;
  const name = connector.name;
  const result = (state, tone, message, action = null) => ({ state, tone, message, action, update });

  if (connector.builtin && !connector.hasKey) return result('needs-setup', 'muted', 'Add a Firecrawl key so members can search the web.', { kind: 'add-key', label: 'Add key' });
  if (connector.kind === 'google' && !googleClientReady && oauth?.status !== 'signed-in') return result('needs-setup', 'muted', 'Squad needs a Google OAuth client before it can sign in to Google.', { kind: 'google-client', label: 'Set up Google sign-in' });
  if (signingIn) return result('needs-sign-in', 'muted', 'Waiting for you to finish signing in…', { kind: 'sign-in', label: 'Open sign-in again' });
  if (oauth && oauth.status !== 'signed-in') {
    const message = oauth.lastError || (oauth.status === 'expired' ? `The sign-in to ${name} ended. Sign in again.` : `Sign in to ${name} so members can use it.`);
    return result('needs-sign-in', oauth.lastError || oauth.status === 'expired' ? 'error' : 'muted', message, { kind: 'sign-in', label: oauth.status === 'expired' ? 'Sign in again' : 'Sign in' });
  }
  if (test && !test.ok) {
    if (test.needsSignIn) return result('needs-sign-in', 'muted', `${name} asks you to sign in.`, { kind: 'sign-in', label: 'Sign in' });
    const plain = plainError(test.error, { name, command: connector.command, signedIn: oauth?.status === 'signed-in' });
    const labels = { 'install-runtime': 'How to install', 'sign-in': 'Sign in again', edit: 'Edit', test: 'Test again' };
    return result('failing', 'error', plain.message, { kind: plain.action, label: labels[plain.action] || 'Test again', ...(plain.runtime ? { runtime: plain.runtime } : {}) });
  }
  const crashes = connector.runtime?.crashesLastHour || 0;
  if (crashes > 0 && connector.runtime?.lastError) {
    return result('unstable', 'error', `Stopped ${crashes === 1 ? 'once' : `${crashes} times`} in the last hour: ${connector.runtime.lastError}`, { kind: 'test', label: 'Test again' });
  }
  if (connector.runtime?.lastError && Date.parse(connector.runtime.lastErrorAt || '') > Date.parse(test?.at || '')) {
    const plain = plainError(connector.runtime.lastError, { name, command: connector.command, signedIn: oauth?.status === 'signed-in' });
    return result('unstable', 'error', `Last use failed: ${plain.message}`, { kind: plain.action === 'sign-in' ? 'sign-in' : 'test', label: plain.action === 'sign-in' ? 'Sign in again' : 'Test again' });
  }
  if (!test) return result('untested', 'muted', 'Not checked yet.', { kind: 'test', label: 'Test' });
  const count = test.tools.length;
  const account = oauth?.account ? ` · ${oauth.account}` : '';
  const when = relative(test.at, now);
  return result('ready', 'ok', `${count} ${count === 1 ? 'tool' : 'tools'}${account}${when ? ` · checked ${when}` : ''}`, update ? { kind: 'update', label: `Update to ${update.latest}` } : null);
}
