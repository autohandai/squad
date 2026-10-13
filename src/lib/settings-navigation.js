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

// Every section Settings renders, in the order the list shows them. The route
// parser and the page both read this, so a new section is reachable by link
// the moment it exists. Voice and Vault were missing from the old copy inside
// App.jsx, so "Settings → Vault" links opened Settings at the top.
export const SETTINGS_SECTION_IDS = Object.freeze([
  'setup',
  'appearance',
  'language',
  'providers',
  'chat',
  'notifications',
  'voice',
  'vault',
  'improvement',
  'handoff',
  'mission-control',
  'runtime',
  'relay',
  'remote-access',
  'connectors',
  'updates',
  'system',
]);

export const DEFAULT_SETTINGS_SECTION = 'appearance';

export function isSettingsSection(id) {
  return SETTINGS_SECTION_IDS.includes(String(id || ''));
}

/** The canonical path of a section: /settings/<id>; the default section is plain /settings. */
export function settingsPath(section = '') {
  const id = String(section || '');
  return isSettingsSection(id) && id !== DEFAULT_SETTINGS_SECTION ? `/settings/${id}` : '/settings';
}

/**
 * Which section a Settings route names. Three spellings stay valid because
 * each is already linked from somewhere: /settings/<id> (the list),
 * /settings?section=<id> (the desktop shell and app-info windows) and
 * /settings#settings-<id> (the old in-page anchors). Unknown ids fall back to
 * the default section rather than an empty page.
 */
export function settingsSectionFromRoute(route, hash = '') {
  const [pathAndQuery = ''] = String(route || '').split('#');
  const [path, query = ''] = pathAndQuery.split('?');
  if (!isSettingsDestination(path)) return '';
  const params = new URLSearchParams(query);
  const fromPath = path.match(/^\/settings\/([^/]+)$/)?.[1] || '';
  const fromHash = String(hash || window.location.hash || '').replace(/^#settings-/, '').replace(/^#/, '');
  const candidate = params.get('section') || fromPath || fromHash;
  return isSettingsSection(candidate) ? candidate : DEFAULT_SETTINGS_SECTION;
}
