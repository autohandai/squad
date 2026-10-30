import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, GitBranch, List, Loader2, Pin, Plus, RefreshCw, Search, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MemoryGraph } from "./MemoryGraph";
import { MEMORY_KINDS, memoryColor, scopeLabel } from "@/lib/memory-graph";
import { cn } from "@/lib/utils";
import "./memory.css";

const EMPTY = { records: [], members: [], groups: [], links: [], warnings: [], collected: 0, total: 0, index: {} };
const when = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Time not recorded';
const initialFilter = () => {
  const query = new URLSearchParams(window.location.search);
  return Object.fromEntries(['owner', 'scope', 'kind', 'group'].map(key => [key, query.get(key) || '']));
};

export function MemoryChoice({ label, value, onChange, children, className }) {
  return <Select value={value || '__all'} onValueChange={next => onChange(next === '__all' ? '' : next)}><SelectTrigger aria-label={label} className={cn('h-8 w-auto min-w-32 gap-3 border-transparent bg-transparent text-xs shadow-none', className)}><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{children}</SelectContent></Select>;
}

function MemoryInspector({ record, data, api, onChanged, onSelect, onClose, navigate }) {
  const [draft, setDraft] = useState({ title: record.title, kind: record.kind, groupId: record.groupId || '', tags: record.tags.join(', '), text: record.text });
  const [touched, setTouched] = useState({}), [baseText, setBaseText] = useState(record.text);
  const [editText, setEditText] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [forgetting, setForgetting] = useState(false);
  const [target, setTarget] = useState(''), [relation, setRelation] = useState('references'), [evidence, setEvidence] = useState('');
  const owner = data.members.find(member => member.id === record.ownerId);
  const links = data.links.filter(link => link.from === record.id || link.to === record.id);
  const changed = Object.keys(touched).length > 0;
  const recordVersion = JSON.stringify([record.title, record.kind, record.groupId, record.tags, record.text]);
  useEffect(() => {
    if (!Object.keys(touched).length) { setDraft({ title: record.title, kind: record.kind, groupId: record.groupId || '', tags: record.tags.join(', '), text: record.text }); setBaseText(record.text); }
  }, [recordVersion]);
  function change(field, value) { setSaved(false); setTouched(current => ({ ...current, [field]: true })); setDraft(current => ({ ...current, [field]: value })); }
  async function act(operation) {
    setError(''); setPending(true); setSaved(false);
    try { await operation(); await onChanged(); return true; }
    catch (failure) { setError(failure.message); return false; }
    finally { setPending(false); }
  }
  async function save() {
    if (await act(async () => {
      if (touched.text && record.editable) await api(`/api/memory/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: JSON.stringify({ text: draft.text, expectedText: baseText }) });
      const values = { title: draft.title, kind: draft.kind, groupId: draft.groupId, tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean) };
      const patch = Object.fromEntries(Object.entries(values).filter(([field]) => touched[field]));
      if (Object.keys(patch).length) await api(`/api/memory/${encodeURIComponent(record.id)}/metadata`, { method: 'PATCH', body: JSON.stringify(patch) });
    })) { setSaved(true); setEditText(false); setTouched({}); setBaseText(draft.text); }
  }
  return <aside className="memory-inspector min-h-0 overflow-y-auto border-l bg-background p-5" aria-label="Memory details">
    <div className="mb-5 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Memory details</span><Button variant="ghost" size="icon-sm" aria-label="Close memory details" onClick={onClose}><X className="size-4" /></Button></div>
    <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full" style={{ backgroundColor: memoryColor(record.ownerId, data.settings?.colors?.[record.ownerId] || owner?.color) }} />{owner?.name || record.authorName || 'Whole team'}<span>·</span>{scopeLabel(record)}</div>
    <h2 className="select-text text-base font-semibold leading-snug">{record.title}</h2>
    {editText ? <Textarea aria-label="Memory text" value={draft.text} onChange={event => change('text', event.target.value)} maxLength={500} className="mt-4 min-h-40" /> : <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed select-text">{record.text}</p>}
    {baseText !== record.text && changed ? <p className="mt-2 text-xs text-muted-foreground">This source changed while you were editing.<Button variant="ghost" size="sm" className="h-7 px-1 text-xs" onClick={() => { setDraft({ title: record.title, kind: record.kind, groupId: record.groupId || '', tags: record.tags.join(', '), text: record.text }); setBaseText(record.text); setTouched({}); setError(''); }}>Reload current memory</Button></p> : null}
    <div className="mt-4 flex items-center gap-2">
      {record.editable ? <Button variant="ghost" size="sm" className="h-7 px-0 text-xs" onClick={() => setEditText(value => !value)}>{editText ? 'Preview' : 'Edit text'}</Button> : <span className="text-xs text-muted-foreground">Collected from its source · read only here</span>}
      <Button variant="ghost" size="icon-sm" aria-label={record.pinned ? 'Unpin memory' : 'Pin memory'} className="ml-auto" disabled={pending} onClick={() => act(() => api(`/api/memory/${encodeURIComponent(record.id)}/metadata`, { method: 'PATCH', body: JSON.stringify({ pinned: !record.pinned }) }))}><Pin className={cn('size-3.5', record.pinned && 'fill-current')} /></Button>
    </div>
    <section className="mt-6 border-t pt-5" aria-label="Memory source">
      <h3 className="text-xs font-medium">Source</h3><p className="mt-2 text-sm">{record.sourceLabel}</p><p className="mt-1 text-xs text-muted-foreground">{record.authorName ? `Saved by ${record.authorName} · ` : ''}{when(record.updatedAt || record.createdAt)}</p>
      {record.workspace ? <p className="mt-2 break-all text-xs text-muted-foreground select-text">Project: {record.workspace}</p> : null}
      {record.sourcePath ? <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-muted-foreground select-text">{record.sourcePath}{record.sourceLine ? `:${record.sourceLine}` : ''}</p> : null}
      {record.sourceHref ? <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 px-0 text-xs" onClick={() => navigate(record.sourceHref)}>Open member memory<ArrowUpRight className="size-3" /></Button> : null}
    </section>
    <section className="mt-6 grid gap-3 border-t pt-5" aria-label="Organize memory">
      <h3 className="text-xs font-medium">Organize</h3>
      <label className="grid gap-1.5 text-xs text-muted-foreground">Title<Input aria-label="Memory title" className="h-8 text-sm text-foreground" maxLength={80} value={draft.title} onChange={event => change('title', event.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs text-muted-foreground">Kind<MemoryChoice label="Memory kind" value={draft.kind} onChange={kind => change('kind', kind)} className="w-full min-w-0 border-input">{MEMORY_KINDS.map(kind => <SelectItem key={kind} value={kind} className="capitalize">{kind}</SelectItem>)}</MemoryChoice></label>
      <label className="grid gap-1.5 text-xs text-muted-foreground">Group<MemoryChoice label="Memory group" value={draft.groupId} onChange={groupId => change('groupId', groupId)} className="w-full min-w-0 border-input"><SelectItem value="__all">Ungrouped</SelectItem>{data.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</MemoryChoice></label></div>
      <label className="grid gap-1.5 text-xs text-muted-foreground">Tags, separated by commas<Input aria-label="Memory tags" className="h-8 text-sm text-foreground" value={draft.tags} onChange={event => change('tags', event.target.value)} /></label>
      <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={!changed || pending} onClick={save}>{pending ? 'Saving…' : 'Save changes'}</Button>{saved ? <span role="status" className="text-xs text-muted-foreground">Saved</span> : null}</div>
    </section>
    <section className="mt-6 border-t pt-5" aria-label="Memory relationships">
      <h3 className="text-xs font-medium">Connections <span className="font-normal text-muted-foreground">{links.length}</span></h3>
      {links.map(link => { const otherId = link.from === record.id ? link.to : link.from, other = data.records.find(item => item.id === otherId); return <div key={link.id} className="border-b py-3 text-xs"><button className="text-left hover:underline" onClick={() => onSelect(otherId)}>{other?.title || 'Memory'}</button><p className="mt-1 text-muted-foreground">{link.derived ? 'Computed text similarity' : link.relation}{link.evidence ? ` · ${link.evidence}` : ''}</p>{!link.derived ? <Button variant="ghost" size="sm" className="mt-1 h-6 px-0 text-[11px] text-muted-foreground" disabled={pending} onClick={() => act(() => api(`/api/memory/links/${encodeURIComponent(link.id)}`, { method: 'DELETE' }))}>Remove link</Button> : null}</div>; })}
      {!links.length ? <p className="mt-2 text-xs text-muted-foreground">No saved connections yet.</p> : null}
      <details className="mt-3"><summary className="cursor-pointer text-xs">Connect another memory</summary><div className="mt-3 grid gap-3">
        <MemoryChoice label="Connect to memory" value={target} onChange={setTarget} className="w-full border-input"><SelectItem value="__all">Choose a memory</SelectItem>{data.records.filter(item => item.id !== record.id).map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</MemoryChoice>
        <MemoryChoice label="Relationship" value={relation} onChange={setRelation} className="w-full border-input">{['references', 'supports', 'contradicts'].map(kind => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}</MemoryChoice>
        <Textarea aria-label="Relationship evidence" placeholder="Why are these connected?" value={evidence} maxLength={500} onChange={event => setEvidence(event.target.value)} className="min-h-20 text-xs" />
        <Button size="sm" variant="outline" disabled={!target || !evidence.trim() || pending} onClick={async () => { if (await act(() => api('/api/memory/links', { method: 'POST', body: JSON.stringify({ from: record.id, to: target, relation, evidence }) }))) { setTarget(''); setEvidence(''); } }}>Save connection</Button>
      </div></details>
    </section>
    {record.scope !== 'team' ? <section className="mt-6 border-t pt-5" aria-label="Memory sharing"><h3 className="text-xs font-medium">Also shared with</h3><p className="mt-1 text-xs text-muted-foreground">Grant a teammate access without changing the original scope.</p>{data.members.filter(member => member.id !== record.ownerId).map(member => <label key={member.id} className="flex items-center justify-between gap-4 border-b py-3 text-xs">{member.name}<Switch aria-label={`Share with ${member.name}`} disabled={pending} checked={record.sharedWith.includes(member.id)} onCheckedChange={checked => act(() => api(`/api/memory/${encodeURIComponent(record.id)}/share`, { method: 'POST', body: JSON.stringify({ memberId: member.id, revoke: !checked }) }))} /></label>)}</section> : null}
    {record.editable ? <div className="mt-6 border-t pt-3" onMouseLeave={() => setForgetting(false)}><Button variant="ghost" size="sm" className="px-0 text-xs text-destructive" disabled={pending} onClick={async () => { if (!forgetting) return setForgetting(true); if (await act(() => api(`/api/memory/${encodeURIComponent(record.id)}`, { method: 'DELETE' }))) onClose(); }}>{forgetting ? 'Confirm forget memory' : 'Forget memory'}</Button></div> : null}
    {error ? <p role="alert" className="mt-4 text-xs text-destructive">{error}</p> : null}
  </aside>;
}

export function MemoryPage({ api, navigate, onSettings }) {
  const [data, setData] = useState(EMPTY), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [filters, setFilters] = useState(initialFilter), [view, setView] = useState('graph'), [grouping, setGrouping] = useState('agent'), [similarity, setSimilarity] = useState(false);
  const [selectedId, setSelectedId] = useState(''), [refresh, setRefresh] = useState(0), [groupName, setGroupName] = useState(''), [addingGroup, setAddingGroup] = useState(false), [addingMemory, setAddingMemory] = useState(false), [note, setNote] = useState(''), [noteScope, setNoteScope] = useState('team'), [noteOwner, setNoteOwner] = useState(''), [noteWorkspace, setNoteWorkspace] = useState(''), [saving, setSaving] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const filterKey = JSON.stringify(filters);
  const reload = useCallback(() => { setRefresh(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), query: deferredQuery, similarity: similarity ? '1' : '0', limit: '500' });
    setLoading(true);
    api(`/api/memory?${parameters}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setError(''); } }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, deferredQuery, filterKey, similarity, refresh]);
  useEffect(() => { const timer = setInterval(reload, 15_000); return () => clearInterval(timer); }, [reload]);
  const selected = data.records.find(record => record.id === selectedId);
  const members = useMemo(() => new Map(data.members.map(member => [member.id, member])), [data.members]);
  function filter(key, value) { setFilters(current => ({ ...current, [key]: value })); }
  async function mutate(path, method, body, done) {
    setSaving(true); setError('');
    try { const result = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); done?.(result); reload(); }
    catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <div className="memory-page flex h-[100dvh] min-h-[650px] flex-col bg-background pt-[var(--app-titlebar-height,0px)]" data-testid="memory-page">
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 pb-5 pt-7 sm:px-8">
      <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold tracking-tight">Collective memory</h1><p className="mt-1 text-xs text-muted-foreground">{data.collected ? `${data.collected} memories · ${data.members.length} members · one shared view` : 'What your squad knows, where it came from, and how it connects.'}</p></div>
      <Button variant="ghost" size="icon-sm" aria-label="Memory settings" onClick={onSettings}><Settings2 className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh memories" disabled={loading} onClick={reload}><RefreshCw className={cn('size-4', loading && 'animate-spin')} /></Button>
      <Button variant="outline" size="sm" aria-label="Add memory" onClick={() => setAddingMemory(value => !value)}><Plus className="size-3.5" /><span className="hidden sm:inline">Add memory</span></Button>
    </header>
    <div className="flex flex-wrap items-center gap-2 px-6 pb-4 sm:px-8">
      <div className="relative mr-auto min-w-48 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input aria-label="Search collective memory" placeholder="Search what your squad knows…" className="h-9 pl-8 text-sm" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} /></div>
      <MemoryChoice label="Filter by member" value={filters.owner} onChange={value => filter('owner', value)}><SelectItem value="__all">All members</SelectItem>{data.members.map(member => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</MemoryChoice>
      <MemoryChoice label="Filter by kind" value={filters.kind} onChange={value => filter('kind', value)}><SelectItem value="__all">All kinds</SelectItem>{MEMORY_KINDS.map(kind => <SelectItem key={kind} value={kind} className="capitalize">{kind}</SelectItem>)}</MemoryChoice>
      <MemoryChoice label="Filter by scope" value={filters.scope} onChange={value => filter('scope', value)}><SelectItem value="__all">All scopes</SelectItem><SelectItem value="team">Whole team</SelectItem><SelectItem value="member">Private</SelectItem><SelectItem value="project">Project</SelectItem></MemoryChoice>
      <MemoryChoice label="Filter by group" value={filters.group} onChange={value => filter('group', value)} className="min-[781px]:hidden"><SelectItem value="__all">All groups</SelectItem><SelectItem value="__ungrouped">Ungrouped</SelectItem>{data.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</MemoryChoice>
      <Button variant="ghost" size="sm" className="h-8 text-xs min-[781px]:hidden" onClick={() => setAddingGroup(value => !value)}>New group</Button>
    </div>
    {addingGroup ? <form className="flex items-center gap-3 border-t px-6 py-3 sm:px-8" onSubmit={event => { event.preventDefault(); mutate('/api/memory/groups', 'POST', { name: groupName }, result => { setGroupName(''); setAddingGroup(false); filter('group', result.id); }); }}><Input aria-label="New group name" placeholder="Name this memory group" className="h-8 max-w-sm text-xs" value={groupName} onChange={event => setGroupName(event.target.value)} autoFocus /><Button type="submit" variant="outline" size="sm" disabled={saving || !groupName.trim()}>Create</Button><Button variant="ghost" size="sm" onClick={() => setAddingGroup(false)}>Cancel</Button></form> : null}
    {addingMemory ? <form className="grid gap-3 border-t px-6 py-4 sm:px-8" onSubmit={event => { event.preventDefault(); mutate('/api/memory', 'POST', { text: note, scope: noteScope, memberId: noteOwner, workspace: noteWorkspace, ...(filters.group && filters.group !== '__ungrouped' ? { groupId: filters.group } : {}) }, result => { setNote(''); setAddingMemory(false); setSelectedId(result.id); }); }}>
      <Textarea aria-label="New memory" placeholder="A durable fact, decision, or preference worth keeping." value={note} maxLength={500} onChange={event => setNote(event.target.value)} className="min-h-20 text-sm" />
      <div className="flex flex-wrap items-center gap-3"><MemoryChoice label="New memory scope" value={noteScope} onChange={setNoteScope} className="border-input"><SelectItem value="team">Whole team</SelectItem><SelectItem value="member">One member</SelectItem><SelectItem value="project">Project</SelectItem></MemoryChoice>
        {noteScope === 'member' ? <MemoryChoice label="New memory owner" value={noteOwner} onChange={setNoteOwner} className="border-input"><SelectItem value="__all">Choose a member</SelectItem>{data.members.map(member => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</MemoryChoice> : null}
        {noteScope === 'project' ? <Input aria-label="Memory project folder" placeholder="Full project folder path" className="h-8 max-w-sm text-xs" value={noteWorkspace} onChange={event => setNoteWorkspace(event.target.value)} /> : null}
        <Button type="submit" size="sm" disabled={saving || !note.trim() || (noteScope === 'member' && !noteOwner) || (noteScope === 'project' && !noteWorkspace.trim())}>{saving ? 'Saving…' : 'Save memory'}</Button><Button variant="ghost" size="sm" type="button" onClick={() => setAddingMemory(false)}>Cancel</Button></div>
    </form> : null}
    {error ? <p role="alert" className="px-8 pb-3 text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={reload}>Retry</Button></p> : null}
    <div className="flex flex-wrap items-center gap-4 border-y px-6 sm:px-8">
      <div className="flex gap-5" role="tablist" aria-label="Memory view">{[['graph', GitBranch, 'Graph'], ['list', List, 'List']].map(([id, Icon, name]) => <button key={id} role="tab" aria-selected={view === id} className={cn('flex items-center gap-2 border-b-2 py-3 text-xs', view === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground')} onClick={() => setView(id)}><Icon className="size-3.5" />{name}</button>)}</div>
      {view === 'graph' ? <><span className="ml-auto hidden text-xs text-muted-foreground sm:block">Group by</span><MemoryChoice label="Group graph by" value={grouping} onChange={setGrouping}><SelectItem value="agent">Member</SelectItem><SelectItem value="kind">Kind</SelectItem><SelectItem value="group">Group</SelectItem></MemoryChoice><label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch aria-label="Show text similarity" checked={similarity} onCheckedChange={setSimilarity} />Text similarity</label></> : null}
    </div>
    {data.warnings.length || (!loading && data.index.available === false) ? <details className="border-b px-8 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{data.warnings.length ? `${data.warnings.length} source ${data.warnings.length === 1 ? 'warning' : 'warnings'}` : 'Search index unavailable · keyword search still works'}</summary>{data.warnings.map((warning, index) => <p className="mt-2 select-text" key={index}>{warning.message}</p>)}{data.index.error ? <p className="mt-2">{data.index.error}</p> : null}</details> : null}
    <div className={cn('memory-workspace grid min-h-0 flex-1 grid-cols-[174px_minmax(0,1fr)]', selected && 'memory-has-detail')}>
      <nav className="memory-groups overflow-y-auto border-r p-4" aria-label="Memory groups">
        <p className="mb-3 px-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Library</p>
        <button className={cn('flex w-full items-center gap-2 py-2 pl-2 text-left text-xs', !filters.group && 'font-semibold')} aria-current={!filters.group ? 'true' : undefined} onClick={() => filter('group', '')}>All memories<span className="ml-auto text-muted-foreground">{data.collected}</span></button>
        <button className={cn('flex w-full items-center gap-2 py-2 pl-2 text-left text-xs text-muted-foreground', filters.group === '__ungrouped' && 'font-semibold text-foreground')} onClick={() => filter('group', '__ungrouped')}>Ungrouped</button>
        <div className="my-3 border-t" /><p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Groups</p>
        {data.groups.map(group => <button key={group.id} className={cn('flex w-full items-center gap-2 py-2 pl-2 text-left text-xs', filters.group === group.id ? 'font-semibold' : 'text-muted-foreground')} aria-current={filters.group === group.id ? 'true' : undefined} onClick={() => filter('group', group.id)}><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} /><span className="truncate">{group.name}</span></button>)}
        <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-start px-2 text-xs text-muted-foreground" onClick={() => setAddingGroup(value => !value)}><Plus className="size-3" />New group</Button>
        {filters.group && data.groups.some(group => group.id === filters.group) ? <details className="mt-4 px-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Manage group</summary><form className="mt-3 grid gap-2" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); mutate('/api/memory/groups', 'POST', { id: filters.group, name: form.get('name'), color: form.get('color') }); }} key={filters.group}><Input name="name" aria-label="Rename group" defaultValue={data.groups.find(group => group.id === filters.group).name} className="h-8 text-xs" /><label className="flex items-center justify-between">Color<input type="color" aria-label="Group color" name="color" defaultValue={data.groups.find(group => group.id === filters.group).color} className="size-6 cursor-pointer border-0 bg-transparent" /></label><Button variant="ghost" size="sm" type="submit" disabled={saving} className="h-7 px-0 text-xs">Save group</Button><Button variant="ghost" size="sm" className="h-7 px-0 text-xs" disabled={saving} onClick={() => mutate(`/api/memory/groups/${filters.group}`, 'DELETE', undefined, () => filter('group', ''))}>Remove group · keep memories</Button></form></details> : null}
      </nav>
      <div className="relative flex min-h-0 min-w-0 flex-col">
        {data.records.length ? view === 'graph' ? <MemoryGraph records={data.records} members={data.members} groups={data.groups} grouping={grouping} colors={data.settings?.colors || {}} links={data.links} selectedId={selectedId} onSelect={setSelectedId} /> : <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-8" role="tabpanel" aria-label="Memory list">
          {data.records.map(record => <button key={record.id} data-memory-row={record.id} className={cn('flex w-full gap-3 border-b py-4 text-left', record.id === selectedId && 'border-l-2 border-l-foreground pl-3')} onClick={() => setSelectedId(record.id)}><span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: memoryColor(record.ownerId, data.settings?.colors?.[record.ownerId] || members.get(record.ownerId)?.color) }} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{record.title}{record.pinned ? <Pin className="ml-2 inline size-3 text-muted-foreground" /> : null}</span><span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{record.text}</span><span className="mt-2 block text-[11px] text-muted-foreground">{members.get(record.ownerId)?.name || record.authorName || 'Whole team'} · {scopeLabel(record)} · {record.kind} · {record.sourceLabel}</span></span><span className="shrink-0 text-[11px] text-muted-foreground">{when(record.updatedAt || record.createdAt)}</span></button>)}
        </div> : <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center"><GitBranch className="mb-5 size-7 text-muted-foreground/50" /><h2 className="text-sm font-medium">{loading ? 'Collecting memories…' : query || Object.values(filters).some(Boolean) ? 'No memories match this view' : 'Your squad’s knowledge starts here'}</h2><p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">{query ? `Nothing found for “${query}”. Try fewer words or clear the filters.` : 'Ask a member to remember something, add a memory, or choose a Markdown folder in Settings.'}</p>{query || Object.values(filters).some(Boolean) ? <Button variant="ghost" size="sm" className="mt-3 text-xs" onClick={() => { setQuery(''); setFilters({ owner: '', scope: '', kind: '', group: '' }); }}>Clear filters</Button> : <Button variant="ghost" size="sm" className="mt-3 text-xs" onClick={onSettings}>Choose collection sources</Button>}</div>}
        {loading && data.records.length ? <span role="status" className="absolute left-5 top-3 flex items-center gap-1.5 bg-background/90 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" />Updating…</span> : null}
      </div>
      {selected ? <MemoryInspector key={selected.id} record={selected} data={data} api={api} onChanged={reload} onSelect={setSelectedId} onClose={() => setSelectedId('')} navigate={navigate} /> : null}
    </div>
    <footer className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-1 border-t px-6 py-2 text-[11px] text-muted-foreground sm:px-8"><span>{data.records.length} of {data.total} in view{data.hasMore ? ' · Narrow your filters to see more' : ''}</span><span className="ml-auto flex items-center gap-2"><span className="w-5 border-t border-current" />Saved connection</span>{similarity ? <span className="flex items-center gap-2"><span className="w-5 border-t border-dashed border-current" />Computed similarity</span> : null}<span>{data.index.available ? 'TurboVec · local' : 'Local memories'}</span></footer>
  </div>;
}
