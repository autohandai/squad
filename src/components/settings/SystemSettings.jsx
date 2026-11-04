import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { formatUsageCount, systemCountRows } from "@/lib/system-settings";
import { copyText } from "@/lib/copy-text";
import { getSystemResetClient, pendingSystemReset, performSystemReset, recoverSystemReset, restartAfterSystemReset } from "@/lib/system-reset";

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
 *     POST /api/system/reveal    open the data folder
 *   locale, copy                 locale strings (fallbacks inline)
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function SystemSettings({ api, locale = "en", copy = {}, className }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState({ state: "idle", error: "" });
  const nativeReset = useMemo(() => getSystemResetClient(), []);
  const [reset, setReset] = useState(() => ({ state: pendingSystemReset() ? "recovering" : "idle", pending: pendingSystemReset(), error: "" }));
  async function openReset() {
    try {
      await nativeReset?.stage("confirm");
      setReset({ state: "confirm", error: "" });
    } catch (failure) { setReset({ state: "idle", error: failure.message }); }
  }
  async function cancelReset() {
    if (reset.state !== "confirm") return;
    try {
      await nativeReset?.stage("idle");
      setReset({ state: "idle", error: "" });
    } catch (failure) { setReset(previous => ({ ...previous, error: failure.message })); }
  }
  async function resetSquad() {
    setReset({ state: "working", error: "" });
    try {
      const receipt = await performSystemReset({ api, native: nativeReset, onRecovery: pending => setReset({ state: "recovering", pending, error: "" }) });
      setReset({ state: "complete", receipt, error: "" });
    } catch (error) {
      const pending = pendingSystemReset();
      setReset({ state: pending ? "unknown" : "confirm", pending, error: error?.message || "Squad could not be reset." });
    }
  }
  async function checkReset() {
    setReset(previous => ({ ...previous, state: "recovering", error: "" }));
    try {
      const receipt = await recoverSystemReset(reset.pending, { native: nativeReset });
      setReset({ state: "complete", receipt, error: "" });
    } catch (failure) { setReset(previous => ({ ...previous, state: "unknown", error: failure.message })); }
  }
  async function restartSquad() {
    setReset(previous => ({ ...previous, state: "restarting", error: "" }));
    try { await restartAfterSystemReset(reset.receipt, nativeReset); }
    catch (failure) { setReset(previous => ({ ...previous, state: "complete", error: failure.message })); }
  }
  useEffect(() => {
    if (reset.state === "idle" || reset.state === "complete" || reset.state === "restarting") return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ""; };
    // Native menus have the same guard. Keep app-wide navigation shortcuts
    // from unmounting the dialog while the person is deciding or resetting.
    const shortcut = event => { if ((event.metaKey || event.ctrlKey) && !["c", "a", "v", "x"].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("keydown", shortcut, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("keydown", shortcut, true); };
  }, [reset.state]);
  useEffect(() => {
    const pending = pendingSystemReset();
    if (!pending) return;
    let mounted = true;
    recoverSystemReset(pending, { native: nativeReset }).then(receipt => { if (mounted) setReset({ state: "complete", receipt, error: "" }); }, failure => { if (mounted) setReset({ state: "unknown", pending, error: failure.message }); });
    return () => { mounted = false; };
  }, [nativeReset]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!api) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const nextSummary = await api("/api/system/summary");
        if (cancelled) return;
        setSummary(nextSummary);
        setError("");
      } catch (failure) {
        if (!cancelled) setError(failure?.message || String(failure));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

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

        <Row title={copy.systemReset || "Reset Squad"} description={copy.systemResetDetail || "Start again as a clean install. Your Autohand Code sign-in stays."}>
          <Button type="button" variant="outline" size="sm" disabled={!api || reset.state !== "idle"} onClick={() => void openReset()}>
            {copy.systemResetAction || "Reset Squad…"}
          </Button>
        </Row>
        {reset.error && reset.state === "idle" ? (
          <p role="status" className="py-2 text-xs text-destructive">
            {reset.error}
          </p>
        ) : null}
      </div>

      <Dialog open={reset.state !== "idle"} onOpenChange={open => { if (!open) void cancelReset(); }}>
        <DialogContent className="sm:max-w-md" showCloseButton={reset.state === "confirm"} onEscapeKeyDown={event => { if (reset.state !== "confirm") event.preventDefault(); }} onInteractOutside={event => event.preventDefault()} data-testid="system-reset-dialog">
          <DialogHeader>
            <DialogTitle>{reset.state === "confirm" ? copy.systemResetTitle || "Reset Squad to a clean install?" : reset.state === "complete" || reset.state === "restarting" ? reset.receipt?.phase === "complete" ? "Squad has been reset" : "Reset could not finish" : "Resetting Squad…"}</DialogTitle>
            <DialogDescription>
              {reset.state === "confirm" ? copy.systemResetBody || "Members, channels, chats, memory, run history and settings are moved aside with today's date, not deleted. Your Autohand Code sign-in, sessions and skills stay. Squad restarts at first run. Keychain items and macOS privacy grants are listed in the setup guide if you want those gone too." : reset.state === "complete" || reset.state === "restarting" ? reset.receipt?.phase === "complete" ? "Your dated backups and Autohand Code sign-in are kept. Restart Squad to start fresh." : reset.receipt?.error || "Your folders are kept. Restart Squad before trying again." : "Moving members, channels and history aside. Don’t quit Squad."}
            </DialogDescription>
          </DialogHeader>
          {["working", "recovering", "restarting"].includes(reset.state) ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{reset.state === "restarting" ? "Restarting Squad…" : reset.state === "recovering" ? "Checking reset progress…" : "Resetting Squad…"}</p> : null}
          {reset.error ? <p role="alert" className="text-sm text-destructive">{reset.error}</p> : null}
          <DialogFooter>
            {reset.state === "confirm" ? <><Button type="button" variant="ghost" onClick={() => void cancelReset()}>{copy.cancel || "Cancel"}</Button><Button type="button" variant="destructive" onClick={() => void resetSquad()} data-testid="system-reset-confirm">{copy.systemResetConfirm || "Reset Squad"}</Button></> : null}
            {reset.state === "complete" || reset.state === "restarting" ? <Button type="button" disabled={reset.state === "restarting"} onClick={() => void restartSquad()}>Restart Squad</Button> : null}
            {reset.state === "unknown" ? <Button type="button" variant="outline" onClick={() => void checkReset()}>Check reset status</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
