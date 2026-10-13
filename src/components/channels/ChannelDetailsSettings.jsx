import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponderSettings } from "@/components/channels/ResponderSettings";
import { normalizeResponder } from "@/lib/channel-responders";

export function ChannelDetailsSettings({ channel, members = [], onSave, loadAutoAvailability }) {
  const [draft, setDraft] = useState(channel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => { setDraft(channel); setError(''); }, [channel.id]);
  const responderChanged = JSON.stringify(normalizeResponder(draft.responder)) !== JSON.stringify(normalizeResponder(channel.responder));
  const changed = responderChanged || ['name', 'section', 'visibility'].some(key => String(draft[key] || '') !== String(channel[key] || ''));
  const responder = normalizeResponder(draft.responder);
  const leadRequired = responder.mode === 'lead' && !responder.leadMemberId;
  async function save(event) {
    event.preventDefault();
    if (submitting.current || !draft.name.trim() || leadRequired) return;
    submitting.current = true; setSaving(true); setError('');
    try {
      const saved = await onSave({ name: draft.name.trim(), section: String(draft.section || '').trim(), visibility: draft.visibility, responder });
      if (!saved) throw new Error('Could not save these details. Your changes are kept; try again.');
      setDraft(saved);
    } catch (failure) { setError(failure.message); }
    finally { submitting.current = false; setSaving(false); }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Label htmlFor="channel-details-name">Channel name</Label>
      <Input id="channel-details-name" value={draft.name} disabled={saving} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
      <Label htmlFor="channel-details-section">Sidebar section</Label>
      <Input id="channel-details-section" value={draft.section || ''} placeholder="Channels" disabled={saving} onChange={event => setDraft(current => ({ ...current, section: event.target.value }))} />
      <Label htmlFor="channel-details-visibility">Visibility</Label>
      <Select value={draft.visibility} disabled={saving} onValueChange={visibility => setDraft(current => ({ ...current, visibility }))}>
        <SelectTrigger id="channel-details-visibility"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="private">Private</SelectItem></SelectContent>
      </Select>
      <ResponderSettings channel={channel} draft={draft.responder} members={members} disabled={saving} loadAutoAvailability={loadAutoAvailability} onChange={next => setDraft(current => ({ ...current, responder: next }))} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" variant="outline" disabled={saving || !changed || !draft.name.trim() || leadRequired}>{saving ? 'Saving…' : 'Save channel'}</Button>
    </form>
  );
}
