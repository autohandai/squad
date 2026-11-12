import { copyFile, readFile } from 'node:fs/promises';
import { readPersistentJson, writePersistentJson } from './persistent-json.mjs';
import { conversationLifecycle, isGroupChat } from '../src/lib/group-chats.js';

export function channelError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Lifecycle changes are explicit operations, not legacy cache reconciliation.
function preserveConversationLifecycle(incoming, current) {
  const { kind, groupCreation: _creation, groupConversion: incomingConversion, ...content } = incoming;
  const changedKind = current && (kind || 'channel') !== (current.kind || 'channel');
  const staleConversion = current?.groupConversion && incomingConversion?.requestHash !== current.groupConversion.requestHash;
  return { ...content, ...conversationLifecycle(current),
    ...(changedKind || staleConversion ? { name: current.name, visibility: current.visibility } : {}) };
}

// Index just past the first complete JSON value, honouring strings and escapes;
// -1 when the text never closes one.
function firstDocumentEnd(text) {
  let depth = 0, inString = false, escaped = false, started = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') { depth++; started = true; }
    else if (char === '}' || char === ']') { depth--; if (started && depth === 0) return index + 1; }
  }
  return -1;
}

// 0.1.5 wrote channels.json from two unserialised writers (the git mirror and
// the snapshot PUT). When a shorter document overwrote a longer one, the old
// closing brace survived after the new document and every later read failed.
// That exact shape, one complete document followed only by stray closers, is
// recovered here with the original kept beside it (ADR-0082). Any other
// damage still refuses writes: this never guesses at missing records.
async function recoverTornTail(filename, error) {
  const raw = await readFile(filename, 'utf8');
  const end = firstDocumentEnd(raw);
  if (end < 0) return null;
  const tail = raw.slice(end);
  if (!/^[\s\]}]*$/.test(tail) || !/[\]}]/.test(tail)) return null;
  let value;
  try { value = JSON.parse(raw.slice(0, end)); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const backup = `${filename}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(filename, backup);
  await writePersistentJson(filename, value);
  console.warn(`channels: recovered ${filename} after trailing content (${error.message}); the original is kept at ${backup}`);
  return value;
}

// All writers share this queue, including git/relay and legacy snapshot sync.
// A failed operation leaves the last committed document intact and does not
// poison the queue. Atomic rename prevents readers seeing a partial JSON file.
export function createChannelsStore({ filename, normalize, changed }) {
  let queue = Promise.resolve();
  let recovery = null;
  const read = async () => {
    try { return normalize(await readPersistentJson(filename, {})); }
    catch (error) {
      if (error instanceof SyntaxError) {
        // One recovery at a time: concurrent readers share the same attempt so
        // the file is backed up and rewritten once.
        recovery ||= recoverTornTail(filename, error).finally(() => { recovery = null; });
        const recovered = await recovery;
        if (recovered) return normalize(recovered);
        throw Object.assign(channelError('Saved channel history is damaged. Your data has been kept; restore the saved file from a backup before saving channels.', 409), { cause: error });
      }
      throw error;
    }
  };
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const mutate = operation => serialize(async () => {
    const state = await read();
    const before = JSON.stringify(state);
    const result = await operation(state);
    if (JSON.stringify(state) === before) return result;
    const next = normalize(state);
    next.revision = state.revision + 1;
    next.updatedAt = new Date().toISOString();
    await writePersistentJson(filename, next);
    changed?.();
    return result;
  });
  const replace = input => serialize(async () => {
    const current = await read();
    if (input?.revision !== undefined && input.revision !== current.revision) {
      throw channelError('Channels changed in another window. Reload before saving this snapshot.', 409);
    }
    const source = Array.isArray(input) ? { channels: input } : input;
    let next = normalize({ ...source, deletedChannelIds: current.deletedChannelIds || [] });
    if (Array.isArray(next.channels)) {
      const deleted = new Set(current.deletedChannelIds || []);
      const incomingIds = new Set(next.channels.map(channel => channel.id));
      const managed = (current.channels || []).filter(channel => isGroupChat(channel) || channel.groupCreation || channel.groupConversion);
      const omitted = managed.filter(channel => !incomingIds.has(channel.id));
      const managedIds = new Set(managed.map(channel => channel.id));
      next.channels.push(...omitted);
      // A client which cannot represent a group cannot delete its history by
      // omitting it. Only the explicit group/channel delete owns that action.
      for (const key of ['threads', 'messages']) if (Array.isArray(next[key])) {
        const incomingRecords = new Set(next[key].map(record => record.id));
        next[key].push(...(current[key] || []).filter(record => managedIds.has(record.channelId) && !incomingRecords.has(record.id)));
      }
      next.channels = next.channels.filter(channel => !deleted.has(channel.id))
        .map(channel => preserveConversationLifecycle(channel, current.channels?.find(item => item.id === channel.id)));
      next = normalize(next);
    }
    // Legacy browser snapshots are not authority for permission grants,
    // proposals or execution receipts, even if they include these fields.
    next.agentChannelAccess = current.agentChannelAccess;
    next.agentChannelActions = current.agentChannelActions;
    next.revision = current.revision + 1;
    next.updatedAt = new Date().toISOString();
    await writePersistentJson(filename, next);
    changed?.();
    return next;
  });
  const sync = input => mutate(state => {
    const incoming = normalize({ ...input, channels: Array.isArray(input?.channels) ? input.channels : state.channels });
    const deleted = new Set(state.deletedChannelIds);
    for (const key of ['channels', 'threads', 'messages']) {
      const records = new Map(state[key].map(record => [record.id, record]));
      for (const record of incoming[key]) {
        if (deleted.has(key === 'channels' ? record.id : record.channelId)) continue;
        const existing = records.get(record.id);
        if (!existing || String(record.updatedAt) > String(existing.updatedAt)) records.set(record.id, key === 'channels' ? preserveConversationLifecycle(record, existing) : record);
      }
      state[key] = [...records.values()];
    }
    return state;
  });
  return { read, mutate, replace, sync };
}
