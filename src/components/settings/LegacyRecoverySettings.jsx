import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { currentOwnership } from "@/lib/owned-storage";

// Read only these former Squad data keys, and only after explicit consent.
// General storage, account credentials, vaults and runtime grants are not read.
const browserKeys = ['agents', 'removedAgents', 'messages', 'channels', 'channelThreads', 'channelMessages'];
export function LegacyRecoverySettings({ api, onPrepared }) {
  const context=currentOwnership();
  const [paths,setPaths]=useState({stateRoot:'',appRoot:'',workspaceRoot:''});
  const [includeBrowser,setIncludeBrowser]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[prepared,setPrepared]=useState(false);
  async function preview() {
    setBusy(true);setError('');setPrepared(false);
    try {
      let browser;
      if(includeBrowser) {
        browser={};let bytes=0;
        for(const key of browserKeys) {
          const raw=globalThis.localStorage.getItem(`autohandSquad.v1.${key}`);
          if(raw!==null){bytes+=new TextEncoder().encode(raw).length;if(bytes>6*1024*1024)throw Error('Old browser data exceeds this preview’s 6 MiB limit. Keep the originals and use the documented recovery API for a smaller selection.');browser[key]=JSON.parse(raw);}
        }
      }
      const plan=await api('/api/ownership/legacy/preview',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),...paths,...(browser?{browser}:{}),consent:'preview-unowned-data'})});
      onPrepared({...plan,fileName:'Manually recovered unowned data'});setPrepared(true);
    } catch(failure){setError(failure.message||'The old data could not be previewed. Nothing was replaced.');}
    finally{setBusy(false);}
  }
  return <section className="space-y-4 py-6" aria-labelledby="legacy-recovery-title">
    <h2 id="legacy-recovery-title" className="font-medium">Recover older unowned data</h2>
    <p className="max-w-prose text-muted-foreground">Choose data saved before Squad recorded account ownership. Original files and browser data stay intact. A verified preview appears under Restore a backup; importing into {context.ownerLabel} requires a separate replacement confirmation.</p>
    <div className="max-w-xl space-y-3">
      {[
        ['stateRoot','Old Squad data folder','Folder containing channels.json, chats and artifacts'],
        ['appRoot','Old agent data folder','Folder containing agents/'],
        ['workspaceRoot','Old managed work folder (optional)','Include assigned project files inside this folder'],
      ].map(([key,title,placeholder])=><label key={key} className="block space-y-1.5"><span>{title}</span><Input value={paths[key]} disabled={busy} placeholder={placeholder} onChange={event=>setPaths(previous=>({...previous,[key]:event.target.value}))}/></label>)}
    </div>
    <label className="flex items-start gap-3"><Checkbox checked={includeBrowser} disabled={busy} onCheckedChange={value=>setIncludeBrowser(value===true)}/><span>Include old Squad members and conversations stored in this browser</span></label>
    <label className="flex max-w-prose items-start gap-3"><Checkbox checked={consent} disabled={busy} onCheckedChange={value=>setConsent(value===true)}/><span>I choose these unowned sources for recovery into {context.ownerLabel}.{context.owner.kind==='team'?' Importing will make this data visible to people with access to this team.':''}</span></label>
    <p className="max-w-prose text-xs text-muted-foreground">Use absolute or ~/ paths. Credentials, live sessions, Git authority, pending work and browser-only automations are excluded. Nothing is scanned before you choose Preview.</p>
    <Button variant="outline" disabled={busy||!consent||!paths.stateRoot&&!paths.appRoot&&!includeBrowser} onClick={()=>void preview()}>{busy?'Checking old data…':'Preview older data'}</Button>
    {prepared?<p role="status" className="text-muted-foreground">Older data verified. Review the restore preview before importing.</p>:null}
    {error?<p role="alert" className="text-destructive">{error}</p>:null}
  </section>;
}
