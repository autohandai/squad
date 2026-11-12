import { useState } from "react";
import { BellOff, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { channelNotificationPreference } from "@/lib/channel-notifications";
import { isGroupChat } from "@/lib/group-chats";

const primitives = {
  dropdown: { Group: DropdownMenuGroup, Item: DropdownMenuItem, Label: DropdownMenuLabel, RadioGroup: DropdownMenuRadioGroup, RadioItem: DropdownMenuRadioItem, Separator: DropdownMenuSeparator },
  context: { Group: ContextMenuGroup, Item: ContextMenuItem, Label: ContextMenuLabel, RadioGroup: ContextMenuRadioGroup, RadioItem: ContextMenuRadioItem, Separator: ContextMenuSeparator },
};
const choices = [['default', 'Use Settings default'], ['all', 'All new posts'], ['mentions', 'Just mentions'], ['muted', 'Mute and hide']];

function ActionItems({ kind, noun, preference, busy, armed, onArm, onRename, onDelete, onPreference }) {
  const { Group, Item, Label, RadioGroup, RadioItem, Separator } = primitives[kind];
  return <>
    <Group>
      <Item disabled={busy} onSelect={onRename}><Pencil />Rename {noun}</Item>
      <Item disabled={busy} variant="destructive" onMouseLeave={() => onArm(false)} onBlur={() => onArm(false)} onSelect={event => {
        if (!armed) { event.preventDefault(); onArm(true); }
        else void onDelete();
      }}><Trash2 />Delete {noun}{armed ? '?' : ''}</Item>
    </Group>
    <Separator />
    <Label>Notify you about…</Label>
    <RadioGroup value={preference.inherited ? 'default' : preference.mode}>
      {choices.map(([value, label]) => <RadioItem key={value} value={value} disabled={busy} onSelect={() => void onPreference({ mode: value, hidden: value === 'muted' })}>{label}</RadioItem>)}
    </RadioGroup>
    {preference.hidden ? <Group><Item disabled={busy} onSelect={() => void onPreference({ hidden: false })}><BellOff />Show in sidebar</Item></Group> : null}
  </>;
}

/** One action definition serves keyboard/overflow and right-click menus. */
export function ChannelActions({ channel, settings, onRename, onDelete, onPreference, renderRow }) {
  const noun = isGroupChat(channel) ? 'group chat' : 'channel';
  const preference = channelNotificationPreference(settings, channel.id);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');
  const [renameError, setRenameError] = useState('');
  function menuChanged() { setArmed(false); }
  async function changePreference(patch) {
    if (busy) return;
    setBusy(true); setError('');
    try { await onPreference(channel.id, patch); }
    catch (failure) { setError(failure.message || 'Could not save channel preferences. Try again.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try { if (!await onDelete(channel.id)) throw new Error('Could not delete this channel. Reopen the menu to try again.'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function beginRename() { setName(channel.name); setRenameError(''); setRenameOpen(true); }
  async function rename(event) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setRenameError('');
    try {
      if (!await onRename(channel.id, { name: name.trim() })) throw new Error('Could not save this name. Your edit is kept; try again.');
      setRenameOpen(false);
    } catch (failure) { setRenameError(failure.message); }
    finally { setBusy(false); }
  }
  const actions = { noun, preference, busy, armed, onArm: setArmed, onRename: beginRename, onDelete: remove, onPreference: changePreference };
  const menu = <DropdownMenu onOpenChange={menuChanged}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" disabled={busy} aria-label={`Channel actions: ${channel.name}`}><Ellipsis /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-56"><ActionItems kind="dropdown" {...actions} /></DropdownMenuContent>
  </DropdownMenu>;
  return <>
    <ContextMenu onOpenChange={menuChanged}>
      <ContextMenuTrigger asChild disabled={busy}><div data-channel-row={channel.id}>{renderRow(menu, preference.mode === 'muted' ? <BellOff className="size-3 text-muted-foreground" aria-label="Muted" /> : null)}</div></ContextMenuTrigger>
      <ContextMenuContent className="w-56"><ActionItems kind="context" {...actions} /></ContextMenuContent>
    </ContextMenu>
    {error ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p> : null}
    <Dialog open={renameOpen} onOpenChange={next => { if (!busy) setRenameOpen(next); }}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={rename} className="flex flex-col gap-5">
          <DialogHeader><DialogTitle>Rename {noun}</DialogTitle><DialogDescription>Change the name of {isGroupChat(channel) ? channel.name : `#${channel.name}`}. Members and messages stay here.</DialogDescription></DialogHeader>
          <FieldGroup><Field data-invalid={Boolean(renameError)} data-disabled={busy}><FieldLabel htmlFor="rename-channel-name">Channel name</FieldLabel><Input id="rename-channel-name" value={name} maxLength={80} autoFocus disabled={busy} aria-invalid={Boolean(renameError)} onChange={event => setName(event.target.value)} /></Field></FieldGroup>
          {renameError ? <p role="alert" className="text-sm text-destructive">{renameError}</p> : null}
          <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => setRenameOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save name'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
