import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AgentChannelProposals({ proposals, members, onDecision }) {
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  if (!proposals.length) return null;
  async function decide(id, decision) {
    if (pending) return;
    setPending(id); setError('');
    try { await onDecision(id, decision); }
    catch (failure) { setError(failure.message || 'Could not save this decision. Try again.'); }
    finally { setPending(''); }
  }
  return <section aria-label="Channel proposals" className="mx-6 py-4 border-b border-border/60 space-y-3">
    <p className="text-sm font-medium">Channel proposals</p>
    {proposals.map(proposal => <div key={proposal.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div>
        <p>{members.find(member => member.id === proposal.actorId)?.name || 'A teammate'} proposes <strong>#{proposal.action.name}</strong></p>
        <p className="text-muted-foreground">{proposal.action.purpose || 'A shared place to organise work.'}</p>
        <p className="text-xs text-muted-foreground">{proposal.action.memberIds.map(id => members.find(member => member.id === id)?.name || id).join(', ')}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => decide(proposal.id, 'decline')}>Decline</Button>
        <Button size="sm" variant="outline" disabled={Boolean(pending)} onClick={() => decide(proposal.id, 'approve')}>{pending === proposal.id ? 'Saving…' : 'Approve channel'}</Button>
      </div>
    </div>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}
