import { randomUUID } from 'node:crypto';
const id = { type: 'string', minLength: 1, maxLength: 256 };
const owner = { type: 'object', properties: { kind: { type: 'string', enum: ['user', 'team'] }, issuer: { type: 'string', minLength: 1, maxLength: 1024 }, id }, required: ['kind', 'issuer', 'id'], additionalProperties: false };
const format = { type: 'string', enum: ['json', 'yaml'], description: 'Equivalent portable backup encoding; default json.' };
const tool = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const OWNERSHIP_TOOLS = [
  tool('get_squad_context', 'Read the verified actor, selected personal/team owner and read/write entitlement. This client remains bound to that context.'),
  tool('list_squad_owners', 'List the current person’s personal Squad and existing Autohand team accounts. Discovery never imports or claims legacy agents.'),
  tool('select_squad_owner', 'Explicitly change this client’s selected Squad for the SAME signed-in person. Background work pauses. Never switches to another signed-in identity.', { owner }, ['owner']),
  tool('get_member_data', 'Read a saved member’s provider-neutral profile, conversations, memories, routines, skills and managed-file inventory from the selected owner.', { member_id: id }, ['member_id']),
  tool('get_member_files', 'List managed file references for a saved member. Use export_member for exact file contents; file bytes never pass through MCP text redaction.', { member_id: id }, ['member_id']),
  tool('get_member_memories', 'Read a saved member’s memory entries and memory-document inventory from the selected owner.', { member_id: id }, ['member_id']),
  tool('export_squad', 'Save a verified JSON/YAML portable backup with exact managed files. Returns a download receipt, coverage and exclusions; excludes credentials and external checkout contents. Works for read-only teams.', { format }),
  tool('export_member', 'Save one member’s profile, knowledge, conversations, skills, routines and managed file bytes in the same interoperable format. Returns a download receipt.', { member_id: id, format }, ['member_id']),
  tool('prepare_squad_import','Verify an interoperable JSON/YAML backup without changing data. Text input is limited to 8 MiB; use Settings or the documented HTTP upload for larger files. Returns an actor-private preview ID and warnings.',{format,document:{type:'string',minLength:1,maxLength:8*1024*1024}},['format','document']),
  tool('prepare_legacy_recovery','Explicitly preview old unowned Squad data from chosen local folders or supplied old browser data. Never scans on discovery, changes original files, claims account-owned datasets or starts agents. Review its import source with restore_squad separately.',{request_id:id,destination_owner:owner,state_root:{type:'string',maxLength:4096},app_root:{type:'string',maxLength:4096},managed_work_root:{type:'string',maxLength:4096},browser_data:{type:'string',maxLength:6*1024*1024,description:'Optional JSON containing only agents, removedAgents, messages, channels, channelThreads and channelMessages from an explicitly chosen old Squad browser store.'},confirm_preview:{type:'boolean',enum:[true]}},['request_id','destination_owner','confirm_preview']),
  tool('restore_squad','After reviewing prepare_squad_import, explicitly replace the selected dataset with the verified import. Earlier data is preserved separately; agents and routines remain paused. Requires the exact destination owner and confirm_replace=true. Reuse request_id after a lost response; never generate a retry with another ID.',{source_id:id,request_id:id,destination_owner:owner,confirm_replace:{type:'boolean',enum:[true]}},['source_id','request_id','destination_owner','confirm_replace']),
  tool('reset_squad_data','Explicitly replace the selected personal/team dataset with an empty one, retaining earlier data separately. Does not reset other owners, credentials or external folders. Requires exact owner and confirm_replace=true.',{request_id:id,destination_owner:owner,confirm_replace:{type:'boolean',enum:[true]}},['request_id','destination_owner','confirm_replace']),
  tool('get_squad_data_operation','Read this actor’s durable restore/reset receipt. This does not grant access to another actor’s private import source.',{operation_id:id},['operation_id']),
  tool('restart_squad_data','Acknowledge a committed restore/reset and admit its new private runtime after explicit review. This does not restart macOS or initialize Git. Agents and imported routines stay paused.',{operation_id:id,revision:{type:'integer',minimum:1}},['operation_id','revision']),
  tool('list_cloud_backups','List retained snapshots for the selected immutable personal/team owner. Explicitly connects using the current actor; never uploads local data.',{cursor:{type:'string',maxLength:200}}),
  tool('save_cloud_backup','Explicitly upload a local backup receipt into the exact selected owner and retain a verified complete snapshot. Requires confirm_upload=true and a stable request_id. Cloud conflicts block completion; replacing them needs confirm_replace_cloud=true plus the reviewed keys/revisions.',{request_id:id,backup_id:id,label:{type:'string',minLength:1,maxLength:120},destination_owner:owner,confirm_upload:{type:'boolean',enum:[true]},confirm_replace_cloud:{type:'boolean',enum:[true]},resolutions:{type:'array',maxItems:10_000,items:{type:'object',properties:{key:id,remote_revision:{type:'integer',minimum:0}},required:['key','remote_revision'],additionalProperties:false}}},['request_id','backup_id','label','destination_owner','confirm_upload']),
  tool('get_cloud_backup_operation','Read this actor’s local cloud upload receipt and conflict revisions. An incomplete upload is not a confirmed retained snapshot.',{operation_id:id},['operation_id']),
  tool('download_cloud_backup','Verify and download a retained snapshot as an exact JSON/YAML local receipt. Works for read-only teams; no restore occurs.',{backup_id:id,format},['backup_id']),
  tool('prepare_cloud_restore','Download and verify a retained cloud snapshot into an actor-private restore preview. Does not replace local data; use restore_squad after review.',{backup_id:id,format},['backup_id']),
  tool('remove_cloud_backup','Explicitly remove one retained cloud snapshot plan from the exact selected owner. Live agents, file blobs and local backups are kept. Requires confirm_remove=true.',{backup_id:id,destination_owner:owner,confirm_remove:{type:'boolean',enum:[true]}},['backup_id','destination_owner','confirm_remove']),
  tool('reconnect_cloud_backups','Explicitly replace this actor/owner’s cached Squad cloud session using the current verified Autohand identity. Does not upload or restore data.'),
];
export function createOwnershipTools(bridge) {
  const memberPath = id => `/api/owned/members/${encodeURIComponent(id)}`;
  async function backup(format = 'json', memberIds) {
    const saved = await bridge.post('/api/backups', { format, ...(memberIds ? { memberIds } : {}) });
    return { backup_id: saved.id, format: saved.format, bytes: saved.bytes, members: saved.memberCount, omissions: saved.omissions,
      download_url: await bridge.downloadUrl(saved.downloadUrl), note: 'Download exact JSON/YAML bytes through this URL. Runtime credentials and external working-folder contents are excluded.' };
  }
  async function operation(kind,{source_id,request_id,destination_owner,confirm_replace}) {
    if(confirm_replace!==true)throw Error('Explicit replacement confirmation is required.');
    const context=await bridge.get('/api/ownership/context');
    if(!['kind','issuer','id'].every(field=>context.owner?.[field]===destination_owner[field]))throw Error('The destination owner differs from the selected Squad.');
    // Source digests remain internal, outside MCP’s generic secret redactor.
    const source=kind==='reset'?null:await bridge.get(`/api/ownership/imports/${encodeURIComponent(source_id)}`);
    return bridge.dataOperation({id:request_id,kind,beforeDatasetId:context.pendingOperation?.id===request_id?context.pendingOperation.beforeDatasetId:context.datasetId,
      sourceId:source?.id||null,sourceDigest:source?.sha256||null,confirmation:'replace-current-squad'});
  }
  async function destination(selected) {
    const context=await bridge.get('/api/ownership/context');
    if(!['kind','issuer','id'].every(key=>context.owner?.[key]===selected[key]))throw Error('The destination owner differs from the selected Squad.');
    return context;
  }
  return {
    get_squad_context: async () => { const context = await bridge.get('/api/ownership/context'); return { actor: context.actor, owner: context.owner, label: context.ownerLabel, role: context.role, canWrite: context.canWrite, generation: context.generation,state:context.state,pendingOperation:context.pendingOperation }; },
    list_squad_owners: () => bridge.get('/api/ownership/owners'),
    select_squad_owner: ({ owner }) => bridge.selectOwner(owner),
    get_member_data: ({ member_id }) => bridge.get(memberPath(member_id)),
    get_member_files: ({ member_id }) => bridge.get(`${memberPath(member_id)}/files`),
    get_member_memories: ({ member_id }) => bridge.get(`${memberPath(member_id)}/memories`),
    export_squad: ({ format }) => backup(format),
    export_member: ({ member_id, format }) => backup(format, [member_id]),
    prepare_squad_import:async({format,document})=>{
      const plan=await bridge.upload(`/api/ownership/imports?format=${encodeURIComponent(format)}&requestId=${randomUUID()}`,document,format==='yaml'?'application/yaml':'application/json');
      return {source_id:plan.id,sourceOwner:plan.sourceOwner,members:plan.memberCount,files:plan.fileCount,routines:plan.routineCount,memberSamples:plan.memberSamples,omissionSamples:plan.omissionSamples,warnings:plan.warningSamples,expiresAt:plan.expiresAt};
    },
    prepare_legacy_recovery:async({request_id,destination_owner,state_root='',app_root='',managed_work_root='',browser_data,confirm_preview})=>{
      if(confirm_preview!==true)throw Error('Explicit consent to preview unowned sources is required.');
      await destination(destination_owner);
      const plan=await bridge.post('/api/ownership/legacy/preview',{id:request_id,stateRoot:state_root,appRoot:app_root,workspaceRoot:managed_work_root,...(browser_data?{browser:JSON.parse(browser_data)}:{}),consent:'preview-unowned-data'});
      return {source_id:plan.id,sourceOwner:plan.sourceOwner,members:plan.memberCount,files:plan.fileCount,routines:plan.routineCount,memberSamples:plan.memberSamples,omissionSamples:plan.omissionSamples,warnings:plan.warningSamples,expiresAt:plan.expiresAt};
    },
    restore_squad:args=>operation('restore',args),
    reset_squad_data:args=>operation('reset',args),
    get_squad_data_operation:({operation_id})=>bridge.get(`/api/ownership/operations/${encodeURIComponent(operation_id)}`),
    restart_squad_data:({operation_id,revision})=>bridge.restartData(operation_id,revision),
    list_cloud_backups:({cursor=''}={})=>bridge.get(`/api/ownership/cloud/backups?cursor=${encodeURIComponent(cursor)}`),
    get_cloud_backup_operation:({operation_id})=>bridge.get(`/api/ownership/cloud/operations/${encodeURIComponent(operation_id)}`),
    save_cloud_backup:async({request_id,backup_id,label,destination_owner,confirm_upload,confirm_replace_cloud,resolutions=[]})=>{
      if(confirm_upload!==true||resolutions.length&&confirm_replace_cloud!==true)throw Error('Explicit upload and conflict replacement confirmation are required.');
      await destination(destination_owner);let choices=[];
      if(resolutions.length) {
        const status=await bridge.get(`/api/ownership/cloud/operations/${encodeURIComponent(request_id)}`);
        choices=resolutions.map(choice=>{const current=status.conflicts.find(item=>item.key===choice.key&&item.remoteRevision===choice.remote_revision);if(!current)throw Error('The cloud conflict changed. Read its receipt again.');return {key:current.key,remoteRevision:current.remoteRevision,remoteHash:current.remoteHash,choice:'local'};});
      }
      return bridge.post('/api/ownership/cloud/backups',{id:request_id,backupId:backup_id,label,resolutions:choices});
    },
    download_cloud_backup:async({backup_id,format='json'})=>{const saved=await bridge.post('/api/ownership/cloud/downloads',{id:randomUUID(),planId:backup_id,format});return {backup_id:saved.id,format:saved.format,members:saved.memberCount,bytes:saved.bytes,download_url:await bridge.downloadUrl(saved.downloadUrl)};},
    prepare_cloud_restore:async({backup_id,format='json'})=>{const plan=await bridge.post('/api/ownership/cloud/imports',{id:randomUUID(),planId:backup_id,format});return {source_id:plan.id,sourceOwner:plan.sourceOwner,members:plan.memberCount,files:plan.fileCount,routines:plan.routineCount,memberSamples:plan.memberSamples,omissionSamples:plan.omissionSamples,warnings:plan.warningSamples,expiresAt:plan.expiresAt};},
    remove_cloud_backup:async({backup_id,destination_owner,confirm_remove})=>{if(confirm_remove!==true)throw Error('Explicit cloud snapshot removal confirmation is required.');await destination(destination_owner);return bridge.delete(`/api/ownership/cloud/backups/${encodeURIComponent(backup_id)}`,{confirm:'remove-cloud-backup'});},
    reconnect_cloud_backups:()=>bridge.post('/api/ownership/cloud/reconnect'),
  };
}
