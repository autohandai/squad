import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getComputerUseConsentClient } from "./model";

export function ComputerUsePermissions({ member, api }) {
  const native = useMemo(() => getComputerUseConsentClient(), []);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [setupOpened, setSetupOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal) => {
    const current = await api(`/api/computer-use/status?memberId=${encodeURIComponent(member.id)}`, { signal });
    if (!signal?.aborted) { setStatus({ ...current, memberId: member.id }); setError(""); }
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
  const ready = current?.available === true && current.accessibility === true && current.screenRecording === true;
  async function change(next) {
    if (!native || busy) return;
    setBusy(true); setError("");
    try {
      const result = next === "none" ? await native.revoke(member.id) : await native.confirm(member.id, next);
      if (result?.confirmed === true || result?.revoked === true) await refresh();
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
  return (
    <section className="border-b border-border pb-5" aria-labelledby="computer-use-heading" data-testid="computer-use-permissions">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="computer-use-heading" className="text-base font-semibold">Computer Use</h2>
          <p className="mt-1 text-sm text-muted-foreground">Allow {member.name} to inspect apps and screenshots, or operate your computer. Screenshots and action evidence appear in the conversation.</p>
        </div>
        <span className="text-sm text-muted-foreground">{scope === "control" ? "Control allowed" : scope === "observe" ? "Observe allowed" : "Not allowed"}</span>
      </div>
      {/* Outside the desktop app the System Settings sentence asked for a
          step the browser cannot take, right above "open the desktop app".
          One instruction: the one that can be followed from here. */}
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {!native ? "Open this member’s Permissions page in the Squad desktop app to allow Computer Use." : !current ? "Checking readiness…" : current.readinessError ? current.readinessError : !current.available ? "Computer Use readiness could not be confirmed. Check that this Squad build includes the engine and macOS permission host." : ready ? "macOS permissions are ready." : "Allow Squad Computer Use in System Settings → Privacy & Security → Accessibility and Screen Recording, then check again."}
      </p>
      {setupOpened && !ready ? <p className="mt-2 text-sm text-muted-foreground">Finish the macOS permission prompts, then check again. Opening setup does not grant access to this member.</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(current?.bundled === true || current?.available) && !ready && native ? <Button size="sm" variant="outline" disabled={busy} onClick={setup}>Set up macOS permissions</Button> : null}
        <Button size="sm" variant="outline" disabled={!native || !ready || busy || scope === "observe"} onClick={() => change("observe")}>Allow observe</Button>
        <Button size="sm" variant="outline" disabled={!native || !ready || busy || scope === "control"} onClick={() => change("control")}>Allow control</Button>
        {scope !== "none" ? <Button size="sm" variant="ghost" disabled={!native || busy} onClick={() => change("none")}>Revoke access</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => refresh().catch((reason) => setError(reason.message))}>Check again</Button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
