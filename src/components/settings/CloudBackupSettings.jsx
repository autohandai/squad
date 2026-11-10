import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { currentOwnership, ownedLocalStorage } from "@/lib/owned-storage";
import { ownershipUrl } from "@/lib/ownership-client";

const PENDING='autohandSquad.v1.cloudBackupPending';
function pending(){try{return JSON.parse(ownedLocalStorage.getItem(PENDING)||'null');}catch{return null;}}
export function CloudBackupSettings({api,createBackup,onPrepared,format='json',agents=[],canSave=true,readOnly=false}) {
  const context=currentOwnership();
  const [label,setLabel]=useState(()=>`Squad backup ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC`);
  const [intent,setIntent]=useState(pending),[operation,setOperation]=useState(null),[backups,setBackups]=useState([]),[page,setPage]=useState(null);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[replace,setReplace]=useState(false),[removeId,setRemoveId]=useState(''),[download,setDownload]=useState(null);
  async function run(name,action){setBusy(name);setError('');setNotice('');try{await action();}catch(failure){setError(failure.message||'Cloud backups could not be reached. Your local data is kept.');}finally{setBusy('');}}
  async function load(cursor='') {
    const result=await api(`/api/ownership/cloud/backups?cursor=${encodeURIComponent(cursor)}`);
    setBackups(previous=>cursor?[...new Map([...previous,...result.backups].map(backup=>[backup.id,backup])).values()]:result.backups);setPage(result);
    if(!result.backups.length&&!cursor)setNotice('No cloud backups are saved for this owner yet.');
  }
  async function applyResult(result) {
    setOperation(result);setReplace(false);
    if(result.phase==='complete') {
      ownedLocalStorage.removeItem(PENDING);setIntent(null);setNotice('Cloud backup saved.');
      try{await load();}catch{setNotice('Cloud backup saved. Reload the list to see it.');}
    }
  }
  async function upload(source,resolutions=[]) {
    await applyResult(await api('/api/ownership/cloud/backups',{method:'POST',body:JSON.stringify({...source,resolutions})}));
  }
  async function save() {
    const local=await createBackup(),source={id:crypto.randomUUID(),backupId:local.id,label:label.trim()};
    ownedLocalStorage.setItem(PENDING,JSON.stringify(source));setIntent(source);setOperation(null);await upload(source);
  }
  return <section className="min-w-0 space-y-4 py-6 text-sm [overflow-wrap:anywhere]" aria-labelledby="cloud-backups-title">
    <h2 id="cloud-backups-title" className="font-medium">Cloud backups</h2>
    <p className="max-w-prose text-muted-foreground">{readOnly?'Download retained snapshots belonging to':'Upload the selected members, saved knowledge and managed files to'} {context?.ownerLabel||'the selected owner'}.{context?.owner?.kind==='team'?' Authorized members of this Autohand team can retrieve its backups.':''} Saved cloud snapshots remain until explicitly removed.</p>
    {!readOnly?<div className="space-y-2"><label htmlFor="cloud-backup-name" className="text-xs text-muted-foreground">Backup name</label><Input id="cloud-backup-name" value={label} onChange={event=>setLabel(event.target.value)} maxLength={120} disabled={Boolean(busy)||Boolean(intent)} className="max-w-md"/></div>:null}
    <div className="flex flex-wrap gap-2">
      {!readOnly?<Button variant="outline" disabled={Boolean(busy)||Boolean(intent)||!canSave||!label.trim()} onClick={()=>run('save',save)}>{busy==='save'?'Saving cloud backup…':'Save selected members to cloud'}</Button>:null}
      <Button variant="ghost" disabled={Boolean(busy)} onClick={()=>run('list',()=>load())}>{busy==='list'?'Loading…':'Load cloud backups'}</Button>
    </div>
    {intent&&!readOnly?<div className="space-y-3">
      <p className="text-muted-foreground">Pending snapshot: {intent.label}. Its local backup is kept. {operation?.phase==='conflicts'?'Cloud changes need your decision before this upload can finish.':'Check its progress or retry the same request to recover a lost response.'}</p>
      {operation?.conflicts?.length?<>
        <ul className="space-y-1 [overflow-wrap:anywhere]">{operation.conflicts.map(item=><li key={item.key}>{agents.find(agent=>agent.id===item.id)?.name||item.id} · cloud revision {item.remoteRevision}</li>)}</ul>
        <p className="text-muted-foreground">{operation.publishedRecords} member records have been confirmed so far. Completion of the whole cloud snapshot has not been confirmed.</p>
        <label className="flex items-start gap-3"><Checkbox checked={replace} disabled={Boolean(busy)} onCheckedChange={value=>setReplace(value===true)}/><span>Replace these conflicting cloud records with the versions in this local backup.</span></label>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!replace||Boolean(busy)} onClick={()=>run('resume',()=>upload(intent,operation.conflicts.map(item=>({key:item.key,remoteRevision:item.remoteRevision,remoteHash:item.remoteHash,choice:'local'}))))}>Use this backup’s local versions</Button><Button variant="ghost" disabled={Boolean(busy)} onClick={()=>{ownedLocalStorage.removeItem(PENDING);setIntent(null);setOperation(null);setNotice('Conflicting cloud versions kept. Your local backup is still available to download.');}}>Keep conflicting cloud versions</Button></div>
      </>:<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(busy)} onClick={()=>run('resume',()=>upload(intent))}>Resume cloud backup</Button><Button variant="ghost" disabled={Boolean(busy)} onClick={()=>run('status',async()=>applyResult(await api(`/api/ownership/cloud/operations/${intent.id}`)))}>Check progress</Button></div>}
    </div>:null}
    {notice?<p role="status" className="text-muted-foreground">{notice}</p>:null}
    {error?<div className="space-y-2"><p role="alert" className="text-destructive">{error}</p><Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={()=>run('reconnect',async()=>{await api('/api/ownership/cloud/reconnect',{method:'POST'});await load();})}>Reconnect cloud access</Button></div>:null}
    {download?<a className="inline-block underline underline-offset-4" href={ownershipUrl(download.downloadUrl)} target="_blank" rel="noreferrer">Download verified {download.format.toUpperCase()} cloud snapshot</a>:null}
    <div className="divide-y divide-border/65">{backups.map(backup=><div key={backup.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium [overflow-wrap:anywhere]">{backup.label||'Squad backup'}</span><time className="text-xs text-muted-foreground" dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString()}</time></div>
      <p className="text-xs text-muted-foreground">{backup.memberCount} {backup.memberCount===1?'member':'members'}</p>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={()=>run('download',async()=>setDownload(await api('/api/ownership/cloud/downloads',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),planId:backup.id,format})})))}>Download {format.toUpperCase()}</Button>
        {!readOnly?<Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={()=>run('preview',async()=>{const preview=await api('/api/ownership/cloud/imports',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),planId:backup.id,format})});onPrepared({...preview,fileName:backup.label||'Cloud backup'});})}>Preview restore</Button>:null}
        {!readOnly?<Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={()=>setRemoveId(backup.id)}>Remove</Button>:null}
      </div>
      {removeId===backup.id?<div className="space-y-2"><p>Remove this retained cloud snapshot? Live agents and local backup files are kept.</p><div className="flex gap-2"><Button variant="destructive" size="sm" disabled={Boolean(busy)} onClick={()=>run('remove',async()=>{await api(`/api/ownership/cloud/backups/${backup.id}`,{method:'DELETE',body:JSON.stringify({confirm:'remove-cloud-backup'})});setBackups(rows=>rows.filter(row=>row.id!==backup.id));setRemoveId('');})}>Remove cloud snapshot</Button><Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={()=>setRemoveId('')}>Cancel</Button></div></div>:null}
    </div>)}</div>
    {page?.hasMore?<Button variant="ghost" disabled={Boolean(busy)} onClick={()=>run('list',()=>load(page.cursor))}>More backups</Button>:null}
  </section>;
}
