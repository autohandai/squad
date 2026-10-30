import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { memoryColor } from "@/lib/memory-graph";

const SOURCES = [
  ['team', 'Squad memories', 'Shared, private and project memories saved by you or through Squad MCP.'],
  ['members', 'Member memories', 'Durable facts saved in each member’s profile.'],
  ['profiles', 'Profile Markdown', 'The memory documents attached to each member.'],
  ['cli', 'Autohand memory', 'Canonical memories in each member’s isolated Autohand home. Session logs and stale summary caches are excluded.'],
];

export function MemorySettings({ api, onOpenLibrary }) {
  const [data, setData] = useState(null), [draft, setDraft] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/api/memory?limit=1', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setData(value); setDraft(value.settings); } }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [api, retry]);
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(data.settings);
  async function save() {
    setError(''); setMessage(''); setSaving(true);
    try { const saved = await api('/api/memory/settings', { method: 'PATCH', body: JSON.stringify(draft) }); setDraft(saved); const snapshot = await api('/api/memory?limit=1'); setData(snapshot); setMessage('Collection settings saved.'); }
    catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  if (!draft) return <div><p className="text-sm text-muted-foreground">{error ? 'Memory settings could not load.' : 'Loading memory settings…'}</p>{error ? <><p role="alert" className="mt-2 text-sm text-destructive">{error}</p><Button variant="ghost" size="sm" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</Button></> : null}</div>;
  return <div className="grid gap-7" data-testid="memory-settings">
    <div><Button variant="outline" size="sm" onClick={onOpenLibrary}>Open collective memory<ArrowUpRight className="size-3.5" /></Button><p className="mt-3 text-sm text-muted-foreground">{data.collected} memories collected. Collection changes the library and search, while original memories and each member’s saved context stay in place.</p></div>
    <section aria-label="Memory collection sources"><h3 className="mb-2 text-sm font-medium">Collect from</h3>{SOURCES.map(([key, name, description]) => <label key={key} className="flex items-start justify-between gap-6 border-t py-4"><span><span className="block text-sm font-medium">{name}</span><span className="mt-1 block max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</span></span><Switch aria-label={`Collect ${name}`} checked={draft[key]} disabled={saving} onCheckedChange={checked => setDraft(current => ({ ...current, [key]: checked }))} className="mt-0.5 shrink-0" /></label>)}</section>
    <section aria-label="Markdown memory folders"><h3 className="text-sm font-medium">Shared Markdown folders</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose folders of memories for the whole team. Their Markdown content becomes readable by every member through Squad MCP. Squad reads these files without changing them.</p>
      {draft.folders.map((folder, index) => <div key={folder.id || index} className="mt-4 grid gap-2 border-t pt-4"><div className="flex gap-2"><Input aria-label={`Memory folder ${index + 1} name`} placeholder="Collection name" value={folder.label} onChange={event => setDraft(current => ({ ...current, folders: current.folders.map((item, row) => row === index ? { ...item, label: event.target.value } : item) }))} /><Button variant="ghost" size="icon-sm" aria-label={`Remove memory folder ${index + 1}`} onClick={() => setDraft(current => ({ ...current, folders: current.folders.filter((_, row) => row !== index) }))}><X className="size-4" /></Button></div><Input aria-label={`Memory folder ${index + 1} path`} placeholder="Full path to a memory folder" value={folder.path} onChange={event => setDraft(current => ({ ...current, folders: current.folders.map((item, row) => row === index ? { ...item, path: event.target.value } : item) }))} /></div>)}
      <Button variant="ghost" size="sm" className="mt-3 px-0" disabled={draft.folders.length >= 8 || saving} onClick={() => setDraft(current => ({ ...current, folders: [...current.folders, { label: '', path: '' }] }))}><Plus className="size-3.5" />Add Markdown folder</Button>
      <p className="mt-2 text-xs text-muted-foreground">Up to eight folders. Hidden files, symbolic links and non-Markdown files are skipped; collection warnings appear in the memory view.</p>
    </section>
    <section aria-label="Agent memory colors"><h3 className="text-sm font-medium">Member colors</h3><p className="mt-1 mb-3 text-sm text-muted-foreground">A consistent color follows each member’s memories across the graph and list.</p>{data.members.map(member => <label key={member.id} className="flex items-center justify-between gap-5 border-t py-3 text-sm"><span>{member.name}<span className="ml-2 text-xs text-muted-foreground">{member.role}</span></span><input aria-label={`${member.name} memory color`} type="color" value={memoryColor(member.id, draft.colors?.[member.id] || member.color)} disabled={saving} className="h-7 w-9 cursor-pointer border-0 bg-transparent" onChange={event => setDraft(current => ({ ...current, colors: { ...current.colors, [member.id]: event.target.value } }))} /></label>)}</section>
    <div className="flex items-center gap-3 border-t pt-4"><Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save collection settings'}</Button>{dirty ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(data.settings)}>Discard</Button> : null}{message ? <span role="status" className="text-xs text-muted-foreground">{message}</span> : null}</div>
    <section className="border-t pt-5" aria-label="Memory search index"><h3 className="text-sm font-medium">Search on this computer</h3><p className="mt-2 text-sm text-muted-foreground">{data.index.available ? `TurboVec ${data.index.version || ''} · ${data.index.itemCount ?? data.collected} indexed memories` : 'The vector index is unavailable. Keyword search remains available.'}</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Text similarity uses local token and phrase features. It needs no API key, model download, or external embedding service. Private memories stay scoped to their owner; project memories follow the current workspace. Cloud sync remains a separate choice.</p><Button variant="ghost" size="sm" className="mt-3 px-0" disabled={saving} onClick={async () => { setSaving(true); setMessage(''); setError(''); try { const result = await api('/api/memory/reindex', { method: 'POST', body: '{}' }); if (!result.available) throw new Error(result.error); const next = await api('/api/memory?limit=1'); setData(next); setMessage('Search index refreshed.'); } catch (failure) { setError(failure.message); } finally { setSaving(false); } }}>Refresh search index</Button></section>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
