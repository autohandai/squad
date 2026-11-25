import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Cloud, ExternalLink, Laptop, Plus, RefreshCw, Server, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cloudSetupSteps } from "@/lib/cloud-computers";

/**
 * Where members can run (ADR-0282): this computer, other computers' Squads
 * over SSH, cloud computers (set up by the person, then added over SSH),
 * other Squads members already use, and the other computers in the account.
 * Sections are headings over divider rows, like the rest of Settings.
 */
const STATE = { connected: "Connected", connecting: "Connecting…", reconnecting: "Reconnecting…", stopped: "Not connected" };

function Section({ title, action, children, description }) {
  return (
    <section className="py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="flex items-center gap-1">{action}</div>
      </div>
      {description ? <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">{description}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, title, detail, trailing, testId }) {
  return (
    <div data-testid={testId} className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      </div>
      {trailing}
    </div>
  );
}

const members = (count) => (count === 1 ? "1 member runs here" : `${count} members run here`);

function AddSshForm({ api, keys, onAdded, onCancel }) {
  const [form, setForm] = useState({ label: "", user: "", host: "", port: "22", identityFile: "", remotePort: "19821" });
  const [busy, setBusy] = useState(""), [result, setResult] = useState(null);
  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setResult(null); };
  const body = () => JSON.stringify({ ...form, port: Number(form.port), remotePort: Number(form.remotePort) });
  async function run(kind) {
    setBusy(kind); setResult(null);
    try {
      if (kind === "test") setResult({ ...(await api("/api/computers/ssh/test", { method: "POST", body: body() })) });
      else { const added = await api("/api/computers/ssh", { method: "POST", body: body() }); onAdded(added); }
    } catch (error) { setResult({ reachable: false, message: error.message }); }
    finally { setBusy(""); }
  }
  const ready = form.user.trim() && form.host.trim();
  return (
    <form data-testid="ssh-add-form" className="flex flex-col gap-3 py-3" onSubmit={(event) => { event.preventDefault(); if (ready) void run("add"); }}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_90px]">
        <div className="flex flex-col gap-1.5"><Label htmlFor="ssh-user" className="text-xs">User</Label><Input id="ssh-user" value={form.user} onChange={set("user")} placeholder="igor" autoComplete="off" spellCheck={false} className="h-9 bg-card" /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="ssh-host" className="text-xs">Host</Label><Input id="ssh-host" value={form.host} onChange={set("host")} placeholder="studio.local or 203.0.113.7" autoComplete="off" spellCheck={false} className="h-9 bg-card" /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="ssh-port" className="text-xs">Port</Label><Input id="ssh-port" type="number" min="1" max="65535" value={form.port} onChange={set("port")} className="h-9 bg-card" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
        <div className="flex flex-col gap-1.5"><Label htmlFor="ssh-name" className="text-xs">Name</Label><Input id="ssh-name" value={form.label} onChange={set("label")} placeholder="Studio Mac" className="h-9 bg-card" /></div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssh-key" className="text-xs">Key</Label>
          <select id="ssh-key" value={form.identityFile} onChange={set("identityFile")} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
            <option value="">The ssh agent</option>
            {keys.map((key) => <option key={key.path} value={key.path}>~/.ssh/{key.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="ssh-squad-port" className="text-xs">Squad’s port there</Label><Input id="ssh-squad-port" type="number" min="1" max="65535" value={form.remotePort} onChange={set("remotePort")} className="h-9 bg-card" /></div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Squad signs in with your key, never a password, and connects to Squad on that computer through SSH. Nothing is opened to the internet.</p>
      {result ? <p role="status" data-testid="ssh-result" className={result.reachable && result.squad !== false ? "text-xs text-foreground" : "text-xs text-destructive"}>{result.message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!ready || Boolean(busy)} onClick={() => run("test")}>{busy === "test" ? <Spinner /> : <RefreshCw data-icon="inline-start" />}Test</Button>
        <Button type="submit" size="sm" disabled={!ready || Boolean(busy)}>{busy === "add" ? <Spinner /> : null}Add computer</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function CloudDialog({ open, onOpenChange, providers, onUseSsh }) {
  const [chosen, setChosen] = useState(null);
  useEffect(() => { if (!open) setChosen(null); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="cloud-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cloud className="size-4" aria-hidden="true" />{chosen ? chosen.name : "New cloud computer"}</DialogTitle>
          <DialogDescription>{chosen ? "Runs in your own account there, billed by them. Squad doesn’t create it for you yet." : "Choose where it runs. It’s your own account with that provider."}</DialogDescription>
        </DialogHeader>
        {chosen ? (
          <div className="flex flex-col gap-3">
            <ol className="list-decimal space-y-2 pl-5 text-sm">{cloudSetupSteps(chosen).map((step) => <li key={step}>{step}</li>)}</ol>
            <div className="flex flex-wrap gap-2">
              {chosen.url ? <Button asChild variant="outline" size="sm"><a href={chosen.url} target="_blank" rel="noreferrer">Open {chosen.name}<ExternalLink data-icon="inline-end" /></a></Button> : null}
              <Button size="sm" onClick={() => { onOpenChange(false); onUseSsh(); }}>Add it over SSH</Button>
              <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>Back</Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/60" role="list">
            {providers.map((provider) => (
              <button key={provider.id} type="button" role="listitem" data-testid={`cloud-provider-${provider.id}`} onClick={() => setChosen(provider)}
                className="flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm">
                <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm">{provider.name}</span><span className="block text-xs text-muted-foreground">{provider.where}</span></span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RunPlacesSettings({ api, memberCount = 0, memberNames = {} }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [adding, setAdding] = useState(false);
  const [keys, setKeys] = useState([]), [account, setAccount] = useState(null), [cloudOpen, setCloudOpen] = useState(false), [busy, setBusy] = useState("");
  const refresh = useCallback(async () => {
    try { setData(await api("/api/computers")); setError(""); } catch (failure) { setError(failure.message); }
  }, [api]);
  const refreshAccount = useCallback(async () => {
    setBusy("account");
    try { setAccount(await api("/api/computers/account")); } catch (failure) { setAccount({ available: false, reason: failure.message, computers: [] }); }
    finally { setBusy(""); }
  }, [api]);
  useEffect(() => { void refresh(); void refreshAccount(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [refresh, refreshAccount]);
  useEffect(() => { if (adding) api("/api/computers/ssh/keys").then((value) => setKeys(value.keys || [])).catch(() => setKeys([])); }, [adding, api]);
  const names = (ids) => ids.map((id) => memberNames[id] || id).join(", ");
  async function remove(computer) {
    setBusy(computer.id);
    try {
      const removed = await api(`/api/computers/ssh/${computer.id}`, { method: "DELETE" });
      setError(removed.members?.length ? `${names(removed.members)} still point at ${computer.label}. Choose This machine in their Runs on.` : "");
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(""); }
  }
  if (!data) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status" className="text-sm text-muted-foreground">Loading computers…</p>;
  const away = new Set([...data.ssh.flatMap((row) => row.members), ...data.bridges.flatMap((row) => row.members)]);
  const others = (account?.computers || []).filter((row) => !row.thisComputer);
  return (
    <div data-testid="run-places" className="divide-y divide-border/60">
      <Section title="This computer">
        <Row icon={Laptop} testId="run-place-this" title={data.thisComputer.name} detail={`Online · ${members(Math.max(0, memberCount - away.size))}`} />
      </Section>
      <Section title="Over SSH" description="Another Mac or Linux computer running Squad. Members you point at it do their work there; the conversation stays here."
        action={<Button variant="ghost" size="icon-sm" aria-label="Add a computer over SSH" onClick={() => setAdding(true)} disabled={adding}><Plus /></Button>}>
        {data.ssh.map((computer) => (
          <Row key={computer.id} icon={Server} testId={`ssh-${computer.id}`} title={computer.label}
            detail={[`${computer.user}@${computer.host}${computer.port === 22 ? "" : `:${computer.port}`}`, STATE[computer.state] || computer.state, computer.members.length ? names(computer.members) : "No members yet: choose it in a member’s Runs on", computer.error && computer.state !== "connected" ? computer.error : ""].filter(Boolean).join(" · ")}
            trailing={<Button variant="ghost" size="icon-sm" aria-label={`Remove ${computer.label}`} disabled={busy === computer.id} onClick={() => remove(computer)}>{busy === computer.id ? <Spinner /> : <X />}</Button>} />
        ))}
        {adding ? <AddSshForm api={api} keys={keys} onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); void refresh(); }} /> : data.ssh.length ? null : <p className="text-xs text-muted-foreground">No computers over SSH yet.</p>}
      </Section>
      <Section title={<span className="flex items-center gap-2">Cloud computers<Badge variant="secondary">Beta</Badge></span>}
        description="Runs in your own account with a cloud provider, which bills you while it’s on. Set it up there, then add it over SSH."
        action={<Button variant="ghost" size="icon-sm" aria-label="New cloud computer" onClick={() => setCloudOpen(true)}><Plus /></Button>}>
        <p className="text-xs text-muted-foreground">Squad doesn’t create cloud computers yet. Choose a provider for the steps.</p>
      </Section>
      {data.bridges.length ? (
        <Section title="Other Squads" description="Squads members reach by address and token, set in each member’s Runs on.">
          {data.bridges.map((bridge) => <Row key={bridge.url} icon={Server} title={bridge.label} detail={`${new URL(bridge.url).host} · ${names(bridge.members)}`} />)}
        </Section>
      ) : null}
      <Section title="Other computers in your account"
        action={<Button variant="ghost" size="icon-sm" aria-label="Refresh other computers" onClick={refreshAccount} disabled={busy === "account"}>{busy === "account" ? <Spinner /> : <RefreshCw />}</Button>}>
        {account?.available === false ? <p className="text-xs text-muted-foreground">{account.reason}</p>
          : others.length ? others.map((row) => <Row key={row.computerID} icon={Laptop} title={row.name || "A computer without a name yet"} detail={`${row.team ? "Team Squad · " : ""}Last connected ${new Date(row.lastSeenAt).toLocaleString()}`} />)
          : <p className="text-xs text-muted-foreground">No other computers in your account yet.</p>}
      </Section>
      {error ? <p role="alert" className="py-3 text-sm text-destructive">{error}</p> : null}
      <CloudDialog open={cloudOpen} onOpenChange={setCloudOpen} providers={data.providers} onUseSsh={() => setAdding(true)} />
    </div>
  );
}
