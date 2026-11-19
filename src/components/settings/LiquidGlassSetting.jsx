import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { saveQuickChatSettings } from "@/components/settings/QuickChatPreferences";

/**
 * Settings › Appearance › Liquid Glass sidebar (ADR-0258). Shown only when the
 * desktop shell reports that this Mac has native Liquid Glass (macOS 26 and
 * later, e.g. 27.2.1 "Golden Gate"); elsewhere the sidebar keeps its usual
 * material and the row would promise nothing.
 */
export function LiquidGlassSetting({ api }) {
  const [available, setAvailable] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.liquidGlassAvailable === "true");
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setAvailable(root.dataset.liquidGlassAvailable === "true");
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-liquid-glass-available"] });
    read();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!available) return;
    let live = true;
    api("/api/system/settings").then((settings) => { if (live) setOn(settings?.sidebarLiquidGlass !== false); }).catch(() => {});
    return () => { live = false; };
  }, [api, available]);
  if (!available) return null;
  async function change(next) {
    setBusy(true); setError(""); setOn(next);
    try { await saveQuickChatSettings(api, { sidebarLiquidGlass: next }); }
    catch (failure) { setOn(!next); setError(failure?.message || "The setting could not be saved."); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]" data-testid="liquid-glass-setting">
      <div className="min-w-0">
        <label htmlFor="sidebar-liquid-glass" className="text-sm font-medium">Liquid Glass sidebar</label>
        <p className="mt-1 text-sm text-muted-foreground">The sidebar sits on this Mac’s Liquid Glass and picks up what is behind the window. Off uses the plain sidebar material.</p>
      </div>
      <div className="flex items-start gap-3 py-1">
        <Switch id="sidebar-liquid-glass" checked={on} disabled={busy} onCheckedChange={change} />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
