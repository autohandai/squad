import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { peopleSentence, relayStatusSentence } from "@/lib/workspaces";

function Row({ title, description, children, htmlFor }) {
  return (
    <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
      <FieldContent className="w-[220px] shrink-0 gap-1">
        <FieldTitle>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </Field>
  );
}

/**
 * Settings › Relay. Props:
 *   config  { url, workspace, enabled, hasToken, tokenHint }   from GET /api/relay/config
 *   status  { configured, connected, peers, self, lastSync, lastError }  from GET /api/relay/status
 *   onSave(patch) -> Promise   PUT /api/relay/config; `patch.token` is omitted when untouched
 *   onSync() -> Promise        POST /api/relay/sync
 *   copy    locale strings (fallbacks inline)
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function RelaySettings({ config = {}, status = {}, onSave, onSync, copy = {}, className }) {
  const [url, setUrl] = useState(config.url || "");
  const [workspace, setWorkspace] = useState(config.workspace || "");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUrl(config.url || "");
    setWorkspace(config.workspace || "");
    setToken("");
  }, [config.url, config.workspace, config.hasToken]);

  const dirty = url !== (config.url || "") || workspace !== (config.workspace || "") || token.trim() !== "";
  const canEnable = Boolean(config.url && config.workspace && config.hasToken);

  async function save(patch) {
    if (!onSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave(patch);
      setToken("");
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setSaving(false);
    }
  }

  function saveFields() {
    const patch = { url: url.trim(), workspace: workspace.trim().toLowerCase() };
    if (token.trim()) patch.token = token.trim();
    return save(patch);
  }

  async function syncNow() {
    if (!onSync) return;
    setSyncing(true);
    setError("");
    try {
      await onSync();
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setSyncing(false);
    }
  }

  const sentence = relayStatusSentence(status, config, copy);
  const people = status.connected ? peopleSentence(status.peers, status.self, copy) : "";

  return (
    <div className={cn("divide-y divide-border/65", className)}>
      <Row title={copy.relayUrl || "Relay URL"} description={copy.relayUrlDetail || "Where your team's relay runs, for example https://relay.example.com."} htmlFor="relay-url">
        <Input id="relay-url" value={url} placeholder="https://relay.example.com" autoComplete="off" spellCheck={false} onChange={(event) => setUrl(event.target.value)} className="max-w-sm" />
      </Row>
      <Row title={copy.relayToken || "Token"} description={config.hasToken ? `${copy.relayTokenStored || "A token is stored"} (${config.tokenHint}). ${copy.relayTokenReplace || "Enter a new one to replace it."}` : copy.relayTokenDetail || "Your personal token for the relay. Stored on this machine only."} htmlFor="relay-token">
        <Input id="relay-token" type="password" value={token} placeholder={config.hasToken ? "••••••••" : ""} autoComplete="off" onChange={(event) => setToken(event.target.value)} className="max-w-sm" />
      </Row>
      <Row title={copy.relayWorkspace || "Workspace"} description={copy.relayWorkspaceDetail || "The shared workspace name everyone connects to. Lowercase letters, digits, dots and dashes."} htmlFor="relay-workspace">
        <Input id="relay-workspace" value={workspace} placeholder="team" autoComplete="off" spellCheck={false} onChange={(event) => setWorkspace(event.target.value)} className="max-w-sm" />
      </Row>
      <div className="flex items-center justify-end gap-2 py-3">
        {error ? <p className="mr-auto text-sm text-destructive">{error}</p> : null}
        <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={saveFields}>
          {saving ? copy.saving || "Saving…" : copy.save || "Save"}
        </Button>
      </div>
      <Row title={copy.relayEnabled || "Sync with the relay"} description={copy.relayEnabledDetail || "Share channels and messages with everyone in the workspace. Members keep running on the machine that owns them."}>
        <Switch
          checked={config.enabled === true}
          disabled={saving || (!config.enabled && !canEnable)}
          onCheckedChange={(checked) => save({ enabled: checked })}
          aria-label={copy.relayEnabled || "Sync with the relay"}
        />
      </Row>
      <div className="flex items-center justify-between gap-6 py-4">
        <p className="min-w-0 text-sm leading-6 text-muted-foreground">
          {sentence}
          {people ? <span className="block">{people}.</span> : null}
        </p>
        <Button size="sm" variant="ghost" disabled={!config.enabled || syncing} onClick={syncNow} aria-label={copy.syncNow || "Sync now"}>
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} aria-hidden="true" />
          {copy.syncNow || "Sync now"}
        </Button>
      </div>
    </div>
  );
}
