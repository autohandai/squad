import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { chatMetaLine } from "@/lib/chat-sessions";
import { harnessLabel } from "@/lib/harness";
import { relativeTime } from "@/lib/member-history";
import { cn } from "@/lib/utils";

const keyOf = item => `${item.kind}:${item.id}`;

/** One history manager for saved chats and independently running threads. */
export function PreviousChats({ api, memberId, onOpen, onOpenThread, disabled = false, copy = {}, locale = "en-US", className = "" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mergeRequest = useRef(null);
  const prefix = `/api/members/${encodeURIComponent(memberId)}/history`;
  const choices = items.filter(item => selected.has(keyOf(item)));
  const working = choices.some(item => item.working);

  async function load() {
    const data = await api(prefix);
    setItems(data.items || []);
    setSelected(current => new Set([...current].filter(key => data.items.some(item => keyOf(item) === key))));
  }
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true); setError(""); setSelected(new Set()); setArmed(false); setNotice("");
    const refresh = async () => {
      try { const data = await api(prefix); if (!cancelled) setItems(data.items || []); }
      catch (failure) { if (!cancelled) setError(failure.message); }
      finally { if (!cancelled) setLoading(false); }
    };
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open, api, prefix]);

  async function act(operation) {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); }
    catch (failure) { setError(failure.message || "Could not update history."); }
    finally { setBusy(false); }
  }
  function toggle(item) {
    setArmed(false); setNotice("");
    setSelected(current => { const next = new Set(current); const key = keyOf(item); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  async function merge() {
    const selection = choices.map(({ kind, id }) => ({ kind, id }));
    const signature = JSON.stringify([selection, title]);
    if (mergeRequest.current?.signature !== signature) mergeRequest.current = { signature, requestId: crypto.randomUUID() };
    await api(prefix + "/merge", { method: "POST", body: JSON.stringify({ selection, title, requestId: mergeRequest.current.requestId }) });
    setSelected(new Set()); setTitle("");
    setNotice("Merged into a new conversation. The originals are kept; the merged chat starts a fresh engine session.");
    await load();
  }
  async function remove() {
    for (const item of choices) await api(`${prefix}/${item.kind}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    setSelected(new Set()); setArmed(false); setNotice("Selected conversations deleted."); await load();
  }
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className={cn("relative", className)} aria-label="History" title="History" data-testid="previous-chats"><History /></Button></SheetTrigger>
    <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" aria-label="Conversation history">
      <SheetHeader className="border-b px-5 py-4 pr-12"><SheetTitle>History</SheetTitle><SheetDescription>Saved conversations and reply threads. Select conversations to merge or delete.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5" data-testid="conversation-history">
        {error ? <p role="alert" className="py-3 text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="py-3 text-sm text-muted-foreground">{notice}</p> : null}
        {!items.length ? <p className="py-6 text-sm text-muted-foreground">{loading ? "Loading…" : "No previous chats yet. Reply threads also appear here."}</p> : <ul className="divide-y divide-border/70">{items.map(item => <li key={keyOf(item)} className="flex items-start gap-3 py-3" data-history-kind={item.kind}>
          <Checkbox className="mt-1" aria-label={`Select ${item.title || "conversation"}`} checked={selected.has(keyOf(item))} disabled={busy} onCheckedChange={() => toggle(item)} />
          <div className="min-w-0 flex-1">
            <button type="button" className="block w-full text-left text-sm hover:underline disabled:opacity-60" disabled={busy || (disabled && item.kind === "chat")} onClick={() => void act(async () => { if (item.kind === "thread") onOpenThread?.(item); else if (await onOpen?.(item) === false) return; setOpen(false); })}>
              <span className="block break-words">{item.title || "Conversation"}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.kind === "thread" ? `Reply thread · ${Math.max(0, item.messageCount - 1)} messages${item.working ? " · working" : ""}` : `Saved chat · ${chatMetaLine(item, { harnessName: harnessLabel, relative: (value, now) => relativeTime(value, { now, locale, copy }), copy })}${item.resumable ? "" : " · new engine session"}`}</span>
            </button>
            {item.working ? <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-0 text-xs text-muted-foreground" disabled={busy} onClick={() => void act(async () => { await api(`/api/members/${encodeURIComponent(memberId)}/threads/${encodeURIComponent(item.id)}/stop`, { method: "POST", body: "{}" }); await load(); })}>Stop this thread</Button> : null}
          </div>
        </li>)}</ul>}
      </div>
      {choices.length ? <div className="space-y-3 border-t px-5 py-4">
        <p className="text-xs text-muted-foreground">{choices.length} selected{working ? " · Stop selected working threads before merging or deleting." : ""}</p>
        {choices.length >= 2 ? <><Input aria-label="Merged conversation name" placeholder="Merged conversation name (optional)" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} disabled={busy} /><p className="text-xs text-muted-foreground">Merge keeps the originals and all saved messages and work details. The new conversation uses a fresh engine session.</p></> : null}
        <div className="flex flex-wrap gap-2">
          {choices.length >= 2 ? <Button type="button" variant="outline" size="sm" disabled={busy || working} onClick={() => void act(merge)}>Merge selected</Button> : null}
          <Button type="button" variant="ghost" size="sm" className={armed ? "text-destructive" : "text-muted-foreground"} disabled={busy || working} onClick={() => { if (armed) void act(remove); else setArmed(true); }}>{busy ? "Working…" : armed ? `Delete ${choices.length} for good?` : "Delete selected"}</Button>
          {armed ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setArmed(false)}>Cancel</Button> : null}
        </div>
      </div> : null}
      {disabled ? <p className="border-t px-5 py-3 text-xs text-muted-foreground">Wait for the current reply to finish or stop it before opening another saved chat. Independent threads remain available.</p> : null}
    </SheetContent>
  </Sheet>;
}
