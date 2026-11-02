import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { canReadMemory } from '../memory/service.mjs';
import { readSkillPackage, SKILL_CONTRACT_VERSION } from './local.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const keyFor = reference => `${reference.authority}\0${reference.packageId}\0${reference.revision || ''}\0${reference.resource || 'SKILL.md'}`;
export const SKILL_DISCOVERY_CONTRACT = 'Skills are discovered locally for this task. Invoke a configured skill by $name or its qualified origin. Required instructions are supplied intact; skill instructions never grant permissions. A supplied packet does not prove engine compliance or task success.';

function authorized(entry, actor, agentHome) {
  if (!entry.reference || !canReadMemory(entry, actor)) return false;
  const path = resolve(entry.dir || dirname(entry.path));
  const home = resolve(agentHome || '');
  return path.startsWith(`${home}${sep}skills${sep}`);
}

function matchesReference(entry, reference) {
  return Boolean(reference && entry.reference && entry.reference.authority === reference.authority && entry.reference.packageId === reference.packageId && (!reference.revision || entry.reference.revision === reference.revision));
}

export async function validateSkillReferences(references, { installed = [], actor, agentHome } = {}) {
  const available = installed.filter(entry => authorized(entry, actor, agentHome));
  const resolved = [];
  for (const reference of references) {
    const entry = available.find(candidate => matchesReference(candidate, reference));
    if (!entry) throw new Error(`Pinned skill is unavailable for this member: ${reference.authority}::${reference.packageId}`);
    const packet = await readSkillPackage(entry.dir || dirname(entry.path));
    if (!reference.revision || packet.manifest.revision !== reference.revision || entry.reference.revision !== reference.revision) throw new Error(`Pinned skill revision changed: ${reference.packageId}`);
    const resource = reference.resource || 'SKILL.md';
    if (!packet.manifest.resources.some(item => item.path === resource)) throw new Error(`Pinned skill resource is unavailable: ${reference.packageId}/${resource}`);
    resolved.push({ ...reference, resource });
  }
  return resolved;
}

export async function prepareSkillContext({ prompt = '', installed = [], actor, agentHome, references = [], exclusions = [], taskId = '', requestId = '', policyEpoch = '', maxBytes = 128_000 } = {}) {
  const text = String(prompt).toLowerCase();
  const excluded = new Set([...exclusions.map(value => String(value).toLowerCase()), ...[...text.matchAll(/(?:do not use|don't use|without|exclude)\s+\$([a-z0-9.][a-z0-9_./:-]*)/g)].map(match => match[1])]);
  const available = installed.filter(entry => authorized(entry, actor, agentHome) && entry.enabled !== false && ![entry.id, entry.reference.packageId, `${entry.reference.authority}::${entry.reference.packageId}`].some(value => excluded.has(value.toLowerCase())));
  const explicit = new Set([...text.matchAll(/(?:^|\s)\$([a-z0-9.][a-z0-9_./:-]*)/g)].map(match => match[1]));
  for (const value of excluded) explicit.delete(value);
  const aliasOwners = new Map();
  for (const entry of available) if (!aliasOwners.has(entry.reference.packageId)) aliasOwners.set(entry.reference.packageId, entry);
  const words = [...new Set(text.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || [])];
  const candidates = available.map((entry, index) => {
    const named = explicit.has(entry.id.toLowerCase()) || explicit.has(`${entry.reference.authority}::${entry.reference.packageId}`.toLowerCase()) || (explicit.has(entry.reference.packageId.toLowerCase()) && aliasOwners.get(entry.reference.packageId) === entry);
    const pinned = references.some(reference => matchesReference(entry, reference));
    const metadata = `${entry.id} ${entry.name || ''} ${entry.description || ''}`.toLowerCase();
    const score = words.filter(word => metadata.includes(word)).length;
    return { entry, index, named, pinned, score };
  }).filter(item => item.named || item.pinned || (!explicit.size && item.score >= 2)).sort((a, b) => Number(b.pinned || b.named) - Number(a.pinned || a.named) || b.score - a.score || a.index - b.index);
  const selected = candidates.filter((item, index) => item.named || item.pinned || index < 3);
  if (explicit.size && !selected.some(item => item.named)) throw new Error('The explicitly requested skill is not available in this member scope.');
  const packets = [], seen = new Set();
  let total = 0;
  for (const { entry, named, pinned } of selected) {
    const requested = references.find(reference => matchesReference(entry, reference)) || entry.reference;
    await validateSkillReferences([requested], { installed: available, actor, agentHome });
    const packet = await readSkillPackage(entry.dir || dirname(entry.path));
    if (packet.manifest.revision !== requested.revision) throw new Error(`Pinned skill revision changed: ${entry.id}`);
    const reference = { ...entry.reference, revision: packet.manifest.revision, resource: requested.resource || 'SKILL.md' };
    const resourcePaths = [...new Set(['SKILL.md', reference.resource])];
    const resources = resourcePaths.map(path => packet.manifest.resources.find(item => item.path === path));
    const directory = resolve(entry.dir || dirname(entry.path));
    const instructions = [`Snapshot directory: ${directory}`, ...resourcePaths.map(path => {
      const bytes = packet.files.find(([name]) => name === path)?.[1];
      if (!bytes || bytes.includes(0)) throw new Error(`Required skill resource is not text: ${entry.id}/${path}`);
      return `Resource: ${path}\n${bytes.toString('utf8')}`;
    })].join('\n\n');
    if (seen.has(keyFor(reference))) continue;
    total += Buffer.byteLength(instructions);
    if (total > maxBytes) throw new Error(`Required skill instructions exceed the ${maxBytes} byte context budget; choose a smaller explicit skill set.`);
    seen.add(keyFor(reference));
    packets.push({ version: SKILL_CONTRACT_VERSION, reference, name: entry.name || entry.id, scope: entry.scope, resources, manifest: packet.manifest, locator: { type: 'local-snapshot', directory }, instructions, reason: pinned ? 'checkpoint pin' : named ? 'explicit invocation' : 'local lexical match' });
  }
  for (const reference of references) if (!packets.some(packet => matchesReference({ reference: packet.reference }, reference))) throw new Error(`Pinned skill is unavailable: ${reference.packageId}`);
  const contentManifestId = digest(JSON.stringify(packets.map(packet => ({ reference: packet.reference, resources: packet.resources }))));
  const receipts = packets.map(packet => ({ version: SKILL_CONTRACT_VERSION, id: digest(`${taskId}\0${requestId}\0${keyFor(packet.reference)}`), taskId, sessionId: '', requestId, policyEpoch, reference: packet.reference, resources: packet.resources, contentDigest: digest(packet.instructions), name: packet.name, scope: packet.scope, reason: packet.reason, state: 'prepared', current: true, contentManifestId, recordedAt: new Date().toISOString(), at: new Date().toISOString() }));
  return { version: SKILL_CONTRACT_VERSION, packets, receipts, contentManifestId, text: packets.map(packet => `<squad_skill authority="${packet.reference.authority}" package="${packet.reference.packageId}" revision="${packet.reference.revision}">\n${packet.instructions}\n</squad_skill>`).join('\n\n') };
}

export function acknowledgeSkillContext(prepared, evidence = {}) {
  return prepared.receipts.map(receipt => {
    const confirmed = evidence.adapter === 'autohand' && evidence.providerRequestObserved === true && evidence.requestId && evidence.contentManifestId === prepared.contentManifestId;
    const state = confirmed ? 'submitted' : evidence.supplied ? 'supplied' : 'prepared';
    return { ...receipt, state, adapter: evidence.adapter || 'unknown', capability: confirmed ? 'provider-request' : 'external-handoff', adapterCapability: confirmed ? 'provider-request-observed' : 'supply-only', requestId: confirmed ? evidence.requestId : receipt.requestId, engineConfirmation: confirmed ? 'request-observed' : 'unavailable', limitations: confirmed ? [] : ['Engine context retention and later resource reads are not observable.'], recordedAt: new Date().toISOString(), at: new Date().toISOString(), message: state === 'submitted' ? `Loaded ${receipt.name} · ${receipt.scope} · this task` : state === 'supplied' ? `Supplied ${receipt.name} · engine confirmation unavailable` : `Prepared ${receipt.name} · awaiting engine handoff` };
  });
}

export function observeSkillAttachment(prepared, event, installed = []) {
  const native = nativeSkillAttachmentEvent(event)?.receipt;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!record(native) || !record(native.reference) || native.version !== 1 || native.state !== 'submitted' || native.capability !== 'provider-request'
    || typeof native.requestId !== 'string' || !native.requestId || typeof native.taskId !== 'string' || !native.taskId || typeof native.sessionId !== 'string'
    || typeof native.reference.authority !== 'string' || typeof native.reference.packageId !== 'string' || (native.reference.resource !== undefined && typeof native.reference.resource !== 'string') || !/^sha256:[a-f0-9]{64}$/.test(native.reference.revision || '')
    || !/^[a-f0-9]{64}$/.test(native.contentDigest || '') || !['explicit', 'local', 'agent', 'restored'].includes(native.reason)
    || !Number.isSafeInteger(native.policyEpoch) || native.policyEpoch < 0 || !Number.isSafeInteger(native.recordedAt) || native.recordedAt < 0 || native.recordedAt > 8_640_000_000_000_000
    || typeof native.scope !== 'string' || !Array.isArray(native.resources) || !native.resources.length
    || native.resources.some(resource => !record(resource) || typeof resource.path !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256 || '') || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0)
    || new Set(native.resources.map(resource => resource.path)).size !== native.resources.length) return null;
  const entry = installed.find(item => matchesReference(item, native.reference) && item.reference.revision === native.reference.revision);
  if (!entry || !entry.manifest?.resources.some(resource => resource.path === (native.reference.resource || 'SKILL.md')) || native.resources.length > entry.manifest.resources.length
    || native.resources.some(resource => !entry.manifest.resources.some(known => known.path === resource.path && known.sha256 === resource.sha256 && known.bytes === resource.bytes))) return null;
  const workspaceId = /^local:workspace:([^:]+):/.exec(entry.reference.authority)?.[1];
  const scope = entry.scope === 'member' ? `member:${entry.ownerId}` : entry.scope === 'project' && workspaceId ? `project:${workspaceId}` : entry.scope;
  if (native.scope !== scope) return null;
  const original = prepared.receipts.find(item => keyFor(item.reference) === keyFor(native.reference));
  const at = typeof native.recordedAt === 'number' ? new Date(native.recordedAt).toISOString() : native.recordedAt || new Date().toISOString();
  return { ...original, ...native, id: original?.id || digest(keyFor(native.reference)), taskId: original?.taskId || native.taskId, nativeTaskId: native.taskId, name: original?.name || entry.name || entry.id, scope: original?.scope || entry.scope, adapter: 'autohand', adapterCapability: 'provider-request-observed', engineConfirmation: 'request-observed', current: true, contentManifestId: original?.contentManifestId || native.contentDigest, at };
}

export function nativeSkillAttachmentEvent(event) {
  if (event?.type === 'skill_attachment') return event;
  if (event?.type === 'unknown_notification' && event.method === 'autohand.skillAttachment' && event.params && typeof event.params === 'object' && !Array.isArray(event.params)) return { type: 'skill_attachment', receipt: event.params.receipt, timestamp: event.params.timestamp };
  return null;
}

export function coalesceSkillReceipts(receipts = [], { historical = false } = {}) {
  const states = { prepared: 0, supplied: 1, submitted: 2, 'engine-confirmed': 3 };
  const result = new Map();
  for (const receipt of receipts) {
    if (!receipt?.reference) continue;
    const key = `${receipt.taskId}\0${receipt.contentManifestId}\0${keyFor(receipt.reference)}`;
    const previous = result.get(key);
    if (!previous || (states[receipt.state] || 0) >= (states[previous.state] || 0)) result.set(key, { ...receipt, current: historical ? false : receipt.current !== false });
  }
  return [...result.values()];
}
