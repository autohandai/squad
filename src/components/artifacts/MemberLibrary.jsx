import { useEffect, useMemo, useState } from "react";
import { ownershipUrl } from "@/lib/ownership-client";
import { BookOpen, Code2, Download, FileText, Image as ImageIcon, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { artifactDate, artifactIdFromHref, artifactSize, openArtifact } from "@/lib/artifacts";

const KIND_ICON = { image: ImageIcon, code: Code2 };
const KIND_LABEL = { image: 'Image', document: 'Document', code: 'Code', data: 'Data', media: 'Audio or video', file: 'File' };

/** A quiet delete that asks once more before acting (DESIGN: Unpair). */
function ConfirmDelete({ label, confirmLabel = 'Delete', busy, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const timer = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(timer); }, [armed]);
  return armed
    ? <Button variant="destructive" size="sm" disabled={busy} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</Button>
    : <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={label} onClick={() => setArmed(true)}><Trash2 className="size-4" /></Button>;
}

/**
 * Files a member made in its folders (ADR-0287), recorded after each of its
 * turns: newest first, created or edited, with Move to Trash for files it
 * created. Edited files were the person's first and stay.
 */
function MemberFolderFiles({ agent, api, query, refresh }) {
  const [files, setFiles] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
  const load = () => api(`/api/member-files/${encodeURIComponent(agent.id)}`).then(data => { setFiles(data.files); setError(''); }, failure => setError(failure.message)).finally(() => setLoading(false));
  useEffect(() => { setLoading(true); void load(); }, [agent.id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = query.trim().toLowerCase();
  const shown = files.filter(file => !needle || `${file.name} ${file.displayPath}`.toLowerCase().includes(needle));
  async function trash(file) {
    setBusy(file.path); setError('');
    try { await api(`/api/member-files/${encodeURIComponent(agent.id)}/trash`, { method: 'POST', body: JSON.stringify({ path: file.path }) }); setFiles(current => current.filter(row => row.path !== file.path)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }
  return <section className="mt-12" data-testid="member-folder-files">
    <h2 className="text-sm font-medium">Made in its folders</h2>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">Files {agent.name} created or changed in its work folders, recorded after each reply. Move one you no longer need to the Trash; you can put it back from there.</p>
    {error ? <p role="alert" className="py-3 text-sm text-destructive">{error}</p> : null}
    <div className="mt-3">{shown.map(file => { const Icon = KIND_ICON[file.kind] || FileText; return <div key={file.path} className="flex items-center gap-4 border-b py-3" data-testid="member-folder-file">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={file.displayPath}>{file.displayPath}</span><span className="mt-1.5 block text-[11px] text-muted-foreground">{file.created ? 'Created' : 'Edited'} · {KIND_LABEL[file.kind] || 'File'} · {artifactSize(file.size)} · {artifactDate(file.lastSeenAt)}</span></div>
      {file.created ? <ConfirmDelete label={`Move ${file.name} to the Trash`} confirmLabel="Move to Trash" busy={busy === file.path} onConfirm={() => trash(file)} /> : null}
    </div>; })}</div>
    {!shown.length && !error ? <p className="py-6 text-sm text-muted-foreground">{loading ? 'Looking for files…' : needle ? 'No files match your search.' : `Nothing yet. Files ${agent.name} makes in its folders appear here after its next reply.`}</p> : null}
  </section>;
}

export function MemberLibrary({ agent, api, navigate }) {
  const [records, setRecords] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const requestedArtifact = artifactIdFromHref(window.location.pathname + window.location.search);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`/api/artifacts?owner=${encodeURIComponent(agent.id)}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setRecords(data.artifacts); }, failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agent.id, api, refresh]);
  useEffect(() => {
    if (!requestedArtifact) return;
    const frame = requestAnimationFrame(() => openArtifact(requestedArtifact));
    return () => cancelAnimationFrame(frame);
  }, [agent.id, requestedArtifact]);
  const [removing, setRemoving] = useState('');
  async function remove(record) {
    setRemoving(record.id); setError('');
    try { await api(`/api/artifacts/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); setRecords(current => current.filter(row => row.id !== record.id)); }
    catch (failure) { setError(failure.message); }
    finally { setRemoving(''); }
  }
  const shown = useMemo(() => records.filter(record => `${record.title} ${record.description} ${record.filename}`.toLowerCase().includes(query.trim().toLowerCase())), [records, query]);
  return <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8" data-testid="member-artifact-library">
    <div className="flex items-start justify-between gap-5"><div><h1 className="text-xl font-semibold">Library</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Files {agent.name} saved for you, and the files it made in its folders. Delete what you don’t need.</p></div><Button variant="ghost" size="sm" onClick={() => navigate(`/memory?owner=${encodeURIComponent(agent.id)}`)}><BookOpen className="size-4" />Knowledge base</Button></div>
    <div className="mt-8 flex items-center gap-3 border-b pb-4"><Search className="size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search artifacts" placeholder="Search artifacts" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" /><span className="shrink-0 text-xs text-muted-foreground">{records.length} {records.length === 1 ? 'file' : 'files'}</span><Button variant="ghost" size="icon-sm" disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh artifacts"><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /></Button></div>
    {error ? <p role="alert" className="py-5 text-sm text-destructive">{error}</p> : null}
    {shown.map((record, index) => <div key={record.id}>
      {index === 0 || artifactDate(shown[index - 1].updatedAt) !== artifactDate(record.updatedAt) ? <h2 className="pt-7 pb-2 text-xs font-medium text-muted-foreground">{artifactDate(record.updatedAt)}</h2> : null}
      <div className="flex items-center gap-4 border-b py-4"><FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><button className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openArtifact(record.id)}><span className="block truncate text-sm font-medium">{record.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{record.description || record.filename}</span><span className="mt-1.5 block text-[11px] text-muted-foreground">{record.kind === 'file' ? 'File' : record.kind.toUpperCase()} · {artifactSize(record.size)}{record.revision > 1 ? ` · Revision ${record.revision}` : ''}</span></button><Button asChild variant="ghost" size="icon-sm"><a href={ownershipUrl(record.downloadUrl)} download={record.filename} aria-label={`Download ${record.title}`}><Download className="size-4" /></a></Button><ConfirmDelete label={`Delete ${record.title}`} busy={removing === record.id} onConfirm={() => remove(record)} /></div>
    </div>)}
    {!shown.length && !error ? <div className="py-16 text-center"><FileText className="mx-auto mb-4 size-6 text-muted-foreground/50" /><h2 className="text-sm font-medium">{loading ? 'Loading artifacts…' : query.trim() ? 'No artifacts match your search' : 'The work you keep, in one place'}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{query.trim() ? `Nothing found for “${query}”. Try fewer words.` : `Ask ${agent.name} to create a report, page, document or image and save it to their Library. Published files also appear in your knowledge base.`}</p>{query ? <Button variant="ghost" size="sm" className="mt-3" onClick={() => setQuery('')}>Clear search</Button> : null}</div> : null}
    <MemberFolderFiles agent={agent} api={api} query={query} refresh={refresh} />
  </div>;
}
