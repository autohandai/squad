import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { currentOwnership, ownedLocalStorage } from "@/lib/owned-storage";
import { ownershipFetch, ownershipUrl } from "@/lib/ownership-client";
import { CloudBackupSettings } from "./CloudBackupSettings";
import { LegacyRecoverySettings } from "./LegacyRecoverySettings";

function draftDownload(value,name) {
  const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function BackupSettings({api,agents=[],onFlush}) {
  const context=currentOwnership();
  const [selected,setSelected]=useState(()=>agents.map(agent=>agent.id)),[format,setFormat]=useState('json');
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[receipt,setReceipt]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false);
  const retainedDraft=ownedLocalStorage.getItem('autohandSquad.v1.browserDraftRecovery');
  async function run(name,action) {setBusy(name);setError('');try{await action();}catch(failure){setError(failure.message||'Squad could not finish this backup operation.');}finally{setBusy('');}}
  async function exportBackup() {
    await onFlush?.();
    const saved=await api('/api/backups',{method:'POST',body:JSON.stringify({format,...(selected.length===agents.length?{}:{memberIds:selected})})});setReceipt(saved);return saved;
  }
  async function prepare(file) {
    setPreview(null);setConfirmed(false);
    if(!file)return;
    if(file.size>256*1024*1024)throw Error('Choose a JSON or YAML backup up to 256 MiB.');
    const encoding=/\.ya?ml$/i.test(file.name)?'yaml':'json';
    const response=await ownershipFetch(`/api/ownership/imports?format=${encoding}&requestId=${crypto.randomUUID()}`,{method:'POST',headers:{'content-type':encoding==='yaml'?'application/yaml':'application/json'},body:await file.arrayBuffer()});
    const envelope=await response.json();
    if(!response.ok||!envelope.success)throw Error(typeof envelope.error==='string'?envelope.error:'This backup could not be verified.');
    setPreview({...envelope.data,fileName:file.name});
  }
  async function restore() {
    if(!preview||!confirmed)throw Error('Review and confirm the selected destination first.');
    await onFlush?.();
    await api('/api/ownership/operations',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),kind:'restore',beforeDatasetId:context.datasetId,sourceId:preview.id,sourceDigest:preview.sha256,confirmation:'replace-current-squad'})});
    window.location.replace('/squad');
  }
  return <div className="divide-y divide-border/65 text-sm">
    <section className="space-y-3 pb-6">
      <h2 className="font-medium">{context?.ownerLabel||'Selected Squad'}</h2>
      <p className="max-w-prose text-muted-foreground">Save your agents, memories, conversations, skills, routines, artifacts and managed work files. JSON and YAML contain the same versioned, documented data.</p>
      <p className="max-w-prose text-muted-foreground">Provider credential stores, live engine sessions, Git metadata and external project contents are excluded. The backup lists any omitted files; file and document limits are checked explicitly.</p>
    </section>
    <section className="space-y-4 py-6" aria-labelledby="backup-members">
      <div className="flex items-center justify-between gap-4"><h2 id="backup-members" className="font-medium">Members to include</h2><Button variant="ghost" size="sm" onClick={()=>setSelected(agents.map(agent=>agent.id))} disabled={Boolean(busy)}>Select all</Button></div>
      <div className="space-y-3">{agents.map(agent=><label key={agent.id} className="flex w-fit items-center gap-3"><Checkbox disabled={Boolean(busy)} checked={selected.includes(agent.id)} onCheckedChange={checked=>setSelected(ids=>checked?[...ids,agent.id]:ids.filter(id=>id!==agent.id))}/><span>{agent.name}<span className="ml-2 text-muted-foreground">{agent.role}</span></span></label>)}</div>
      <p className="text-xs text-muted-foreground">Including every member also includes shared channels and team memory.</p>
      <div className="flex flex-wrap items-center gap-3"><Select value={format} onValueChange={setFormat} disabled={Boolean(busy)}><SelectTrigger className="w-32" aria-label="Backup format"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="json">JSON</SelectItem><SelectItem value="yaml">YAML</SelectItem></SelectContent></Select><Button variant="outline" disabled={Boolean(busy)||Boolean(agents.length&&!selected.length)} onClick={()=>run('export',exportBackup)}>{busy==='export'?'Checking and saving…':'Export backup'}</Button></div>
      {receipt?<div className="space-y-2" role="status"><a className="underline underline-offset-4" href={ownershipUrl(receipt.downloadUrl)} target="_blank" rel="noreferrer">Download {receipt.format.toUpperCase()} backup · {receipt.memberCount} {receipt.memberCount===1?'member':'members'}</a><p className="text-xs text-muted-foreground">{receipt.omissions?.length||0} {receipt.omissions?.length===1?'exclusion':'exclusions'} recorded in the backup. Desktop downloads open in your browser.</p></div>:null}
    </section>
    <CloudBackupSettings api={api} agents={agents} format={format} canSave={(agents.length===0||selected.length>0)&&!busy} createBackup={exportBackup} onPrepared={value=>{setPreview(value);setConfirmed(false);}}/>
    <section className="space-y-4 py-6" aria-labelledby="restore-backup">
      <h2 id="restore-backup" className="font-medium">Restore a backup</h2>
      <p className="max-w-prose text-muted-foreground">Choose a portable JSON or YAML file. Squad verifies its format, file checksums and compatibility before asking you to restore.</p>
      <Input type="file" accept=".json,.yaml,.yml,application/json,application/yaml" aria-label="Choose Squad backup" disabled={Boolean(busy)} onClick={event=>{event.currentTarget.value='';}} onChange={event=>{const file=event.target.files?.[0];void run('preview',()=>prepare(file));}}/>
      {busy==='preview'?<p role="status" className="text-muted-foreground">Verifying the backup and its files…</p>:null}
      {preview?<div className="space-y-4">
        <p className="font-medium">Restore into {context.ownerLabel}</p>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">Verified file: {preview.fileName}</p>
        <p className="text-muted-foreground">{preview.memberCount} {preview.memberCount===1?'member':'members'} · {preview.fileCount} {preview.fileCount===1?'file':'files'} · {preview.routineCount} {preview.routineCount===1?'routine':'routines'} · {preview.omissionCount} recorded {preview.omissionCount===1?'exclusion':'exclusions'}</p>
        <ul className="space-y-1 [overflow-wrap:anywhere]">{preview.memberSamples.map((member,index)=><li key={index}>{member.name}{member.role?` · ${member.role}`:''}</li>)}</ul>
        {preview.memberCount>preview.memberSamples.length?<p className="text-muted-foreground">And {preview.memberCount-preview.memberSamples.length} more members.</p>:null}
        <p className="max-w-prose text-muted-foreground">This opens a new dataset containing the imported members. Your current dataset is preserved separately. Managed work files receive new folders; external folders and credentials require reconnection. Agents and routines remain paused.</p>
        {preview.warningSamples?.map((warning,index)=><p key={index} className="max-w-prose text-muted-foreground">{warning}</p>)}
        {preview.omissionSamples.length?<ul className="space-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{preview.omissionSamples.map((item,index)=><li key={index}>{item.path}: {item.reason}</li>)}</ul>:null}
        <label className="flex items-start gap-3"><Checkbox checked={confirmed} disabled={Boolean(busy)} onCheckedChange={value=>setConfirmed(value===true)}/><span>I understand this replaces the selected dataset for {context.ownerLabel}.{context.owner.kind==='team'?' Everyone with access to this team will see the imported data.':''}</span></label>
        <Button variant="outline" disabled={Boolean(busy)||!confirmed} onClick={()=>run('restore',restore)}>{busy==='restore'?'Restoring…':'Restore into selected Squad'}</Button>
      </div>:null}
    </section>
    <LegacyRecoverySettings api={api} onPrepared={value=>{setPreview(value);setConfirmed(false);}}/>
    {error||retainedDraft?<section className="space-y-3 py-6">
      {error?<p role="alert" className="text-destructive">{error}</p>:null}
      {retainedDraft?<p className="text-muted-foreground">An earlier local conversation draft was preserved when the saved version was loaded. You can download it before comparing or merging conversations.</p>:null}
      <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={()=>draftDownload(retainedDraft||ownedLocalStorage.getItem('autohandSquad.v1.messages')||'{}','squad-conversation-draft.json')}>Download local conversation draft</Button><Button variant="ghost" onClick={()=>window.location.reload()}>Reload saved conversations</Button></div>
    </section>:null}
  </div>;
}
