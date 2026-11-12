import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { decodeFile, inventory, validateBackup } from '@autohand/squad-portable';
import { datasetPaths, ownedDirectory } from './datasets.mjs';
import { ownerKey } from './identity.mjs';
import { stampOwnedProfile } from './profile.mjs';
import { chatDigest, chatSummary, countTurns, MAX_CHAT_BYTES, MAX_CHATS_PER_MEMBER, MAX_MESSAGES_PER_CHAT } from '../chats/store.mjs';
import { collectMemories, teamMemoryRecord } from '../memory/collect.mjs';
import { artifactMemoryRecord } from '../artifacts/service.mjs';
import { attachmentReferences, ATTACHMENT_COUNT_LIMIT } from '../../src/lib/attachments.js';
import { normalizeResponder } from '../../src/lib/channel-responders.js';
import { MAX_INSTRUCTIONS, MAX_TITLE, MAX_RUNS_KEPT, normalizeRun } from '../routines/store.mjs';
import { strictScheduleInput, validateSchedule } from '../routines/schedule.mjs';
import { TEAM_MEMORY_LIMIT } from '../team/store.mjs';
import { syncMetadataDirectory } from './metadata.mjs';

const NS = 'ai.autohand.squad';
const list = value => Array.isArray(value) ? value : [];
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const sha = value => createHash('sha256').update(value).digest('hex');
const fresh = prefix => `${prefix}-${randomUUID()}`;
const fail = message => Object.assign(Error(message), { status:400, code:'restore_incompatible' });
const contentFields = ['name','formerNames','role','employeeType','avatar','avatarVersion','description','instructions','brainCard','memory','profileFiles','createdAt','updatedAt'];
const curationFields = ['title','kind','tags','groupId','pinned','sharedWith'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(obj(value),key)).map(key => [key,value[key]]));
function curation(value) {
  const result=pick(value,curationFields);
  for(const key of ['title','kind','groupId'])if(result[key]!==undefined&&typeof result[key]!=='string')throw fail('A memory label has an incompatible type. Its original source is unchanged.');
  for(const key of ['tags','sharedWith'])if(result[key]!==undefined&&(!Array.isArray(result[key])||result[key].some(item=>typeof item!=='string')))throw fail('A memory tag or sharing list has an incompatible type.');
  if(result.pinned!==undefined&&typeof result.pinned!=='boolean')throw fail('A memory pin has an incompatible type.');
  return result;
}

function identities(records, prefix) {
  const result = new Map();
  for (const row of records) {
    if (typeof row?.id !== 'string' || !row.id || result.has(row.id)) throw fail(`The backup has missing or duplicate ${prefix} identities.`);
    result.set(row.id, fresh(prefix));
  }
  return result;
}
const mapped = (map, id) => map.get(id) || '';
// Rebind recognized local Markdown destinations only. IDs in ordinary prose,
// inline code and fenced examples retain their original exact meaning.
function artifactLinks(value,memberIds,artifactIds) {
  let fence=null;
  return String(value||'').split(/(\r?\n)/).map((line,index)=>{
    if(index%2)return line;
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return line;}
    if(fence)return line;
    return line.replace(/(`+)(.*?)\1|\[([^\]\n]*)\]\((\/squad-members\/[^)\s]+)\)/g,(token,code,_body,label,href)=>{
      if(code)return token;
      let url;try{url=new URL(href,'http://squad.local');}catch{return token;}
      const match=url.pathname.match(/^\/squad-members\/([^/]+)\/library$/);
      if(!match)return token;
      let source;try{source=decodeURIComponent(match[1]);}catch{return token;}
      const member=memberIds.get(source),artifact=artifactIds.get(JSON.stringify([source,url.searchParams.get('artifact')]));
      if(!member||!artifact)return token;
      url.pathname=`/squad-members/${encodeURIComponent(member)}/library`;url.searchParams.set('artifact',artifact);
      return `[${label}](${url.pathname}${url.search}${url.hash})`;
    });
  }).join('');
}

/** Build a bounded write plan. Source paths and executable runtime settings
 * never become destination authority. Unknown content stays in an inert
 * portable inventory and can be exported again. No runtime services start. */
export function planRestore(input, { owner, staged }) {
  const document = validateBackup(input), key = ownerKey(owner);
  if (relative(join(staged.root,'..'),staged.root) !== staged.datasetId || !staged.root.includes(key)) throw fail('Restore requires a new dataset for the selected owner.');
  const now = new Date().toISOString(), writes = new Map(), targets = new Set(), directories = new Set(), consumed = new Set();
  const refs = new Map(inventory(document).map(ref => [JSON.stringify([ref.agentId,ref.id]),ref]));
  const payloads = new Map(document.files.map(file => [JSON.stringify([file.agentId,file.id]),file]));
  const memberIds = identities(document.agents,'member');
  const allArtifactIds=new Map();
  for(const agent of document.agents)for(const artifact of list(agent.extensions[NS]?.artifactRecords)) {
    const key=JSON.stringify([agent.id,artifact.id]);if(allArtifactIds.has(key))throw fail('An artifact has a duplicate identity.');allArtifactIds.set(key,`artifact_${randomUUID()}`);
  }
  const shared = obj(document.shared.data), channels = list(shared.channels), channelIds = identities(channels,'channel');
  const threads = list(shared.threads), threadIds = identities(threads,'thread');
  const channelMessages = list(shared.messages), channelMessageIds = identities(channelMessages,'message');
  const artifacts = [], attachments = new Map(), agents = [], team = [], routines = [], memberThreads = [], current = {}, access = {}, availability = {};
  const portable = {version:1,sourceOwner:document.owner,createdAt:document.createdAt,extensions:document.extensions,sharedData:{},agents:{},sharedFiles:[],workspaces:document.workspaces,omissions:document.omissions};
  const warn = [];
  const checkedPath = path => {
    const rel = relative(staged.root,path);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw fail('A restored file cannot leave its new dataset.');
    const normalized=rel.normalize('NFC').toLowerCase();
    if (targets.has(normalized)||directories.has(normalized)) throw fail('Two restored files would occupy the same destination.');
    for(let part=dirname(normalized);part!=='.';part=dirname(part)) {if(targets.has(part))throw fail('A restored file conflicts with a directory.');directories.add(part);}
    targets.add(normalized);return path;
  };
  function json(path,value,limit=8*1024*1024,deferred=false) {
    const bytes=Buffer.from(`${JSON.stringify(value)}\n`);
    if(bytes.length>limit)throw fail('A saved record exceeds this Squad version’s read limit. Split the source backup before restoring; no data was changed.');
    writes.set(checkedPath(path),{bytes,...(deferred?{deferred:true,value,limit}:{})});
  }
  function file(scope,id,path,kind) {
    const idKey=JSON.stringify([scope,id]),ref=refs.get(idKey),payload=payloads.get(idKey);
    if(!ref||!payload||(kind&&ref.kind!==kind))throw fail('A restored record refers to a missing or incompatible file.');
    writes.set(checkedPath(path),{ref,payload});consumed.add(idKey);return ref;
  }
  function workspaceFor(agent,extension) {
    const result=new Map();
    for(const entry of list(extension.managedWorkspaces)) {
      const source=document.workspaces.find(workspace=>workspace.id===entry.id);
      if(!source||entry.filePrefix!==`work/${entry.id}`||result.has(source.pathHint))throw fail('A managed workspace has an invalid portable reference.');
      const path=join(staged.workspaceRoot,'data','workers',memberIds.get(agent.id),`project-${result.size+1}`);
      result.set(source.pathHint,path);
      for(const ref of agent.files.filter(ref=>ref.path.startsWith(`${entry.filePrefix}/`))) {
        if(ref.kind!=='other')throw fail('A managed work file has an incompatible kind.');
        const parts=ref.path.slice(entry.filePrefix.length+1).split('/');
        if(parts.some(part=>['.git','.autohand','.codex','.claude','node_modules'].includes(part.normalize('NFC').toLowerCase())))throw fail('A managed workspace includes Git or harness authority. Remove it before import.');
        file(agent.id,ref.id,join(path,...parts),'other');
      }
    }
    return result;
  }
  function restoreAttachments(scope,records) {
    const result=new Map();
    for(const record of list(records)) {
      if(typeof record.id!=='string'||result.has(record.id))throw fail('An attachment has a missing or duplicate identity.');
      const id=randomBytes(16).toString('hex'),ext=/^[a-z0-9]{1,8}$/.test(record.ext||'')?record.ext:'bin';
      const ref=file(scope,record.fileId,join(staged.dataRoot,'attachments',`${id}.${ext}`),'attachment');
      if(record.size!==undefined&&record.size!==ref.bytes)throw fail('An attachment byte count does not match its verified payload.');
      if(record.previewFileId)file(scope,record.previewFileId,join(staged.dataRoot,'attachments',`${id}.preview.png`),'attachment');
      const saved={...pick(record,['name','mime','kind','width','height','durationMs','createdAt']),id,ext,size:ref.bytes,preview:Boolean(record.previewFileId)};
      json(join(staged.dataRoot,'attachments',`${id}.json`),saved);result.set(record.id,saved);attachments.set(id,saved);
    }
    return result;
  }
  const sharedAttachments=restoreAttachments(null,shared.attachmentRecords);
  function message(row,ids,attachmentMap,workspaces=new Map()) {
    if(!row||typeof row.id!=='string'||!ids.has(row.id))throw fail('A conversation has a message without an identity.');
    if(list(row.attachments).length>ATTACHMENT_COUNT_LIMIT)throw fail('A message exceeds the supported attachment count.');
    const files=list(row.attachments).map(item=>{
      const oldId=typeof item==='string'?item:item?.id, saved=attachmentMap.get(oldId);
      if(!saved)throw fail('A message attachment has no verified payload.');
      return {...saved,previewUrl:saved.preview?`/api/attachments/${saved.id}/preview`:undefined};
    });
    return {...pick(row,['role','body','content','time','authorName','agentName','startedAt','completedAt','durationMs','createdAt','updatedAt','trace','streamEvents','workDetailsLimited','kind']),
      id:ids.get(row.id),status:['loading','queued','running','pending','streaming'].includes(row.status)?'interrupted':row.status||'complete',
      body:artifactLinks(typeof row.body==='string'?row.body:typeof row.content==='string'?row.content:'',memberIds,allArtifactIds),
      agentId:mapped(memberIds,row.agentId),memberId:mapped(memberIds,row.memberId),authorId:mapped(memberIds,row.authorId),
      channelId:mapped(channelIds,row.channelId),threadId:mapped(threadIds,row.threadId),parentMessageId:mapped(ids,row.parentMessageId),
      workspace:workspaces.get(row.workspace)||'',attachments:attachmentReferences(files)};
  }
  function savedMemory(record,memberId='') {
    const id=fresh('memory');
    return {...pick(record,['text','createdAt','updatedAt','at','authorName','source']),id,scope:memberId?'member':'team',memberId,
      authorId:mapped(memberIds,record.authorId),workspace:''};
  }
  const memoryIds=new Map();
  const unboundSharedMemories=list(shared.memories).filter(record=>record.scope!=='team'||Boolean(record.workspace));
  if(unboundSharedMemories.length)warn.push(`${unboundSharedMemories.length} project or unknown-scope memories were preserved as unbound source data. Reconnect their project scope before use.`);
  for(const record of list(shared.memories).filter(record=>record.scope==='team'&&!record.workspace)) {const restored=savedMemory(record);team.push(restored);memoryIds.set(record.id,restored.id);}
  for(const source of document.agents) {
    for(const field of ['name','role','employeeType','avatar','description','instructions'])if(source.profile[field]!==undefined&&typeof source.profile[field]!=='string')throw fail('A member profile has an incompatible text field. The original backup is unchanged.');
    for(const meta of Object.values(obj(source.extensions[NS]?.memoryLibrary?.metadata)))curation(meta);
    const id=memberIds.get(source.id),extension=obj(source.extensions[NS]),home=join(staged.appRoot,'agents',id),workspaces=workspaceFor(source,extension);
    const reconstructedMemories=new Map();
    const profile=stampOwnedProfile({...pick(source.profile,contentFields),id,profileRevision:1,status:'paused',workspace:workspaces.get(source.profile.workspace)||'',
      projects:[...workspaces.values()].map(path=>({path,name:path.split(/[\\/]/).at(-1)})),permissions:{builtInPolicies:{squad_create_channel:'ask',squad_schedule:'ask'},mcp:'ask'},
      skills:source.skills.map(skill=>String(skill.id||'')).filter(value=>/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(value)&&!value.split('/').includes('..')),
      harness:pick(source.profile.harness,['id','model'])},owner);
    // Profile file paths are display/content only. Executable paths are rebuilt
    // when the person explicitly starts work; no source profileDocs are used.
    profile.profileFiles=list(profile.profileFiles).map(value=>pick(value,['section','fileName','title','content']));
    const profileMemoryIds=new Map();
    profile.memory=list(profile.memory).map(value=>{const id=fresh('entry');profileMemoryIds.set(value.id,id);return {...pick(value,['text','at','createdAt','updatedAt']),id};});
    for(const ref of source.files) for(const [prefix,kind] of [['member/profile/','profile'],['member/memory/','memory'],['member/skills/','skill']]) {
      if(!ref.path.startsWith(prefix))continue;
      if(ref.kind!==kind)throw fail('A member source file has an incompatible kind.');
      file(source.id,ref.id,join(home,...ref.path.slice('member/'.length).split('/')),kind);
    }
    const attachmentMap=restoreAttachments(source.id,extension.attachmentRecords);
    const artifactIds=new Map();
    for(const artifact of list(extension.artifactRecords)) {
      if(typeof artifact.id!=='string'||artifactIds.has(artifact.id))throw fail('An artifact has a missing or duplicate identity.');
      const artifactId=allArtifactIds.get(JSON.stringify([source.id,artifact.id])),ref=refs.get(JSON.stringify([source.id,artifact.fileId]));
      if(!ref||ref.bytes>20*1024*1024)throw fail('An artifact exceeds this Squad version’s 20 MiB limit. Its portable backup remains unchanged.');
      const path=join(staged.dataRoot,'artifacts','files',ref.sha256);
      // Multiple artifacts may deliberately share their verified content.
      if(!writes.has(path))file(source.id,artifact.fileId,path,'artifact');else consumed.add(JSON.stringify([source.id,artifact.fileId]));
      const record={...pick(artifact,['authorName','title','description','filename','kind','mime','createdAt','updatedAt','revision']),id:artifactId,ownerId:id,
        contentHash:ref.sha256,size:ref.bytes,sourcePath:'',workspace:'',runId:'',channelId:mapped(channelIds,artifact.channelId),threadId:mapped(threadIds,artifact.threadId)};
      artifacts.push(record);artifactIds.set(artifact.id,artifactId);memoryIds.set(artifact.id,artifactId);reconstructedMemories.set(artifact.id,artifactId);
    }
    for(const record of source.memories.filter(record=>(record.sourceType==='team'||!record.sourceType)&&record.scope!=='project'&&!record.workspace)) {
      const restored=savedMemory(record,id);team.push(restored);memoryIds.set(record.id,restored.id);reconstructedMemories.set(record.id,restored.id);
    }
    const chats=[],allMessages=source.conversations.flatMap(conversation=>[conversation.root,...list(conversation.messages)].filter(Boolean));
    if(allMessages.some(row=>typeof row.id!=='string'||!row.id))throw fail('A conversation has a message without an identity.');
    const memberMessageIds=identities([...new Map(allMessages.map(row=>[row.id,row])).values()],'message');
    for(const conversation of source.conversations) {
      const rows=list(conversation.messages),root=conversation.root;
      const ids=memberMessageIds;
      if(rows.length>MAX_MESSAGES_PER_CHAT||Buffer.byteLength(JSON.stringify(rows))>MAX_CHAT_BYTES)throw fail('A conversation exceeds this Squad version’s message budget. No messages were truncated.');
      const messages=rows.map(row=>message(row,ids,attachmentMap,workspaces));
      if(conversation.current) {if(Object.hasOwn(current,id))throw fail('A member has more than one current conversation.');current[id]=messages;continue;}
      if(conversation.kind==='reply-thread') {
        memberThreads.push({...pick(conversation,['title','createdAt','updatedAt']),id:fresh('reply'),memberId:id,creationId:'',creationIds:[],parentMessageId:mapped(ids,conversation.parentMessageId),root:root?message(root,ids,attachmentMap,workspaces):null,messages});continue;
      }
      const record={...pick(conversation,['title','startedAt','endedAt','createdAt','harness','limited']),id:fresh('chat'),memberId:id,workspace:workspaces.get(conversation.workspace)||'',sessions:{},messages,messageCount:messages.length,turns:countTurns(messages),digest:chatDigest(messages)};
      json(join(staged.dataRoot,'chats',id,`${record.id}.json`),record);chats.push(chatSummary(record));
    }
    if(chats.length>MAX_CHATS_PER_MEMBER)throw fail('This member exceeds the supported archived conversation count. Nothing was discarded.');
    json(join(staged.dataRoot,'chats',id,'index.json'),{version:1,chats});
    for(const routine of source.routines) {
      const strict=strictScheduleInput(routine.schedule),problems=[...strict.problems,...validateSchedule(strict.schedule)];
      if(problems.length||String(routine.instructions||'').length>MAX_INSTRUCTIONS||String(routine.title||'').length>MAX_TITLE||list(routine.runs).length>MAX_RUNS_KEPT)throw fail('A routine exceeds this Squad version’s definition, schedule or history limits. Its portable backup is unchanged; no history was truncated.');
      for(const run of list(routine.runs)) {
        const normalized=normalizeRun(run);
        for(const key of ['reason','preview','reply','note'])if(String(run[key]||'').trim()!==normalized[key])throw fail('A routine run exceeds this Squad version’s text limits. No history was truncated.');
      }
      const routineId=fresh('routine');
      routines.push({...pick(routine,['title','instructions','model','maxRunMinutes','source','createdAt','updatedAt','lastRunAt']),schedule:strict.schedule,id:routineId,memberId:id,enabled:false,nextAt:null,proposalId:'',
        workspace:workspaces.get(routine.workspace)||'',destination:routine.destination?.channelId&&channelIds.has(routine.destination.channelId)?{channelId:mapped(channelIds,routine.destination.channelId),threadId:mapped(threadIds,routine.destination.threadId),parentMessageId:mapped(channelMessageIds,routine.destination.parentMessageId)}:null,
        runs:list(routine.runs).map(run=>({...pick(run,['trigger','scheduledFor','queuedAt','startedAt','finishedAt','reason','preview','reply','note']),id:fresh('rrun'),routineId,
          status:['running','queued'].includes(run.status)?'interrupted':run.status,dispatch:'',memberRunId:'',claimedAt:null}))});
    }
    agents.push({source,id,profile,extension,artifactIds,profileMemoryIds,reconstructedMemories});
    access[id]={agent:profile,profile:'',mode:'ask',workspaceModes:{},removed:false,updatedAt:now};
    availability[id]={memberId:id,onBreak:true,breakStartedAt:now,endedAt:null};
    json(join(home,'profile.json'),profile,8*1024*1024,true);
    portable.agents[id]={sourceId:source.id,extensions:source.extensions,profile:source.profile,skills:source.skills,routines:source.routines,memories:source.memories,memorySources:list(extension.memorySources),unboundMemories:source.memories.filter(record=>record.scope==='project'||Boolean(record.workspace)||!['team','member','profile','cli','artifact'].includes(record.sourceType||'')),files:[]};
    for(const ref of source.files) if(!consumed.has(JSON.stringify([source.id,ref.id]))) {
      file(source.id,ref.id,join(home,'portable-files',sha(ref.id)));portable.agents[id].files.push(ref);
    }
  }
  const restoredChannels=channels.map(channel=>({...pick(channel,['name','visibility','section','purpose','createdAt','updatedAt','replyMode']),id:channelIds.get(channel.id),memberIds:list(channel.memberIds).map(id=>mapped(memberIds,id)).filter(Boolean),creatorId:mapped(memberIds,channel.creatorId),projects:[],goalSetup:null,autoModeDefault:false,responder:{...normalizeResponder(channel.responder),leadMemberId:mapped(memberIds,channel.responder?.leadMemberId)}}));
  const restoredThreads=threads.map(thread=>{
    if(!channelIds.has(thread.channelId))throw fail('A channel thread has no parent channel.');
    return {...pick(thread,['title','createdAt','updatedAt','replyCount']),id:threadIds.get(thread.id),channelId:channelIds.get(thread.channelId),parentMessageId:mapped(channelMessageIds,thread.parentMessageId),creatorId:mapped(memberIds,thread.creatorId),memberIds:list(thread.memberIds).map(id=>mapped(memberIds,id)).filter(Boolean),autoMode:false,selfJudge:false};
  });
  const restoredMessages=channelMessages.map(row=>{
    if(!channelIds.has(row.channelId))throw fail('A channel message has no parent channel.');
    return message(row,channelMessageIds,sharedAttachments);
  });
  for(const ref of document.shared.files)if(!consumed.has(JSON.stringify([null,ref.id]))) {file(null,ref.id,join(staged.dataRoot,'portable-shared',sha(ref.id)));portable.sharedFiles.push(ref);}
  // Unknown fields are inert source material, never a channels/access/settings
  // document that runtime code can accidentally adopt.
  portable.sharedData=Object.fromEntries(Object.entries(shared).filter(([name])=>!['channels','threads','messages','memories','library','attachmentRecords'].includes(name)));
  if(unboundSharedMemories.length)portable.sharedData.unboundMemories=[...list(portable.sharedData.unboundMemories),...unboundSharedMemories];
  portable.sourceLibrary=shared.library||{};
  for(const meta of Object.values(obj(portable.sourceLibrary.metadata)))curation(meta);
  if(team.length>TEAM_MEMORY_LIMIT)throw fail('The imported team memory exceeds this Squad version’s 200-entry shared store limit. No memory was discarded.');
  json(join(staged.dataRoot,'channels.json'),{version:1,revision:1,channels:restoredChannels,threads:restoredThreads,messages:restoredMessages,agentChannelAccess:access,agentChannelActions:[],deletedChannelIds:[],updatedAt:now},8*1024*1024,true);
  json(join(staged.dataRoot,'routines.json'),{version:1,routines,proposals:[],updatedAt:now});
  json(join(staged.dataRoot,'member-threads.json'),{version:1,threads:memberThreads,deleted:[]});
  json(join(staged.dataRoot,'browser-state.json'),{version:1,revision:1,messagesByAgent:current,savedAt:now});
  json(join(staged.dataRoot,'member-availability.json'),{version:1,members:availability});
  json(join(staged.dataRoot,'artifacts','library.json'),{version:1,records:artifacts});
  json(join(staged.dataRoot,'restore-source.json'),portable);
  return {document,owner,staged,writes,agents,team,artifacts,memoryIds,memberIds,portable,warnings:warn};
}

/** Called only on an unpublished, empty dataset after all writers drained.
 * Every created file is private, exclusive, verified and durably flushed. */
export async function materializeRestore(plan, { serviceRoot, assertCurrent }) {
  const {staged}=plan;
  const expected=datasetPaths(serviceRoot,ownerKey(plan.owner),staged.datasetId);
  for(const name of ['root','dataRoot','appRoot','workspaceRoot','logsRoot'])if(resolve(staged[name])!==expected[name])throw fail('The staged dataset does not belong to the selected owner.');
  async function write(path,bytes) {
    assertCurrent();
    const parts=relative(serviceRoot,dirname(path)).split(/[\\/]/);
    const directory=await ownedDirectory(serviceRoot,parts);
    const file=await open(path,'wx',0o600);
    try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await syncMetadataDirectory(directory);
    assertCurrent();
  }
  for(const [path,item] of plan.writes) {
    if(item.deferred)continue;
    const bytes=item.bytes||Buffer.from(decodeFile(item.payload));
    if(item.ref&&(bytes.length!==item.ref.bytes||sha(bytes)!==item.ref.sha256))throw fail('A file changed after restore verification.');
    await write(path,bytes);
  }
  // Recollect from the actual staged sources to obtain the NEW canonical IDs.
  // Matching by typed source reference and content hash avoids rewriting prose.
  const records=[...plan.team.map(teamMemoryRecord).filter(Boolean),...plan.artifacts.map(artifactMemoryRecord)];
  for(const agent of plan.agents) {
    const collected=await collectMemories({members:async()=>[agent.profile],teamStore:{read:async()=>({memory:[]})},settings:{team:false,members:true,profiles:true,cli:true,folders:[]},agentsDir:join(staged.appRoot,'agents')});
    records.push(...collected.records);plan.warnings.push(...collected.warnings.map(item=>item.message));
    for(const source of list(agent.extension.memorySources)) {
      if(agent.reconstructedMemories.has(source.id))continue;
      const matches=collected.records.filter(record=>record.sourceType===source.sourceType&&sha(record.text)===source.textHash&&
        (source.sourceType==='member'?record.sourceRef===agent.profileMemoryIds.get(source.sourceRef):source.sourceType==='profile'?record.sourceKey===source.sourceKey.replace(`profile:${agent.source.id}:`,`profile:${agent.id}:`):record.sourceRef===source.sourceRef));
      if(matches.length===1){plan.memoryIds.set(source.id,matches[0].id);agent.reconstructedMemories.set(source.id,matches[0].id);}
    }
    // A foreign tool may supply member/profile/CLI memories directly, without
    // this app's profile/event-file projection. Never infer that a familiar
    // sourceType proves its original source was actually reconstructed.
    const fallbacks=[];
    for(const source of agent.source.memories) {
      if(agent.reconstructedMemories.has(source.id)||source.scope==='project'||source.workspace)continue;
      const text=typeof source.text==='string'?source.text:typeof source.content==='string'?source.content:'';
      if(!text.trim())continue; // the original opaque record remains below
      const matches=collected.records.filter(record=>record.sourceType===source.sourceType&&record.text===text);
      if(matches.length===1){plan.memoryIds.set(source.id,matches[0].id);agent.reconstructedMemories.set(source.id,matches[0].id);continue;}
      const entry={text,id:fresh('entry'),at:String(source.createdAt||source.at||''),source:'import'};
      agent.profile.memory.push(entry);fallbacks.push({source,entry});
    }
    if(fallbacks.length) {
      const projected=await collectMemories({members:async()=>[agent.profile],teamStore:{read:async()=>({memory:[]})},settings:{team:false,members:true,profiles:false,cli:false,folders:[]},agentsDir:join(staged.appRoot,'agents')});
      records.push(...projected.records);
      for(const {source,entry} of fallbacks) {
        const record=projected.records.find(record=>record.sourceRef===entry.id);
        if(record){plan.memoryIds.set(source.id,record.id);agent.reconstructedMemories.set(source.id,record.id);}
        else plan.warnings.push('A memory could not enter the current library projection. Its original content remains in the portable source inventory.');
      }
    }
  }
  const library=obj(plan.portable.sourceLibrary),metadata={},groups=new Map(),links=[],groupIds=new Map();
  const sourceLibraries=[{library,ids:plan.memoryIds},...plan.agents.map(agent=>({library:obj(agent.extension.memoryLibrary),ids:agent.reconstructedMemories}))];
  const knownRecords=new Set(records.map(record=>record.id));
  for(const {library:source} of sourceLibraries)for(const group of list(source.groups))if(typeof group.id==='string'&&!groupIds.has(group.id)) {
    if(typeof group.name!=='string'||group.color!==undefined&&typeof group.color!=='string')throw fail('A memory group has an incompatible name or color.');
    const id=fresh('group');groupIds.set(group.id,id);groups.set(id,{...pick(group,['name','color','createdAt','updatedAt']),id});
  }
  for(const {library:source,ids} of sourceLibraries) {
    for(const [oldId,value] of Object.entries(obj(source.metadata))) {
      const id=ids.get(oldId);if(!id||!knownRecords.has(id))continue;
      metadata[id]={...curation(value),groupId:mapped(groupIds,value.groupId),sharedWith:list(value.sharedWith).map(member=>mapped(plan.memberIds,member)).filter(Boolean)};
    }
    for(const link of list(source.links)) {
      if(link.derived===true||!['references','supports','contradicts'].includes(link.relation))continue;
      if(link.evidence!==undefined&&typeof link.evidence!=='string')throw fail('A memory relationship has incompatible evidence.');
      const from=ids.get(link.from),to=ids.get(link.to);
      if(from&&to&&!links.some(saved=>saved.from===from&&saved.to===to&&saved.relation===link.relation))links.push({...pick(link,['relation','label','evidence','createdAt']),id:fresh('link'),from,to,derived:false,authorId:mapped(plan.memberIds,link.authorId)});
    }
  }
  const settings={...pick(library.settings,['team','members','profiles','cli']),folders:[],colors:Object.fromEntries(Object.entries(obj(library.settings?.colors)).filter(([id])=>plan.memberIds.has(id)).map(([id,color])=>[plan.memberIds.get(id),color]))};
  await write(join(staged.dataRoot,'team.json'),Buffer.from(`${JSON.stringify({version:1,memory:plan.team,deliveries:[]})}\n`));
  await write(join(staged.dataRoot,'memory','library.json'),Buffer.from(`${JSON.stringify({version:1,settings,groups:[...groups.values()],metadata,links})}\n`));
  for(const [path,item] of plan.writes)if(item.deferred) {
    const bytes=Buffer.from(`${JSON.stringify(item.value)}\n`);if(bytes.length>item.limit)throw fail('The imported member memory exceeds this Squad version’s metadata read limit. Nothing was published.');
    await write(path,bytes);
  }
  return {memberCount:plan.agents.length,fileCount:plan.document.files.length,routineCount:plan.document.agents.reduce((sum,agent)=>sum+agent.routines.length,0),warnings:plan.warnings};
}
