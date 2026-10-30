import { useEffect, useRef, useState } from "react";
import { File, FileImage, FileSpreadsheet, FileText, LoaderCircle, Paperclip, RotateCcw, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_COUNT_LIMIT, ATTACHMENT_LIMIT_BYTES, attachmentLabel, attachmentMime, attachmentReferences, attachmentSize, transferHasFiles } from "@/lib/attachments";
import { cn } from "@/lib/utils";

async function rasterPreview(file, rasterize = true) {
  const url = URL.createObjectURL(new Blob([file], { type: attachmentMime(file.name, file.type) }));
  try {
    const picture = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The image preview took too long. Try another image.")), 10000);
      picture.onload = () => { clearTimeout(timer); resolve(); };
      picture.onerror = () => { clearTimeout(timer); reject(new Error("This image could not be decoded. Try another image.")); };
      picture.src = url;
    });
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error("This image could not be decoded. Try another image.");
    if (!rasterize) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(picture.naturalWidth, picture.naturalHeight));
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The image preview could not be prepared.")), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

/** Pending files belong to their composer, including while another member is open. */
export function useAttachments(owner, api) {
  const [byOwner, setByOwner] = useState({});
  const [dragging, setDragging] = useState(false);
  const files = useRef(new Map());
  const controllers = useRef(new Map());
  const objectUrls = useRef(new Map());
  const mounted = useRef(true);
  const current = useRef(byOwner);
  current.current = byOwner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current.values()) controller.abort();
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url);
      controllers.current.clear(); objectUrls.current.clear(); files.current.clear();
    };
  }, []);
  useEffect(() => setDragging(false), [owner]);

  function patch(target, clientId, update) {
    if (!mounted.current) return;
    setByOwner(current => ({ ...current, [target]: (current[target] || []).map(file => file.clientId === clientId ? { ...file, ...update } : file) }));
  }
  async function upload(target, clientId) {
    const file = files.current.get(clientId);
    if (!file) return;
    const controller = new AbortController();
    controllers.current.set(clientId, controller);
    patch(target, clientId, { status: "uploading", error: "" });
    try {
      if (!file.size) throw new Error("This file is empty. Choose another file.");
      if (file.size > ATTACHMENT_LIMIT_BYTES) throw new Error("This file is larger than 25 MB. Choose a smaller file.");
      const mime = attachmentMime(file.name, file.type);
      const preview = mime.startsWith("image/") ? await rasterPreview(file, !/^image\/(png|jpeg|gif|webp)$/.test(mime)) : null;
      let record = await api("/api/attachments", { method: "POST", headers: { "x-file-name": encodeURIComponent(file.name), "content-type": mime }, body: file, signal: controller.signal });
      // SVG and browser-only formats need a raster input for engines whose
      // native image input accepts PNG/JPEG/GIF/WebP. Preserve the original.
      if (preview) {
        record = await api(`/api/attachments/${record.id}/preview`, { method: "POST", headers: { "content-type": "image/png" }, body: preview, signal: controller.signal });
      }
      if (controller.signal.aborted) return;
      patch(target, clientId, { ...record, status: "ready", error: "" });
    } catch (error) {
      if (!controller.signal.aborted) patch(target, clientId, { status: "error", error: error.message || "Could not upload this file. Retry or remove it." });
    } finally { if (controllers.current.get(clientId) === controller) controllers.current.delete(clientId); }
  }
  function addFiles(incoming) {
    const selected = Array.from(incoming || []);
    const target = owner;
    const count = (current.current[target] || []).length;
    const entries = selected.slice(0, Math.max(0, ATTACHMENT_COUNT_LIMIT - count)).map(file => {
      const clientId = crypto.randomUUID();
      files.current.set(clientId, file);
      const mime = attachmentMime(file.name, file.type);
      const previewUrl = mime.startsWith("image/") ? URL.createObjectURL(new Blob([file], { type: mime })) : "";
      if (previewUrl) objectUrls.current.set(clientId, previewUrl);
      return { clientId, id: clientId, name: file.name, mime, kind: mime.startsWith("image/") ? "image" : "file", size: file.size, localPreview: previewUrl, status: "uploading" };
    });
    const limited = selected.length > entries.length ? [{ clientId: crypto.randomUUID(), id: crypto.randomUUID(), name: "Too many files", status: "error", error: `Attach up to ${ATTACHMENT_COUNT_LIMIT} files per message.` }] : [];
    const next = [...(current.current[target] || []), ...entries, ...limited];
    current.current = { ...current.current, [target]: next };
    setByOwner(current => ({ ...current, [target]: [...(current[target] || []), ...entries, ...limited] }));
    for (const entry of entries) void upload(target, entry.clientId);
  }
  function remove(clientId) {
    controllers.current.get(clientId)?.abort(); controllers.current.delete(clientId);
    const url = objectUrls.current.get(clientId);
    if (url) URL.revokeObjectURL(url);
    objectUrls.current.delete(clientId); files.current.delete(clientId);
    setByOwner(current => ({ ...current, [owner]: (current[owner] || []).filter(file => file.clientId !== clientId) }));
  }
  function clear() { for (const file of current.current[owner] || []) remove(file.clientId); }
  function restore(records) {
    setByOwner(current => ({ ...current, [owner]: [...(current[owner] || []), ...attachmentReferences(records).filter(file => !(current[owner] || []).some(saved => saved.id === file.id)).map(file => ({ ...file, clientId: crypto.randomUUID(), status: "ready" }))] }));
  }
  const entries = byOwner[owner] || [];
  return {
    entries, ready: attachmentReferences(entries.filter(file => file.status === "ready")), blocked: entries.some(file => file.status !== "ready"), dragging,
    addFiles, remove, clear, restore, retry: clientId => upload(owner, clientId),
    bind: {
      onDragEnter: event => { if (transferHasFiles(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); setDragging(true); } },
      onDragOver: event => { if (transferHasFiles(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; } },
      onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
      onDrop: event => { if (!transferHasFiles(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(event.dataTransfer.files); },
      onPaste: event => { const incoming = Array.from(event.clipboardData?.files || []); if (incoming.length) { event.preventDefault(); event.stopPropagation(); addFiles(incoming); } },
    },
  };
}

function FileThumbnail({ file }) {
  const mime = attachmentMime(file.name, file.mime);
  const isImage = file.kind === "image" || mime.startsWith("image/");
  const url = file.status && file.status !== "ready" ? file.localPreview : file.previewUrl || file.url || (file.id ? `/api/attachments/${file.id}` : "");
  if (isImage && url) return <img src={url} alt={file.name} loading="lazy" className="size-12 shrink-0 rounded object-contain" />;
  const Icon = /spreadsheet|excel|csv/.test(mime) ? FileSpreadsheet : /font\//.test(mime) ? Type : /pdf|word|text/.test(mime) ? FileText : isImage ? FileImage : File;
  return <span className="flex size-12 shrink-0 flex-col items-center justify-center gap-0.5 text-muted-foreground" aria-label={`${attachmentLabel(file)} file preview`}><Icon className="size-6" /><span className="text-[9px] font-medium">{attachmentLabel(file)}</span></span>;
}

export function AttachmentList({ files = [], onRemove, onRetry, className }) {
  if (!files.length) return null;
  return <div className={cn("flex max-w-full flex-wrap gap-2", className)} aria-label="Attachments">
    {files.map(file => {
      const pending = file.status === "uploading", error = file.status === "error";
      const content = <><FileThumbnail file={file} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{file.name}</span><span className={cn("mt-0.5 block text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>{pending ? "Uploading…" : error ? file.error : `${attachmentLabel(file)} · ${attachmentSize(file.size)}`}</span></span></>;
      return <div key={file.clientId || file.id} data-attachment-id={file.id} data-attachment-status={file.status || "ready"} className="flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 sm:max-w-72">
        {onRemove || pending || error ? <div className="flex min-w-0 flex-1 items-center gap-2">{content}</div> : <a className="flex min-w-0 flex-1 items-center gap-2" href={file.url || `/api/attachments/${file.id}`} download={file.name} target="_blank" rel="noreferrer">{content}</a>}
        {pending ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label={`Uploading ${file.name}`} /> : null}
        {error && onRetry ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Retry ${file.name}`} onClick={() => onRetry(file.clientId)}><RotateCcw className="size-3.5" /></Button> : null}
        {onRemove ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.clientId)}><X className="size-3.5" /></Button> : null}
      </div>;
    })}
  </div>;
}

export function AttachmentButton({ onFiles, disabled = false, compact = false }) {
  const input = useRef(null);
  return <>
    <input ref={input} type="file" multiple className="sr-only" data-attachment-picker aria-label="Choose files to attach" onChange={event => { onFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="Attach files" title="Attach files" className={compact ? "size-7" : ""} onClick={() => input.current?.click()}><Paperclip className="size-4" /></Button>
  </>;
}
