import { randomUUID } from 'node:crypto';
import { ownerSchema, validateManifest, validateAgent, validateState } from '@autohand/squad-portable';
import { squadApiUrl } from '../squad-cloud/client.mjs';
import { writePortableFile } from './portable-file.mjs';

const failure = (message, status, code) => Object.assign(Error(message), { status, code });

// Tokens, owner and assertion are captured for this operation. A caller must
// create another client after an explicit context switch, never retarget this one.
export function createOwnedCloudClient({ owner: selected, token, identityToken, baseUrl, fetchImpl = fetch, assertCurrent, signal }) {
  if (typeof assertCurrent !== 'function') throw Error('An owned cloud client requires a current-context assertion.');
  const owner = Object.freeze(ownerSchema.parse(selected)), origin = squadApiUrl(baseUrl);
  const prefix = owner.kind === 'user' ? '/v1/users/me' : `/v1/teams/${encodeURIComponent(owner.id)}`;
  async function request(path, { method = 'GET', value, rawBody, idempotencyKey, raw = false } = {}) {
    assertCurrent(); signal?.throwIfAborted();
    const target = new URL(`${prefix}${path}`, origin);
    if (!path.startsWith('/') || path.startsWith('//') || target.hash || target.origin !== origin || !target.pathname.startsWith(`${prefix}/`)) throw Error('Invalid owned API path.');
    const response = await fetchImpl(target.href, { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)].filter(Boolean)),
      headers: { authorization: `Bearer ${token}`, ...(identityToken ? { 'x-autohand-identity': identityToken } : {}),
        ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      ...(rawBody !== undefined ? { body: rawBody } : value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    assertCurrent(); signal?.throwIfAborted();
    if (raw && response.ok) return response;
    let result;
    try { result = await response.json(); } catch { throw failure('Squad API returned an unreadable response. Local data is unchanged.', response.status); }
    assertCurrent(); signal?.throwIfAborted();
    if (!response.ok || result.success !== true) throw failure(result.error?.message || 'The owned Squad operation failed.', response.status, result.error?.code);
    return result.data;
  }
  async function frozenExport({ agentIds, includeShared, idempotencyKey = randomUUID(),planId,stateOverride } = {}) {
    if(planId!==undefined&&!/^[a-f0-9-]{36}$/.test(planId))throw Error('Choose a valid retained cloud backup.');
    const plan = planId?await request(`/exports/${planId}`):await request('/exports', { method: 'POST', value: { ...(agentIds ? { agentIds } : {}), ...(includeShared === undefined ? {} : { includeShared }),...(stateOverride===undefined?{}:{state:validateState(stateOverride)}) }, idempotencyKey });
    if (!/^[a-f0-9-]{36}$/.test(plan.id) || JSON.stringify(ownerSchema.parse(plan.owner)) !== JSON.stringify(owner)) throw Error('The export plan belongs to a different owner.');
    const path = `/exports/${plan.id}`, agents = [];
    let cursor = '', metadataBytes = 0;
    while (true) {
      const page = await request(`${path}/agents?limit=100&cursor=${encodeURIComponent(cursor)}`);
      if (!Array.isArray(page.agents) || page.agents.length > 100) throw Error('Invalid export page.');
      for (const entry of page.agents) {
        if (agents.length >= 10_000 || typeof entry.id !== 'string' || entry.id <= cursor) throw Error('Invalid export pagination.');
        const record = await request(`${path}/agents/${encodeURIComponent(entry.id)}`);
        if (record.kind !== 'agent' || record.deleted || record.id !== entry.id || record.revision !== entry.revision) throw Error('A frozen export record did not match its pointer.');
        const agent = validateAgent(record.content);
        if (agent.id !== entry.id) throw Error('The frozen agent ID does not match.');
        metadataBytes += Buffer.byteLength(JSON.stringify(agent));
        if (metadataBytes > 64 * 1024 * 1024) throw Error('Select fewer agents; export metadata exceeds 64 MiB. Nothing was truncated.');
        agents.push(agent); cursor = entry.id;
      }
      if (!page.hasMore) break;
      if (!page.agents.length || page.cursor !== cursor) throw Error('The frozen export did not advance.');
    }
    const snapshot = await request(`${path}/state`);
    const state = validateState(snapshot.content);
    const manifest = validateManifest({ ...state, agents, owner, format: 'autohand-squad', schemaVersion: 1, createdAt: plan.createdAt });
    return { plan, manifest, readFile: async file => {
      const filePath = file.agentId === null ? 'state' : `agents/${encodeURIComponent(file.agentId)}`;
      const response = await request(`${path}/${filePath}/files/${encodeURIComponent(file.id)}`, { raw: true });
      return { async *[Symbol.asyncIterator]() {
        if (!response.body) throw Error('The saved file has no contents.');
        const reader = response.body.getReader(); let done = false;
        try { while (true) { assertCurrent(); signal?.throwIfAborted(); const next = await reader.read(); assertCurrent(); if (next.done) { done = true; break; } yield next.value; } }
        finally { if (!done) await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } };
    } };
  }
  return {
    owner, request, frozenExport,
    exportFile: async options => { const snapshot = await frozenExport(options); const receipt=await writePortableFile({ ...snapshot, outputPath: options.outputPath, format: options.format, assertCurrent, signal });return {...receipt,memberCount:snapshot.manifest.agents.length,omissions:snapshot.manifest.omissions}; },
  };
}
