import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { PairedPhones } from "./PairedPhones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function PairingCode({ offer, width = 300 }) {
  const canvas = useRef(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    QRCode.toCanvas(canvas.current, offer.link, { errorCorrectionLevel: 'M', margin: 4, width }, failure => {
      if (active && failure) setError('The QR code could not be drawn. Copy the pairing link instead.');
    });
    return () => { active = false; };
  }, [offer.link, width]);
  return <>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<canvas ref={canvas} role="img" aria-label={`Private pairing code for ${offer.computerName}`} className="max-w-full" /></>;
}

function Row({ label, id, children }) {
  return <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-center"><label htmlFor={id} className="text-sm">{label}</label>{children}</div>;
}

// Each route is an independent switch (ADR-0228). A phone tries the most
// direct route it was told about and falls back to the relay by itself.
const ROUTES = [
  { key: 'local', label: 'Same Wi-Fi', detail: 'Phones on this network connect directly to this computer.' },
  { key: 'relay', label: 'From anywhere', detail: 'Through Autohand’s encrypted relay, without opening a network port. Messages stay encrypted between this computer and your approved phone.' },
  { key: 'tunnel', label: 'My secure tunnel', detail: 'Your own HTTPS tunnel forwards only the encrypted phone connection to this computer.' },
  // Shown only when this build carries the iCloud helper (ADR-0255). Last
  // resort after the others; slower, no Autohand server in the path.
  { key: 'icloud', label: 'Through iCloud', detail: 'When Wi-Fi and the relay can’t reach this computer, your phone can go through your own iCloud. Slower. Needs the same Apple Account on both, and the phone must be paired first.', optional: true },
];
const ICLOUD_STATES = { starting: 'Connecting…', ready: 'Ready', noAccount: 'Sign in to iCloud on this Mac', quotaExceeded: 'iCloud storage is full', offline: 'iCloud unreachable', rateLimited: 'iCloud is slowing requests', unentitled: 'Not available in this build', error: 'Unavailable' };
function routeState(route) {
  if (!route) return '';
  if (route.kind === 'relay') return route.connected ? 'Connected' : 'Connecting…';
  if (route.kind === 'icloud') return 'Ready';
  return route.endpoint;
}

export function ComputersSettings({ api }) {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [readError, setReadError] = useState(''), [busy, setBusy] = useState(false);
  const [routes, setRoutes] = useState({ local: true, relay: true, tunnel: false, icloud: false }), [endpoint, setEndpoint] = useState(''), [port, setPort] = useState('29323');
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
        if (!initialized.current) { initialized.current = true; setRoutes({ local: next.config.local, relay: next.config.relay, tunnel: next.config.tunnel, icloud: Boolean(next.config.icloud) }); setEndpoint(next.config.endpoint); setPort(String(next.config.port)); }
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
  const shown = ROUTES.filter(route => !route.optional || status.icloud?.available);
  const dirty = shown.some(route => Boolean(routes[route.key]) !== Boolean(status.config[route.key])) || endpoint !== status.config.endpoint || Number(port) !== status.config.port;
  const live = kind => (status.routes || []).find(route => route.kind === kind);
  const configure = patch => change('/api/mobile/config', 'PUT', { ...status.config, ...patch });
  return <div data-testid="computers-settings" className="divide-y divide-border/60">
    <div className="flex items-start justify-between gap-6 py-5">
      <div><label htmlFor="phone-connections" className="text-sm font-medium">Connect phones</label><p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">Chat with your agents from iPhone or iPad. Each phone needs approval here.</p></div>
      <Switch id="phone-connections" checked={status.config.enabled} disabled={busy || (!status.config.enabled && dirty)} onCheckedChange={enabled => configure({ enabled })} />
    </div>
    <form className="space-y-4 py-5" onSubmit={event => { event.preventDefault(); configure({ ...routes, endpoint, port: Number(port) }); }}>
      <div><h3 className="text-sm font-medium">How phones reach this computer</h3><p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">Turn on more than one. Your phone uses Same Wi-Fi at home and the relay everywhere else, without pairing again.</p></div>
      <ul className="divide-y divide-border/60">{shown.map(route => <li key={route.key} className="flex items-start justify-between gap-6 py-3">
        <div className="min-w-0"><label htmlFor={`phone-route-${route.key}`} className="text-sm">{route.label}</label><p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">{route.detail}</p>{status.config.enabled && status.config[route.key] && live(route.key) ? <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{routeState(live(route.key))}</p> : route.key === 'icloud' && status.config.enabled && status.config.icloud && status.icloud ? <p className="mt-1 text-xs text-muted-foreground">{ICLOUD_STATES[status.icloud.state] || status.icloud.detail}</p> : null}</div>
        <Switch id={`phone-route-${route.key}`} checked={routes[route.key]} disabled={busy} onCheckedChange={value => setRoutes(current => ({ ...current, [route.key]: value }))} />
      </li>)}</ul>
      {routes.tunnel ? <Row label="Tunnel address" id="phone-endpoint"><Input id="phone-endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://your-computer.example.com" disabled={busy} /></Row> : null}
      {routes.local || routes.tunnel ? <Row label="Connection port" id="phone-port"><Input id="phone-port" type="number" min="1024" max="65535" required value={port} onChange={event => setPort(event.target.value)} disabled={busy} /></Row> : null}
      <p className="text-xs leading-5 text-muted-foreground">Your computer needs to be awake with Squad running.</p>
      <Button type="submit" variant="outline" disabled={busy || !dirty || !ROUTES.some(route => !route.optional && routes[route.key])}>Save connection</Button>
    </form>
    <div className="space-y-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{status.computerName}</h3><p className="mt-1 text-xs text-muted-foreground">{status.listening ? (status.routes || []).filter(route => route.connected).map(route => ROUTES.find(row => row.key === route.kind)?.label).filter(Boolean).join(' and ') + ' ready.' : status.config.enabled ? 'Waiting for the phone connection.' : 'Phone connections are off.'}</p></div><Button variant="outline" disabled={busy || !status.listening || !status.endpoint} onClick={() => change('/api/mobile/pair', 'POST')}>Connect a phone</Button></div>
      {offer ? <div className="space-y-3"><PairingCode offer={offer} /><p className="text-xs text-muted-foreground">Scan with Squad for iOS. This private code expires in ten minutes.</p><Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(offer.link); } catch { setError('The link could not be copied. Try scanning the QR code.'); } }}>Copy pairing link</Button></div> : null}
      {status.pending ? <div className="space-y-3" role="status"><p className="text-sm">{status.pending.deviceName} wants to connect.</p><p className="font-mono text-2xl tracking-[0.3em]">{status.pending.code}</p><p className="text-xs text-muted-foreground">Approve only if this code matches the one on your phone.</p><div className="flex gap-2"><Button disabled={busy} onClick={() => change('/api/mobile/approve', 'POST', { pairingID: status.pending.pairingID, code: status.pending.code })}>Approve connection</Button><Button variant="ghost" disabled={busy} onClick={() => change('/api/mobile/reject', 'POST')}>Decline</Button></div></div> : null}
    </div>
    <div className="py-5"><h3 className="text-sm font-medium">Paired phones</h3>{status.devices.length ? <div className="mt-2"><PairedPhones devices={status.devices} busy={busy} onDisconnect={device => change(`/api/mobile/devices/${device.id}`, 'DELETE')} /></div> : <p className="mt-2 text-xs text-muted-foreground">No phones connected yet.</p>}</div>
    {error || readError || status.error ? <p role="alert" className="py-3 text-sm text-destructive">{error || readError || status.error}</p> : null}
  </div>;
}
