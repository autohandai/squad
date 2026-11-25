import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { birdAvatarSrc } from "@/lib/bird-cast";

const show = value => Array.isArray(value) ? (value.length ? value.join(", ") : "None") : String(value || "") || "Empty";

// Member profiles in the Autohand account (ADR-0280): one switch, the
// choices a person owes when both sides changed the same field, and members
// kept in the account that are not on this computer.
export function ProfileCloudSettings({ api }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => api("/api/cloud/profiles").then(value => { if (active) setStatus(value); }).catch(error => { if (active) setError(error.message); });
    void load(); const timer = setInterval(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [api]);
  async function action(path, body = {}) {
    setBusy(true); setError("");
    try { setStatus(await api(`/api/cloud/profiles/${path}`, { method: "POST", body: JSON.stringify(body) })); }
    catch (error) { setError(error.message || "Profiles could not sync."); }
    finally { setBusy(false); }
  }
  const synced = status?.lastSyncedAt ? ` Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "";
  return <section className="flex max-w-xl flex-col gap-5" aria-label="Member profiles in your account" data-testid="profile-cloud-settings">
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="profile-cloud-switch">Keep member profiles in your Autohand account</Label>
        <p className="text-sm text-muted-foreground">
          {status && !status.available ? "Sign in to Autohand to use this."
            : status?.ownerKind === "team" ? "Name, role, description, instructions, personality, skills, bird and voice are kept with this team, where its members can read them. Folders, permissions and memories stay on this computer."
              : "Name, role, description, instructions, personality, skills, bird and voice follow you to your other computers and your phone. Folders, permissions and memories stay on this computer."}
          {status?.enabled ? synced : ""}
        </p>
      </div>
      <Switch id="profile-cloud-switch" data-testid="profile-cloud-switch" checked={Boolean(status?.enabled)} disabled={busy || !status?.available} onCheckedChange={enabled => action("enabled", { enabled })} />
    </div>
    {status?.enabled ? <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => action("sync")}>Sync profiles now</Button> : null}
    {status?.enabled && status.conflicts?.length ? <div className="flex flex-col gap-4" data-testid="profile-cloud-conflicts">
      <h3 className="text-sm font-medium">Changed in both places</h3>
      {status.conflicts.map(conflict => <div key={conflict.id} className="flex flex-col gap-2 border-t pt-4 text-sm">
        <p className="font-medium">{conflict.name}</p>
        {conflict.fields.map(field => <div key={field.field} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <span className="text-muted-foreground">{field.label}</span>
          <div className="flex flex-col gap-1 [overflow-wrap:anywhere]" data-selectable>
            <span><span className="text-muted-foreground">This computer: </span>{show(field.local)}</span>
            <span><span className="text-muted-foreground">Your account: </span>{show(field.cloud)}</span>
          </div>
        </div>)}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => action("resolve", { id: conflict.id, choice: "local" })}>Keep this computer's</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => action("resolve", { id: conflict.id, choice: "cloud" })}>Use your account's</Button>
        </div>
      </div>)}
    </div> : null}
    {status?.enabled && status.cloudOnly?.length ? <div className="flex flex-col gap-3" data-testid="profile-cloud-elsewhere">
      <h3 className="text-sm font-medium">In your account, not on this computer</h3>
      {status.cloudOnly.map(member => <div key={member.id} className="flex items-center gap-3 border-t pt-3 text-sm">
        {member.avatar ? <img src={birdAvatarSrc(member.avatar)} alt="" className="size-8 rounded-full" /> : <span className="size-8 rounded-full bg-muted" aria-hidden="true" />}
        <div className="flex min-w-0 flex-1 flex-col"><span className="truncate">{member.name}</span>{member.role ? <span className="truncate text-muted-foreground">{member.role}</span> : null}</div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => action("add", { id: member.id })}>Add to this computer</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => action("remove", { id: member.id })}>Remove from account</Button>
      </div>)}
    </div> : null}
    {status?.enabled && status.notes?.length ? <ul className="flex flex-col gap-1 text-sm text-muted-foreground">{status.notes.map(note => <li key={note.id} data-selectable>{note.message}</li>)}</ul> : null}
    {error || status?.error ? <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]" data-selectable>{error || status.error}</p> : null}
  </section>;
}
