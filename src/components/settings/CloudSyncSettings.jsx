import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CloudSyncSettings({ api }) {
  const [status, setStatus] = useState(null);
  const [tenants, setTenants] = useState(null);
  const [tenantId, setTenantId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => api("/api/cloud").then(value => { if (active) setStatus(value); }).catch(error => { if (active) setError(error.message); });
    void load(); const timer = setInterval(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [api]);
  async function action(path, body = {}) {
    setBusy(true); setError("");
    try { const result = await api(`/api/cloud/${path}`, { method: "POST", body: JSON.stringify(body) }); return result; }
    catch (error) { setError(error.message || "Cloud sync could not finish."); return null; }
    finally { setBusy(false); }
  }
  function choose(result) {
    if (!result) return;
    setTenants(result.tenants);
    const team = result.tenants.find(tenant => ["owner", "admin", "editor"].includes(tenant.role));
    setTenantId(team?.id || ""); setWorkspaceId(team?.workspaces.find(workspace => !workspace.archivedAt)?.id || "");
    setCreating(!result.tenants.length);
  }
  const tenant = tenants?.find(tenant => tenant.id === tenantId);
  return <section className="flex max-w-xl flex-col gap-6" aria-label="Cloud memory sync" data-testid="cloud-sync-settings">
    <p className="text-sm text-muted-foreground">Share team memories across your devices through a private Squad workspace. Choose the team that will receive those memories.</p>
    {status?.enabled ? <>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 text-sm">
        <dt className="text-muted-foreground">Team</dt><dd>{status.tenantName}</dd>
        <dt className="text-muted-foreground">Workspace</dt><dd>{status.workspaceName}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">Shared team memories sync every 30 seconds.{status.lastSyncedAt ? ` Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={async () => { const result = await action("sync"); if (result) setStatus(result); }}>Sync now</Button>
        <Button variant="ghost" disabled={busy} onClick={async () => { const result = await action("disconnect"); if (result) { setStatus(result); setTenants(null); } }}>Disconnect</Button>
      </div>
      {status.conflicts?.length ? <div className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Choose which memory to keep</h3>
        {status.conflicts.map(conflict => <div key={conflict.id} className="flex flex-col gap-2 border-t pt-4 text-sm">
          <p><span className="text-muted-foreground">This computer: </span>{conflict.localText || "Deleted"}</p>
          <p><span className="text-muted-foreground">Cloud: </span>{conflict.remoteDeleted ? "Deleted" : conflict.remoteText}</p>
          <div className="flex gap-2">{[["local", "Keep local"], ["remote", "Use cloud"]].map(([resolution, label]) => <Button key={resolution} variant="outline" size="sm" disabled={busy} onClick={async () => { const result = await action("resolve", { id: conflict.id, resolution }); if (result) setStatus(result); }}>{label}</Button>)}</div>
        </div>)}
      </div> : null}
    </> : tenants === null ? <Button className="self-start" disabled={busy || !status} onClick={async () => choose(await action("session"))}>{busy ? "Connecting…" : "Choose cloud workspace"}</Button> : <>
      {tenants.length ? <>
        <div className="flex flex-col gap-2"><Label htmlFor="cloud-team">Team</Label><Select value={tenantId} onValueChange={id => { setTenantId(id); setWorkspaceId(tenants.find(team => team.id === id)?.workspaces.find(workspace => !workspace.archivedAt)?.id || ""); }}><SelectTrigger id="cloud-team"><SelectValue placeholder="Choose a team" /></SelectTrigger><SelectContent>{tenants.map(team => <SelectItem key={team.id} value={team.id} disabled={!["owner", "admin", "editor"].includes(team.role)}>{team.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex flex-col gap-2"><Label htmlFor="cloud-workspace">Workspace</Label><Select value={workspaceId} onValueChange={setWorkspaceId}><SelectTrigger id="cloud-workspace"><SelectValue placeholder="Choose a workspace" /></SelectTrigger><SelectContent>{tenant?.workspaces.filter(workspace => !workspace.archivedAt).map(workspace => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select></div>
        <p className="text-xs text-muted-foreground">Enable sync uploads your shared team memories to this workspace. Everyone with access to it can read them.</p>
        <div className="flex gap-2"><Button disabled={busy || !tenantId || !workspaceId} onClick={async () => { const result = await action("connect", { tenantId, workspaceId }); if (result) setStatus(result); }}>Enable sync</Button><Button variant="ghost" disabled={busy} onClick={() => setCreating(value => !value)}>Create a team</Button></div>
      </> : null}
      {creating ? <form className="flex flex-col gap-3 border-t pt-4" onSubmit={async event => { event.preventDefault(); const result = await action("tenants", { name }); if (result) { choose(result); setCreating(false); setName(""); } }}>
        <Label htmlFor="cloud-team-name">Team name</Label><Input id="cloud-team-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required placeholder="Your team" />
        <Button className="self-start" type="submit" disabled={busy || !name.trim()}>Create team</Button>
      </form> : null}
    </>}
    {error || status?.error ? <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]" data-selectable>{error || status.error}</p> : null}
    {busy ? <p role="status" className="text-sm text-muted-foreground">Working…</p> : null}
  </section>;
}
