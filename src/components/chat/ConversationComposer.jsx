import { useRef, useState } from "react";
import { Hash, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarketplaceSuggestions } from "@/components/marketplace/MarketplaceSuggestions";
import { PresenceDot } from "@/components/members/PresenceDot";

/**
 * New message (ADR-0265): a "To:" field, as in Slack. Type a name or #; the
 * list under it shows members with their face and presence, then channels.
 * Members become chips (more than one is a private group chat); a channel
 * opens that channel. Choosing recipients never provisions a member or
 * starts work.
 */
export function ConversationComposer({ agents = [], channels = [], presenceFor, onOpenChannel, renderAvatar, onStart, onCancel, api, avatarStyle, onOpenListing }) {
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
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const wantsChannel = search.startsWith("#");
  const term = search.replace(/^[@#]/, "");
  const memberMatches = wantsChannel ? [] : available.filter(agent => !selected.includes(agent.id) && `${agent.name} ${agent.role || ""}`.toLocaleLowerCase().includes(term));
  const channelMatches = onOpenChannel && !selected.length ? channels.filter(channel => channel?.id && channel?.name && !channel.archived && channel.name.toLocaleLowerCase().includes(term)).slice(0, 8) : [];
  const options = [...memberMatches.map(agent => ({ kind: "member", agent })), ...channelMatches.map(channel => ({ kind: "channel", channel }))];
  function choose(option) {
    if (!option) return;
    if (option.kind === "channel") { onOpenChannel?.(option.channel); return; }
    if (selected.length >= 20) return;
    setSelected(current => [...current, option.agent.id]);
    setQuery(""); setActive(0); inputRef.current?.focus();
  }
  function onKey(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, options.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && open && options[active]) { event.preventDefault(); choose(options[active]); }
    else if (event.key === "Backspace" && !query && selected.length) setSelected(current => current.slice(0, -1));
    else if (event.key === "Escape") setOpen(false);
  }
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
      <p className="mt-2 text-sm text-muted-foreground">Add one member, or several for a private group chat. Type # to open a channel.</p>
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
            {api && onOpenListing ? <MarketplaceSuggestions api={api} kind="agent" showClosed avatarStyle={avatarStyle} onOpen={onOpenListing} query={[newMember.role, newMember.description].filter(Boolean).join(" ")} /> : null}
          </>
        ) : (
          <>
            <div className="relative">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-2" onClick={() => inputRef.current?.focus()}>
                <span className="mr-1 text-sm text-muted-foreground">To:</span>
                {recipients.map(agent => (
                  <span key={agent.id} className="inline-flex items-center gap-1.5 rounded-md bg-muted/70 py-0.5 pl-1 pr-1.5 text-sm" data-testid="recipient-chip">
                    {renderAvatar?.(agent, "size-5 shrink-0 rounded")}
                    {agent.name}
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${agent.name}`} disabled={pending} onClick={() => setSelected(current => current.filter(id => id !== agent.id))}><X className="size-3.5" /></button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  aria-label="To"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls="recipient-options"
                  autoFocus
                  className="min-w-40 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={recipients.length ? "Add someone" : onOpenChannel ? "@member or #channel" : "@member"}
                  value={query}
                  disabled={pending}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 120)}
                  onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
                  onKeyDown={onKey}
                />
              </div>
              {open && options.length ? (
                <div id="recipient-options" role="listbox" aria-label="Recipients" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-border/80 bg-popover py-1 shadow-md">
                  {options.map((option, index) => option.kind === "member" ? (
                    <button key={option.agent.id} type="button" role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${index === active ? "bg-muted" : ""}`}>
                      {renderAvatar?.(option.agent, "size-6 shrink-0 rounded")}
                      <span className="truncate font-medium">{option.agent.name}</span>
                      {presenceFor ? <PresenceDot entry={presenceFor(option.agent)} ring={false} /> : null}
                      <span className="truncate text-muted-foreground">{option.agent.role}</span>
                    </button>
                  ) : (
                    <button key={option.channel.id} type="button" role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${index === active ? "bg-muted" : ""}`}>
                      <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate font-medium">{option.channel.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {open && !options.length ? (
                <p className="mt-2 text-sm text-muted-foreground">{search ? "Nobody matches that. Create a new member below." : available.length ? "Everyone is already added." : "Your squad has no members yet."}</p>
              ) : null}
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
