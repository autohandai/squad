import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The sign-in apps a release build provides (ADR-0248): a Google "Desktop app"
// OAuth client and a GitHub OAuth App used through the device flow. Both are
// installed-app clients, public by their providers' own definition, so the
// build stages them as a plain file beside server.mjs, the way
// PRODUCT_TELEMETRY.json carries PostHog's public key. Nothing here is a
// credential that identifies a person.
export const CONNECTOR_CLIENTS_FILE = 'CONNECTOR_CLIENTS.json';

const GOOGLE_ID = /^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/;
const GOOGLE_SECRET = /^[A-Za-z0-9_-]{16,80}$/;
const GITHUB_ID = /^[A-Za-z0-9._-]{16,40}$/;
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Throws on a value that cannot be the kind of client it claims to be. */
export function connectorClientsFrom(source = {}, { strict = true } = {}) {
  const fail = (message) => { if (strict) throw new Error(message); return null; };
  const googleId = text(source.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID);
  const googleSecret = text(source.AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET);
  const githubId = text(source.AUTOHAND_SQUAD_GITHUB_CLIENT_ID);
  let google = null;
  if (googleId || googleSecret) {
    if (!GOOGLE_ID.test(googleId)) google = fail('AUTOHAND_SQUAD_GOOGLE_CLIENT_ID is not a Google OAuth client id (…apps.googleusercontent.com).');
    else if (googleSecret && !GOOGLE_SECRET.test(googleSecret)) google = fail('AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET does not look like a Google client secret.');
    else google = { clientId: googleId, clientSecret: googleSecret };
  }
  let github = null;
  if (githubId) github = GITHUB_ID.test(githubId) ? { clientId: githubId } : fail('AUTOHAND_SQUAD_GITHUB_CLIENT_ID is not a GitHub OAuth App client id.');
  return { google, github };
}

/**
 * What the bridge uses. Each provider is taken whole from one place: the
 * environment when it names that provider (development, a fixture, an
 * operator override), otherwise the staged file. A missing or unreadable file
 * means "not set up", which the Connectors page already explains.
 */
export function readConnectorBuildClients(rootDir, env = process.env) {
  let staged = {};
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, CONNECTOR_CLIENTS_FILE), 'utf8'));
    staged = connectorClientsFrom({
      AUTOHAND_SQUAD_GOOGLE_CLIENT_ID: raw?.google?.clientId,
      AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET: raw?.google?.clientSecret,
      AUTOHAND_SQUAD_GITHUB_CLIENT_ID: raw?.github?.clientId,
    }, { strict: false });
  } catch { /* No staged clients: sign-in for these providers is not set up. */ }
  const fromEnv = connectorClientsFrom(env, { strict: false });
  const google = text(env.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID) ? fromEnv.google : staged.google || null;
  const github = text(env.AUTOHAND_SQUAD_GITHUB_CLIENT_ID) ? fromEnv.github : staged.github || null;
  return {
    google,
    github,
    source: { google: google ? (text(env.AUTOHAND_SQUAD_GOOGLE_CLIENT_ID) ? 'env' : 'build') : null, github: github ? (text(env.AUTOHAND_SQUAD_GITHUB_CLIENT_ID) ? 'env' : 'build') : null },
  };
}

/** The shape deviceAppsFromEnv() reads, without touching process.env. */
export function deviceAppEnv(clients) {
  return clients?.github?.clientId ? { AUTOHAND_SQUAD_GITHUB_CLIENT_ID: clients.github.clientId } : {};
}

/** Safe to log or return to the page: which providers are set up, never values. */
export function describeConnectorBuildClients(clients) {
  return `Google ${clients?.google ? `set up (${clients.source.google})` : 'not set up'}; GitHub ${clients?.github ? `set up (${clients.source.github})` : 'not set up'}`;
}
