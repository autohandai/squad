import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

export function UpdatePreferences({ api, onChange }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api("/api/system/settings").then(value => {
      if (!cancelled) { setSettings(value); setError(""); }
    }).catch(failure => { if (!cancelled) setError(failure.message || "Could not load update preferences."); });
    return () => { cancelled = true; };
  }, [api, retry]);
  async function change(key, checked) {
    setSaving(true); setError("");
    try {
      const saved = await api("/api/system/settings", { method: "PUT", body: JSON.stringify({ [key]: checked }) });
      setSettings(saved);
      onChange?.();
    } catch (failure) { setError(failure.message || "Could not save update preferences. Try again."); }
    finally { setSaving(false); }
  }
  return (
    <div data-testid="update-preferences" className="divide-y divide-border/65">
      {[
        ["autoCheckUpdates", "Check for updates automatically", "Look for new releases in the background. You can always check manually."],
        ["autoDownloadUpdates", "Download updates automatically", "Download and verify new versions in the background. Always ask before installing or restarting."],
      ].map(([key, label, description]) => (
        <div key={key} className="flex items-center justify-between gap-6 py-4">
          <div className="min-w-0 space-y-1">
            <label htmlFor={`updates-${key}`} className="text-sm font-medium">{label}</label>
            <p id={`updates-${key}-detail`} className="text-sm text-muted-foreground">{description}</p>
            {key === "autoDownloadUpdates" && settings?.autoCheckUpdates === false ? <p className="text-xs text-muted-foreground">Automatic downloads wait until automatic checks are on.</p> : null}
          </div>
          <Switch id={`updates-${key}`} aria-describedby={`updates-${key}-detail`} checked={settings?.[key] === true} disabled={!settings || saving} onCheckedChange={checked => void change(key, checked)} />
        </div>
      ))}
      {error ? <p role="alert" className="py-3 text-sm text-destructive">{error} {!settings ? <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button> : null}</p> : null}
    </div>
  );
}
