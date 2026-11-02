import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatUsageCount, systemCountRows } from "@/lib/system-settings";
import { copyText } from "@/lib/copy-text";

function Row({ title, description, children, htmlFor }) {
  return (
    <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
      <FieldContent className="w-[220px] shrink-0 gap-1">
        <FieldTitle>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">{children}</div>
    </Field>
  );
}

/**
 * Settings › System (ADR-0105). Props:
 *   api(path, options) -> data   the app's bridge helper; this component
 *                                fetches on mount (docs/integration/system.md)
 *     GET /api/system/summary    counts + dataFolder + revealLabel
 *     GET /api/system/settings   { autoCheckUpdates }
 *     PUT /api/system/settings   { autoCheckUpdates }
 *     POST /api/system/reveal    open the data folder
 *   onAutoCheckUpdatesChange(enabled)  optional; the integrator refreshes its
 *                                      update status so the browser's own
 *                                      automatic check follows the switch
 *   locale, copy                 locale strings (fallbacks inline)
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function SystemSettings({ api, locale = "en", copy = {}, onAutoCheckUpdatesChange, className }) {
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState({ autoCheckUpdates: true });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState({ state: "idle", error: "" });
  // Reset Squad (ADR-0161 §3.1): the bridge moves its folders aside and
  // restarts; the window forgets its own storage and returns to first run.
  const [reset, setReset] = useState({ state: "idle", error: "" });
  async function resetSquad() {
    setReset({ state: "working", error: "" });
    try {
      await api("/api/system/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) });
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("autohandSquad.")) window.localStorage.removeItem(key);
      window.setTimeout(() => { window.location.assign("/"); }, 2500);
    } catch (error) {
      setReset({ state: "idle", error: error?.message || "Squad could not be reset." });
    }
  }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [nextSummary, nextSettings] = await Promise.all([api("/api/system/summary"), api("/api/system/settings")]);
        if (cancelled) return;
        setSummary(nextSummary);
        setSettings({ autoCheckUpdates: nextSettings?.autoCheckUpdates !== false });
        setError("");
      } catch (failure) {
        if (!cancelled) setError(failure?.message || String(failure));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function toggleAutoCheck(checked) {
    const enabled = checked === true;
    const previous = settings;
    setSettings({ autoCheckUpdates: enabled });
    setSaving(true);
    setError("");
    try {
      const stored = await api("/api/system/settings", { method: "PUT", body: JSON.stringify({ autoCheckUpdates: enabled }) });
      setSettings({ autoCheckUpdates: stored?.autoCheckUpdates !== false });
      onAutoCheckUpdatesChange?.(stored?.autoCheckUpdates !== false);
    } catch (failure) {
      setSettings(previous);
      setError(failure?.message || String(failure));
    } finally {
      setSaving(false);
    }
  }

  async function revealFolder() {
    setReveal({ state: "opening", error: "" });
    try {
      await api("/api/system/reveal", { method: "POST" });
      setReveal({ state: "idle", error: "" });
    } catch (failure) {
      setReveal({ state: "idle", error: failure?.message || String(failure) });
    }
  }

  async function copyPath() {
    const path = summary?.dataFolder || "";
    if (!path) return;
    const ok = await copyText(path);
    setCopied(ok ? "copied" : "failed");
    window.setTimeout(() => setCopied(false), 1500);
  }

  const counts = systemCountRows(summary || {}, copy);
  const dataFolder = summary?.dataFolder || "";

  return (
    <div className={cn("min-w-0", className)}>
      {error ? (
        <p role="status" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="divide-y divide-border/65">
        {counts.map((row) => (
          <Row key={row.id} title={row.label}>
            <span className="text-sm tabular-nums" data-testid={`system-count-${row.id}`}>
              {summary ? formatUsageCount(row.value, locale) : "…"}
            </span>
          </Row>
        ))}

        <Row title={copy.systemDataFolder || "Data folder"} description={copy.systemDataFolderDetail || "Channels, runs, telemetry and settings live here."}>
          <code translate="no" className="min-w-0 truncate text-xs text-muted-foreground" title={dataFolder} data-testid="system-data-folder">
            {/* "/Users/igorcosta..." hid the
                only part that says where the data is. */}
            {dataFolder ? dataFolder.replace(/^\/(?:Users|home)\/[^/]+/, "~") : "…"}
          </code>
          <Button type="button" variant="ghost" size="sm" disabled={!dataFolder} onClick={copyPath}>
            {copied === "copied" ? copy.copied || "Copied" : copied === "failed" ? copy.copyFailed || "Select the path to copy it" : copy.copyPath || "Copy path"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!dataFolder || reveal.state === "opening"} onClick={revealFolder}>
            {summary?.revealLabel || copy.systemReveal || "Show in Finder"}
          </Button>
        </Row>
        {reveal.error ? (
          <p role="status" className="py-2 text-xs text-destructive">
            {reveal.error}
          </p>
        ) : null}

        <Row
          htmlFor="system-auto-check-updates"
          title={copy.systemAutoCheckUpdates || "Check for updates automatically"}
          description={copy.systemAutoCheckUpdatesDetail || "Off, the app only checks GitHub when you ask it to."}
        >
          <Switch id="system-auto-check-updates" checked={settings.autoCheckUpdates} disabled={saving || !api} onCheckedChange={toggleAutoCheck} />
        </Row>

        <Row title={copy.systemReset || "Reset Squad"} description={copy.systemResetDetail || "Start again as a clean install. Your Autohand Code sign-in stays."}>
          <Button type="button" variant="outline" size="sm" disabled={!api || reset.state === "working"} onClick={() => setReset({ state: "confirm", error: "" })}>
            {copy.systemResetAction || "Reset Squad…"}
          </Button>
        </Row>
        {reset.error ? (
          <p role="status" className="py-2 text-xs text-destructive">
            {reset.error}
          </p>
        ) : null}
      </div>

      <Dialog open={reset.state === "confirm" || reset.state === "working"} onOpenChange={(open) => { if (!open && reset.state !== "working") setReset({ state: "idle", error: "" }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.systemResetTitle || "Reset Squad to a clean install?"}</DialogTitle>
            <DialogDescription>
              {copy.systemResetBody || "Members, channels, chats, memory, run history and settings are moved aside with today's date, not deleted. Your Autohand Code sign-in, sessions and skills stay. Squad restarts at first run. Keychain items and macOS privacy grants are listed in the setup guide if you want those gone too."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={reset.state === "working"} onClick={() => setReset({ state: "idle", error: "" })}>{copy.cancel || "Cancel"}</Button>
            <Button type="button" variant="destructive" disabled={reset.state === "working"} onClick={() => void resetSquad()} data-testid="system-reset-confirm">
              {reset.state === "working" ? copy.systemResetting || "Resetting…" : copy.systemResetConfirm || "Reset Squad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
