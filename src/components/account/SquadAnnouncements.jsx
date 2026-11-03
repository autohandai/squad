import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SquadAnnouncements({ api, enabled, busy = false, showErrors = false }) {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const autoShown = useRef(new Set());
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await api("/api/announcements");
      if (generation.current === current) { setItems(result.announcements || []); setError(""); }
    } catch (failure) { if (generation.current === current) setError(failure.message || "Squad news could not be loaded."); }
  }, [api]);
  useEffect(() => {
    if (!enabled) { setItems([]); setActive(null); return undefined; }
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visible, 5 * 60_000);
    document.addEventListener("visibilitychange", visible);
    return () => { ++generation.current; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [enabled, refresh]);
  const open = useCallback(item => { autoShown.current.add(item.id); setStep(0); setError(""); setActive(item); }, []);
  useEffect(() => {
    if (!enabled || busy || active) return undefined;
    const next = items[0];
    if (!next || next.placement !== "modal" || autoShown.current.has(next.id)) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || document.querySelector('[role="dialog"]') || document.activeElement?.matches('input,textarea,select,[role="combobox"],[contenteditable="true"]') || document.activeElement?.closest("form")) return;
      open(next);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, busy, active, items, open]);
  const markSeen = useCallback(async () => {
    if (!active) return;
    try { await api(`/api/announcements/${active.id}/seen`, { method: "POST", body: JSON.stringify({ lastStep: step }) }); }
    catch (failure) { setError(failure.message || "Could not save your reading progress."); }
  }, [api, active, step]);
  useEffect(() => { setMediaFailed(false); void markSeen(); }, [markSeen]);
  async function dismiss(item) {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await api(`/api/announcements/${item.id}/dismiss`, { method: "POST", body: "{}" });
      ++generation.current;
      setItems(current => current.filter(value => value.id !== item.id));
      setActive(null);
    } catch (failure) { setError(failure.message || "Could not dismiss this announcement. Try again."); }
    finally { setSaving(false); }
  }
  if (!enabled) return null;
  const item = items[0];
  const media = active?.steps?.[step];
  const link = media?.ctaUrl ? media : active;
  return (
    <>
      {item ? <section aria-label="News from Autohand" data-testid="squad-announcement" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/65 px-6 py-2 text-sm">
        <p className="min-w-0 flex-1"><span className="mr-2 text-xs text-muted-foreground">From Autohand</span>{item.title}</p>
        <Button size="sm" variant="ghost" onClick={() => open(item)}>Read announcement</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => void dismiss(item)}>Dismiss</Button>
      </section> : null}
      {error && !active && (showErrors || item) ? <p role="alert" className="px-6 py-2 text-xs text-destructive">{error} <Button size="sm" variant="link" onClick={() => void refresh()}>Retry news</Button></p> : null}
      <Dialog open={Boolean(active)} onOpenChange={value => { if (!value && active) void dismiss(active); }}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl" aria-describedby="squad-announcement-description">
          <DialogHeader>
            <p className="text-xs text-muted-foreground">From Autohand</p>
            <DialogTitle>{active?.title}</DialogTitle>
            <DialogDescription id="squad-announcement-description">{active?.description || "What’s new in Autohand Squad."}</DialogDescription>
          </DialogHeader>
          {media?.mediaUrl ? mediaFailed ? <p className="text-sm text-muted-foreground">This media could not be loaded. You can still read the announcement.</p> : media.type === "video" ? <video controls playsInline preload="metadata" className="max-h-[45svh] w-full" src={media.mediaUrl} poster={media.posterUrl || undefined} onError={() => setMediaFailed(true)} /> : <img className="max-h-[45svh] w-full object-contain" src={media.mediaUrl} alt={media.title || active?.title || "Announcement"} onError={() => setMediaFailed(true)} /> : null}
          {media?.title ? <h3 className="text-base font-medium">{media.title}</h3> : null}
          {media?.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{media.description}</p> : null}
          {link?.ctaUrl && link?.ctaLabel ? <a href={link.ctaUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">{link.ctaLabel}</a> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">{active?.steps?.length ? `${step + 1} of ${active.steps.length}` : ""}</span>
            <div className="flex gap-2">
              {step > 0 ? <Button variant="ghost" onClick={() => setStep(value => value - 1)}>Previous</Button> : null}
              {step + 1 < (active?.steps?.length || 0) ? <Button onClick={() => setStep(value => value + 1)}>Next</Button> : <Button disabled={saving} onClick={() => active && void dismiss(active)}>{saving ? "Saving…" : "Done"}</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
