import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

export const TEAM_SQUADS_FLAG = 'squad_team_squads';
const RETRY_MS = 30_000;
const SAVED_FOR_MS = 24 * 60 * 60_000;

const platformName = (value = process.platform) => ({ darwin: 'macos', win32: 'windows' })[value] || value;
const override = value => (['1', 'true', 'on'].includes(String(value).toLowerCase()) ? true : ['0', 'false', 'off'].includes(String(value).toLowerCase()) ? false : undefined);

function packageVersion(rootDir) {
  try { return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

/**
 * Whether this account may use team Squads, from Autohand's flag service
 * (`squad_team_squads`, ADR-0239). The answer belongs to one signed-in
 * credential: it is asked with that credential's bearer token, kept per
 * credential fingerprint (never the token) and saved for a day so a restart
 * during an outage keeps the last answer. With no answer for the credential
 * at all, team Squads are off.
 *
 * AUTOHAND_SQUAD_FLAG_TEAM_SQUADS=1|0 fixes the answer for checks and
 * development and skips the service.
 */
export function createTeamSquadsFlag({ origin, serviceRoot, fetchImpl = fetch, rootDir = process.cwd(), appVersion = packageVersion(rootDir), platform = platformName(), fixed = override(process.env.AUTOHAND_SQUAD_FLAG_TEAM_SQUADS), minRefreshMs = 60_000, retryMs = RETRY_MS }) {
  const file = join(serviceRoot, 'ownership-flags.json');
  const answers = new Map();
  let loaded = false, nextAt = 0, inFlight = null;

  async function load() {
    if (loaded) return; loaded = true;
    try {
      const saved = await readPersistentJson(file, { version: 1, teamSquads: {} });
      for (const [fingerprint, entry] of Object.entries(saved.teamSquads || {})) {
        if (typeof entry?.enabled === 'boolean' && Number.isFinite(entry.evaluatedAt) && entry.evaluatedAt + SAVED_FOR_MS > Date.now()) answers.set(fingerprint, entry);
      }
    } catch { /* An unreadable file is the same as no saved answer. */ }
  }
  async function save() {
    const fresh = [...answers].filter(([, entry]) => entry.evaluatedAt + SAVED_FOR_MS > Date.now()).sort((a, b) => b[1].evaluatedAt - a[1].evaluatedAt).slice(0, 32);
    try { await writePersistentJson(file, { version: 1, teamSquads: Object.fromEntries(fresh) }); } catch { /* The in-memory answer still holds. */ }
  }
  async function ask(current) {
    const url = new URL('/v1/feature-flags/evaluate', origin);
    url.search = new URLSearchParams({ clientType: 'squad', platform, ...(appVersion ? { cliVersion: appVersion } : {}) }).toString();
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${current.token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('flag service unavailable');
    const text = await response.text();
    if (text.length > 512 * 1024) throw Error('flag response too large');
    const body = JSON.parse(text);
    if (body?.success !== true || !Array.isArray(body.flags)) throw Error('flag response invalid');
    const flag = body.flags.find(item => item?.key === TEAM_SQUADS_FLAG);
    const ttlMs = Number.isFinite(body.ttlSeconds) ? Math.min(3600_000, Math.max(minRefreshMs, body.ttlSeconds * 1000)) : 300_000;
    return { enabled: flag?.enabled === true, ttlMs };
  }

  return {
    fixed: fixed !== undefined,
    /** The answer for this credential fingerprint; false when there is none. */
    enabled(fingerprint) {
      if (fixed !== undefined) return fixed;
      return Boolean(fingerprint && answers.get(fingerprint)?.enabled);
    },
    due: () => fixed === undefined && Date.now() >= nextAt,
    /**
     * Ask the service for this credential. Resolves to the answer now held,
     * which is the previous one (or off) when the service could not answer.
     */
    refresh(current) {
      if (fixed !== undefined) return Promise.resolve(fixed);
      if (!current) return Promise.resolve(false);
      if (inFlight?.fingerprint === current.fingerprint) return inFlight.promise;
      const promise = (async () => {
        await load();
        try {
          const answer = await ask(current);
          answers.set(current.fingerprint, { enabled: answer.enabled, evaluatedAt: Date.now() });
          nextAt = Date.now() + answer.ttlMs;
          await save();
        } catch { nextAt = Date.now() + retryMs; }
        return Boolean(answers.get(current.fingerprint)?.enabled);
      })().finally(() => { if (inFlight?.promise === promise) inFlight = null; });
      inFlight = { fingerprint: current.fingerprint, promise };
      return promise;
    },
  };
}
