import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readPersistentJson, writePersistentJson } from '../persistent-json.mjs';
import { cleanMemoryText, looksSecret } from '../team/store.mjs';
import { collectMemories, digest, teamMemoryRecord } from './collect.mjs';
import { createMemoryVectorClient } from './vector-client.mjs';

export const MEMORY_KINDS = Object.freeze(['memory', 'lesson', 'decision', 'preference', 'discovery']);
export const MEMORY_RELATIONS = Object.freeze(['references', 'supports', 'contradicts']);
export const DEFAULT_COLLECTION = Object.freeze({ team: true, members: true, profiles: true, cli: true, folders: [], colors: {} });
const empty = () => ({ version: 1, settings: { ...DEFAULT_COLLECTION }, groups: [], metadata: {}, links: [] });
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const label = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const folderName = path => path.split(/[\\/]/).filter(Boolean).at(-1) || 'Shared Markdown';

export function canReadMemory(record, actor) {
  if (!actor) return true; // The local person's library, never agent arguments.
  return record.scope === 'team' || (record.scope === 'member' && record.ownerId === actor.memberId) || (record.sharedWith || []).includes(actor.memberId) || (record.scope === 'project' && actor.workspace && record.workspace === resolve(actor.workspace));
}
function canChange(record, actor) {
  return !actor || (record.authorId && record.authorId === actor.memberId) || (record.scope === 'member' && record.ownerId === actor.memberId);
}

/** One collection, one authorization boundary for the app and managed MCP. */
export function createMemoryService({ stateDir, rootDir, agentsDir, members, teamStore, emit = () => {}, vectorClient } = {}) {
  const file = join(stateDir, 'memory', 'library.json');
  const vectors = vectorClient || createMemoryVectorClient({ rootDir, stateDir });
  let mutation = Promise.resolve(), collection;

  async function state() {
    const saved = await readPersistentJson(file, empty());
    if (!saved || saved.version !== 1 || !Array.isArray(saved.groups) || typeof saved.metadata !== 'object' || !Array.isArray(saved.links)) throw error('The memory library settings could not be read. Your source memories are unchanged; restore the saved library file before editing.', 503);
    return { ...empty(), ...saved, settings: { ...DEFAULT_COLLECTION, ...saved.settings } };
  }
  function mutate(operation) {
    const pending = mutation.then(async () => {
      const value = await state();
      const result = await operation(value);
      await writePersistentJson(file, value);
      collection = undefined;
      emit('memory.changed', { reason: 'library' });
      return result;
    });
    mutation = pending.catch(() => {});
    return pending;
  }
  async function collect() {
    // Requests in the same frame share disk I/O, but a later refresh always
    // reconciles source deletion and edits. No stale source content is retained.
    if (!collection) {
      const pending = (async () => {
      await mutation;
      const saved = await state();
      const collected = await collectMemories({ members, teamStore, settings: saved.settings, agentsDir });
      const records = collected.records.map(item => ({ ...item, ...(saved.metadata[item.id] || {}), sourceTitle: item.title, title: saved.metadata[item.id]?.title || item.title, sharedWith: saved.metadata[item.id]?.sharedWith || [], tags: [...new Set([...(item.tags || []), ...(saved.metadata[item.id]?.tags || [])])] }));
      // Source fields and visibility cannot be replaced by curation metadata.
      return { ...collected, records, groups: saved.groups, settings: saved.settings, links: saved.links };
      })();
      collection = pending;
      pending.finally(() => { if (collection === pending) collection = undefined; }).catch(() => {});
    }
    return collection;
  }
  async function index(records) {
    // Retain complete source text in the library. The compact search features
    // have an explicit per-document budget so every collected ID is indexed.
    const budget = Math.min(32000, Math.floor((15 * 1024 * 1024) / Math.max(1, records.length)));
    let truncatedDocuments = 0;
    const documents = records.map(item => { const text = Buffer.from(`${item.title}\n${item.text}`, 'utf8'); if (text.length > budget) truncatedDocuments++; return { id: item.id, text: text.subarray(0, budget).toString('utf8') }; });
    try { return { available: true, ...await vectors.request({ op: 'sync', documents }), truncatedDocuments }; }
    catch (failure) { return { available: false, engine: 'turbovec', error: failure.message }; }
  }
  async function list({ actor, query = '', owner = '', scope = '', kind = '', group = '', tag = '', limit = 500, offset = 0, similarity = false } = {}) {
    const data = await collect();
    const allVisible = data.records.filter(record => canReadMemory(record, actor));
    let records = allVisible.filter(record => (!owner || record.ownerId === owner) && (!scope || record.scope === scope) && (!kind || record.kind === kind) && (!group || (group === '__ungrouped' ? !record.groupId : record.groupId === group)) && (!tag || record.tags.includes(tag)));
    const engine = await index(data.records);
    const needle = String(query).trim().slice(0, 2000);
    if (needle) {
      const words = needle.toLowerCase().split(/\s+/).filter(Boolean);
      const exact = new Set(records.filter(item => words.every(word => `${item.title} ${item.text} ${item.tags.join(' ')}`.toLowerCase().includes(word))).map(item => item.id));
      let hits = [];
      if (engine.available && records.length) {
        try { hits = (await vectors.request({ op: 'search', query: needle, allowedIds: records.map(item => item.id), limit: 100 })).hits || []; }
        catch (failure) { engine.available = false; engine.error = failure.message; }
      }
      const scores = new Map(hits.filter(hit => Number(hit.score) >= 0.12).map(hit => [hit.id, Number(hit.score)]));
      records = records.filter(item => exact.has(item.id) || scores.has(item.id)).map(item => ({ ...item, score: (exact.has(item.id) ? 1 : 0) + (scores.get(item.id) || 0) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    } else records.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
    const total = records.length;
    const count = Math.min(1000, Math.max(1, Number(limit) || 500));
    const start = Math.max(0, Number(offset) || 0);
    records = records.slice(start, start + count);
    const ids = new Set(records.map(item => item.id));
    const links = data.links.filter(link => ids.has(link.from) && ids.has(link.to));
    if (similarity && engine.available && records.length) {
      const candidates = records.slice(0, 160);
      const pairs = new Set(links.map(link => [link.from, link.to].sort().join('\0')));
      for (let i = 0; i < candidates.length; i += 12) {
        await Promise.all(candidates.slice(i, i + 12).map(async record => {
          try {
            const query = Buffer.from(record.text, 'utf8').subarray(0, 16000).toString('utf8');
            const hits = (await vectors.request({ op: 'search', query, allowedIds: records.map(item => item.id), limit: 4 })).hits || [];
            for (const hit of hits) {
              if (hit.id === record.id || hit.score < 0.24 || !ids.has(hit.id)) continue;
              const key = [record.id, hit.id].sort().join('\0');
              if (pairs.has(key)) continue;
              pairs.add(key); links.push({ id: `similar:${digest(key)}`, from: record.id, to: hit.id, relation: 'similar', derived: true, score: hit.score });
            }
          } catch (failure) { engine.available = false; engine.error = failure.message; }
        }));
      }
    }
    const visibleIds = new Set(allVisible.map(item => item.id));
    return { records: records.map(record => ({ ...record, editable: record.sourceType === 'team' && canChange(record, actor) })), total, offset: start, hasMore: start + count < total, collected: allVisible.length,
      members: actor ? data.members.map(({ id, name, role, color }) => ({ id, name, role, color })) : data.members,
      groups: data.groups.filter(item => !actor || allVisible.some(record => record.groupId === item.id)),
      links, settings: actor ? undefined : data.settings, sources: actor ? undefined : data.sources,
      warnings: data.warnings.filter(item => !actor || !item.ownerId || item.ownerId === actor.memberId).map(item => actor ? { message: item.message.replace(/\/[^ ]+/g, '[local source]') } : item),
      index: { ...engine, encoderLabel: 'Local text similarity', note: 'Offline token and phrase features; no external embedding model or API.' },
      totalLinks: data.links.filter(link => visibleIds.has(link.from) && visibleIds.has(link.to)).length };
  }
  async function get(id, actor) {
    const data = await collect();
    let record = data.records.find(item => item.id === id && canReadMemory(item, actor));
    if (!record) {
      // Source inclusion is not deletion or revocation of canonical team
      // memory. Existing update/forget calls by exact ID keep working even
      // when that source is excluded from the searchable library.
      const entry = (await teamStore.read()).memory.find(item => item.id === id);
      const source = entry && teamMemoryRecord(entry);
      const metadata = (await state()).metadata[id] || {};
      const candidate = source && { ...source, ...metadata, tags: [...new Set([...(source.tags || []), ...(metadata.tags || [])])], sharedWith: metadata.sharedWith || [] };
      if (candidate && canReadMemory(candidate, actor)) record = candidate;
    }
    if (!record) throw error('That memory is not available to you.', 404);
    return record;
  }
  async function updateSettings(input) {
    return mutate(saved => {
      const next = { ...saved.settings };
      for (const key of ['team', 'members', 'profiles', 'cli']) if (key in input) next[key] = input[key] === true;
      if ('colors' in input) {
        if (!input.colors || typeof input.colors !== 'object' || Array.isArray(input.colors) || Object.keys(input.colors).length > 1000) throw error('Choose valid member colors.');
        next.colors = Object.fromEntries(Object.entries(input.colors).filter(([id, color]) => /^[A-Za-z0-9_.:-]{1,200}$/.test(id) && /^#[0-9a-f]{6}$/i.test(color)));
      }
      if ('folders' in input) {
        if (!Array.isArray(input.folders) || input.folders.length > 8) throw error('Choose up to eight Markdown folders.');
        next.folders = input.folders.map(folder => {
          const path = String(folder.path || '').trim();
          if (!path || !/^(\/|[A-Za-z]:[\\/])/.test(path) || path.includes('\0')) throw error('Use the full path to a Markdown memory folder.');
          return { id: `folder:${digest(resolve(path))}`, label: label(folder.label) || folderName(path), path: resolve(path) };
        });
      }
      saved.settings = next;
      return next;
    });
  }
  async function group(input) {
    return mutate(saved => {
      const name = label(input.name);
      if (!name) throw error('Give the group a name.');
      if (looksSecret(name)) throw error('That looks like a password or key. Secrets belong in the vault, never in memory groups.');
      const existing = input.id && saved.groups.find(item => item.id === input.id);
      if (input.id && !existing) throw error('That group no longer exists.', 404);
      if (saved.groups.some(item => item.id !== input.id && item.name.toLowerCase() === name.toLowerCase())) throw error('A group already has that name.');
      const item = { id: existing?.id || `mg_${randomUUID()}`, name, color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : existing?.color || '#6c9fe8' };
      if (existing) Object.assign(existing, item); else { if (saved.groups.length >= 100) throw error('The library has reached 100 groups.'); saved.groups.push(item); }
      return item;
    });
  }
  async function removeGroup(id) {
    return mutate(saved => { saved.groups = saved.groups.filter(item => item.id !== id); for (const meta of Object.values(saved.metadata)) if (meta.groupId === id) delete meta.groupId; return { id }; });
  }
  async function curate(id, input, actor) {
    const record = await get(id, actor);
    if (!canChange(record, actor)) throw error('Only the owner or the person can organize this memory.', 403);
    return mutate(saved => {
      const meta = { ...(saved.metadata[id] || {}) };
      if ('groupId' in input) { if (input.groupId && !saved.groups.some(item => item.id === input.groupId)) throw error('Choose an existing memory group.'); meta.groupId = String(input.groupId || ''); }
      if ('tags' in input) { if (!Array.isArray(input.tags) || input.tags.length > 20) throw error('Use up to 20 tags.'); meta.tags = [...new Set(input.tags.map(label).filter(Boolean))]; }
      if ('kind' in input) { if (!MEMORY_KINDS.includes(input.kind)) throw error('Choose a memory kind.'); meta.kind = input.kind; }
      if ('title' in input) { const title = label(input.title); if (!title) throw error('Give the memory a title.'); meta.title = title; }
      if ('pinned' in input) meta.pinned = input.pinned === true;
      if (looksSecret([meta.title || '', ...(meta.tags || [])].join('\n'))) throw error('That looks like a password or key. Secrets belong in the vault, never in memory labels.');
      saved.metadata[id] = meta;
      return { ...record, ...meta };
    });
  }
  async function remember(input, actor) {
    const scope = input.scope === 'me' ? 'member' : input.scope || 'team';
    const people = await members();
    const memberId = actor?.memberId || String(input.memberId || '');
    if (scope === 'member' && !people.some(item => item.id === memberId && !item.removed)) throw error('Choose a current member for a private memory.');
    const workspace = actor ? actor.workspace : String(input.workspace || '');
    if (scope === 'project' && !workspace) throw error('A project memory needs the current project folder.');
    const owner = people.find(item => item.id === actor?.memberId);
    const entry = await teamStore.remember({ text: cleanMemoryText(input.text), scope, memberId, workspace, authorId: actor?.memberId || '', authorName: owner?.name || 'You', source: actor ? 'member' : 'person' });
    collection = undefined;
    if (input.kind || input.groupId || input.tags) await curate(entry.id, { ...(input.kind ? { kind: input.kind } : {}), ...(input.groupId ? { groupId: input.groupId } : {}), ...(input.tags ? { tags: input.tags } : {}) }, actor);
    emit('team.memory.changed', { id: entry.id });
    return entry;
  }
  async function update(id, text, actor, { expectedText } = {}) {
    const record = await get(id, actor);
    if (record.sourceType !== 'team') throw error('This memory is collected from a source. Edit its original file or member profile, then refresh.');
    const entry = await teamStore.updateMemory(id, text, { ...(actor ? { actorId: actor.memberId } : { person: true }), ...(expectedText !== undefined ? { expectedText } : {}) });
    collection = undefined;
    emit('team.memory.changed', { id }); return entry;
  }
  async function forget(id, actor) {
    const record = await get(id, actor);
    if (record.sourceType !== 'team') throw error('This memory is collected from a source. Remove it from its original file or member profile, then refresh.');
    const entry = await teamStore.forget(id, actor ? { actorId: actor.memberId } : { person: true });
    await mutate(saved => { delete saved.metadata[id]; saved.links = saved.links.filter(link => link.from !== id && link.to !== id); });
    emit('team.memory.changed', { id }); return entry;
  }
  async function share(id, memberId, actor, revoke = false) {
    const record = await get(id, actor);
    if (!canChange(record, actor)) throw error('Only the owner or the person can share this memory.', 403);
    if (!(await members()).some(item => item.id === memberId && !item.removed)) throw error('Choose a current teammate.');
    return mutate(saved => {
      const meta = saved.metadata[id] ||= {};
      meta.sharedWith = revoke ? (meta.sharedWith || []).filter(item => item !== memberId) : [...new Set([...(meta.sharedWith || []), memberId])];
      return { id, sharedWith: meta.sharedWith };
    });
  }
  async function relate(input, actor) {
    const [from, to] = await Promise.all([get(input.from, actor), get(input.to, actor)]);
    if (!canChange(from, actor)) throw error('Only the source memory owner or the person can add a relationship.', 403);
    if (from.id === to.id || !MEMORY_RELATIONS.includes(input.relation)) throw error('Choose two different memories and a saved relationship.');
    const evidence = String(input.evidence || '').trim().slice(0, 500);
    if (!evidence) throw error('Say why these memories are related. Text similarity alone is not evidence.');
    if (looksSecret(evidence)) throw error('That looks like a password or key. Secrets belong in the vault, never in memory evidence.');
    return mutate(saved => {
      const existing = saved.links.find(item => item.from === from.id && item.to === to.id && item.relation === input.relation);
      const link = { id: existing?.id || `ml_${randomUUID()}`, from: from.id, to: to.id, relation: input.relation, evidence, derived: false, authorId: actor?.memberId || '', createdAt: new Date().toISOString() };
      if (existing) Object.assign(existing, link); else { if (saved.links.length >= 10_000) throw error('The saved relationship limit has been reached.'); saved.links.push(link); }
      return link;
    });
  }
  async function removeLink(id) { return mutate(saved => { saved.links = saved.links.filter(item => item.id !== id); return { id }; }); }
  return { list, get, remember, update, forget, curate, group, removeGroup, updateSettings, share, relate, removeLink,
    invalidate: () => { collection = undefined; },
    settings: async () => (await state()).settings,
    reindex: async () => { const data = await collect(); return index(data.records); },
    close: () => vectors.close() };
}
