import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EffortSlider } from "@/components/chat/EffortSlider";
import { HarnessModelSelect } from "./HarnessModelSelect";
import { effortLevelsFor, fetchHarnesses } from "@/lib/harness";
import { MAX_FALLBACKS, normalizeModelRouting } from "@/lib/model-routing";

export function MemberFallbacks({ agent, api, providerSettings, updateAgent }) {
  const saved=normalizeModelRouting(agent.modelRouting);
  const [draft,setDraft]=useState(saved);
  const [harnesses,setHarnesses]=useState([]);
  const [health,setHealth]=useState({});
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const savedKey=JSON.stringify(saved);
  useEffect(()=>{setDraft(JSON.parse(savedKey));setError('');},[agent.id,savedKey]);
  useEffect(()=>{let active=true;setLoaded(false);Promise.all([fetchHarnesses(api),api(`/api/members/${encodeURIComponent(agent.id)}/model-routing`)]).then(([engines,state])=>{if(active){setHarnesses(engines);setHealth(state.health||{});}}).catch(problem=>{if(active)setError(problem.message);}).finally(()=>{if(active)setLoaded(true);});return()=>{active=false;};},[api,agent.id]);
  const connected=harnesses.filter(item=>item.status==='ready'&&(!item.fetchOnUse||item.installed));
  const providers=Object.values(providerSettings?.providers||{}).filter(item=>item.enabled&&(item.apiKeyConfigured||item.accountReady||!item.requiresApiKey));
  const dirty=JSON.stringify(draft)!==savedKey;
  const patch=(index,update)=>setDraft(current=>({...current,fallbacks:current.fallbacks.map((row,i)=>i===index?{...row,...update}:row)}));
  function add(){const engine=connected.find(item=>item.id!==agent.harness?.id)||connected[0];if(!engine)return;setDraft(current=>({...current,fallbacks:[...current.fallbacks,{harness:{id:engine.id,model:'',effort:''},...(engine.id==='autohand'?{provider:providerSettings?.defaultProvider||'autohandai'}:{})}]}));}
  function move(index,delta){setDraft(current=>{const rows=[...current.fallbacks];[rows[index],rows[index+delta]]=[rows[index+delta],rows[index]];return{...current,fallbacks:rows};});}
  async function save(){setError('');setSaving(true);try{const normalized=normalizeModelRouting(draft,{strict:true});const result=await updateAgent(agent.id,{modelRouting:normalized,updatedAt:new Date().toISOString()});if(result?.error)throw new Error(result.error);setDraft(normalized);}catch(problem){setError(problem.message);}finally{setSaving(false);}}
  async function reset(){try{await api(`/api/members/${encodeURIComponent(agent.id)}/model-routing/reset`,{method:'POST',body:'{}'});setHealth({});setError('');}catch(problem){setError(problem.message);}}
  return <section className="grid gap-5 border-t border-border/70 pt-7 lg:grid-cols-[220px_minmax(0,1fr)]" aria-label="Fallbacks">
    <div><h2 className="text-sm font-medium">Fallbacks</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Try these in order when the primary engine cannot answer. Chat, memory, files and workspace carry over.</p></div>
    <div className="grid gap-4">
      <p className="text-xs leading-5 text-muted-foreground">Startup, sign-in and usage failures can switch immediately. An engine that does not respond gets one retry. Squad tries the primary again after five minutes. Your permission choices stay in force; API-key models use their provider’s billing.</p>
      {!draft.fallbacks.length?<p className="text-sm text-muted-foreground">No fallbacks yet.</p>:<ol className="divide-y divide-border/60">{draft.fallbacks.map((row,index)=>{
        const readiness=harnesses.find(item=>item.id===row.harness.id);
        const levels=effortLevelsFor(row.harness.id,readiness,row.harness.model);
        const providerId=row.provider||providerSettings?.defaultProvider||'autohandai';
        return <li key={index} className="grid gap-3 py-4 first:pt-0" data-fallback-row={index}>
          <div className="flex items-center gap-2"><span className="w-4 text-xs text-muted-foreground">{index+1}</span><Select value={row.harness.id} onValueChange={id=>patch(index,{harness:{id,model:'',effort:''},provider:id==='autohand'?providerSettings?.defaultProvider||'autohandai':''})}><SelectTrigger aria-label={`Fallback engine ${index+1}`} className="h-9 flex-1"><SelectValue/></SelectTrigger><SelectContent>{connected.map(engine=><SelectItem key={engine.id} value={engine.id}>{engine.label}</SelectItem>)}{!connected.some(engine=>engine.id===row.harness.id)?<SelectItem value={row.harness.id}>{readiness?.label||row.harness.id} · unavailable</SelectItem>:null}</SelectContent></Select>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move fallback ${index+1} up`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp className="size-3.5"/></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Move fallback ${index+1} down`} disabled={index===draft.fallbacks.length-1} onClick={()=>move(index,1)}><ArrowDown className="size-3.5"/></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove fallback ${index+1}`} onClick={()=>setDraft(current=>({...current,fallbacks:current.fallbacks.filter((_,i)=>i!==index)}))}><Trash2 className="size-3.5"/></Button>
          </div>
          {row.harness.id==='autohand'?<Select value={providerId} onValueChange={provider=>patch(index,{provider,harness:{...row.harness,model:''}})}><SelectTrigger aria-label={`Fallback ${index+1} provider`} className="h-9"><SelectValue/></SelectTrigger><SelectContent>{providers.map(provider=><SelectItem key={provider.id} value={provider.id}>{provider.label||provider.id}</SelectItem>)}{!providers.some(provider=>provider.id===providerId)?<SelectItem value={providerId}>{providerSettings?.providers?.[providerId]?.label||providerId} · unavailable</SelectItem>:null}</SelectContent></Select>:null}
          <HarnessModelSelect api={api} harness={row.harness.id} executablePath={row.harness.executablePath} provider={row.provider||''} workspace={agent.workspace} value={row.harness.model||''} label={`Fallback ${index+1} model`} onChange={model=>patch(index,{harness:{...row.harness,model}})}/>
          {levels.length?<EffortSlider id={`fallback-${index}-effort`} levels={levels} value={row.harness.effort||''} onChange={effort=>patch(index,{harness:{...row.harness,effort}})}/>:null}
          {readiness&&readiness.status!=='ready'?<p className="text-xs text-muted-foreground">{readiness.detail} This fallback will be skipped until it can start.</p>:null}
        </li>;
      })}</ol>}
      <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={!loaded||!connected.length||draft.fallbacks.length>=MAX_FALLBACKS} onClick={add}><Plus className="size-3.5"/>Add fallback</Button>
      {loaded&&!connected.length?<p className="text-xs text-muted-foreground">Connect a coding engine in Engine settings to add a fallback.</p>:null}
      <label className="flex items-start justify-between gap-6 border-t border-border/60 pt-4"><span><span className="block text-sm font-medium">Let this member manage fallbacks</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">The member can select and reorder connected engines when you ask. It cannot turn this permission on.</span></span><Switch aria-label="Let this member manage fallbacks" checked={draft.allowAgentChanges} onCheckedChange={allowAgentChanges=>setDraft(current=>({...current,allowAgentChanges}))}/></label>
      {Object.values(health).some(route=>route.blockedUntil>Date.now())?<div className="flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>A failed engine is cooling down before its next check.</span><Button type="button" variant="ghost" size="sm" onClick={reset}>Retry primary now</Button></div>:null}
      {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
      <div className="flex gap-2"><Button type="button" disabled={!dirty||saving} onClick={save}>{saving?'Saving…':'Save fallbacks'}</Button>{dirty?<Button type="button" variant="ghost" disabled={saving} onClick={()=>setDraft(saved)}>Discard</Button>:null}</div>
    </div>
  </section>;
}
