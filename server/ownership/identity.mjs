import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 503, code = 'identity_unavailable') => Object.assign(new Error(message), { status, code });
const profileSchema = z.object({ success: z.literal(true), profile: z.object({
  id: z.string().min(1).max(256), email: z.email(), name: z.string().nullable().optional(), status: z.string().nullable().optional(),
}) });
const accountsSchema = z.object({ success: z.literal(true), accounts: z.array(z.object({
  account: z.object({ id: z.string().min(1).max(256), name: z.string().max(500), type: z.enum(['personal', 'team']), accessMode: z.enum(['full', 'read_only']) }),
  role: z.enum(['owner', 'admin', 'contributor']), permissions: z.array(z.string()),
})).max(10_000) });

export function identityOrigin(value = process.env.AUTOHAND_SQUAD_IDENTITY_ORIGIN || 'https://api.autohand.ai') {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('Identity service must be an HTTPS origin or a loopback development server.', 500, 'identity_origin_invalid');
  return url.origin;
}
export const ownerKey = owner => digest(JSON.stringify([owner.issuer, owner.kind, owner.id]));
export const actorKey = actor => digest(JSON.stringify([actor.issuer, actor.id]));

export function readCredential(configPath) {
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw fail('The Autohand sign-in file could not be read safely.', 401, 'identity_invalid'); }
  const auth = config?.auth;
  if (!auth || typeof auth.token !== 'string' || !auth.token.trim()) return null;
  const token = auth.token.trim();
  if (token.length > 8192 || /[\r\n\0]/.test(token)) throw fail('Sign in again; the saved credential is invalid.', 401, 'identity_invalid');
  const expiry = auth.expiresAt ? Date.parse(auth.expiresAt) : Infinity;
  if (Number.isNaN(expiry) || expiry <= Date.now()) return null;
  return { token, fingerprint: digest(token), expiresAt: expiry };
}

async function json(response, schema, limit) {
  if (!response.ok) throw fail('The account service could not verify current access.', [401, 403].includes(response.status) ? 401 : 503,
    response.status === 429 || response.status >= 500 ? 'identity_transport_unavailable' : 'identity_rejected');
  const reader = response.body?.getReader();
  if (!reader) throw fail('The account service returned an empty response.');
  const data = new Uint8Array(limit); let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw fail('The account response exceeds its size limit.', 503, 'identity_invalid_response'); }
      data.set(next.value, size - next.value.byteLength);
    }
  } finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(data.subarray(0, size))); } catch { throw fail('The account service returned invalid JSON.', 503, 'identity_invalid_response'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail('The account service returned invalid identity or membership information.', 503, 'identity_invalid_response');
  return parsed.data;
}

export function createIdentityService({ serviceRoot, configPath, origin = identityOrigin(), fetchImpl = fetch }) {
  const cacheFile = join(serviceRoot, 'ownership-identities.json');
  const cacheKey = fingerprint => `${origin}|${fingerprint}`;
  const credential = () => readCredential(configPath);
  async function request(path, current, schema, limit) {
    let response;
    try { response = await fetchImpl(new URL(path, origin), { headers: { authorization: `Bearer ${current.token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) }); }
    catch { throw fail('The account service is unavailable. Current team access cannot be assumed.', 503, 'identity_transport_unavailable'); }
    return json(response, schema, limit);
  }
  async function verify(current = credential()) {
    if (!current) return null;
    let cache;
    try { cache = await readPersistentJson(cacheFile, { version: 1, identities: {} }); }
    catch { throw fail('Saved identity verification is unreadable. Sign in again.', 401, 'identity_cache_invalid'); }
    try {
      const { profile } = await request('/v1/profile', current, profileSchema, 128 * 1024);
      if (['disabled', 'suspended', 'deleted'].includes(profile.status || '')) throw fail('This Autohand account is unavailable.', 403, 'identity_disabled');
      const actor = { issuer: origin, id: profile.id, email: profile.email, name: profile.name || profile.email };
      const expiresAt = Math.min(current.expiresAt, Date.now() + 24 * 60 * 60_000);
      cache.identities[cacheKey(current.fingerprint)] = { actor, expiresAt };
      // Retain only unexpired verification, never a token or team membership.
      cache.identities = Object.fromEntries(Object.entries(cache.identities).filter(([, entry]) => entry.expiresAt > Date.now()).sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, 256));
      await writePersistentJson(cacheFile, cache);
      return { actor, fingerprint: current.fingerprint, expiresAt, offline: false };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        delete cache.identities[cacheKey(current.fingerprint)];
        await writePersistentJson(cacheFile, cache);
        throw error;
      }
      if (error.code !== 'identity_transport_unavailable') throw error;
      const saved = cache.identities[cacheKey(current.fingerprint)];
      if (!saved || saved.expiresAt <= Date.now() || saved.actor?.issuer !== origin || typeof saved.actor?.id !== 'string' || !saved.actor.id) throw error;
      return { actor: saved.actor, fingerprint: current.fingerprint, expiresAt: Math.min(saved.expiresAt, current.expiresAt), offline: true };
    }
  }
  const personal = verified => ({ owner: { kind: 'user', issuer: origin, id: verified.actor.id }, label: 'Personal Squad', role: 'owner', canWrite: true });
  async function owners(verified) {
    const current = credential();
    if (!current || current.fingerprint !== verified.fingerprint) throw fail('The account changed. Reopen Squad before continuing.', 409, 'context_changed');
    const { accounts } = await request('/v1/accounts', current, accountsSchema, 1024 * 1024);
    return [personal(verified), ...accounts.filter(item => item.account.type === 'team').map(item => ({
      owner: { kind: 'team', issuer: origin, id: item.account.id }, label: item.account.name,
      role: item.role === 'contributor' ? 'editor' : item.role,
      canWrite: item.account.accessMode === 'full' && item.permissions.includes('resources:operate'),
    }))];
  }
  async function authorize(verified, owner, write = false) {
    const current = credential();
    if (!current || current.fingerprint !== verified.fingerprint || verified.expiresAt <= Date.now()) throw fail('The account changed or expired. Reopen Squad.', 409, 'context_changed');
    const access = owner.kind === 'user' && owner.id === verified.actor.id && owner.issuer === origin ? personal(verified)
      : (await owners(verified)).find(item => item.owner.kind === owner.kind && item.owner.id === owner.id && item.owner.issuer === owner.issuer);
    if (!access) throw fail('This Squad is not available to the current account.', 404, 'owner_not_found');
    if (write && !access.canWrite) throw fail('This team is read-only. Backup and retrieval remain available.', 403, 'owner_read_only');
    return access;
  }
  return { credential, verify, owners, personal, authorize, origin };
}
