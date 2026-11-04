import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, FileText, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { artifactDate, artifactIdFromHref, artifactSize, openArtifact } from "@/lib/artifacts";

export function MemberLibrary({ agent, api, navigate }) {
  const [records, setRecords] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`/api/artifacts?owner=${encodeURIComponent(agent.id)}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setRecords(data.artifacts); }, failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent.id, api, refresh]);
  useEffect(() => {
    const id = artifactIdFromHref(window.location.pathname + window.location.search);
    if (!id) return;
    const frame = requestAnimationFrame(() => openArtifact(id));
    return () => cancelAnimationFrame(frame);
  }, [agent.id]);
  const shown = useMemo(() => records.filter(record => `${record.title} ${record.description} ${record.filename}`.toLowerCase().includes(query.trim().toLowerCase())), [records, query]);
  return <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8" data-testid="member-artifact-library">
    <div className="flex items-start justify-between gap-5"><div><h1 className="text-xl font-semibold">Library</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Files {agent.name} created and saved for you.</p></div><Button variant="ghost" size="sm" onClick={() => navigate(`/memory?owner=${encodeURIComponent(agent.id)}`)}><BookOpen className="size-4" />Knowledge base</Button></div>
    <div className="mt-8 flex items-center gap-3 border-b pb-4"><Search className="size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search artifacts" placeholder="Search artifacts" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" /><span className="shrink-0 text-xs text-muted-foreground">{records.length} {records.length === 1 ? 'file' : 'files'}</span><Button variant="ghost" size="icon-sm" disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh artifacts"><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></Button></div>
    {error ? <p role="alert" className="py-5 text-sm text-destructive">{error}</p> : null}
    {shown.map((record, index) => <div key={record.id}>
      {index === 0 || artifactDate(shown[index - 1].updatedAt) !== artifactDate(record.updatedAt) ? <h2 className="pt-7 pb-2 text-xs font-medium text-muted-foreground">{artifactDate(record.updatedAt)}</h2> : null}
      <div className="flex items-center gap-4 border-b py-4"><FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><button className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openArtifact(record.id)}><span className="block truncate text-sm font-medium">{record.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{record.description || record.filename}</span><span className="mt-1.5 block text-[11px] text-muted-foreground">{record.kind === 'file' ? 'File' : record.kind.toUpperCase()} · {artifactSize(record.size)}{record.revision > 1 ? ` · Revision ${record.revision}` : ''}</span></button><Button asChild variant="ghost" size="icon-sm"><a href={record.downloadUrl} download={record.filename} aria-label={`Download ${record.title}`}><Download className="size-4" /></a></Button></div>
    </div>)}
    {!shown.length && !error ? <div className="py-16 text-center"><FileText className="mx-auto mb-4 size-6 text-muted-foreground/50" /><h2 className="text-sm font-medium">{loading ? 'Loading artifacts…' : query.trim() ? 'No artifacts match your search' : 'The work you keep, in one place'}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{query.trim() ? `Nothing found for “${query}”. Try fewer words.` : `Ask ${agent.name} to create a report, page, document or image and save it to their Library. Published files also appear in your knowledge base.`}</p>{query ? <Button variant="ghost" size="sm" className="mt-3" onClick={() => setQuery('')}>Clear search</Button> : null}</div> : null}
  </div>;
}
