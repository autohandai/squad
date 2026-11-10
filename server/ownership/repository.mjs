import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { checkStructure, fileSchema, MAX_FILE_BYTES, validateManifest } from '@autohand/squad-portable';
import { ownedDirectory } from './datasets.mjs';
import { collectMemories, teamMemoryRecord } from '../memory/collect.mjs';
import { artifactMemoryRecord } from '../artifacts/service.mjs';

const memberId = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const missing = () => Object.assign(Error('This member is not available in the selected Squad.'), { status: 404, code: 'member_not_found' });
const list = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const digest = value => createHash('sha256').update(value).digest('hex');
const uniqueRecords=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
function memberProvenance(retained,sourceOwner) {
  const previous=object(retained.extensions?.['ai.autohand.squad.restoredSource']);
  const skills=new Map(list(previous.skills).map(skill=>[skill.id,skill]));
  for(const skill of list(retained.skills))skills.set(skill.id,{...object(skills.get(skill.id)),...skill});
  return {...previous,sourceId:retained.sourceId,sourceOwner,profile:{...object(previous.profile),...object(retained.profile)},skills:[...skills.values()],routines:previous.routines||retained.routines||[],memories:previous.memories||retained.memories||[],unboundMemories:uniqueRecords([...list(previous.unboundMemories),...list(retained.unboundMemories)])};
}
function sharedProvenance(retained) {
  const previous=object(retained.extensions?.['ai.autohand.squad.restoredSource']);
  return {...previous,sourceOwner:retained.sourceOwner,createdAt:retained.createdAt,workspaces:uniqueRecords([...list(previous.workspaces),...list(retained.workspaces)]),omissions:uniqueRecords([...list(previous.omissions),...list(retained.omissions)]),
    sharedData:{...object(previous.sharedData),...object(retained.sharedData)},sourceLibrary:previous.sourceLibrary||retained.sourceLibrary||{}};
}
const mediaType = path => ({ '.md': 'text/markdown', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.csv': 'text/csv', '.txt': 'text/plain' }[extname(path).toLowerCase()] || 'application/octet-stream');
function portableProfile(value) {
  // Operational credentials and resume capabilities are never definitions.
  const { owner, ownership, ownerId, auth, config, sessions, runtime, apiKey, token, ...profile } = object(value);
  return profile;
}
function portableConversation(value) {
  const { sessions, sessionId, resumeId, ...conversation } = object(value);
  return conversation;
}

/** A passive reader: no repair, migration, scheduling, provider probe or write. */
export class OwnedAgentRepository {
  constructor(context, { assertCurrent = () => {} } = {}) {
    if (!context.owner || !context.actor) throw Error('An owned repository requires verified read access.');
    this.context = context; this.assertCurrent = assertCurrent;
  }
  async openFile(root, path) {
    this.assertCurrent();
    const parts = relative(resolve(root), resolve(path)).split(/[\\/]/);
    if (parts.some(part => !part || part === '..' || part === '.')) throw Error('A managed file cannot leave its data root.');
    const rootParts = relative(this.context.serviceRoot, resolve(root)).split(/[\\/]/);
    await ownedDirectory(this.context.serviceRoot, [...rootParts, ...parts.slice(0, -1)], { create: false });
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1) { await file.close(); throw Error('Only private ordinary managed files can be read.'); }
    try { this.assertCurrent(); return { file, info }; } catch (error) { await file.close(); throw error; }
  }
  async json(root, path, fallback) {
    let opened;
    try {
      opened = await this.openFile(root, path);
      if (opened.info.size > 8 * 1024 * 1024) throw Error('A saved Squad record exceeds its read limit.');
      const value = JSON.parse(await opened.file.readFile('utf8'));
      checkStructure(value, 200_000); this.assertCurrent(); return value;
    } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    finally { await opened?.file.close(); }
  }
  readState(name, fallback) { return this.json(this.context.dataRoot, join(this.context.dataRoot, name), fallback); }
  async channels() { return this.readState('channels.json', { version: 1, channels: [], threads: [], messages: [], agentChannelAccess: {} }); }
  async list() {
    const state = await this.channels();
    return Object.entries(object(state.agentChannelAccess)).filter(([id, access]) => memberId.test(id) && id !== 'squad-designer' && access?.agent && !access.removed)
      .map(([id, access]) => ({ id, name: String(access.agent.name || id), role: String(access.agent.role || ''), ownership: this.context.owner }));
  }
  async member(id) {
    if (!memberId.test(id) || id === 'squad-designer') throw missing();
    const state = await this.channels(), access = state.agentChannelAccess?.[id];
    if (!access?.agent || access.removed) throw missing();
    const home = join(this.context.appRoot, 'agents', id);
    const saved = await this.json(this.context.appRoot, join(home, 'profile.json'), {});
    return { ...portableProfile(saved), ...portableProfile(access.agent), id, ownership: this.context.owner };
  }
  async snapshot({ agentIds, includeShared = !agentIds } = {}) {
    this.assertCurrent();
    const roster = await this.list(), chosen = agentIds ? new Set(agentIds) : new Set(roster.map(member => member.id));
    if (chosen.size !== (agentIds ? agentIds.length : roster.length) || [...chosen].some(id => !roster.some(member => member.id === id))) throw missing();
    const [channels, team, routines, threads, browser, library, artifactLibrary, inbox, restoredSource] = await Promise.all([
      this.channels(), this.readState('team.json', {}), this.readState('routines.json', {}), this.readState('member-threads.json', {}),
      this.readState('browser-state.json', {}), this.readState('memory/library.json', {}), this.readState('artifacts/library.json', {}), this.readState('memory-inbox.json', {}), this.readState('restore-source.json', {}),
    ]);
    const omissions = [], sources = new Map(), workspaces = new Map(), managedWorkspaces = new Set(), agents = [];
    const addWorkspace = path => {
      if (!path || typeof path !== 'string') return null;
      const id = `workspace-${digest(path).slice(0, 24)}`;
      workspaces.set(id, { id, label: basename(path), pathHint: path });
      return id;
    };
    const addFile = async (agentId, root, path, portablePath, kind, mime = mediaType(path)) => {
      let opened;
      try {
        opened = await this.openFile(root, path);
        if (opened.info.size > MAX_FILE_BYTES) { omissions.push({ path: portablePath, reason: 'The file exceeds the portable 25 MiB file limit.' }); return null; }
        const hash = createHash('sha256');
        for await (const chunk of opened.file.createReadStream({ autoClose: false })) { this.assertCurrent(); hash.update(chunk); }
        const after = await opened.file.stat();
        if (after.size !== opened.info.size || after.mtimeMs !== opened.info.mtimeMs) throw Error(`A managed file changed during backup: ${portablePath}. Retry after its work finishes.`);
        const parsed = fileSchema.safeParse({ id: `file-${digest(portablePath).slice(0, 32)}`, path: portablePath, kind, sha256: hash.digest('hex'), bytes: after.size, mediaType: mime });
        if (!parsed.success) { omissions.push({ path: portablePath, reason: 'This filename or file type is not portable across supported systems.' }); return null; }
        sources.set(JSON.stringify([agentId, parsed.data.id]), { root, path, info: after }); return parsed.data;
      } catch (error) {
        if (['ENOENT', 'ELOOP'].includes(error.code)) { omissions.push({ path: portablePath, reason: 'The file is missing or is a symbolic link; no external content was followed.' }); return null; }
        throw error;
      } finally { await opened?.file.close(); }
    };
    const walk = async (agentId, root, directory, prefix, kind, output, depth = 0) => {
      let entries;
      try {
        await ownedDirectory(this.context.serviceRoot, relative(this.context.serviceRoot, directory).split(/[\\/]/), { create: false });
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (depth > 32 || sources.size + entries.length > 100_000) throw Error('This backup exceeds its file inventory limit. Select fewer members.');
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name), portable = `${prefix}/${entry.name}`;
        if (kind === 'other' && ['.git', '.autohand', '.codex', '.claude', 'node_modules', '.ds_store'].includes(entry.name.normalize('NFC').toLowerCase())) { omissions.push({ path: portable, reason: 'Runtime credentials, Git authority, harness state and rebuildable dependency caches are excluded from managed work files.' }); continue; }
        if (entry.isSymbolicLink()) { omissions.push({ path: portable, reason: 'Symbolic links are excluded; external folders need a separate backup.' }); continue; }
        if (entry.isDirectory()) await walk(agentId, root, path, portable, kind, output, depth + 1);
        else if (entry.isFile()) { const file = await addFile(agentId, root, path, portable, kind); if (file) output.push(file); }
        else omissions.push({ path: portable, reason: 'Only ordinary files and directories are portable; devices and sockets are excluded.' });
      }
    };
    const addRetained = async (scope, root, directory, retained, output) => {
      for(const reference of list(retained)) {
        const ref=fileSchema.parse(reference);
        const file=await addFile(scope,root,join(directory,digest(ref.id)),ref.path,ref.kind,ref.mediaType);
        if(!file)throw Error('A retained portable source file is missing. Existing data was preserved.');
        const computed=JSON.stringify([scope,file.id]),source=sources.get(computed);
        sources.delete(computed);sources.set(JSON.stringify([scope,ref.id]),source);
        output.push({...file,id:ref.id});
      }
    };
    for (const id of chosen) {
      const member = await this.member(id), profile = portableProfile(member), files = [], home = join(this.context.appRoot, 'agents', id);
      const memberWorkspaces = [...new Set([member.workspace, ...list(member.projects).map(project => typeof project === 'string' ? project : project?.path)].filter(path => typeof path === 'string' && path))];
      const managedWorkspaceRecords = [];
      for (const path of memberWorkspaces) {
        const workspaceId = addWorkspace(path), part = relative(this.context.workspaceRoot, resolve(path));
        if (part === '..' || part.startsWith('../') || part.startsWith('..\\') || isAbsolute(part)) continue;
        const filePrefix = `work/${workspaceId}`;
        await walk(id, this.context.workspaceRoot, resolve(path), filePrefix, 'other', files);
        managedWorkspaces.add(workspaceId); managedWorkspaceRecords.push({ id: workspaceId, pathHint: path, filePrefix });
      }
      for (const [folder, kind] of [['profile', 'profile'], ['memory', 'memory'], ['skills', 'skill']]) {
        await walk(id, this.context.appRoot, join(home, folder), `member/${folder}`, kind, files);
      }
      const conversations = [];
      const chats = join(this.context.dataRoot, 'chats', id);
      let chatFiles = []; try { chatFiles = await readdir(chats); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const name of chatFiles.filter(name => name.endsWith('.json') && name !== 'index.json').sort()) {
        const record = await this.json(this.context.dataRoot, join(chats, name), null); if (record) conversations.push(portableConversation(record));
      }
      if (Array.isArray(browser.messagesByAgent?.[id]) && browser.messagesByAgent[id].length) conversations.push({ id: `current-${id}`, memberId: id, current: true, messages: browser.messagesByAgent[id] });
      for (const thread of list(threads.threads).filter(thread => thread.memberId === id)) conversations.push({ ...portableConversation(thread), kind: 'reply-thread' });
      const artifactRecords = [];
      for (const artifact of list(artifactLibrary.records).filter(item => item.ownerId === id)) {
        if (!/^[a-f0-9]{64}$/.test(artifact.contentHash || '')) throw Error('A saved artifact has an invalid content reference.');
        const file = await addFile(id, this.context.dataRoot, join(this.context.dataRoot, 'artifacts', 'files', artifact.contentHash), `artifacts/${artifact.id}/${artifact.filename}`, 'artifact', artifact.mime);
        const { sourcePath, contentHash, ...metadata } = artifact;
        if (file) { files.push(file); artifactRecords.push({ ...metadata, fileId: file.id }); }
      }
      const attachmentRecords = [], attachmentIds = new Set();
      for (const conversation of conversations) for (const message of [conversation.root, ...list(conversation.messages)].filter(Boolean)) for (const file of list(message.attachments)) if (/^[a-z0-9]{12,32}$/.test(file?.id || '')) attachmentIds.add(file.id);
      for (const attachmentId of attachmentIds) {
        const metadata = await this.readState(`attachments/${attachmentId}.json`, null);
        if (!metadata || !/^[a-z0-9]{1,12}$/.test(metadata.ext || '')) { omissions.push({ path: `attachments/${attachmentId}`, reason: 'The attachment metadata is missing or invalid.' }); continue; }
        const file = await addFile(id, this.context.dataRoot, join(this.context.dataRoot, 'attachments', `${attachmentId}.${metadata.ext}`), `attachments/${attachmentId}/${metadata.name || 'file'}`, 'attachment', metadata.mime);
        if (file) {
          files.push(file);
          const preview = metadata.preview ? await addFile(id, this.context.dataRoot, join(this.context.dataRoot, 'attachments', `${attachmentId}.preview.png`), `attachments/${attachmentId}/preview.png`, 'attachment', 'image/png') : null;
          if (preview) files.push(preview);
          attachmentRecords.push({ ...metadata, fileId: file.id, ...(preview ? { previewFileId: preview.id } : {}) });
        }
      }
      const scopedTeam = list(team.memory).filter(entry => entry.scope === 'member' && entry.memberId === id);
      // Collect the same canonical identities as Memory, without initializing
      // its vector service or following configured external collection folders.
      const collected = await collectMemories({ members: async()=>[{...channels.agentChannelAccess[id].agent,id}], teamStore:{read:async()=>({memory:scopedTeam})},
        settings:{team:true,members:true,profiles:true,cli:true,folders:[]},agentsDir:join(this.context.appRoot,'agents') });
      for(const warning of collected.warnings) omissions.push({path:`members/${id}/memory`,reason:`Memory source projection: ${warning.message}`});
      const memoryRecords = [...collected.records, ...artifactRecords.map(artifact=>artifactMemoryRecord({...artifact,href:`/squad-members/${encodeURIComponent(id)}/library?artifact=${artifact.id}`}))];
      const memoryIds = new Set(memoryRecords.map(record=>record.id));
      const metadata = Object.fromEntries(Object.entries(object(library.metadata)).filter(([recordId])=>memoryIds.has(recordId)));
      const groupIds = new Set(Object.values(metadata).map(meta=>meta?.groupId).filter(Boolean));
      const personalLibrary = {version:1,metadata,groups:list(library.groups).filter(group=>groupIds.has(group.id)),links:list(library.links).filter(link=>memoryIds.has(link.from)&&memoryIds.has(link.to))};
      const memoryFiles = new Map(files.map(file=>[sources.get(JSON.stringify([id,file.id]))?.path,file]));
      const memorySources = memoryRecords.map(record=> {
        const source = record.sourcePath ? memoryFiles.get(record.sourcePath) : null;
        return {id:record.id,sourceType:record.sourceType,sourceKey:record.sourceKey||'',sourceRef:record.sourceRef||'',ownerId:record.ownerId||'',authorId:record.authorId||'',workspace:record.workspace||'',textHash:digest(record.text),...(source?{fileId:source.id,portablePath:source.path}:{})};
      });
      const memories = memoryRecords.map(record=> {
        const {sourcePath,sessionId,...content}=record,curation=object(metadata[record.id]);
        return {...content,...Object.fromEntries(['title','kind','tags','groupId','pinned','sharedWith'].filter(key=>Object.hasOwn(curation,key)).map(key=>[key,curation[key]]))};
      });
      const skills = list(profile.skills).map(skill => typeof skill === 'string' ? { id: skill } : object(skill));
      const retained=object(restoredSource.agents?.[id]);
      await addRetained(id,this.context.appRoot,join(home,'portable-files'),retained.files,files);
      agents.push({ id, profile, memories, conversations, routines: list(routines.routines).filter(routine => routine.memberId === id), skills, files,
        extensions: { ...object(retained.extensions), 'ai.autohand.squad': { ...object(retained.extensions?.['ai.autohand.squad']), artifactRecords, attachmentRecords, managedWorkspaces: managedWorkspaceRecords, memorySources, memoryLibrary:personalLibrary },
          ...(retained.sourceId ? {'ai.autohand.squad.restoredSource':memberProvenance(retained,restoredSource.sourceOwner)}:{}) } });
      omissions.push({ path: `members/${id}/runtime`, reason: 'Provider credentials, engine sessions, MCP capabilities and runtime configuration are excluded.' });
    }
    for (const workspace of workspaces.values()) if (!managedWorkspaces.has(workspace.id)) omissions.push({ path: workspace.pathHint, reason: 'External working folders are references. Their contents require a separate project backup and consent before reuse.' });
    const shared = { data: includeShared ? { channels: list(channels.channels), threads: list(channels.threads), messages: list(channels.messages),
      memories: list(team.memory).filter(entry => entry.scope !== 'member'), memoryInbox: inbox,
      library: { ...library, settings: { ...object(library.settings), folders: [] } } } : {}, files: [] };
    if (includeShared) {
      await addRetained(null,this.context.dataRoot,join(this.context.dataRoot,'portable-shared'),restoredSource.sharedFiles,shared.files);
      const ids = new Set(list(channels.messages).flatMap(message => list(message.attachments).map(file => file?.id)).filter(id => /^[a-z0-9]{12,32}$/.test(id || '')));
      shared.data.attachmentRecords = [];
      for (const attachmentId of ids) {
        const metadata = await this.readState(`attachments/${attachmentId}.json`, null);
        if (!metadata || metadata.id !== attachmentId || !/^[a-z0-9]{1,12}$/.test(metadata.ext || '')) { omissions.push({ path: `shared/attachments/${attachmentId}`, reason: 'The attachment metadata is missing or invalid.' }); continue; }
        const file = await addFile(null, this.context.dataRoot, join(this.context.dataRoot, 'attachments', `${attachmentId}.${metadata.ext}`), `attachments/${attachmentId}/${metadata.name || 'file'}`, 'attachment', metadata.mime);
        if (!file) continue;
        shared.files.push(file);
        const preview = metadata.preview ? await addFile(null, this.context.dataRoot, join(this.context.dataRoot, 'attachments', `${attachmentId}.preview.png`), `attachments/${attachmentId}/preview.png`, 'attachment', 'image/png') : null;
        if (preview) shared.files.push(preview);
        shared.data.attachmentRecords.push({ ...metadata, fileId: file.id, ...(preview ? { previewFileId: preview.id } : {}) });
      }
      for (const folder of list(library.settings?.folders)) omissions.push({ path: typeof folder === 'string' ? folder : String(folder.path || 'External memory folder'), reason: 'External library folders are not copied or automatically reactivated by a restore.' });
    }
    const sharedSources = includeShared ? list(team.memory).filter(entry=>entry.scope!=='member').map(teamMemoryRecord).filter(Boolean).map(record=>({id:record.id,sourceType:record.sourceType,sourceKey:record.sourceKey||'',sourceRef:record.sourceRef||'',ownerId:record.ownerId||'',authorId:record.authorId||'',workspace:record.workspace||'',textHash:digest(record.text)})) : [];
    const manifest = validateManifest({ format: 'autohand-squad', schemaVersion: 1, createdAt: new Date().toISOString(), owner: this.context.owner,
      agents, shared, workspaces: [...workspaces.values()], omissions, extensions: { ...(includeShared?object(restoredSource.extensions):{}), 'ai.autohand.squad':{...(includeShared?object(restoredSource.extensions?.['ai.autohand.squad']):{}),memorySources:sharedSources},
        ...(includeShared&&restoredSource.sourceOwner?{'ai.autohand.squad.restoredSource':sharedProvenance(restoredSource)}:{}) } });
    return { manifest, readFile: async ref => {
      const source = sources.get(JSON.stringify([ref.agentId, ref.id])); if (!source) throw Error('This file is outside the backup snapshot.');
      const repository = this;
      return { async *[Symbol.asyncIterator]() {
        const { file, info } = await repository.openFile(source.root, source.path);
        try {
          if (info.ino !== source.info.ino || info.size !== source.info.size || info.mtimeMs !== source.info.mtimeMs) throw Error('A backup file changed. Retry after its work finishes.');
          for await (const chunk of file.createReadStream({ autoClose: false })) { repository.assertCurrent(); yield chunk; }
        } finally { await file.close(); }
      } };
    } };
  }
}
