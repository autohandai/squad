import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { backupJsonSchema, parseBackup, encodeBackup, verifyBackup, streamBackup, sha256, validateManifest } from '../packages/squad-portable/index.mjs';

const bytes = Uint8Array.from([0, 255, 17, 33, 128, 0, 10, 13, ...new TextEncoder().encode('Memory: Æ Eva 世界')]);
const file = { id: 'eva-file', path: 'members/eva/memory/MEMORY.md', kind: 'memory', sha256: await sha256(bytes), bytes: bytes.byteLength, mediaType: 'application/octet-stream' };
const agent = { id: 'eva', profile: { name: 'Eva', personality: 'Practical', harness: { id: 'claude' }, future: { provider: 'other-tool' } }, memories: [{ id: 'm1', text: 'Preserve exact knowledge.' }], conversations: [{ id: 'chat1', messages: [{ role: 'user', body: 'Original question' }] }], routines: [{ id: 'routine1', enabled: true }], skills: [{ id: 'skill1', instructions: 'Use the actual evidence.' }], files: [file], extensions: { 'example.org': { revision: 7 } } };
const manifest = { format: 'autohand-squad', schemaVersion: 1, createdAt: new Date().toISOString(), owner: { kind: 'user', issuer: 'https://api.autohand.ai', id: 'alice' }, agents: [agent], shared: { data: { memories: [{ id: 'team-memory', text: 'Shared knowledge' }] }, files: [] }, workspaces: [{ id: 'work1', label: 'Project', pathHint: '/previous/computer/project' }], omissions: [{ path: 'auth.json', reason: 'Machine credentials are excluded.' }], extensions: { 'example.org': { portable: true } } };
const document = { ...manifest, files: [{ agentId: agent.id, id: file.id, encoding: 'base64', content: Buffer.from(bytes).toString('base64') }] };
const collect = async source => { let text = ''; for await (const chunk of source) text += chunk; return text; };
for (const format of ['json', 'yaml']) {
  assert.deepEqual(await parseBackup(encodeBackup(document, format), format), document);
  for (const chunkSize of [1, 2, 3, 7, bytes.byteLength]) {
    const text = await collect(streamBackup(manifest, format, async () => ({ async *[Symbol.asyncIterator]() { for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.slice(i, i + chunkSize); } })));
    assert.deepEqual(await parseBackup(text, format), document, `${format}: preserve binary data across ${chunkSize}-byte chunk boundaries`);
  }
  const empty = { ...manifest, agents: [] };
  assert.deepEqual(await parseBackup(await collect(streamBackup(empty, format, async () => assert.fail('no file read expected'))), format), { ...empty, files: [] });
}
await assert.rejects(verifyBackup({ ...document, files: [{ ...document.files[0], content: Buffer.from('wrong').toString('base64') }] }), /integrity/);
await assert.rejects(verifyBackup({ ...document, files: [] }), /Missing file/);
await assert.rejects(verifyBackup({ ...document, files: [...document.files, document.files[0]] }), /duplicate file/);
assert.throws(() => validateManifest({ ...manifest, agents: [agent, agent] }), /Duplicate agent/);
for (const path of ['../escape', '/absolute', 'C:/windows', 'a\\escape', 'a/../escape', 'a//empty', 'a/CON.txt', 'a/file.', 'a/file ', 'a/file?.txt', 'a/<file>.txt']) {
  assert.throws(() => validateManifest({ ...manifest, agents: [{ ...agent, files: [{ ...file, path }] }] }), /relative file path/);
}
assert.throws(() => validateManifest({ ...manifest, agents: [{ ...agent, files: [file, { ...file, id: 'other', path: file.path.toUpperCase() }] }] }), /Duplicate portable path/);
assert.throws(() => validateManifest({ ...manifest, agents: [{ ...agent, files: [{ ...file, mediaType: 'text/plain\r\nx-extra: injected' }] }] }), /Invalid Squad backup/);
const twoMembers = { ...manifest, agents: [agent, { ...agent, id: 'noah' }] };
assert.equal(validateManifest(twoMembers).agents.length, 2, 'different agents may use the same relative file path and ID');
const unsafe = JSON.parse(JSON.stringify(document));
Object.defineProperty(unsafe.agents[0].profile, '__proto__', { value: { polluted: true }, enumerable: true });
assert.throws(() => encodeBackup(unsafe, 'json'), /Unsafe object key/);
for (const text of ['a: &a [1]\nb: *a', 'a: 1\na: 2', 'a: !!js/function "function() {}"', '__proto__: {polluted: true}', 'a: !custom abc']) {
  await assert.rejects(parseBackup(text, 'yaml'), /aliases|keys|syntax|Unsafe|invalid/i);
}
await assert.rejects(parseBackup('{"format":"x","format":"autohand-squad"}', 'json'), /unique/);
await assert.rejects(parseBackup(JSON.stringify({ ...document, schemaVersion: 2 }), 'json'), /Unsupported/);
await assert.rejects(collect(streamBackup(manifest, 'json', async () => ({ async *[Symbol.asyncIterator]() { yield new Uint8Array(bytes.length); } }))), /integrity/);
const schema = backupJsonSchema();
await writeFile(fileURLToPath(new URL('../packages/squad-portable/squad-backup.schema.json', import.meta.url)), `${JSON.stringify(schema, null, 2)}\n`);
console.log('Portable Squad backups: JSON/YAML and streaming binary round trips, hostile inputs, path safety and checksums passed.');
