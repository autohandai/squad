import { ownedLocalStorage } from "@/lib/owned-storage";
import { currentOwnership } from "@/lib/ownership-client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function QuickChatPreferences({ api }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    api("/api/system/settings").then(value => { if (!disposed) { setSettings(value); setError(""); } }).catch(failure => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [api, attempt]);
  async function change(key, value) {
    setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api("/api/system/settings", { method: "PUT", body: JSON.stringify({ [key]: value }) });
      setSettings(saved);
      try { ownedLocalStorage.setItem("autohandSquad.v1.quickChatSettings", JSON.stringify(saved)); } catch { /* Native polling still applies saved settings. */ }
      window.dispatchEvent(new Event("squad:quick-chat-settings"));
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (invoke) {
        try { await invoke("squad_refresh_quick_chat", { contextGeneration: currentOwnership()?.generation }); }
        catch { setNotice("Preferences saved. Reopen an updated Squad desktop app to apply the menu bar changes."); }
      }
    } catch (failure) { setError(failure.message || "Could not save Quick Chat settings."); }
    finally { setBusy(false); }
  }
  return <FieldGroup className="gap-0 divide-y divide-border/65" data-testid="quick-chat-preferences">
    <Field orientation="horizontal" className="items-center justify-between py-4">
      <FieldContent><FieldTitle><label htmlFor="quick-chat-enabled">Enable Quick Chat</label></FieldTitle><FieldDescription>Chat from the menu bar or with ⌘⇧K. Turning this off keeps agents and their work running.</FieldDescription></FieldContent>
      <Switch id="quick-chat-enabled" checked={settings?.quickChatEnabled !== false} disabled={!settings || busy} onCheckedChange={value => change("quickChatEnabled", value)} />
    </Field>
    <Field orientation="responsive" className="justify-between gap-5 py-4">
      <FieldContent><FieldTitle>Menu bar</FieldTitle><FieldDescription>Choose Agent avatars to show each available agent in the menu bar, including agents waiting for work. One Squad icon keeps their avatars inside Quick Chat.</FieldDescription></FieldContent>
      <Select value={settings?.quickChatMenuBarMode || "single"} disabled={!settings || busy || !settings.quickChatEnabled} onValueChange={value => change("quickChatMenuBarMode", value)}><SelectTrigger className="w-full shrink-0 @md/field-group:w-48" aria-label="Quick Chat menu bar mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">One Squad icon</SelectItem><SelectItem value="active-agents">Agent avatars</SelectItem></SelectContent></Select>
    </Field>
    <Field orientation="responsive" className="justify-between gap-5 py-4">
      <FieldContent><FieldTitle>Appearance</FieldTitle><FieldDescription>Apple Liquid Glass on macOS 26 or later, with native translucency on earlier versions. Choose Solid for an opaque panel.</FieldDescription></FieldContent>
      <Select value={settings?.quickChatAppearance || "glass"} disabled={!settings || busy || !settings.quickChatEnabled} onValueChange={value => change("quickChatAppearance", value)}><SelectTrigger className="w-full shrink-0 @md/field-group:w-48" aria-label="Quick Chat appearance"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="glass">Apple glass</SelectItem><SelectItem value="solid">Solid</SelectItem></SelectContent></Select>
    </Field>
    <Field orientation="horizontal" className="items-center justify-between py-4">
      <FieldContent><FieldTitle><label htmlFor="quick-chat-usage">Show harness usage and limits</label></FieldTitle><FieldDescription>Show connected harnesses’ reported usage, reset times and unavailable states. Usage checks do not send agent prompts.</FieldDescription></FieldContent>
      <Switch id="quick-chat-usage" checked={settings?.quickChatShowUsage !== false} disabled={!settings || busy} onCheckedChange={value => change("quickChatShowUsage", value)} />
    </Field>
    {error ? <div className="py-3 text-sm" role="alert"><p className="text-destructive">{error}</p>{!settings ? <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button> : null}</div> : null}
    {notice ? <p className="py-3 text-sm text-muted-foreground" role="status">{notice}</p> : null}
    <p className="py-4 text-xs text-muted-foreground">Menu bar behavior is available in the macOS desktop app. Preferences are saved on this computer.</p>
  </FieldGroup>;
}
