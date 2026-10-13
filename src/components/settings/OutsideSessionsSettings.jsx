import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";

const ENGINES = [
  { id: "claude", label: "Claude Code", file: "~/.claude/settings.json" },
  { id: "codex", label: "Codex", file: "~/.codex/hooks.json" },
];

/**
 * Sessions started outside Squad (ADR-0127): one switch per engine. On adds
 * Squad's lifecycle hooks to that engine's own config (a backup is kept next
 * to it) so a session you run in a terminal appears in the member's Runs tab;
 * Off removes only Squad's entries. Other hooks in the file are untouched.
 */
export function OutsideSessionsSettings({ api }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api("/api/hooks/status").then((data) => { if (!cancelled) setStatus(data); }).catch((reason) => { if (!cancelled) setError(reason?.message || "Could not read the hook status."); });
    return () => { cancelled = true; };
  }, [api]);

  async function toggle(engine, on) {
    setBusy(engine);
    setError("");
    try {
      const next = await api(`/api/hooks/${engine}/${on ? "install" : "uninstall"}`, { method: "POST", body: "{}" });
      setStatus((current) => ({ ...(current || {}), [engine]: next }));
    } catch (reason) {
      setError(reason?.message || "The engine's config could not be changed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="py-4" data-testid="outside-sessions">
      <div className="px-2">
        <div className="font-medium">Sessions outside Squad</div>
        <p className="mt-1 text-sm text-muted-foreground">Record Claude Code and Codex sessions you start in a terminal. Each prompt appears in the Runs tab of the member on that engine and folder, and in All work. Squad adds its own hooks to the engine's config and keeps a backup; your other hooks are left alone.</p>
      </div>
      <div className="mt-2 divide-y divide-border/60">
        {ENGINES.map((engine) => {
          const entry = status?.[engine.id];
          return (
            <label key={engine.id} className="flex items-center justify-between gap-4 px-2 py-3">
              <span className="min-w-0">
                <span className="block text-sm">{engine.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{entry?.error || (entry?.installed ? `Recording · ${entry.path}` : entry?.path || engine.file)}</span>
              </span>
              <Switch
                aria-label={`Record ${engine.label} sessions started outside Squad`}
                checked={Boolean(entry?.installed)}
                disabled={!status || busy === engine.id || Boolean(entry?.error)}
                onCheckedChange={(on) => toggle(engine.id, on)}
              />
            </label>
          );
        })}
      </div>
      {error ? <p className="px-2 pt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
