import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { getComputerUseConsentClient } from "./model";

export function ComputerUsePermissions({ member, api, compact = false, onOpenPermissions }) {
  const native = useMemo(() => getComputerUseConsentClient(), []);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [setupOpened, setSetupOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const statusSequence = useRef(0);
  const refresh = useCallback(async (signal) => {
    const sequence = ++statusSequence.current;
    try {
      const current = await api(`/api/computer-use/status?memberId=${encodeURIComponent(member.id)}`, { signal });
      if (!signal?.aborted && sequence === statusSequence.current) { setStatus({ ...current, memberId: member.id }); setError(""); }
    } catch (failure) {
      if (!signal?.aborted && sequence === statusSequence.current) throw failure;
    }
  }, [api, member.id]);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => refresh(controller.signal).catch((reason) => { if (!controller.signal.aborted) setError(reason.message || "Could not check Computer Use readiness."); });
    void check();
    const timer = window.setInterval(check, 10000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  const current = status?.memberId === member.id ? status : null;
  const scope = current?.grant?.scope || "none";
  const enabled = scope === "observe" || scope === "control";
  const ready = current?.available === true && current.accessibility === true && current.screenRecording === true;
  async function change(next) {
    if (busy || (next !== "none" && !native)) return;
    statusSequence.current += 1;
    setBusy(true); setError("");
    try {
      const result = next === "none"
        ? native ? await native.revoke(member.id) : await api("/api/computer-use/grant", { method: "DELETE", body: JSON.stringify({ memberId: member.id }) })
        : await native.confirm(member.id, next);
      if (result?.confirmed === true || result?.revoked === true || result?.scope === "none") await refresh();
    } catch (reason) { setError(reason.message || "Could not update Computer Use permission."); }
    finally { setBusy(false); }
  }
  async function setup() {
    if (!native || busy) return;
    setBusy(true); setError("");
    try {
      const result = await native.setup();
      if (result?.opened !== true) throw new Error("macOS permission setup did not open.");
      setSetupOpened(true);
      await refresh();
    }
    catch (reason) { setError(reason.message || "Could not open macOS permission setup."); }
    finally { setBusy(false); }
  }
  // Autohand Computer Use (ADR-0162) is the one component across the CLI,
  // Squad and Autohand Desktop: the bridge prefers the CLI's install and
  // otherwise runs the copy bundled with Squad, the same app and identity.
  // Install runs `autohand computer install`, which opens the macOS prompts.
  const [installing, setInstalling] = useState(false);
  const usingAutohand = current?.host?.source === "autohand";
  async function installAutohand() {
    if (installing) return;
    setInstalling(true); setError("");
    try {
      const result = await api("/api/computer-use/install", { method: "POST" });
      if (result?.ok !== true) throw new Error(result?.message || "Autohand Computer Use could not be installed.");
      setSetupOpened(true);
      await refresh();
    } catch (reason) { setError(reason.message || "Autohand Computer Use could not be installed."); }
    finally { setInstalling(false); }
  }
  const toggle = <Field orientation="horizontal" className="items-center justify-between gap-5 py-4">
    <FieldContent>
      <FieldLabel htmlFor={`computer-use-${member.id}`}>Use the computer</FieldLabel>
      <FieldDescription>{enabled
        ? scope === "observe" ? `${member.name} may inspect apps and screenshots. Control actions remain blocked.` : `${member.name} may inspect and operate apps with your confirmed access.`
        : "Off. New work receives no Computer Use instructions or tools. Enabling requires confirmation in the desktop app."}</FieldDescription>
    </FieldContent>
    <Switch id={`computer-use-${member.id}`} aria-label="Use the computer" checked={enabled} disabled={busy || !current || (!enabled && (!native || !ready))} onCheckedChange={checked => void change(checked ? "control" : "none")} />
  </Field>;
  if (compact) return <section data-testid="member-computer-use" className="border-t border-border/70">
    {toggle}
    {!current ? <p role="status" className="text-sm text-muted-foreground">Checking Computer Use readiness…</p> : null}
    {current && (!native || !ready) ? <p className="text-sm text-muted-foreground">{!native ? "Enable Computer Use from the Squad desktop app." : current.readinessError || "Computer Use needs macOS permission setup."}</p> : null}
    {onOpenPermissions ? <Button type="button" size="sm" variant="ghost" onClick={onOpenPermissions}>Computer Use permissions</Button> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </section>;
  return (
    <section className="border-b border-border pb-5" aria-labelledby="computer-use-heading" data-testid="computer-use-permissions">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="computer-use-heading" className="text-base font-semibold">Computer Use</h2>
          <p className="mt-1 text-sm text-muted-foreground">Allow {member.name} to inspect apps and screenshots, or operate your computer. Screenshots and action evidence appear in the conversation.</p>
        </div>
        <span className="text-sm text-muted-foreground">{scope === "control" ? "Control allowed" : scope === "observe" ? "Observe allowed" : "Not allowed"}</span>
      </div>
      {toggle}
      {/* Outside the desktop app the System Settings sentence asked for a
          step the browser cannot take, right above "open the desktop app".
          One instruction: the one that can be followed from here. */}
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {!native ? "Open this member’s Permissions page in the Squad desktop app to allow Computer Use." : !current ? "Checking readiness…" : current.readinessError ? current.readinessError : !current.available ? "Computer Use readiness could not be confirmed. Install Autohand Computer Use with the button below, or check that this Squad build includes the engine and macOS permission host." : ready ? "macOS permissions are ready." : `Allow ${current.host?.product || "Computer Use"} in System Settings → Privacy & Security → Accessibility and Screen Recording, then check again.`}
      </p>
      {current?.host ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="computer-use-host">
          {usingAutohand
            ? "Using Autohand Computer Use, the same component Autohand Code installs and that you have already granted."
            : current.host.fallbackReason
              ? `Using the copy of Autohand Computer Use bundled with Squad: ${current.host.fallbackReason}`
              : "Using the copy of Autohand Computer Use bundled with Squad. Install it with Autohand Code to share one grant across the CLI, Squad and Autohand Desktop."}
        </p>
      ) : null}
      {setupOpened && !ready ? <p className="mt-2 text-sm text-muted-foreground">Finish the macOS permission prompts, then check again. Opening setup does not grant access to this member.</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(current?.bundled === true || current?.available) && !ready && native && !usingAutohand ? <Button size="sm" variant="outline" disabled={busy} onClick={setup}>Set up macOS permissions</Button> : null}
        {current && (!usingAutohand || !ready) ? <Button size="sm" variant="outline" disabled={busy || installing} onClick={installAutohand}>{installing ? "Installing…" : usingAutohand ? "Repair Autohand Computer Use" : "Install Autohand Computer Use"}</Button> : null}
        <Button size="sm" variant="outline" disabled={!native || !ready || busy || scope === "observe"} onClick={() => change("observe")}>Allow observe</Button>
        <Button size="sm" variant="outline" disabled={!native || !ready || busy || scope === "control"} onClick={() => change("control")}>Allow control</Button>
        {scope !== "none" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => change("none")}>Revoke access</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => refresh().catch((reason) => setError(reason.message))}>Check again</Button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
