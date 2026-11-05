import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function usageResetLabel(value, now = Date.now()) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "Reset time unavailable";
  const minutes = Math.ceil((at - now) / 60000);
  if (minutes <= 0) return "Reset due";
  if (minutes >= 1440) return `resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  return `resets in ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m`;
}

export function QuickChatPanel({ api, member, chatPath, children }) {
  useEffect(() => {
    if (!/^AutohandSquadQuickChat\//.test(navigator.userAgent)) return;
    document.documentElement.dataset.quickChat = "true";
    return () => { delete document.documentElement.dataset.quickChat; };
  }, []);
  const [settings, setSettings] = useState(null);
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let controller;
    async function refresh({ force = false } = {}) {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const saved = await api("/api/system/settings", { signal: controller.signal });
        if (disposed) return;
        setSettings(saved);
        if (saved.quickChatShowUsage && saved.quickChatEnabled) {
          try {
            const result = await api(`/api/harnesses/usage${force ? "?refresh=1" : ""}`, { signal: controller.signal });
            if (!disposed) { setUsage(result); setUsageError(""); }
          } catch { if (!disposed) setUsageError("Harness usage is unavailable."); }
        } else setUsage(null);
      } catch { /* Keep the last settings while the local bridge reconnects. */ }
      finally { clearTimeout(timer); busy = false; }
    }
    const storage = event => { if (!event.key || event.key === "autohandSquad.v1.quickChatSettings") void refresh(); };
    const events = ["focus", "squad:popup-shown", "squad:quick-chat-settings"];
    for (const event of events) window.addEventListener(event, refresh);
    window.addEventListener("storage", storage);
    const timer = setInterval(refresh, 30000);
    void refresh({ force: attempt > 0 });
    return () => { disposed = true; controller?.abort(); clearInterval(timer); for (const event of events) window.removeEventListener(event, refresh); window.removeEventListener("storage", storage); };
  }, [api, attempt]);
  const enabled = settings?.quickChatEnabled !== false;
  return <div className="flex min-h-0 min-w-0 flex-col bg-background text-foreground" data-testid="mac-quick-chat">
    <header className="quick-chat-toolbar flex h-9 shrink-0 items-center gap-1 px-3">
      <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">Quick Chat</span>
      <Button asChild variant="ghost" size="icon-xs"><a href={chatPath} aria-label={member ? `Open ${member.name} in Squad` : "Open Squad"} title="Open in Squad"><ArrowUpRight className="size-3.5" /></a></Button>
      <Button asChild variant="ghost" size="icon-xs"><a href="/settings/quick-chat" aria-label="Quick Chat settings" title="Quick Chat settings"><Settings2 className="size-3.5" /></a></Button>
      <Button asChild variant="ghost" size="icon-xs"><a href="/quick-chat-dismiss" aria-label="Close Quick Chat" title="Close"><X className="size-3.5" /></a></Button>
    </header>
    <div className={enabled ? "contents" : "hidden"}>{children}</div>
    {!enabled ? <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 px-5"><h1 className="text-sm font-medium">Quick Chat is off</h1><p className="text-xs text-muted-foreground">Your agents and their work keep running in Squad.</p><Button asChild variant="outline" size="sm"><a href="/settings/quick-chat">Open settings</a></Button></div> : null}
    {enabled && settings?.quickChatShowUsage && (usageError || usage?.harnesses?.length) ? <details open className="shrink-0 border-t border-border/60 px-3 py-2" data-testid="quick-chat-usage">
      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Usage &amp; limits</summary>
      <div className="mt-2 flex max-h-32 flex-col gap-2 overflow-y-auto">
        {usageError ? <p className="text-xs text-muted-foreground">{usageError}</p> : usage.harnesses.map(harness => <div key={harness.id}>
          <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-medium">{harness.label}</span>{harness.stale ? <span className="text-[10px] text-muted-foreground">Last reported</span> : null}</div>
          {harness.windows.length ? harness.windows.map(window => <div key={window.id} className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-1 w-14 shrink-0 overflow-hidden rounded-sm bg-muted" role="meter" aria-label={`${harness.label} ${window.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent ?? undefined} aria-valuetext={window.usedPercent === null ? "Not reported" : `${window.usedPercent}% used`}><span className="block h-full bg-foreground/65" style={{ width: `${window.usedPercent ?? 0}%` }} /></span>
            <span className="min-w-0">{window.label} · {window.usedPercent === null ? "Not reported" : `${window.usedPercent}% used`} · {usageResetLabel(window.resetsAt)}</span>
          </div>) : <p className="text-[11px] text-muted-foreground">{harness.message || "Usage unavailable for this connection."}</p>}
        </div>)}
      </div>
      <Button variant="ghost" size="icon-xs" className="mt-1" aria-label="Refresh harness usage" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="size-3" /></Button>
    </details> : null}
  </div>;
}
