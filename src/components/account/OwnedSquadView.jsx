import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ownershipFetch, ownershipUrl } from "@/lib/ownership-client";
import { CloudBackupSettings } from "@/components/settings/CloudBackupSettings";

async function request(path, init) {
  const response = await ownershipFetch(path, init), value = await response.json();
  if (!response.ok || value.success !== true) throw Error(typeof value.error === 'string' ? value.error : value.error?.message || 'Squad could not read this data.');
  return value.data;
}
export function SquadOwnerPicker({ context }) {
  const [owners, setOwners] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const send=(path,init={})=>request(path,{...init,headers:{...init.headers,'x-squad-context':context.generation}});
  useEffect(() => {
    let active = true;
    send('/api/ownership/owners').then(value => { if (active) { setOwners(value.owners); setError(value.error || ''); } }, failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [context.generation]);
  useEffect(() => {
    const show = event => setError(event.detail || 'Current conversations could not be saved for backups.');
    window.addEventListener('squad:backup-sync-error', show);
    return () => window.removeEventListener('squad:backup-sync-error', show);
  }, []);
  const selected = `${context.owner.kind}:${context.owner.id}`;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2 text-sm">
    <span className="text-muted-foreground">Squad</span>
    <Select value={selected} disabled={busy || !owners.length} onValueChange={async key => {
      const next = owners.find(item => `${item.owner.kind}:${item.owner.id}` === key);
      if (!next || key === selected) return;
      setBusy(true); setError('');
      try { await send('/api/ownership/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: next.owner, expectedGeneration: context.generation }) });window.location.replace('/squad'); }
      catch (failure) { setError(failure.message); setBusy(false); }
    }}>
      <SelectTrigger aria-label="Choose personal or team Squad" className="h-8 w-auto min-w-44 max-w-full border-0 bg-transparent shadow-none sm:max-w-xs"><SelectValue placeholder={context.ownerLabel} /></SelectTrigger>
      <SelectContent>{owners.map(item => <SelectItem key={`${item.owner.kind}:${item.owner.id}`} value={`${item.owner.kind}:${item.owner.id}`}>{item.label}{item.canWrite ? '' : ' · Read only'}</SelectItem>)}</SelectContent>
    </Select>
    <span className="text-xs text-muted-foreground">{context.owner.kind === 'team' ? 'Team-owned members and data' : 'Your personal members and data'}{context.state!=='ready'?' · Work paused':context.canWrite ? '' : ' · Read only'}</span>
    {error ? <span className="text-xs text-destructive" role="status">{error}</span> : null}
  </div>;
}

export function OwnedSquadView({ context }) {
  const [members, setMembers] = useState([]), [member, setMember] = useState(null), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request('/api/owned/members').then(value => { if (active) setMembers(value.members); }, failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  async function backup(format) {
    setBusy(true); setError(''); setReceipt(null);
    try { setReceipt(await request('/api/backups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, ...(member ? { memberIds: [member.id] } : {}) }) })); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-8 px-6 py-10 text-foreground">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">{context.ownerLabel}</h1><p className="text-sm text-muted-foreground">This team is read-only. Your saved members, memories, conversations and managed files remain available. Automated work stays paused.</p></header>
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy} onClick={() => backup('json')}>Export {member ? member.profile.name || 'member' : 'Squad'} as JSON</Button><Button variant="ghost" disabled={busy} onClick={() => backup('yaml')}>YAML</Button><Button variant="ghost" onClick={() => request('/api/account/logout', { method: 'POST' }).catch(failure => setError(failure.message))}>Sign out</Button></div>
    {busy ? <p className="text-sm text-muted-foreground" role="status">Checking and saving managed files…</p> : null}
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    {receipt ? <div className="space-y-2 text-sm"><a className="underline underline-offset-4" href={ownershipUrl(receipt.downloadUrl)}>Download verified {receipt.format.toUpperCase()} backup</a><p className="text-muted-foreground">{receipt.memberCount} members · {receipt.bytes.toLocaleString()} bytes. Credentials and external folders are excluded.</p>{receipt.omissions.length ? <details><summary>{receipt.omissions.length} exclusions</summary><ul className="mt-2 space-y-1">{receipt.omissions.map((item, index) => <li key={index}><span className="font-medium">{item.path}</span> — {item.reason}</li>)}</ul></details> : null}</div> : null}
    <div className="grid gap-10 md:grid-cols-[220px_1fr]"><nav aria-label="Saved members" className="space-y-1"><Button className="w-full justify-start" variant="ghost" onClick={() => setMember(null)}>All members</Button>{members.map(person => <Button key={person.id} className="h-auto w-full justify-start py-3 text-left" variant="ghost" onClick={async () => { setError(''); try { setMember(await request(`/api/owned/members/${encodeURIComponent(person.id)}`)); } catch (failure) { setError(failure.message); } }}><span>{person.name}<span className="block text-xs font-normal text-muted-foreground">{person.role}</span></span></Button>)}</nav>
      <section className="min-w-0 space-y-8">{member ? <><div><h2 className="text-xl font-semibold">{member.profile.name || member.id}</h2><p className="text-sm text-muted-foreground">{member.profile.role}</p></div><section className="space-y-3"><h3 className="font-medium">Memories</h3>{member.memories.map((item, index) => <p key={item.id || index} className="whitespace-pre-wrap text-sm">{item.text || item.body || item.title}</p>)}{!member.memories.length ? <p className="text-sm text-muted-foreground">No saved memory entries. Memory documents appear in Files.</p> : null}</section><section className="space-y-3"><h3 className="font-medium">Conversations</h3>{member.conversations.map((chat, index) => <details key={chat.id || index} className="border-t py-3"><summary className="text-sm">{chat.title || (chat.current ? 'Current conversation' : 'Saved conversation')}</summary><div className="mt-3 space-y-4">{(chat.messages || []).map((message, index) => <p key={message.id || index} className="whitespace-pre-wrap break-words text-sm"><strong>{message.role === 'user' ? 'You' : member.profile.name}: </strong>{message.body || message.text || ''}</p>)}</div></details>)}</section><section><h3 className="mb-3 font-medium">Files</h3>{member.files.map(file => <a key={file.id} className="flex justify-between gap-3 border-t py-3 text-sm underline-offset-4 hover:underline" href={ownershipUrl(`/api/owned/members/${encodeURIComponent(member.id)}/files/${encodeURIComponent(file.id)}`)}><span className="break-all">{file.path}</span><span className="shrink-0 text-muted-foreground">{file.bytes.toLocaleString()} bytes</span></a>)}</section></> : <p className="text-sm text-muted-foreground">{members.length ? 'Select a member to browse their saved data, or export the whole Squad.' : 'No members have been saved in this team on this computer.'}</p>}</section>
    </div>
    <CloudBackupSettings api={request} agents={members} readOnly />
  </main>;
}
