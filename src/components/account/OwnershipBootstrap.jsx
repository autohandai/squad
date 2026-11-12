import { useEffect, useRef, useState } from "react";
import { SignInGate } from "./SignInGate";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { activateOwnership, invalidateOwnership } from "@/lib/ownership-client";
import { ownedLocalStorage } from "@/lib/owned-storage";
import { withCachedMemberViews } from "@/lib/member-menus";
import { OwnedSquadView, SquadOwnerPicker } from "./OwnedSquadView";

async function request(path, context, init = {}) {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(context ? { 'x-squad-context': context.generation } : {}), ...init.headers }, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok || value.success !== true) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || 'Squad could not verify current access.');
  return value.data;
}

export function OwnershipBootstrap({ children }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [owners, setOwners] = useState([]);
  const [restarting,setRestarting]=useState(false);
  const current = useRef(null), mounted = useRef(null), refresh = useRef(null);
  const nativeGeneration = useRef(new URLSearchParams(window.location.search).get('nativeContext'));
  useEffect(() => {
    let disposed = false, sequence = 0, reloading = false, leaving = false, checking = false, hydrating = false, hydrated = false;
    const leave = next => {
      if (disposed || reloading || !mounted.current) return;
      if(!leaving){leaving=true;invalidateOwnership();setContext({state:'changing'});}
      if (window.location.pathname === '/quick-chat') return;
      // Revoke the private realm immediately, but do not load its replacement
      // while the broker is still draining/revoking temporary runtimes.
      if(!next?.state||['verifying','draining','closed'].includes(next.state))return;
      reloading = true;
      // Private module state is never retargeted. New ownership gets a new
      // JavaScript realm, with old drafts retained only in their own namespace.
      const route = window.location.pathname === '/quick-chat' ? '/quick-chat' : '/squad';
      window.location.replace(route);
    };
    const apply = next => {
      if (disposed || reloading) return;
      if (nativeGeneration.current && next.generation !== nativeGeneration.current) {
        reloading = true; invalidateOwnership(); setContext({ state: 'expired_native' }); return;
      }
      if (mounted.current && (leaving || next.generation !== mounted.current.generation || next.state !== 'ready' || next.storageKey !== mounted.current.storageKey)) { leave(next); return; }
      current.current = next;
      if (next.state === 'ready' && !mounted.current) {
        const state = window.history.state;
        if (state?.squadOwnership !== next.storageKey) {
          const { squadSettingsReturn: _privateDraft, ...rest } = state || {};
          window.history.replaceState({ ...rest, squadOwnership: next.storageKey }, '', window.location.href);
        }
        activateOwnership(next); mounted.current = next;
      }
      if (next.state === 'ready' && !hydrated) {
        if (hydrating) return;
        hydrating = true; setContext({ ...next, state: 'loading' });
        // A cache cannot recreate a member deleted or changed through MCP.
        // Resolve the canonical owned registry before App's mirroring effects
        // can publish any browser state back into the runtime.
        Promise.all([request('/api/channels', next), request('/api/owned/browser-state', next)]).then(async ([snapshot, browser]) => {
          if (disposed || reloading || leaving || current.current?.generation !== next.generation) return;
          let cachedMemberViews = [];
          try { cachedMemberViews = JSON.parse(ownedLocalStorage.getItem('autohandSquad.v1.agents') || '[]'); } catch { /* Malformed view choices do not block the verified roster. */ }
          const members = withCachedMemberViews(Object.entries(snapshot.agentChannelAccess || {}).filter(([id, access]) => id !== 'squad-designer' && access?.agent && !access.removed)
            .map(([id, access]) => ({ ...access.agent, id, ownership: next.owner })), cachedMemberViews);
          ownedLocalStorage.setItem('autohandSquad.v1.agents', JSON.stringify(members));
          const cachedMessages=ownedLocalStorage.getItem('autohandSquad.v1.messages');
          const cachedRevision=ownedLocalStorage.getItem('autohandSquad.v1.browserRevision');
          // Reload can beat the current conversation's debounced save. Recover
          // that exact owner/dataset draft only if its last verified revision
          // still matches. A different window's newer state always wins CAS.
          if(cachedMessages&&cachedMessages!=='{}'&&cachedMessages!==JSON.stringify(browser.messagesByAgent||{})&&cachedRevision!==null&&/^\d+$/.test(cachedRevision)&&Number(cachedRevision)===(browser.revision||0)) {
            try {
              const draft=JSON.parse(cachedMessages),known=new Set(members.map(member=>member.id));
              if(draft&&typeof draft==='object'&&!Array.isArray(draft)&&Object.keys(draft).every(id=>known.has(id))) {
                const saved=await request('/api/owned/browser-state',next,{method:'PUT',body:JSON.stringify({baseRevision:browser.revision||0,messagesByAgent:draft})});
                browser={...browser,messagesByAgent:draft,revision:saved.revision};
              }
            } catch { /* A conflict or failed save preserves the scoped draft below. */ }
            if(disposed||reloading||current.current?.generation!==next.generation)return;
          }
          const canonicalMessages=JSON.stringify(browser.messagesByAgent||{});
          if(cachedMessages&&cachedMessages!==canonicalMessages&&cachedMessages!=='{}')ownedLocalStorage.setItem('autohandSquad.v1.browserDraftRecovery',cachedMessages);
          ownedLocalStorage.setItem('autohandSquad.v1.messages',canonicalMessages);
          ownedLocalStorage.setItem('autohandSquad.v1.browserRevision', String(browser.revision || 0));
          if (Array.isArray(snapshot.channels)) ownedLocalStorage.setItem('autohandSquad.v1.channels', JSON.stringify(snapshot.channels));
          hydrated = true; hydrating = false; setError(''); setContext(next);
        }).catch(failure => {
          if (disposed || reloading || leaving || current.current?.generation !== next.generation) return;
          hydrating = false;
          setError(failure.name === 'QuotaExceededError' ? 'Your device’s local storage is full. Free some space, then retry. Your saved Squad is unchanged.' : failure.message || 'Your saved Squad could not be loaded.');
          setContext({ ...next, state: 'load_error' });
        });
        return;
      }
      setError(''); setContext(next);
    };
    const load = async () => {
      if (checking || disposed || reloading) return;
      checking = true; const mine = ++sequence;
      try { const next = await request('/api/ownership/context'); if (mine === sequence) apply(next); }
      catch (failure) { if (!disposed && mine === sequence) { if (mounted.current) leave(); else setError(failure.message || 'Connecting to Squad…'); } }
      finally { checking = false; }
    };
    refresh.current = load;
    void load();
    let events;
    if (typeof EventSource === 'function') {
      events = new EventSource('/api/ownership/events');
      events.onmessage = event => { try { ++sequence; apply(JSON.parse(event.data)); } catch { if (mounted.current) leave(); } };
      events.onerror = () => { if (mounted.current) leave(); else void load(); };
    }
    const timer = setInterval(() => void load(), 1000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus); window.addEventListener('pageshow', focus);
    window.addEventListener('squad:ownership-invalidated', leave);
    return () => { disposed = true; ++sequence; events?.close(); clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('pageshow', focus); window.removeEventListener('squad:ownership-invalidated', leave); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (context?.state === 'blocked' && context.actor) request('/api/ownership/owners', context).then(value => { if (!cancelled) setOwners(value.owners); }, () => {});
    return () => { cancelled = true; };
  }, [context?.state, context?.generation]);

  async function retry() {
    try { if (current.current) await request('/api/ownership/retry', current.current, { method: 'POST' }); await refresh.current?.(); }
    catch (failure) { setError(failure.message); }
  }
  if(context?.state==='awaiting_restart')return <div className="flex min-h-[100svh] flex-col bg-background text-foreground"><SquadOwnerPicker context={context}/><main className="flex flex-1 items-center justify-center px-6 py-12">
    <div className="w-full max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{context.pendingOperation?.kind==='reset'?'Squad has been reset':'Your backup has been restored'}</h1>
      <p className="text-sm text-muted-foreground">{context.ownerLabel} is ready to open. Your earlier dataset is preserved separately. Imported agents and routines stay paused until you review them.</p>
      {context.pendingOperation?.result?.warningCount?<div className="space-y-2 text-sm text-muted-foreground" role="status"><p>{context.pendingOperation.result.warningCount} source notes were recorded during restoration.</p><ul className="space-y-1">{context.pendingOperation.result.warningSamples.map((note,index)=><li key={index}>{note}</li>)}</ul></div>:null}
      {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
      {!context.canRestartData?<p className="text-sm text-muted-foreground">A team operator with write access must acknowledge this completed operation. You can choose another Squad above.</p>:null}
      <div className="flex flex-wrap gap-2"><Button disabled={restarting||!context.canRestartData} onClick={async()=>{setRestarting(true);setError('');try{
        await request(`/api/ownership/operations/${context.pendingOperation.id}/restart`,context,{method:'POST',body:JSON.stringify({revision:context.pendingOperation.revision})});window.location.replace('/squad');
      }catch(failure){setError(failure.message);setRestarting(false);}}}>{restarting?'Restarting Squad…':'Restart Squad'}</Button>
      <Button variant="ghost" onClick={async()=>{try{await request('/api/account/logout',context,{method:'POST'});await refresh.current?.();}catch(failure){setError(failure.message);}}}>Sign out</Button></div>
    </div>
  </main></div>;
  if (context?.state === 'ready') return <>{window.location.pathname !== '/quick-chat' ? <SquadOwnerPicker context={context} /> : null}{context.canWrite ? children : <OwnedSquadView context={context} />}</>;
  if (context?.state === 'expired_native') return <main className="flex min-h-[100svh] items-center justify-center bg-background p-6 text-sm text-muted-foreground">The selected Squad changed. Reopen Quick Chat from the menu bar.</main>;
  if (context?.state === 'signed_out') return <SignInGate account={{ signedIn: false }}
    startLogin={() => request('/api/harnesses/login', current.current, { method: 'POST', body: JSON.stringify({ id: 'autohand' }) })}
    loginStatus={() => request('/api/harnesses/login?id=autohand', current.current)}
    openLoginPage={() => request('/api/harnesses/login/open?id=autohand', current.current, { method: 'POST' })}
    cancelLogin={() => request('/api/harnesses/login?id=autohand', current.current, { method: 'DELETE' })}
    refreshAccount={() => refresh.current?.()} />;
  const busy = !error && (!context || ['verifying', 'changing', 'loading','draining'].includes(context.state));
  return <main className="flex min-h-[100svh] items-center justify-center bg-background px-6 text-foreground">
    <div className="w-full max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Autohand Squad</h1>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">{busy ? <Spinner className="size-4" /> : null}{busy ? context?.state === 'draining'?'Finishing background work and preparing your Squad’s data…':context?.state === 'loading' ? 'Loading your Squad…' : 'Verifying your Squad…' : error || context?.error || 'Your Squad could not be verified.'}</p>
      {!busy ? <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={retry}>Retry</Button>
        {owners.map(item => <Button key={`${item.owner.kind}:${item.owner.id}`} variant="ghost" onClick={async () => {
          try { await request('/api/ownership/select', current.current, { method: 'POST', body: JSON.stringify({ owner: item.owner, expectedGeneration: current.current.generation }) }); await refresh.current?.(); }
          catch (failure) { setError(failure.message); }
        }}>{item.label}{item.canWrite ? '' : ' · Read only'}</Button>)}
        {context?.actor ? <Button variant="ghost" onClick={async () => { try { await request('/api/account/logout', current.current, { method: 'POST' }); } finally { void refresh.current?.(); } }}>Sign out</Button> : null}
      </div> : null}
    </div>
  </main>;
}
