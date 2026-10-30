import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { normalizeMemoryEntries } from '../../src/lib/chief-of-staff.js';
import { looksSecret, memoryKey } from '../team/store.mjs';

export const digest = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
const FILE_BYTES = 512 * 1024;
const MAX_FILES = 300;
export const MAX_RECORDS = 20_000;
export const MAX_COLLECTION_BYTES = 32 * 1024 * 1024;
export const titleFor = text => String(text).split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 100) || 'Untitled memory';

function record(input) {
  const text = String(input.text || '').trim();
  if (!text || looksSecret(text)) return null;
  return { kind: 'memory', tags: [], createdAt: '', updatedAt: '', ...input, text, title: input.title || titleFor(text) };
}
export const teamMemoryRecord = entry => record({ ...entry, ownerId: entry.memberId || entry.authorId || '', sourceType: 'team', sourceKey: 'team', sourceLabel: entry.source === 'person' ? 'Saved by you' : 'Squad MCP', sourceRef: entry.id, workspace: entry.workspace || '' });

export function markdownMemories(content, source) {
  // Headings and paragraphs are searchable documents, rather than one enormous
  // profile blob. Content hashes stop an edited paragraph inheriting old links.
  const seen = new Set();
  let heading = '';
  const records = [];
  for (const paragraph of String(content).split(/\n\s*\n/)) {
    const clean = paragraph.trim();
    if (/^#{1,6}\s+[^\n]+$/.test(clean)) { heading = clean.replace(/^#+\s*/, ''); continue; }
    for (let offset = 0; offset < clean.length; offset += 8000) {
      const text = clean.slice(offset, offset + 8000);
      const key = memoryKey(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const item = record({ ...source, id: `doc:${digest(source.sourceKey + '\0' + key)}`, title: heading || titleFor(text), text });
      if (item) records.push(item);
    }
  }
  return records;
}

async function regularText(path, limit = FILE_BYTES) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only ordinary files can be collected.');
  if (stat.size > limit) throw new Error('The source is too large to collect safely.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size > limit) throw new Error('The source grew past the collection limit.');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error('The source grew past the collection limit.');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    return { content, updatedAt: stat.mtime.toISOString() };
  } finally { await handle.close(); }
}

/** No links, hidden folders, sessions, config files or derived CLI summaries. */
async function markdownFolder(root, source, warnings, add) {
  let files = 0, examined = 0;
  async function walk(directory, depth) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('A collection folder must be an ordinary directory.');
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++examined > 4096) throw new Error('The folder reached the 4096-entry collection limit.');
      if (item.isSymbolicLink() || item.name.startsWith('.')) continue;
      const path = join(directory, item.name);
      if (item.isDirectory() && depth < 3 && await walk(path, depth + 1) === false) return false;
      if (!item.isFile() || !/\.md$/i.test(item.name)) continue;
      if (++files > MAX_FILES) throw new Error(`Only the first ${MAX_FILES} Markdown files were collected.`);
      try {
        const file = await regularText(path);
        if (!add(markdownMemories(file.content, { ...source, sourceKey: path, sourceLabel: relative(root, path), sourcePath: path, updatedAt: file.updatedAt }))) return false;
      } catch (error) { warnings.push({ source: source.sourceKey, ownerId: source.ownerId, message: `${relative(root, path)}: ${error.message}` }); }
    }
  }
  try { await walk(resolve(root), 0); }
  catch (error) { if (error.code !== 'ENOENT') warnings.push({ source: source.sourceKey, ownerId: source.ownerId, message: `${source.sourceLabel}: ${error.message}` }); }
}

async function cliMemories(root, owner, warnings) {
  const source = { sourceType: 'cli', sourceKey: `cli:${owner.id}`, sourceLabel: `${owner.name}'s Autohand memory`, ownerId: owner.id, authorId: owner.id, authorName: owner.name, scope: 'member', workspace: '' };
  let entries = [];
  const path = join(root, 'events', 'LOG.jsonl');
  try {
    const directory = await lstat(root);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('The CLI memory folder must be an ordinary directory.');
    try { const events = await lstat(join(root, 'events')); if (!events.isDirectory() || events.isSymbolicLink()) throw new Error('The CLI events folder must be an ordinary directory.'); }
    catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
  } catch (failure) {
    if (failure.code !== 'ENOENT') warnings.push({ source: source.sourceKey, ownerId: owner.id, message: `${source.sourceLabel}: ${failure.message}` });
    return [];
  }
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) && !value.includes('..');
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const validEntry = entry => entry && safeId(entry.id) && typeof entry.content === 'string' && entry.content.trim() && Buffer.byteLength(entry.content) <= 32 * 1024 && validDate(entry.createdAt) && validDate(entry.updatedAt);
  try {
    const { content } = await regularText(path, 16 * 1024 * 1024);
    if (content && !content.endsWith('\n')) throw new Error('The canonical memory log has an unfinished final event.');
    const events = content.split('\n').map((line, index) => line.trim() ? { ...JSON.parse(line), _line: index + 1 } : null).filter(Boolean);
    if (events.length > 20_000) throw new Error('The event log exceeds the collection limit.');
    const state = new Map(), eventIds = new Set();
    for (const event of events.sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.eventId).localeCompare(String(b.eventId)))) {
      if (event.version !== 1 || event.level !== 'user' || !['create', 'update', 'delete', 'snapshot'].includes(event.operation) || typeof event.eventId !== 'string' || !event.eventId || !validDate(event.occurredAt) || eventIds.has(event.eventId)) throw new Error('The canonical memory event log is incomplete or unsupported.');
      eventIds.add(event.eventId);
      const id = event.memoryId || event.entry?.id;
      if (!safeId(id)) throw new Error('A memory event has no valid identity.');
      if (event.operation === 'delete') { if (event.entry) throw new Error('A deleted memory event contains an unexpected body.'); state.delete(id); }
      else {
        if (!validEntry(event.entry) || event.entry.id !== id) throw new Error('A memory event has no valid entry.');
        if (event.operation !== 'snapshot' || !state.has(id)) state.set(id, { ...event.entry, _sourcePath: path, _line: event._line });
      }
    }
    entries = [...state.values()];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warnings.push({ source: source.sourceKey, ownerId: owner.id, message: `${source.sourceLabel}: ${error.message} No stale summaries were used.` });
      return [];
    }
    // Legacy projections are authoritative only when no event log exists.
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The CLI memory folder is not an ordinary directory.');
      const allFiles = (await readdir(root, { withFileTypes: true })).filter(file => file.isFile() && file.name.endsWith('.json') && file.name !== 'index.json');
      if (allFiles.length > MAX_FILES) warnings.push({ source: source.sourceKey, ownerId: owner.id, message: `${source.sourceLabel}: only the first ${MAX_FILES} legacy memory files were collected.` });
      let bytes = 0;
      for (const file of allFiles.slice(0, MAX_FILES)) {
        const sourcePath = join(root, file.name), value = await regularText(sourcePath);
        bytes += Buffer.byteLength(value.content);
        if (bytes > 16 * 1024 * 1024) throw new Error('The legacy memory collection is too large.');
        const entry = JSON.parse(value.content);
        if (validEntry(entry) && `${entry.id}.json` === file.name) entries.push({ ...entry, _sourcePath: sourcePath });
        else warnings.push({ source: source.sourceKey, ownerId: owner.id, message: `${source.sourceLabel}: ${file.name} is not a valid canonical entry.` });
      }
    } catch (failure) { if (failure.code !== 'ENOENT') warnings.push({ source: source.sourceKey, ownerId: owner.id, message: `${source.sourceLabel}: ${failure.message}` }); }
  }
  return entries.map(entry => record({ ...source, id: `cli:${digest(owner.id + '\0' + entry.id)}`, text: entry.content, kind: ['turn-reflection', 'session-extraction'].includes(entry.source) ? 'lesson' : 'memory', tags: Array.isArray(entry.tags) ? entry.tags.filter(tag => typeof tag === 'string').slice(0, 20) : [], createdAt: entry.createdAt || '', updatedAt: entry.updatedAt || '', sourcePath: entry._sourcePath || path, sourceLine: entry._line, sourceRef: entry.id, declaredSource: entry.source || '', sessionId: entry.origin?.sessionId || '' })).filter(Boolean);
}

export async function collectMemories({ members, teamStore, settings, agentsDir }) {
  const records = [], warnings = [], sources = [];
  let bytes = 0, exhausted = false;
  function add(items) {
    for (const item of items) {
      const size = Buffer.byteLength(item.text, 'utf8');
      if (records.length >= MAX_RECORDS || bytes + size > MAX_COLLECTION_BYTES) {
        if (!exhausted) warnings.push({ source: 'collection', message: 'The memory collection reached its 20,000-record or 32 MiB text limit. Narrow the collection sources in Settings. Source files are unchanged.' });
        exhausted = true; return false;
      }
      records.push(item); bytes += size;
    }
    return true;
  }
  const people = (await members()).filter(member => member?.id && !member.removed);
  const team = await teamStore.read();
  if (settings.team) {
    sources.push({ id: 'team', label: 'Shared and scoped memories', enabled: true });
    for (const entry of team.memory) {
      const item = teamMemoryRecord(entry);
      if (item && !add([item])) break;
    }
  }
  for (const member of people) {
    if (exhausted) break;
    const source = { ownerId: member.id, authorId: member.id, authorName: member.name, scope: 'member', workspace: '', sourceHref: `/squad-members/${encodeURIComponent(member.id)}/memory` };
    const keys = new Set();
    if (settings.members) {
      sources.push({ id: `member:${member.id}`, label: `${member.name}'s saved memories`, ownerId: member.id, enabled: true });
      for (const entry of normalizeMemoryEntries(member.memory)) {
        const item = record({ ...source, id: `member:${digest(member.id + '\0' + entry.id)}`, text: entry.text, createdAt: entry.at || '', sourceType: 'member', sourceKey: `member:${member.id}`, sourceLabel: 'Member memory', sourceRef: entry.id });
        if (item) { if (!add([item])) break; keys.add(memoryKey(item.text)); }
      }
    }
    if (settings.profiles && !exhausted) {
      for (const file of (member.profileFiles || []).filter(file => file.section === 'memory')) {
        const docs = markdownMemories(file.content, { ...source, sourceType: 'profile', sourceKey: `profile:${member.id}:${file.fileName || 'MEMORY.md'}`, sourceLabel: file.fileName || 'MEMORY.md', updatedAt: member.updatedAt || '' });
        if (!add(docs.filter(item => !keys.has(memoryKey(item.text.replace(/^[-*]\s*/, '')))))) break;
      }
    }
    if (settings.cli && !exhausted) add(await cliMemories(join(agentsDir, member.id, 'memory'), member, warnings));
  }
  for (const folder of settings.folders || []) {
    if (exhausted) break;
    sources.push({ id: folder.id, label: folder.label || basename(folder.path), enabled: true, path: folder.path });
    await markdownFolder(folder.path, { sourceKey: folder.id, sourceType: 'folder', sourceLabel: folder.label || basename(folder.path), scope: 'team', ownerId: '', authorId: '', authorName: 'You', workspace: '' }, warnings, add);
  }
  if (records.length > MAX_RECORDS) warnings.push({ source: 'collection', message: `Showing the first ${MAX_RECORDS} memories. Narrow the collection sources in Settings.` });
  return { records: records.slice(0, MAX_RECORDS), warnings, sources, members: people.map(({ id, name, role, color, avatar, workspace, projects }) => ({ id, name, role, color, avatar, workspace, projects })) };
}
