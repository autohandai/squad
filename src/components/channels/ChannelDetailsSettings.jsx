import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ResponderSettings } from "@/components/channels/ResponderSettings";
import { normalizeResponder } from "@/lib/channel-responders";
import { channelSlug } from "@/lib/channel-name";
import { normalizeChannelReplyMode } from "@/lib/channel-replies";

export function ChannelDetailsSettings({ channel, members = [], onSave, loadAutoAvailability }) {
  const [draft, setDraft] = useState(channel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => { setDraft(channel); setError(''); }, [channel.id]);
  const responderChanged = JSON.stringify(normalizeResponder(draft.responder)) !== JSON.stringify(normalizeResponder(channel.responder));
  const changed = responderChanged || normalizeChannelReplyMode(draft.replyMode) !== normalizeChannelReplyMode(channel.replyMode) || ['name', 'section', 'visibility'].some(key => String(draft[key] || '') !== String(channel[key] || ''));
  const responder = normalizeResponder(draft.responder);
  const leadRequired = responder.mode === 'lead' && !responder.leadMemberId;
  async function save(event) {
    event.preventDefault();
    if (submitting.current || !draft.name.trim() || leadRequired) return;
    submitting.current = true; setSaving(true); setError('');
    try {
      const saved = await onSave({ name: draft.name.trim().replace(/^-+|-+$/g, ''), section: String(draft.section || '').trim(), visibility: draft.visibility, responder, replyMode: normalizeChannelReplyMode(draft.replyMode) });
      if (!saved) throw new Error('Could not save these details. Your changes are kept; try again.');
      setDraft(saved);
    } catch (failure) { setError(failure.message); }
    finally { submitting.current = false; setSaving(false); }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <Label htmlFor="channel-details-name">Channel name</Label>
      <Input id="channel-details-name" value={draft.name} disabled={saving} onChange={event => setDraft(current => ({ ...current, name: channelSlug(event.target.value) }))} />
      <Label htmlFor="channel-details-section">Sidebar section</Label>
      <Input id="channel-details-section" value={draft.section || ''} placeholder="Channels" disabled={saving} onChange={event => setDraft(current => ({ ...current, section: event.target.value }))} />
      <Label htmlFor="channel-details-visibility">Visibility</Label>
      <Select value={draft.visibility} disabled={saving} onValueChange={visibility => setDraft(current => ({ ...current, visibility }))}>
        <SelectTrigger id="channel-details-visibility"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="public">Public</SelectItem><SelectItem value="private">Private</SelectItem></SelectGroup></SelectContent>
      </Select>
      <Field className="my-2">
        <FieldLabel htmlFor="channel-details-replies">Show replies</FieldLabel>
        <Select value={normalizeChannelReplyMode(draft.replyMode)} disabled={saving} onValueChange={replyMode => setDraft(current => ({ ...current, replyMode }))}>
          <SelectTrigger id="channel-details-replies"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="thread">In threads</SelectItem><SelectItem value="channel">In the channel</SelectItem></SelectGroup></SelectContent>
        </Select>
        <FieldDescription>Threads group replies beneath the original message. In the channel shows every reply in time order.</FieldDescription>
      </Field>
      <ResponderSettings channel={channel} draft={draft.responder} members={members} disabled={saving} loadAutoAvailability={loadAutoAvailability} onChange={next => setDraft(current => ({ ...current, responder: next }))} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" size="sm" variant="outline" disabled={saving || !changed || !draft.name.trim() || leadRequired}>{saving ? 'Saving…' : 'Save channel'}</Button>
    </form>
  );
}
