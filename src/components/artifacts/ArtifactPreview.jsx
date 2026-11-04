import { useEffect, useState } from "react";
import { ArrowUpRight, Download, FileText, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { artifactDate, artifactIdFromHref, openArtifact } from "@/lib/artifacts";

/** Chat links use the same saved artifact as the member's Library. */
export function ArtifactCard({ id, title }) {
  return <span className="my-3 inline-flex w-full max-w-md align-top">
    <button type="button" className="group flex w-full items-center gap-3 rounded-md border border-border/70 px-4 py-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openArtifact(id)} aria-label={`Open artifact: ${title}`}>
      <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0"><span className="block truncate font-medium text-foreground">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">Artifact · Open preview</span></span>
      <ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  </span>;
}

function ArtifactBody({ artifact, renderMarkdown }) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [pdf, setPdf] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!['text', 'markdown', 'html', 'pdf'].includes(artifact.kind)) return;
    const controller = new AbortController();
    let objectUrl;
    fetch(artifact.contentUrl, { signal: controller.signal, cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('The saved file could not be read.'); return artifact.kind === 'pdf' ? response.blob() : response.text(); }).then(value => { if (controller.signal.aborted) return; if (artifact.kind === 'pdf') { objectUrl = URL.createObjectURL(value); setPdf(objectUrl); } else setText(value); setLoaded(true); }, failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifact.id, artifact.revision, artifact.kind, artifact.contentUrl]);
  if (error) return <p role="alert" className="p-6 text-sm text-destructive">{error}</p>;
  if (['html', 'text', 'markdown', 'pdf'].includes(artifact.kind) && !loaded) return <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading saved file…</p>;
  if (artifact.kind === 'html') return <iframe title={artifact.title} srcDoc={text} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" className="h-full min-h-80 w-full bg-white" />;
  if (artifact.kind === 'image') return <div className="flex h-full items-center justify-center overflow-auto p-6"><img src={artifact.contentUrl} alt={artifact.title} className="max-h-full max-w-full object-contain" /></div>;
  if (artifact.kind === 'pdf') return pdf ? <iframe title={artifact.title} src={pdf} sandbox="allow-scripts allow-downloads" className="h-full min-h-80 w-full bg-white" /> : <p role="status" className="p-6 text-sm">Opening PDF…</p>;
  if (['text', 'markdown'].includes(artifact.kind)) return <div className="h-full overflow-auto p-6 sm:px-10">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : artifact.kind === 'markdown' && renderMarkdown ? renderMarkdown(text.slice(0, 200000)) : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 select-text">{text.slice(0, 200000)}</pre>}
    {text.length > 200000 ? <p className="mt-5 text-sm text-muted-foreground">Preview shortened. Download the file to read it in full.</p> : null}
  </div>;
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"><FileText className="size-8 text-muted-foreground" /><p className="text-sm">Download this file to open it in its app.</p><Button asChild variant="outline"><a href={artifact.downloadUrl} download={artifact.filename}>Download {artifact.filename}</a></Button></div>;
}

export function ArtifactPreviewController({ api, renderMarkdown }) {
  const [id, setId] = useState(''), [artifact, setArtifact] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const show = event => { setArtifact(null); setError(''); setId(event.detail.id); };
    window.addEventListener('squad:open-artifact', show);
    const initial = artifactIdFromHref(window.location.pathname + window.location.search);
    if (initial) setId(initial);
    return () => window.removeEventListener('squad:open-artifact', show);
  }, []);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    api(`/api/artifacts/${encodeURIComponent(id)}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setArtifact(value); }, failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [api, id]);
  function close() { setId(''); setArtifact(null); setError(''); }
  async function openInBrowser(event) {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!navigator.userAgent.startsWith('AutohandSquadDesktop/') || typeof invoke !== 'function') return;
    event.preventDefault();
    try { await invoke('squad_open_artifact_in_browser', { artifactId: artifact.id }); }
    catch (failure) { setError(String(failure?.message || failure)); }
  }
  return <Dialog open={Boolean(id)} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent showCloseButton={false} className="flex h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-md p-0 duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-none" data-testid="artifact-preview">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1"><DialogTitle className="truncate text-sm font-medium">{artifact?.title || 'Artifact'}</DialogTitle><DialogDescription className="mt-1 truncate text-xs">{artifact ? `${artifact.authorName} · ${artifactDate(artifact.updatedAt)}${artifact.revision > 1 ? ` · Revision ${artifact.revision}` : ''}` : 'Saved work from your member’s Library.'}</DialogDescription></div>
        {artifact ? <><Button asChild variant="ghost" size="icon" title="Download"><a href={artifact.downloadUrl} download={artifact.filename} aria-label="Download artifact"><Download className="size-4" /></a></Button><Button asChild variant="ghost" size="icon" title="Open in browser"><a href={artifact.contentUrl} target="_blank" rel="noreferrer" onClick={openInBrowser} aria-label="Open artifact in browser"><ArrowUpRight className="size-4" /></a></Button></> : null}
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close artifact"><X className="size-4" /></Button>
      </div>
      {artifact && error ? <p role="alert" className="px-6 py-2 text-sm text-destructive">{error}</p> : null}
      <div className="min-h-0 flex-1">{artifact ? <ArtifactBody key={`${artifact.id}:${artifact.revision}`} artifact={artifact} renderMarkdown={renderMarkdown} /> : <div className="flex h-full items-center justify-center p-8">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Opening artifact…</p>}</div>}</div>
    </DialogContent>
  </Dialog>;
}
