import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function PairingCode({ offer }) {
  const canvas = useRef(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    QRCode.toCanvas(canvas.current, offer.link, { errorCorrectionLevel: 'M', margin: 4, width: 300 }, failure => {
      if (active && failure) setError('The QR code could not be drawn. Copy the pairing link instead.');
    });
    return () => { active = false; };
  }, [offer.link]);
  return <>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<canvas ref={canvas} role="img" aria-label={`Private pairing code for ${offer.computerName}`} className="max-w-full" /></>;
}

function Row({ label, id, children }) {
  return <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-center"><label htmlFor={id} className="text-sm">{label}</label>{children}</div>;
}

export function ComputersSettings({ api }) {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [readError, setReadError] = useState(''), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('local'), [endpoint, setEndpoint] = useState(''), [port, setPort] = useState('29323');
  const [offer, setOffer] = useState(null);
  const sequence = useRef(0), editing = useRef(false), mounted = useRef(false), initialized = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let fetching = false;
    async function refresh() {
      if (editing.current || fetching) return;
      fetching = true;
      const request = sequence.current;
      try {
        const next = await api('/api/mobile/status', { signal: controller.signal });
        if (!mounted.current || request !== sequence.current) return;
        setStatus(next); setReadError('');
        if (!initialized.current) { initialized.current = true; setMode(next.config.mode); setEndpoint(next.config.endpoint); setPort(String(next.config.port)); }
        if (offer && offer.expiresAt <= Date.now() / 1000) setOffer(null);
      } catch (failure) { if (!controller.signal.aborted && mounted.current && request === sequence.current) setReadError(failure.message); }
      finally { fetching = false; }
    }
    void refresh(); const timer = setInterval(refresh, 2000);
    return () => { mounted.current = false; sequence.current++; controller.abort(); clearInterval(timer); };
  }, [api, offer]);
  async function change(path, method, body) {
    if (editing.current) return;
    sequence.current++; editing.current = true; setBusy(true); setError('');
    try {
      const result = await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!mounted.current) return;
      if (path === '/api/mobile/pair') setOffer(result);
      else { setStatus(result); if (['/api/mobile/config', '/api/mobile/approve', '/api/mobile/reject'].includes(path)) setOffer(null); }
      return result;
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { sequence.current++; editing.current = false; if (mounted.current) setBusy(false); }
  }
  if (!status) return <><p role="status" className="text-sm text-muted-foreground">Loading computers…</p>{readError ? <p role="alert" className="mt-3 text-sm text-destructive">{readError}</p> : null}</>;
  const dirty = mode !== status.config.mode || endpoint !== status.config.endpoint || Number(port) !== status.config.port;
  const configure = patch => change('/api/mobile/config', 'PUT', { ...status.config, ...patch });
  return <div data-testid="computers-settings" className="divide-y divide-border/60">
    <div className="flex items-start justify-between gap-6 py-5">
      <div><label htmlFor="phone-connections" className="text-sm font-medium">Connect phones</label><p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">Chat with your agents from iPhone or iPad. Each phone needs approval here.</p></div>
      <Switch id="phone-connections" checked={status.config.enabled} disabled={busy || (!status.config.enabled && dirty)} onCheckedChange={enabled => configure({ enabled })} />
    </div>
    <form className="space-y-4 py-5" onSubmit={event => { event.preventDefault(); configure({ mode, endpoint, port: Number(port) }); }}>
      <Row label="Connection" id="phone-connection-mode"><Select value={mode} onValueChange={setMode} disabled={busy}><SelectTrigger id="phone-connection-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">On this network</SelectItem><SelectItem value="tunnel">Secure tunnel</SelectItem></SelectContent></Select></Row>
      {mode === 'tunnel' ? <Row label="Tunnel address" id="phone-endpoint"><Input id="phone-endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://your-computer.example.com" disabled={busy} /></Row> : null}
      <Row label="Connection port" id="phone-port"><Input id="phone-port" type="number" min="1024" max="65535" required value={port} onChange={event => setPort(event.target.value)} disabled={busy} /></Row>
      <p className="text-xs leading-5 text-muted-foreground">Your computer needs to be awake with Squad running. A tunnel forwards only the encrypted phone connection to this port.</p>
      <Button type="submit" variant="outline" disabled={busy || !dirty}>Save connection</Button>
    </form>
    <div className="space-y-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{status.computerName}</h3><p className="mt-1 text-xs text-muted-foreground">{status.listening ? status.endpoint || 'No local network address is available.' : 'Phone connections are off.'}</p></div><Button variant="outline" disabled={busy || !status.listening || !status.endpoint} onClick={() => change('/api/mobile/pair', 'POST')}>Connect a phone</Button></div>
      {offer ? <div className="space-y-3"><PairingCode offer={offer} /><p className="text-xs text-muted-foreground">Scan with Squad for iOS. This private code expires in ten minutes.</p><Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(offer.link); } catch { setError('The link could not be copied. Try scanning the QR code.'); } }}>Copy pairing link</Button></div> : null}
      {status.pending ? <div className="space-y-3" role="status"><p className="text-sm">{status.pending.deviceName} wants to connect.</p><p className="font-mono text-2xl tracking-[0.3em]">{status.pending.code}</p><p className="text-xs text-muted-foreground">Approve only if this code matches the one on your phone.</p><div className="flex gap-2"><Button disabled={busy} onClick={() => change('/api/mobile/approve', 'POST', { pairingID: status.pending.pairingID, code: status.pending.code })}>Approve connection</Button><Button variant="ghost" disabled={busy} onClick={() => change('/api/mobile/reject', 'POST')}>Decline</Button></div></div> : null}
    </div>
    <div className="py-5"><h3 className="text-sm font-medium">Paired phones</h3>{status.devices.length ? <ul className="mt-3 divide-y divide-border/60">{status.devices.map(device => <li key={device.id} className="flex items-center justify-between gap-3 py-3"><span className="text-sm">{device.name}</span><Button variant="ghost" disabled={busy} onClick={() => change(`/api/mobile/devices/${device.id}`, 'DELETE')}>Disconnect</Button></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No phones connected yet.</p>}</div>
    {error || readError || status.error ? <p role="alert" className="py-3 text-sm text-destructive">{error || readError || status.error}</p> : null}
  </div>;
}
