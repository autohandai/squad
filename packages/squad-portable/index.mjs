import { z } from 'zod';
import { parseDocument, stringify } from 'yaml';

export const FORMAT = 'autohand-squad';
export const SCHEMA_VERSION = 1;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { status: 400, code: 'invalid_backup' });
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/);
const jsonObject = z.record(z.string(), z.json());
const safePath = value => value.length <= 1024 && !/[\\:<>"|?*\x00-\x1f\x7f]/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

export const ownerSchema = z.object({ kind: z.enum(['user', 'team']), issuer: z.url().max(1024), id }).strict();
export const fileSchema = z.object({
  id, path: z.string().max(1024).regex(/^(?!\/)[^\\:<>"|?*\x00-\x1f\x7f]+$/, 'Use a portable relative file path.').refine(safePath, 'Use a portable relative file path.'),
  kind: z.enum(['profile', 'memory', 'skill', 'artifact', 'attachment', 'conversation', 'other']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(MAX_FILE_BYTES),
  mediaType: z.string().max(200).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/),
}).strict();
export const agentSchema = z.object({
  id, profile: jsonObject,
  memories: z.array(jsonObject).max(20_000), conversations: z.array(jsonObject).max(20_000),
  routines: z.array(jsonObject).max(10_000), skills: z.array(jsonObject).max(10_000),
  files: z.array(fileSchema).max(20_000), extensions: jsonObject.default({}),
}).strict();
export const stateSchema = z.object({
  shared: z.object({ data: jsonObject, files: z.array(fileSchema).max(20_000) }).strict(),
  workspaces: z.array(z.object({ id, label: z.string().max(200), pathHint: z.string().max(4096) }).strict()).max(10_000),
  omissions: z.array(z.object({ path: z.string().max(4096), reason: z.string().min(1).max(2000) }).strict()).max(100_000),
  extensions: jsonObject.default({}),
}).strict();
export const manifestSchema = stateSchema.extend({
  format: z.literal(FORMAT), schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: z.iso.datetime(), owner: ownerSchema,
  agents: z.array(agentSchema).max(10_000),
}).strict();
export const backupSchema = manifestSchema.extend({
  files: z.array(z.object({ agentId: id.nullable(), id, encoding: z.literal('base64'), content: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4 + MAX_FILE_BYTES / 50) }).strict()).max(100_000),
});
export function backupJsonSchema() {
  return { ...z.toJSONSchema(backupSchema, { target: 'draft-2020-12' }),
    $id: 'https://squad.autohand.ai/schemas/squad-backup-v1.json', title: 'Autohand Squad portable backup v1' };
}

// JSON/YAML share exactly this model. Reject keys that become dangerous when
// another consumer merges an imported profile into ordinary JS objects.
function checkKeys(value, depth = 0, budget = { left: 2_000_000 }) {
  if (depth > 64 || --budget.left < 0) throw fail('The backup exceeds its nesting or object limit.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw fail(`Unsafe object key: ${key}.`);
    checkKeys(child, depth + 1, budget);
  }
}
export function checkStructure(value, maxNodes = 2_000_000) { checkKeys(value, 0, { left: maxNodes }); }
export function validateAgent(value) {
  checkKeys(value);
  const parsed = agentSchema.safeParse(value);
  if (!parsed.success) throw fail(`Invalid agent document: ${parsed.error.issues[0]?.message || 'validation failed'}`);
  inventory({ agents: [parsed.data], shared: { files: [] } });
  return parsed.data;
}
export function inventory(manifest) {
  const agents = new Set(), files = new Map(), paths = new Map(), hashes = new Map();
  for (const agent of manifest.agents) {
    if (agents.has(agent.id)) throw fail(`Duplicate agent ID: ${agent.id}.`);
    agents.add(agent.id);
  }
  const scoped = [...manifest.agents.flatMap(agent => agent.files.map(file => ({ ...file, agentId: agent.id }))), ...manifest.shared.files.map(file => ({ ...file, agentId: null }))];
  if (scoped.length > 100_000) throw fail('A portable document may contain up to 100,000 files. Select fewer agents; nothing was truncated.');
  for (const file of scoped) {
    const key = JSON.stringify([file.agentId, file.id]);
    if (files.has(key)) throw fail(`Duplicate file ID: ${file.id}.`);
    if (hashes.has(file.sha256) && hashes.get(file.sha256) !== file.bytes) throw fail(`Conflicting byte count for ${file.path}.`);
    hashes.set(file.sha256, file.bytes);
    const path = JSON.stringify([file.agentId, file.path.normalize('NFC').toLowerCase()]);
    if (paths.has(path)) throw fail(`Duplicate portable path: ${file.path}.`);
    paths.set(path, file.id); files.set(key, file);
  }
  return [...files.values()];
}
export function validateManifest(value) {
  checkKeys(value);
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw fail(`Invalid Squad backup manifest: ${parsed.error.issues[0]?.message || 'validation failed'}`);
  inventory(parsed.data);
  return parsed.data;
}
export function validateState(value) {
  checkKeys(value);
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) throw fail(`Invalid Squad state: ${parsed.error.issues[0]?.message || 'validation failed'}`);
  inventory({ agents: [], shared: parsed.data.shared });
  return parsed.data;
}
export function validateBackup(value) {
  checkKeys(value);
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success) throw fail(`Unsupported or invalid Squad backup: ${parsed.error.issues[0]?.message || 'validation failed'}`);
  const expected = new Map(inventory(parsed.data).map(file => [JSON.stringify([file.agentId, file.id]), file]));
  for (const file of parsed.data.files) {
    if (!expected.delete(JSON.stringify([file.agentId, file.id]))) throw fail(`Unexpected or duplicate file payload: ${file.id}.`);
  }
  if (expected.size) throw fail(`Missing file contents: ${expected.keys().next().value}.`);
  return parsed.data;
}
export function decodeFile(file) {
  const text = file.content.replace(/[\r\n ]/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw fail(`Invalid base64 for ${file.id}.`);
  let binary;
  try { binary = atob(text); } catch { throw fail(`Invalid base64 for ${file.id}.`); }
  if (btoa(binary) !== text) throw fail(`Noncanonical base64 for ${file.id}.`);
  if (binary.length > MAX_FILE_BYTES) throw fail(`File ${file.id} exceeds the file-size limit.`);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyBackup(value) {
  const document = validateBackup(value), refs = new Map(inventory(document).map(file => [JSON.stringify([file.agentId, file.id]), file]));
  for (const file of document.files) {
    const bytes = decodeFile(file), ref = refs.get(JSON.stringify([file.agentId, file.id]));
    if (bytes.byteLength !== ref.bytes || await sha256(bytes) !== ref.sha256) throw fail(`File integrity check failed: ${ref.path}.`);
    file.content = file.content.replace(/[\r\n ]/g, '');
  }
  return document;
}
export async function parseBackup(text, format) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw fail('The backup exceeds the documented size limit.');
  let value;
  if (format === 'json') {
    try { value = JSON.parse(text); } catch { throw fail('The backup is not valid JSON.'); }
    const doc = parseDocument(text, { uniqueKeys: true, stringKeys: true });
    if (doc.errors.length) throw fail('JSON backup keys must be unique.');
  } else if (format === 'yaml') {
    const doc = parseDocument(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, stringKeys: true, customTags: [], resolveKnownTags: false, merge: false });
    if (doc.errors.length || doc.warnings.length) throw fail('The YAML backup contains unsupported tags, keys or syntax.');
    try { value = doc.toJS({ maxAliasCount: 0 }); } catch { throw fail('YAML aliases are not allowed in backups.'); }
  } else throw fail('Choose json or yaml.');
  return verifyBackup(value);
}
export function encodeBackup(value, format) {
  const document = validateBackup(value);
  if (format === 'json') return `${JSON.stringify(document, null, 2)}\n`;
  if (format === 'yaml') return stringify(document, { version: '1.2', aliasDuplicateObjects: false, lineWidth: 0 });
  throw fail('Choose json or yaml.');
}

function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
async function* encodedChunks(source) {
  let carry = new Uint8Array();
  for await (const chunk of source) {
    let offset = 0;
    if (carry.length) {
      const take = Math.min(3 - carry.length, chunk.length);
      const next = new Uint8Array(carry.length + take);
      next.set(carry); next.set(chunk.subarray(0, take), carry.length);
      offset = take; carry = next;
      if (carry.length === 3) { yield base64(carry); carry = new Uint8Array(); }
    }
    const end = offset + Math.floor((chunk.length - offset) / 3) * 3;
    for (; offset < end; offset += 49152) yield base64(chunk.subarray(offset, Math.min(end, offset + 49152)));
    if (end < chunk.length) carry = chunk.slice(end);
  }
  if (carry.length) yield base64(carry);
}
// readFile returns an async byte source, so a whole team's binary contents
// never need to be materialized in a Worker or held twice by a Node exporter.
export async function* streamBackup(value, format, readFile, { createDigest } = {}) {
  const manifest = validateManifest(value), refs = inventory(manifest);
  if (!['json', 'yaml'].includes(format)) throw fail('Choose json or yaml.');
  if (format === 'json') yield `${JSON.stringify(manifest).slice(0, -1)},"files":[`;
  else yield `${stringify(manifest, { aliasDuplicateObjects: false, lineWidth: 0 })}files:${refs.length ? '' : ' []'}\n`;
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index];
    if (format === 'json') yield `${index ? ',' : ''}{"agentId":${JSON.stringify(ref.agentId)},"id":${JSON.stringify(ref.id)},"encoding":"base64","content":"`;
    else yield `  - agentId: ${JSON.stringify(ref.agentId)}\n    id: ${JSON.stringify(ref.id)}\n    encoding: base64\n    content: "`;
    let size = 0;
    let digest;
    if (createDigest) digest = createDigest(ref);
    else {
      const bytes = new Uint8Array(ref.bytes); let offset = 0;
      digest = { write(chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; }, finish: () => sha256(bytes) };
    }
    async function* counted() {
      const source = await readFile(ref);
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > ref.bytes || size > MAX_FILE_BYTES) throw fail(`File changed during export: ${ref.path}.`);
        await digest.write(chunk);
        yield chunk;
      }
    }
    let finished = false;
    try {
      for await (const chunk of encodedChunks(counted())) yield chunk;
      if (size !== ref.bytes) throw fail(`File changed during export: ${ref.path}.`);
      if (await digest.finish() !== ref.sha256) throw fail(`File integrity check failed during export: ${ref.path}.`);
      finished = true;
    } finally { if (!finished) await digest.cancel?.(); }
    yield format === 'json' ? '"}' : '"\n';
  }
  yield format === 'json' ? ']}\n' : '';
}
