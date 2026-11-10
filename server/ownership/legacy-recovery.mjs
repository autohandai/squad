import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { checkStructure, MAX_DOCUMENT_BYTES, MAX_FILE_BYTES } from '@autohand/squad-portable';
import { actorKey, ownerKey } from './identity.mjs';
import { ownedDirectory } from './datasets.mjs';
import { acquireWriterLease } from './writer-lease.mjs';
import { OwnedAgentRepository } from './repository.mjs';
import { writePortableFile } from './portable-file.mjs';
import { createImportSources } from './import-sources.mjs';

const array = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const memberId = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => Object.assign(Error(message), { status: 409, code: 'legacy_recovery_invalid' });
const inside = (root, path) => { const part = relative(root, path); return part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(part); };
const excluded = new Set(['.git', '.autohand', '.codex', '.claude', 'node_modules', '.ds_store']);
const expand = path => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
const browserSchema = z.object({ agents: z.array(z.record(z.string(), z.json())).max(10_000).default([]), removedAgents: z.array(z.string()).max(10_000).default([]),
  messages: z.record(z.string(), z.array(z.record(z.string(), z.json()))).default({}), channels: z.array(z.record(z.string(), z.json())).default([]),
  channelThreads: z.array(z.record(z.string(), z.json())).default([]), channelMessages: z.record(z.string(), z.array(z.record(z.string(), z.json()))).default({}) }).strict();
export const legacyRecoveryInput = z.object({ id: z.uuid(), stateRoot: z.string().max(4096).default(''), appRoot: z.string().max(4096).default(''),
  workspaceRoot: z.string().max(4096).default(''), browser: browserSchema.optional(), consent: z.literal('preview-unowned-data') }).strict();

/** Deliberately invoked passive copy, never a migration on sign-in. Only these
 * data sources are read; original files and the selected dataset stay intact. */
export async function prepareLegacyRecovery({ context, assertCurrent }, value) {
  const input = legacyRecoveryInput.parse(value); assertCurrent();
  if (!context.canWrite) throw Object.assign(fail('Choose a writable Squad before recovering unowned data.'), { status: 403, code: 'owner_read_only' });
  if (!input.stateRoot && !input.appRoot && !input.browser) throw fail('Choose an old data folder, an old agent folder, or browser data explicitly.');
  const key = ownerKey(context.owner), actor = actorKey(context.actor);
  const base = await ownedDirectory(context.serviceRoot, ['owners', key, 'imports', actor, 'legacy']);
  const release = await acquireWriterLease(join(base, `${input.id}.sqlite`));
  let temporary;
  try {
    const sources = createImportSources({ context, assertCurrent });
    // A stable request always refers to its original verified preview. Changed
    // source files need a new request, never a silent recapture on retry.
    const intent = sha(JSON.stringify(input)), receiptPath = join(base, `${input.id}.json`);
    const receipt = await readPrivateJson(receiptPath, null);
    if (receipt) {
      if (receipt.intent !== intent) throw fail('This recovery request already refers to different sources. Start another preview.');
      try { return await sources.get(input.id); } catch (error) { if (error.code !== 'import_source_not_found') throw error; }
    } else {
      const receiptFile = await open(receiptPath, 'wx', 0o600);
      try { await receiptFile.writeFile(JSON.stringify({ version: 1, intent })); await receiptFile.sync(); } finally { await receiptFile.close(); }
    }
    const protectedRoot = resolve(await realpath(context.serviceRoot), 'owners');
    async function root(path) {
      if (!path) return null;
      const expanded = expand(path);
      if (!isAbsolute(expanded)) throw fail('Recovery folders must use an absolute path or ~/ path.');
      const canonical = await realpath(expanded); assertCurrent();
      if (!(await lstat(canonical)).isDirectory() || inside(protectedRoot, canonical)) throw fail('Choose an original unowned data folder. Account-owned datasets cannot be claimed through legacy recovery.');
      return canonical;
    }
    const stateRoot = await root(input.stateRoot), appRoot = await root(input.appRoot), workspaceRoot = await root(input.workspaceRoot);
    temporary = await ownedDirectory(context.serviceRoot, ['owners', key, 'imports', actor, 'legacy', `source-${randomUUID()}`]);
    const stage = { ...context, dataRoot: join(temporary, 'state'), appRoot: join(temporary, 'app'), workspaceRoot: join(temporary, 'work') };
    for (const name of ['state', 'app', 'work']) await ownedDirectory(temporary, [name]);
    const omissions = []; let total = 0, count = 0;
    async function sourceFile(rootPath, path, maximum = MAX_FILE_BYTES) {
      assertCurrent();
      if (!inside(rootPath, path) || inside(protectedRoot, path)) throw fail('A recovery source leaves the chosen folder or enters account-owned data.');
      const parts = relative(rootPath, path).split(/[\\/]/);
      await ownedDirectory(rootPath, parts.slice(0, -1), { create: false });
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > maximum) throw fail(`An old data file is unsafe or exceeds its limit: ${basename(path)}. Nothing was replaced.`);
        const chunks = []; let size = 0;
        for await (const chunk of file.createReadStream({ autoClose: false })) { assertCurrent(); size += chunk.length; if (size > maximum) throw fail('An old data file grew beyond its read limit.'); chunks.push(chunk); }
        const after = await file.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw fail('Old data changed during recovery. Finish its work and preview again.');
        total += size; count++;
        if (total > MAX_DOCUMENT_BYTES || count > 100_000) throw fail('These sources exceed the recovery inventory limit. Select a smaller source; nothing was truncated.');
        return Buffer.concat(chunks, size);
      } finally { await file.close(); }
    }
    async function save(path, bytes) { assertCurrent(); await ownedDirectory(temporary, relative(temporary, dirname(path)).split(/[\\/]/)); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); assertCurrent(); }
    async function copyFile(rootPath, path, target) {
      try { await save(target, await sourceFile(rootPath, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    async function tree(rootPath, directory, target, work = false, depth = 0) {
      assertCurrent(); if (depth > 32) throw fail('An old data folder exceeds the supported nesting limit.');
      let entries;
      try { await ownedDirectory(rootPath, relative(rootPath, directory).split(/[\\/]/).filter(Boolean), { create: false }); entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink() || work && excluded.has(entry.name.normalize('NFC').toLowerCase()) || !entry.isFile() && !entry.isDirectory()) {
          omissions.push({ path: relative(rootPath, path), reason: 'Symlinks, devices, Git metadata, harness state and dependency caches are excluded from recovery.' }); continue;
        }
        if (entry.isDirectory()) await tree(rootPath, path, join(target, entry.name), work, depth + 1);
        else await copyFile(rootPath, path, join(target, entry.name));
      }
    }
    if (stateRoot) {
      for (const name of ['channels.json', 'team.json', 'routines.json', 'member-threads.json', 'browser-state.json', 'memory-inbox.json', 'memory/library.json', 'artifacts/library.json']) await copyFile(stateRoot, join(stateRoot, name), join(stage.dataRoot, name));
    }
    const channels = await readPrivateJson(join(stage.dataRoot, 'channels.json'), {}), access = { ...object(channels.agentChannelAccess) };
    const browser = input.browser || {}, removed = new Set(array(browser.removedAgents));
    for (const [id, item] of Object.entries(access)) if (item?.removed) removed.add(id);
    if (appRoot) {
      let entries = []; try { await ownedDirectory(appRoot, ['agents'], { create: false }); entries = await readdir(join(appRoot, 'agents'), { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const entry of entries) if (entry.isDirectory() && memberId.test(entry.name) && !removed.has(entry.name) && entry.name !== 'squad-designer') {
        const profile = await sourceFile(appRoot, join(appRoot, 'agents', entry.name, 'profile.json'), 8 * 1024 * 1024).then(bytes => JSON.parse(bytes.toString('utf8'))).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (profile && !access[entry.name]?.agent) access[entry.name] = { agent: { ...profile, id: entry.name }, removed: false };
      }
    }
    for (const profile of array(browser.agents)) if (memberId.test(profile.id || '') && profile.id !== 'squad-designer' && !removed.has(profile.id) && !access[profile.id]?.agent) access[profile.id] = { agent: profile, removed: false };
    for (const id of removed) if (access[id]) access[id] = { ...access[id], removed: true };
    const mergeRows = (canonical, fallback) => [...new Map([...array(fallback), ...array(canonical)].map(row => [row.id, row])).values()];
    const current = await readPrivateJson(join(stage.dataRoot, 'browser-state.json'), { version: 1, messagesByAgent: {} });
    current.messagesByAgent = { ...object(current.messagesByAgent) };
    const members = Object.entries(access).filter(([id, entry]) => memberId.test(id) && id !== 'squad-designer' && entry?.agent && !entry.removed);
    for (const [id, entry] of members) {
      if (appRoot) {
        await copyFile(appRoot, join(appRoot, 'agents', id, 'profile.json'), join(stage.appRoot, 'agents', id, 'profile.json'));
        for (const folder of ['profile', 'memory', 'skills']) await tree(appRoot, join(appRoot, 'agents', id, folder), join(stage.appRoot, 'agents', id, folder));
      }
      if (stateRoot) await tree(stateRoot, join(stateRoot, 'chats', id), join(stage.dataRoot, 'chats', id));
      const oldCurrent = browser.messages?.[id];
      if (Array.isArray(oldCurrent) && oldCurrent.length) {
        if (!current.messagesByAgent[id]?.length) current.messagesByAgent[id] = oldCurrent;
        else if (JSON.stringify(current.messagesByAgent[id]) !== JSON.stringify(oldCurrent)) {
          await save(join(stage.dataRoot, 'chats', id, `legacy-browser-${sha(JSON.stringify(oldCurrent)).slice(0, 24)}.json`), JSON.stringify({ id: `legacy-browser-${id}`, memberId: id, title: 'Recovered browser conversation', messages: oldCurrent }));
          omissions.push({ path: `members/${id}/conversations`, reason: 'The saved conversation and a different browser conversation were both kept; the browser version is an archive.' });
        }
      }
      const profile = { ...object(await readPrivateJson(join(stage.appRoot, 'agents', id, 'profile.json'), {})), ...entry.agent };
      const paths = [...new Set([profile.workspace, ...array(profile.projects).map(project => typeof project === 'string' ? project : project?.path)].filter(path => typeof path === 'string' && isAbsolute(path)))], rebased = new Map();
      if (workspaceRoot) for (const path of paths) {
        const lexicalRoot = resolve(expand(input.workspaceRoot));
        const source = inside(lexicalRoot, resolve(path)) ? join(workspaceRoot, relative(lexicalRoot, resolve(path))) : resolve(path);
        if (!inside(workspaceRoot, source) || inside(protectedRoot, source)) continue;
        const target = join(stage.workspaceRoot, id, sha(path).slice(0, 24));
        await tree(workspaceRoot, source, target, true); rebased.set(path, target);
      }
      // Paths not explicitly copied stay references and cannot become grants.
      entry.agent = { ...entry.agent, workspace: rebased.get(profile.workspace) || profile.workspace || '', projects: array(profile.projects).map(project => typeof project === 'string' ? rebased.get(project) || project : { ...project, path: rebased.get(project?.path) || project?.path }) };
    }
    if (!members.length && !array(channels.channels).length && !array(browser.channels).length) throw fail('No saved members or channels were found in these sources. Check the selected folders.');
    for (const folder of ['attachments', 'artifacts/files']) if (stateRoot) await tree(stateRoot, join(stateRoot, folder), join(stage.dataRoot, folder));
    const browserMessages = Object.entries(object(browser.channelMessages)).flatMap(([channelId, messages]) => array(messages).map(message => ({ ...message, channelId })));
    const merged = { ...channels, version: 1, agentChannelAccess: access, channels: mergeRows(channels.channels, browser.channels), threads: mergeRows(channels.threads, browser.channelThreads), messages: mergeRows(channels.messages, browserMessages) };
    for (const [name, data] of [['channels.json', merged], ['browser-state.json', current]]) { const path = join(stage.dataRoot, name); await rm(path, { force: true }); await save(path, JSON.stringify(data)); }
    const snapshot = await new OwnedAgentRepository(stage, { assertCurrent }).snapshot();
    snapshot.manifest.owner = { kind: 'user', issuer: 'urn:autohand:squad:legacy', id: 'unowned' };
    snapshot.manifest.omissions.push(...omissions, { path: 'legacy/runtime', reason: 'Recovery excludes credentials, sessions, runtime configuration, pending work and browser-only automations. Original files and browser data were not changed.' });
    snapshot.manifest.extensions['ai.autohand.squad.legacyRecovery'] = { version: 1, manual: true, browserIncluded: Boolean(input.browser) };
    const outputPath = join(temporary, 'source.json');
    await writePortableFile({ ...snapshot, outputPath, format: 'json', assertCurrent });
    const bytes = await readPrivateBytes(outputPath, MAX_DOCUMENT_BYTES); assertCurrent();
    const plan = await sources.prepare({ bytes, format: 'json', id: input.id }); assertCurrent();
    assertCurrent(); return plan;
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); release(); }
}

async function readPrivateBytes(path, maximum) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { const info = await file.stat(); if (!info.isFile() || info.nlink !== 1 || info.size > maximum) throw fail('A recovery record is unsafe or exceeds its limit.'); const bytes = await file.readFile(); if (bytes.length > maximum) throw fail('A recovery record exceeds its limit.'); return bytes; } finally { await file.close(); }
}
async function readPrivateJson(path, fallback) {
  try { const value = JSON.parse((await readPrivateBytes(path, 8 * 1024 * 1024)).toString('utf8')); checkStructure(value, 200_000); return value; } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
