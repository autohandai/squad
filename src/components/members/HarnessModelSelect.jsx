import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A catalog belongs to an engine/provider/workspace, never another row. */
export function HarnessModelSelect({ api, harness = 'autohand', provider = '', executablePath = '', workspace = '', value = '', onChange, label = 'Model', allowDefault = true, disabled = false }) {
  const [state, setState] = useState({ status: 'loading', models: [] });
  const [refresh, setRefresh] = useState(0);
  const [custom, setCustom] = useState(false);
  const key = JSON.stringify([harness, provider, executablePath, workspace]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setCustom(false); setState(current => ({ status: 'loading', models: current.key === key ? current.models : [], key }));
    const params = new URLSearchParams({ id: harness, ...(provider ? { provider } : {}), ...(executablePath ? { executablePath } : {}), ...(workspace ? { workspace } : {}), ...(refresh ? { refresh: '1' } : {}) });
    api(`/api/harnesses/models?${params}`, { signal: controller.signal }).then(data => { if (active) setState({ ...data, key, status: 'ready' }); }).catch(error => { if (active) setState(current => ({ ...current, key, status: 'error', detail: error.message })); });
    return () => { active = false; controller.abort(); };
  }, [api, key, refresh]);
  // A parent can change the engine before the loading effect runs. Never
  // render the previous engine's list during that intermediate render.
  const catalog = state.key === key ? state : { status: 'loading', models: [] };
  const customInput = custom && state.key === key;
  const known = catalog.models.some(model => model.id === value);
  const engineManaged = catalog.status === 'ready' && catalog.modelSelection === false;
  return <div className="grid gap-2">
    <div className="flex items-center gap-2">
      <Select value={customInput ? '__custom' : value || (allowDefault ? '__default' : '')} disabled={disabled || catalog.status === 'loading' || engineManaged} onValueChange={next => {
        if (next === '__custom') { setCustom(true); return; }
        setCustom(false); onChange(next === '__default' ? '' : next);
      }}>
        <SelectTrigger aria-label={label} className="h-10 w-full"><SelectValue placeholder={catalog.status === 'loading' ? 'Loading models…' : allowDefault ? 'Engine default' : 'Choose a model'} /></SelectTrigger>
        <SelectContent>
          {allowDefault ? <SelectItem value="__default">Engine default{catalog.defaultModel ? ` · ${catalog.defaultModel}` : ''}</SelectItem> : null}
          {catalog.models.map(model => <SelectItem key={model.id} value={model.id}>{model.label}{model.label !== model.id ? ` · ${model.id}` : ''}</SelectItem>)}
          {value && !known ? <SelectItem value={value}>{value} · saved ID</SelectItem> : null}
          <SelectItem value="__custom">Custom model ID…</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Refresh ${label.toLowerCase()} list`} disabled={disabled || catalog.status === 'loading'} onClick={() => setRefresh(current => current + 1)}><RefreshCw className="size-3.5" /></Button>
    </div>
    {customInput ? <Input aria-label={`Custom ${label.toLowerCase()} ID`} value={value} onChange={event => onChange(event.target.value)} placeholder="Exact model ID" /> : null}
    {catalog.detail ? <p className="text-xs text-muted-foreground" role={catalog.status === 'error' ? 'alert' : undefined}>{catalog.detail}</p> : null}
    {engineManaged ? <p className="text-xs text-muted-foreground">This engine manages its own model; it did not report selectable models.</p> : catalog.status === 'ready' && !catalog.models.length ? <p className="text-xs text-muted-foreground">No models reported. Use the engine default, refresh, or enter a custom ID.</p> : null}
    {value && !known && catalog.status === 'ready' ? <p className="text-xs text-muted-foreground">The saved ID is not in the current list. It will be kept until you change it.</p> : null}
  </div>;
}
