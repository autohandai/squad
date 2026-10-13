/** Settings keeps the originating app screen, rather than guessing a member. */
export function isSettingsDestination(route) {
  const path = String(route || '').split(/[?#]/)[0];
  return path === '/settings' || path.startsWith('/settings/');
}

/** Only same-app paths and text drafts may be restored from browser history. */
export function settingsReturnSnapshot(value) {
  if (!value || typeof value.route !== 'string' || !value.route.startsWith('/') || value.route.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value.route) || isSettingsDestination(value.route)) return null;
  const source = value.drafts && typeof value.drafts === 'object' && !Array.isArray(value.drafts) ? value.drafts : {};
  const drafts = Object.fromEntries(Object.entries(source).filter(([id, text]) => /^[a-zA-Z0-9_.:-]{1,256}$/.test(id) && !['__proto__','constructor','prototype'].includes(id) && typeof text === 'string'));
  return { route: value.route, drafts };
}

const SETTINGS_RETURN_KEY = 'autohandSquad.v1.settingsReturn';

export function readSettingsReturn() {
  const state = settingsReturnSnapshot(window.history.state?.squadSettingsReturn);
  if (state) return state;
  try { return settingsReturnSnapshot(JSON.parse(window.sessionStorage.getItem(SETTINGS_RETURN_KEY))); }
  catch { return null; }
}

export function rememberSettingsReturn(value) {
  try {
    if (value) window.sessionStorage.setItem(SETTINGS_RETURN_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(SETTINGS_RETURN_KEY);
  } catch { /* The current app state and history still support returning. */ }
}
