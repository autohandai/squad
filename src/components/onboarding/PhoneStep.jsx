import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresenceDot } from "@/components/members/PresenceDot";
import { PairingCode } from "@/components/settings/ComputersSettings";
import { PairedPhones } from "@/components/settings/PairedPhones";

/**
 * A phone outline with one member answering, as a hint of what pairing gives.
 * Decorative; the copy beside it carries the meaning.
 */
function PhoneHint({ member = { name: "Chief of Staff", avatar: className => <img src="/avatars/birds/kea.webp" alt="" className={`object-cover ${className}`} decoding="async" /> } }) {
  return <div aria-hidden="true" data-testid="phone-hint" className="phone-hint relative mx-auto flex h-[232px] w-[118px] shrink-0 flex-col rounded-[22px] border-[1.5px] border-foreground/25 bg-background px-2 pb-2 pt-1.5">
    <span className="mx-auto block h-[5px] w-9 rounded-full bg-foreground/15" />
    <span className="mt-3 flex items-center gap-1.5 border-b border-border/60 px-0.5 pb-2">
      <span className="relative inline-flex">
        <span className="inline-flex size-5 overflow-hidden rounded-full">{member.avatar("size-5 rounded-full")}</span>
        <PresenceDot state="working" size="xs" className="absolute -bottom-px -right-px ring-1" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[9px] font-medium leading-3">{member.name}</span>
        <span className="block truncate text-[7.5px] leading-3 text-muted-foreground">Working</span>
      </span>
    </span>
    <span className="flex flex-1 flex-col justify-end gap-1.5 px-0.5 pb-2">
      <span className="phone-hint-out ml-auto block w-fit max-w-[82%] rounded-md bg-foreground px-1.5 py-1 text-[8.5px] leading-3 text-background">Ship the release notes?</span>
      <span className="phone-hint-in block w-fit max-w-[88%] rounded-md bg-muted px-1.5 py-1 text-[8.5px] leading-3">Drafted. Posted in #general for your OK.</span>
    </span>
    <span className="block h-4 rounded-md border border-border/80" />
  </div>;
}

/**
 * Onboarding: pair an iPhone with the same APIs and code as Settings ›
 * Computers. A QR offer grants nothing until the six digits are approved here.
 */
export function PhoneStep({ api, member, onBack, onSkip, onPaired, onFinish, inDialog = false }) {
  const [status, setStatus] = useState(null);
  const [offer, setOffer] = useState(null);
  const [phase, setPhase] = useState("intro");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState(null);
  const known = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Read once to learn about already-paired phones; poll only while a code is out.
  useEffect(() => {
    let disposed = false;
    api("/api/mobile/status").then(next => { if (!disposed) { setStatus(next); known.current ??= new Set((next.devices || []).map(device => device.id)); } }).catch(() => {});
    return () => { disposed = true; };
  }, [api]);
  useEffect(() => {
    if (phase !== "offer") return undefined;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const next = await api("/api/mobile/status", { signal: controller.signal });
        if (!mounted.current) return;
        setStatus(next);
        if (offer && offer.expiresAt <= Date.now() / 1000 && !next.pending) { setOffer(null); setPhase("expired"); }
      } catch { /* The next poll retries; a lost read is not a failed pairing. */ }
    }, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [api, phase, offer]);

  async function waitForRoute() {
    for (let tries = 0; tries < 20; tries++) {
      const next = await api("/api/mobile/status");
      if (!mounted.current) return null;
      setStatus(next);
      if (next.listening && next.endpoint) return next;
      if (next.error && tries > 3) throw Error(next.error);
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw Error("Your computer is not reachable by phone yet. Check Settings › Computers.");
  }
  async function showCode() {
    setBusy(true); setError(""); setPhase("preparing");
    try {
      let current = status || await api("/api/mobile/status");
      known.current ??= new Set((current.devices || []).map(device => device.id));
      // Pairing needs phone connections on. Keep the routes the person saved.
      if (!current.config?.enabled) current = await api("/api/mobile/config", { method: "PUT", body: JSON.stringify({ ...current.config, enabled: true }) });
      if (!current.listening || !current.endpoint) current = await waitForRoute();
      if (!current) return;
      const next = await api("/api/mobile/pair", { method: "POST" });
      if (!mounted.current) return;
      setOffer(next); setPhase("offer");
    } catch (failure) { if (mounted.current) { setError(failure.message || "The pairing code could not be made."); setPhase("intro"); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function decide(approve) {
    setBusy(true); setError("");
    try {
      const pending = status.pending;
      const next = approve
        ? await api("/api/mobile/approve", { method: "POST", body: JSON.stringify({ pairingID: pending.pairingID, code: pending.code }) })
        : await api("/api/mobile/reject", { method: "POST" });
      if (!mounted.current) return;
      setStatus(next); setOffer(null);
      if (approve) {
        const device = (next.devices || []).find(item => !known.current?.has(item.id)) || { name: pending.deviceName };
        setPaired(device); setPhase("paired"); onPaired?.();
      } else setPhase("intro");
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  const pending = phase === "offer" ? status?.pending : null;
  const devices = status?.devices || [];
  const routes = (status?.routes || []).filter(route => route.connected).map(route => route.kind);
  return <section aria-labelledby="phone-heading" data-testid="onboarding-phone">
    <h1 id="phone-heading" tabIndex={-1} className={inDialog ? "text-xl font-semibold tracking-tight" : "text-3xl font-semibold tracking-tight"}>{phase === "paired" ? `${paired?.name || "Your iPhone"} is paired.` : "Take your squad with you."}</h1>
    <p className="mt-3 text-base text-muted-foreground">{phase === "paired"
      ? "Open Squad on your iPhone to chat with your members and hand them work. Disconnect it any time in Settings › Computers."
      : "Pair your iPhone to chat with your members and hand them work from anywhere. It connects directly on the same Wi-Fi, and through Squad relay by Autohand, encrypted, when you’re away."}</p>

    <div className={`${inDialog ? "mt-6" : "mt-8"} flex flex-col items-center gap-8 sm:flex-row sm:items-start`}>
      <div className="order-2 min-w-0 flex-1 sm:order-1">
        {phase === "paired" ? <p className="flex items-center gap-2 text-sm" role="status"><Check className="size-4" aria-hidden="true" />Connected{routes.length ? ` · ${routes.map(kind => kind === "relay" ? "from anywhere" : kind === "local" ? "same Wi-Fi" : "your tunnel").join(" and ")}` : ""}</p>
          : pending ? <div className="space-y-3" role="status" data-testid="onboarding-phone-approval">
            <p className="text-sm">{pending.deviceName} wants to connect.</p>
            <p className="font-mono text-3xl tracking-[0.3em]" aria-label={`Code ${String(pending.code).split("").join(" ")}`}>{pending.code}</p>
            <p className="text-sm text-muted-foreground">Approve only if this code matches the one on your phone.</p>
            <div className="flex gap-2 pt-1"><Button disabled={busy} onClick={() => decide(true)}>Approve connection</Button><Button variant="ghost" disabled={busy} onClick={() => decide(false)}>Decline</Button></div>
          </div>
          : phase === "offer" ? <ol className="space-y-2.5 text-sm">
            <li className="flex gap-3"><span className="w-4 shrink-0 tabular-nums text-muted-foreground">1</span>Open Squad on your iPhone.</li>
            <li className="flex gap-3"><span className="w-4 shrink-0 tabular-nums text-muted-foreground">2</span>Scan this code with the Squad app.</li>
            <li className="flex gap-3"><span className="w-4 shrink-0 tabular-nums text-muted-foreground">3</span>Check that the six digits match, then approve here.</li>
            <li className="flex items-center gap-2 pt-2 text-muted-foreground" role="status"><span className="presence-dots" aria-hidden="true"><span /><span /><span /></span>Waiting for your iPhone…</li>
          </ol>
          : phase === "preparing" ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Getting this computer ready for your phone…</p>
          : <ul className="space-y-2.5 text-sm">
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />Ask a member anything while you’re out.</li>
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />Approve, redirect or stop work while you’re away.</li>
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />Nothing connects until you approve a matching code here.</li>
            {phase === "expired" ? <li className="pt-1 text-muted-foreground" role="status">That code expired. Show a new one when your phone is ready.</li> : null}
          </ul>}
        {devices.length && phase !== "offer" && !pending ? <div className="mt-6" data-testid="phone-step-paired">
          <p className="text-xs font-medium text-muted-foreground">Paired with this computer</p>
          <PairedPhones devices={devices} busy={busy} onDisconnect={async device => {
            setBusy(true); setError("");
            try { await api(`/api/mobile/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" }); const next = await api("/api/mobile/status"); if (mounted.current) setStatus(next); }
            catch (failure) { if (mounted.current) setError(failure.message || "The phone could not be disconnected."); }
            finally { if (mounted.current) setBusy(false); }
          }} />
        </div> : null}
        {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="order-1 sm:order-2">
        {phase === "offer" && offer ? <div className="w-[208px] text-center"><div className="overflow-hidden rounded-lg bg-white"><PairingCode offer={offer} width={208} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Expires in ten minutes.</p>
          <Button variant="ghost" size="sm" className="mt-1" onClick={async () => { try { await navigator.clipboard.writeText(offer.link); } catch { setError("The link could not be copied. Try scanning the QR code."); } }}>Copy pairing link</Button>
        </div> : <PhoneHint member={member} />}
      </div>
    </div>

    <footer className={`${inDialog ? "mt-6 pt-4" : "mt-10 pt-6"} flex flex-wrap items-center gap-2 border-t border-border/70`}>
      {phase === "paired" ? <Button onClick={onFinish}>{inDialog ? "Done" : "Open your squad"}</Button>
        : phase === "offer" ? <><Button variant="outline" onClick={() => { setOffer(null); setPhase("intro"); }} disabled={busy}>Cancel</Button><Button variant="ghost" onClick={() => onSkip(devices.length ? undefined : "skipped")} disabled={busy}>{inDialog ? "Close" : "Not now"}</Button></>
        : <><Button onClick={showCode} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}{devices.length ? "Pair another iPhone" : "Pair an iPhone"}</Button><Button variant="ghost" onClick={() => onSkip(devices.length ? undefined : "skipped")} disabled={busy}>{devices.length ? "Done" : inDialog ? "Close" : "Not now"}</Button></>}
      {onBack && phase !== "paired" && phase !== "offer" ? <Button variant="ghost" onClick={onBack} disabled={busy}>Back</Button> : null}
      <p className="basis-full pt-1 text-xs text-muted-foreground">{phase === "paired" ? "Pair more phones or disconnect this one in Settings › Computers." : inDialog ? "Manage paired phones in Settings › Computers." : "You can pair a phone later in Settings › Computers."}</p>
    </footer>
  </section>;
}
