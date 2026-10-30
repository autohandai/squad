import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const root = process.argv.includes('--packaged') ? resolve('src-tauri/runtime') : process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'squad-memory-check-'));
const moduleAt = path => import(pathToFileURL(join(root, path)).href);
const [{ createMemoryService }, { createMemoryVectorClient }, { collectMemories }, { createTeamService }, { handle: teamRoute }] = await Promise.all([moduleAt('server/memory/service.mjs'), moduleAt('server/memory/vector-client.mjs'), moduleAt('server/memory/collect.mjs'), moduleAt('server/team/service.mjs'), moduleAt('server/routes/team.route.mjs')]);
if (process.argv.includes('--packaged') && !process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY) process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY = resolve(`daemon/target/debug/autohand-squad-daemon${process.platform === 'win32' ? '.exe' : ''}`);
if (process.argv.includes('--release')) process.env.AUTOHAND_SQUAD_MEMORY_INDEX_BINARY = resolve(`daemon/target/release/autohand-squad-daemon${process.platform === 'win32' ? '.exe' : ''}`);
const date = '2026-10-29T00:00:00.000Z';
const people = [{ id: 'iris', name: 'Iris', memory: [{ id: 'legacy-entry', text: 'Iris reviews accessibility and keyboard focus.', at: date }], profileFiles: [{ section: 'memory', fileName: 'MEMORY.md', content: '# Release lessons\n\nTest native replacement before publishing a desktop release.' }] }, { id: 'kai', name: 'Kai', memory: ['Kai keeps deployments reversible.'], profileFiles: [] }];
let library;
const team = createTeamService({ stateDir: directory, rootDir: root, bridgeUrl: 'http://127.0.0.1:1', members: async () => people, memoryLibrary: () => library, emit: () => {} });
const agentsDir = join(directory, 'agents');
const create = () => createMemoryService({ stateDir: directory, rootDir: root, agentsDir, members: async () => people, teamStore: team.store });
const own = { memberId: 'iris', workspace: '/fixture/one' }, other = { memberId: 'kai', workspace: '/fixture/two' };
const event = (operation, id, text, sequence) => ({ version: 1, eventId: `event-${sequence}`, operation, level: 'user', occurredAt: `2026-10-29T00:00:${String(sequence).padStart(2, '0')}.000Z`, memoryId: id, ...(operation === 'delete' ? {} : { entry: { id, content: text, createdAt: date, updatedAt: date, tags: ['release'] } }) });
const log = join(agentsDir, 'iris', 'memory', 'events', 'LOG.jsonl');
let server, proxy;
const rpcWaiting = new Map();
try {
  await mkdir(join(log, '..'), { recursive: true });
  const events = [event('create', 'retained', 'The CLI remembers that release checks must use native binaries.', 1), event('create', 'removed', 'This deleted source must never be found.', 2), event('delete', 'removed', '', 3)];
  await writeFile(log, events.map(JSON.stringify).join('\n') + '\n');
  await mkdir(join(agentsDir, 'iris', 'memory', 'derived', 'summaries', 'user'), { recursive: true });
  await writeFile(join(agentsDir, 'iris', 'memory', 'derived', 'summaries', 'user', 'old.json'), JSON.stringify({ content: 'stale fabricated summary' }));
  library = create();
  const shared = await library.remember({ text: 'The release pipeline validates native desktop packages.', scope: 'team' }, own);
  const privateRecord = await library.remember({ text: 'Iris keeps a private review rubric.', scope: 'me' }, own);
  const project = await library.remember({ text: 'Project one uses the scoped release workspace.', scope: 'project' }, own);
  const snapshot = await library.list();
  assert.equal(snapshot.index.engine, 'turbovec'); assert.equal(snapshot.index.available, true); assert.equal(snapshot.index.version, '1.1.2');
  for (const source of ['team', 'member', 'profile', 'cli']) assert(snapshot.records.some(item => item.sourceType === source), `Collect ${source} memories`);
  assert(!JSON.stringify(snapshot).includes('stale fabricated summary'));
  assert(!snapshot.records.some(item => item.text.includes('deleted source')));
  const cli = snapshot.records.find(item => item.sourceType === 'cli'); assert.equal(cli.sourceLine, 1);
  const ownResult = await library.list({ actor: own, query: 'native release binaries' });
  assert(ownResult.records.some(item => item.id === cli.id), 'Real TurboVec phrase features retrieve the CLI memory');
  const others = await library.list({ actor: other });
  assert(!others.records.some(item => [privateRecord.id, project.id, cli.id].includes(item.id)));
  assert(others.records.some(item => item.id === shared.id));
  await assert.rejects(library.get(privateRecord.id, other), /not available/);
  await assert.rejects(library.update(shared.id, 'Changed by Kai', other), /Only the member/);
  await assert.rejects(library.curate(privateRecord.id, { title: 'Stolen' }, other), /not available/);
  await assert.rejects(library.share(privateRecord.id, 'kai', other), /not available/);
  await library.share(privateRecord.id, 'kai', own);
  assert.equal((await library.get(privateRecord.id, other)).text, privateRecord.text);
  await library.share(privateRecord.id, 'kai', own, true);
  await assert.rejects(library.get(privateRecord.id, other), /not available/);
  await assert.rejects(library.relate({ from: shared.id, to: privateRecord.id, relation: 'supports', evidence: '' }, own), /Say why/);
  const link = await library.relate({ from: shared.id, to: privateRecord.id, relation: 'supports', evidence: 'The review rubric covers the package gate.' }, own);
  assert((await library.list({ actor: own })).links.some(item => item.id === link.id && !item.derived));
  assert(!(await library.list({ actor: other })).links.some(item => item.id === link.id), 'Links do not leak hidden endpoint IDs');
  const group = await library.group({ name: 'Release knowledge', color: '#8c9fca' });
  await library.curate(shared.id, { groupId: group.id, tags: ['release', 'verified'], kind: 'decision' }, own);
  assert.equal((await library.list({ group: group.id })).records.length, 1);
  assert.equal((await library.get(shared.id)).kind, 'decision');
  await library.update(shared.id, 'The release pipeline now checks update rollback.', own);
  await assert.rejects(library.update(shared.id, 'An obsolete edit must not win.', own, { expectedText: 'The release pipeline validates native desktop packages.' }), /changed while you were editing/);
  assert((await library.list({ query: 'rollback' })).records.some(item => item.id === shared.id));
  assert(!(await library.list()).records.find(item => item.id === shared.id).text.includes('validates native'));
  await library.updateSettings({ colors: { iris: '#ff9900' } });
  library.close(); library = create();
  assert.equal((await library.get(shared.id)).groupId, group.id); assert.equal((await library.settings()).colors.iris, '#ff9900');
  assert.equal((await library.list()).index.available, true, 'Real persisted vector cache reloads');
  await library.removeGroup(group.id); assert.equal((await library.get(shared.id)).groupId, undefined); assert.equal((await library.get(shared.id)).text, 'The release pipeline now checks update rollback.');

  // Existing corrupt/torn canonical logs must not resurrect JSON projections.
  const projection = join(agentsDir, 'iris', 'memory', 'retained.json');
  await writeFile(projection, JSON.stringify(events[0].entry));
  await writeFile(log, JSON.stringify(events[0]));
  const corrupt = await library.list();
  assert(corrupt.warnings.some(item => item.message.includes('unfinished final event')));
  assert(!corrupt.records.some(item => item.id === cli.id));
  await rm(log);
  assert((await library.list()).records.some(item => item.id === cli.id), 'Absent log permits validated legacy memory');
  await writeFile(log, ''); assert(!(await library.list()).records.some(item => item.id === cli.id), 'Empty canonical log supersedes legacy data');

  const folder = join(directory, 'shared-markdown'); await mkdir(folder);
  await writeFile(join(folder, 'TEAM.md'), '# Team standards\n\nUse accessible names for all graph controls.\n\nKeep memory provenance next to every source.\n');
  await writeFile(join(folder, 'secret.md'), 'api_key: sk-example_fixture_sensitive_123456789');
  if (process.platform !== 'win32') await symlink(projection, join(folder, 'linked.md'));
  await library.updateSettings({ folders: [{ path: folder, label: 'Team handbook' }] });
  const folderRecords = (await library.list()).records.filter(item => item.sourceType === 'folder');
  assert.equal(folderRecords.length, 2); assert(folderRecords.every(item => item.scope === 'team'));
  await writeFile(join(folder, 'UNICODE.md'), '# Unicode recall\n\n' + '記憶の出典を確認してから共有します。'.repeat(700));
  const unicode = await library.list({ similarity: true }); assert(unicode.index.available, unicode.index.error); assert(unicode.records.some(item => item.sourceType === 'folder' && item.title === 'Unicode recall'));
  await writeFile(join(folder, 'TEAM.md'), '# Team standards\n\nUse the current accessible labels.\n');
  const reconciled = await library.list();
  assert(!reconciled.records.some(item => folderRecords.some(old => old.id === item.id)), 'Edited paragraph identities and stale vector IDs are reconciled');
  await library.updateSettings({ profiles: false, cli: false, folders: [] });
  assert(!(await library.list()).records.some(item => ['profile', 'cli', 'folder'].includes(item.sourceType)));
  assert((await readFile(join(directory, 'team.json'), 'utf8')).includes('rollback'), 'Turning collection off never deletes source memories');
  await library.updateSettings({ team: false });
  await library.update(shared.id, 'Canonical team updates still work when collection is disabled.', own);
  assert.equal((await library.get(shared.id, own)).text, 'Canonical team updates still work when collection is disabled.');
  await library.update(shared.id, 'The release pipeline now checks update rollback.', own);
  await library.updateSettings({ team: true });

  // Actual managed stdio MCP -> HTTP route -> shared library -> native vector
  // runtime, with credentials issued by the normal per-work service.
  server = createServer(async (req, res) => {
    const ctx = { team, readBody: async request => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks)); }, json: (response, status, payload) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)); } };
    await teamRoute(req, res, new URL(req.url, 'http://127.0.0.1'), ctx);
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const work = await team.openWork({ memberId: 'iris', workspace: '/fixture/one', runId: 'memory-proof' });
  const env = { ...work.mcpServer.env, AUTOHAND_SQUAD_TEAM_URL: `http://127.0.0.1:${server.address().port}/api/team/mcp` };
  proxy = spawn(process.execPath, ['server/team/mcp-server.mjs', '--mcp'], { cwd: root, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: proxy.stdout }).on('line', line => { const result = JSON.parse(line); rpcWaiting.get(result.id)?.(result); });
  let rpcSequence = 0;
  const rpc = (method, params = {}) => new Promise((resolveRpc, reject) => { const id = ++rpcSequence; const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 15000); rpcWaiting.set(id, response => { clearTimeout(timer); rpcWaiting.delete(id); resolveRpc(response); }); proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  assert((await rpc('tools/list')).result.tools.some(tool => tool.name === 'squad_search_memory'));
  const found = await call('squad_search_memory', { query: 'update rollback' });
  assert.equal(found.isError, undefined); assert(found.structuredContent.memories.some(item => item.id === shared.id)); assert.equal(found.structuredContent.search, 'turbovec-local-text');
  assert((await call('squad_search_memory', { query: 'anything', memberId: 'kai' })).isError, 'Tools cannot override their credential identity');
  const saved = await call('squad_remember', { text: 'MCP memory transport proof completed.', scope: 'me' });
  assert(saved.structuredContent.saved);
  const id = saved.structuredContent.id;
  assert.equal((await call('squad_read_memory', { id })).structuredContent.text, 'MCP memory transport proof completed.');
  assert.equal((await call('squad_share_memory', { id, teammate_id: 'kai' })).structuredContent.sharedWith[0], 'kai');
  assert((await library.list({ actor: other })).records.some(item => item.id === id));
  await call('squad_organize_memory', { id, kind: 'lesson', tags: ['transport'] }); assert.equal((await library.get(id)).kind, 'lesson');
  const related = await call('squad_relate_memories', { from: id, to: shared.id, relation: 'references', evidence: 'Transport verification uses the same release memory record.' }); assert(related.structuredContent.id);
  const graph = await call('squad_memory_graph', {}); assert(graph.structuredContent.links.some(item => item.id === related.structuredContent.id));
  const recall = await call('squad_recall', { query: 'transport proof' }); assert(recall.structuredContent.memories.some(item => item.id === id));
  people[0].profileFiles.push({ section: 'memory', fileName: 'BOUNDED.md', content: Array.from({ length: 100 }, (_, index) => `# Long memory ${index}\n\n${`Fixture long memory ${index} has bounded excerpt content. `.repeat(120)}`).join('\n\n') });
  await library.updateSettings({ profiles: true });
  const boundedRecall = await call('squad_recall', {}); assert(Buffer.byteLength(boundedRecall.content[0].text) < 18_000); assert(boundedRecall.structuredContent.hasMore); assert(boundedRecall.structuredContent.memories.some(item => item.excerpt));
  await call('squad_forget', { id }); assert(!(await library.list()).records.some(item => item.id === id));
  team.closeMember('iris'); assert((await rpc('tools/list')).error, 'Revoked work credentials cannot keep reading');
  if (process.platform !== 'win32') {
    const broken = createMemoryVectorClient({ rootDir: root, stateDir: join(directory, 'broken-worker'), binary: '/usr/bin/false' });
    try { await assert.rejects(broken.request({ op: 'sync', documents: [{ id: 'large', text: 'x'.repeat(8 * 1024 * 1024) }] }), /memory index/i); }
    finally { broken.close(); }
  }
  const budgetMember = { id: 'bounded', name: 'Bounded', memory: Array.from({ length: 20_001 }, (_, index) => `Collection budget fixture ${index}`), get profileFiles() { throw new Error('Do not keep collecting after the global budget is full.'); } };
  const boundedCollection = await collectMemories({ members: async () => [budgetMember], teamStore: { read: async () => ({ memory: [] }) }, agentsDir, settings: { team: true, members: true, profiles: true, cli: true, folders: [] } });
  assert.equal(boundedCollection.records.length, 20_000); assert(boundedCollection.warnings.some(item => item.message.includes('20,000-record')));
  console.log('Memory library checks passed: real TurboVec, collection/reconciliation, scoped recall, curation, persistence and managed stdio MCP.');
} finally {
  proxy?.kill();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  library?.close(); team.close(); await rm(directory, { recursive: true, force: true });
}
