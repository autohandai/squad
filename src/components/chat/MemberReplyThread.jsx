import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function useMemberThreadSummaries(api, memberId) {
  const [threads, setThreads] = useState([]);
  useEffect(() => {
    let cancelled = false, timer;
    setThreads([]);
    async function load() {
      try {
        const result = await api(`/api/members/${encodeURIComponent(memberId)}/threads`);
        if (!cancelled) setThreads(current => JSON.stringify(current) === JSON.stringify(result.threads) ? current : result.threads || []);
      } catch { /* The thread sheet retains actionable errors when opened. */ }
      if (!cancelled) timer = setTimeout(load, 2500);
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, memberId]);
  return threads;
}

/** A plain side conversation. Closing it never cancels its independent run. */
export function MemberReplyThread({ api, member, root, onClose, workspace, renderBody }) {
  const [thread, setThread] = useState(null);
  const [choices, setChoices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [retry, setRetry] = useState(null);
  const prefix = `/api/members/${encodeURIComponent(member.id)}/threads`;
  useEffect(() => { setSelectedId(root?.threadId || ''); setThread(null); setText(''); setError(''); setRetry(null); }, [member.id, root?.id, root?.threadId]);
  useEffect(() => {
    if (!root) return undefined;
    let cancelled = false, timer;
    let id = selectedId;
    async function load() {
      try {
        if (id) {
          const current = await api(`${prefix}/${encodeURIComponent(id)}`);
          if (!cancelled) setThread(current);
        } else if (root.id) {
          const current = await api(prefix, { method: 'POST', body: JSON.stringify({ root: { id: root.id, role: root.role, body: root.body, authorName: root.authorName } }) });
          id = current.id;
          if (!cancelled) setThread(current);
        } else {
          const result = await api(prefix);
          if (!cancelled) setChoices(result.threads || []);
        }
      } catch (problem) { if (!cancelled) setError(problem.message); }
      if (!cancelled) timer = setTimeout(load, 1000);
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, prefix, root, selectedId]);

  async function submit(event) {
    event.preventDefault();
    if (!thread || !text.trim() || sending || thread.working) return;
    const request = retry?.text === text.trim() ? retry : { text: text.trim(), requestId: crypto.randomUUID() };
    setSending(true); setError(''); setRetry(request);
    try {
      const saved = await api(`${prefix}/${encodeURIComponent(thread.id)}/messages`, { method: 'POST', body: JSON.stringify({ ...request, workspace }) });
      setThread(saved); setText(''); setRetry(null);
    } catch (problem) { setError(problem.message); }
    finally { setSending(false); }
  }
  async function stop() {
    try { setThread(await api(`${prefix}/${encodeURIComponent(thread.id)}/stop`, { method: 'POST', body: '{}' })); setError(''); }
    catch (problem) { setError(problem.message); }
  }
  return <Sheet open={Boolean(root)} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" aria-label="Reply thread">
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <SheetTitle className="text-base">{member.name} · Thread</SheetTitle>
        <SheetDescription>Independent work. Other conversations can continue while this thread runs.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="member-reply-thread">
        {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
        {thread ? <>
          <div className="mb-5 border-b pb-4 text-sm text-muted-foreground">{renderBody(thread.root.body)}</div>
          <div className="space-y-5" aria-live="polite">
            {thread.messages.map(message => <article key={message.id} data-thread-message-id={message.id}>
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">{message.role === 'user' ? 'You' : member.name}</span>{message.status === 'loading' ? <span>Working…</span> : null}{['error','stopped'].includes(message.status) ? <span className="text-destructive">{message.status === 'stopped' ? 'Stopped' : 'Could not finish'}</span> : null}</div>
              <div className="text-sm leading-6">{message.body ? renderBody(message.body) : null}</div>
            </article>)}
            {!thread.messages.length ? <p className="text-sm text-muted-foreground">Reply to start independent work on this message.</p> : null}
          </div>
        </> : choices.length ? <div className="divide-y">{choices.map(choice => <button key={choice.id} className="block w-full py-3 text-left text-sm" onClick={() => setSelectedId(choice.id)}><span className="line-clamp-2">{choice.root.body}</span><span className="mt-1 block text-xs text-muted-foreground">{choice.replyCount} {choice.replyCount === 1 ? 'reply' : 'replies'}{choice.working ? ' · working' : ''}</span></button>)}</div> : <p className="text-sm text-muted-foreground">{root?.id ? 'Opening thread…' : 'Reply to a message to start a thread.'}</p>}
      </div>
      {thread ? <form onSubmit={submit} className="border-t p-4">
        <Textarea value={text} onChange={event => setText(event.target.value)} placeholder={`Reply to ${member.name} in this thread…`} aria-label="Thread reply" className="min-h-20 resize-none" onKeyDown={event => {if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form.requestSubmit();}}} />
        <div className="mt-2 flex justify-end gap-2">{thread.working ? <Button type="button" variant="outline" size="sm" onClick={stop}>Stop this thread</Button> : null}<Button type="submit" size="sm" disabled={!text.trim() || sending || thread.working}>{sending ? 'Sending…' : 'Reply'}</Button></div>
      </form> : null}
    </SheetContent>
  </Sheet>;
}
