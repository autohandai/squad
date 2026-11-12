import { useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Choosing recipients never provisions a member or starts work. */
export function ConversationComposer({ agents = [], renderAvatar, onStart, onCancel }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [newMember, setNewMember] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(null);
  const submitting = useRef(false);
  const available = agents.filter(agent => agent?.id && agent?.name && !agent.archived);
  const recipients = available.filter(agent => selected.includes(agent.id));
  const search = query.trim().toLocaleLowerCase();
  const matches = available.filter(agent => `${agent.name} ${agent.role || ""}`.toLocaleLowerCase().includes(search));
  const canStart = newMember ? newMember.name.trim() && newMember.role.trim() : recipients.length > 0;

  async function start(event) {
    event.preventDefault();
    if (!canStart || submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    const draft = newMember ? { newMember: { name: newMember.name.trim(), role: newMember.role.trim(), description: newMember.description.trim() } }
      : { memberIds: recipients.map(agent => agent.id), name: groupName.trim() || recipients.map(agent => agent.name).join(", ").slice(0, 80) };
    const signature = JSON.stringify(draft);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    try { await onStart({ ...draft, requestId: attempt.current.requestId }); }
    catch (failure) { setError(failure.message || "Could not open this conversation. Your choices are kept; try again."); }
    finally { submitting.current = false; setPending(false); }
  }

  return (
    <section data-testid="conversation-composer" className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight">New message</h1>
      <p className="mt-2 text-sm text-muted-foreground">Choose who to talk to. Select more than one member for a private group chat.</p>
      <form onSubmit={start} className="mt-7 flex flex-col gap-4">
        {newMember ? (
          <>
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-medium">New member</h2>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setNewMember(null); setError(""); }}>Choose existing members</Button>
            </div>
            <div className="space-y-2"><Label htmlFor="message-new-name">Name</Label><Input id="message-new-name" autoFocus value={newMember.name} maxLength={60} disabled={pending} onChange={event => setNewMember({ ...newMember, name: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="message-new-role">Role</Label><Input id="message-new-role" value={newMember.role} maxLength={80} placeholder="e.g. Release reviewer" disabled={pending} onChange={event => setNewMember({ ...newMember, role: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="message-new-description">What should they help with?</Label><Textarea id="message-new-description" value={newMember.description} maxLength={600} disabled={pending} onChange={event => setNewMember({ ...newMember, description: event.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Squad chooses a connected harness and available fallbacks. You can review their profile and permissions before sending work.</p>
          </>
        ) : (
          <>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search recipients" placeholder="Search by name or role" className="pl-9" autoFocus value={query} disabled={pending} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} /></div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border/60 border-y border-border/60" aria-label="Recipients">
              {matches.map(agent => (
                <label key={agent.id} className="flex cursor-pointer items-center gap-3 py-3 pr-1">
                  {renderAvatar?.(agent, "size-9 shrink-0 rounded-md")}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{agent.name}</span><span className="block truncate text-xs text-muted-foreground">{agent.role}</span></span>
                  <Checkbox aria-label={`Select ${agent.name}`} checked={selected.includes(agent.id)} disabled={pending || (!selected.includes(agent.id) && selected.length >= 20)} onCheckedChange={checked => setSelected(current => checked ? [...current, agent.id] : current.filter(id => id !== agent.id))} />
                </label>
              ))}
              {!matches.length ? <p className="py-4 text-sm text-muted-foreground">{search ? "No members match that search." : "Your squad has no members yet."}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground" role="status">{recipients.length ? `${recipients.length} selected${recipients.length > 1 ? " · Private group chat" : ""}` : "No recipients selected"}</p>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setNewMember({ name: query.trim().slice(0, 60), role: "", description: "" }); setError(""); }}><UserPlus data-icon="inline-start" />New member</Button>
            </div>
            {recipients.length > 1 ? <div className="space-y-2"><Label htmlFor="message-group-name">Group name</Label><Input id="message-group-name" value={groupName} maxLength={80} placeholder={recipients.map(agent => agent.name).join(", ").slice(0, 80)} disabled={pending} onChange={event => setGroupName(event.target.value)} /></div> : null}
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex items-center gap-2 border-t border-border/60 pt-4"><Button type="submit" disabled={!canStart || pending}>{pending ? "Opening…" : newMember ? "Create member and open chat" : recipients.length > 1 ? "Create group chat" : "Open chat"}</Button><Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button></div>
      </form>
    </section>
  );
}
