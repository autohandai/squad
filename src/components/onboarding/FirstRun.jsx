import { useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Repository selection is mandatory. Analysis only suggests; Start creates
 * the one coordinator. Specialists have a separate, explicit creation flow. */
export function FirstRun({ runtime, workspaces = [], onboardingState, updateOnboardingState, api, loginRequestStatus = '', onRequestLogin, onRefreshAccount, onRefreshRuntime, providerReady, onOpenProviders, renderTemplateAvatar, onStart, onContinue, onReviewSuggestion, setupSnapshot, setupError, onRefreshSetup, brand }) {
  const [paths, setPaths] = useState(onboardingState.selectedRepositories || []);
  const [path, setPath] = useState('');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [runtimeAttempt, setRuntimeAttempt] = useState(0);
  const [runtimeSetup, setRuntimeSetup] = useState(runtime?.bootstrap || { phase: 'idle' });
  const startingRef = useRef(false);
  const refreshRuntimeRef = useRef(onRefreshRuntime || onRefreshAccount);
  useEffect(() => { refreshRuntimeRef.current = onRefreshRuntime || onRefreshAccount; }, [onRefreshRuntime, onRefreshAccount]);
  const complete = ['completed', 'existing'].includes(setupSnapshot?.status) || ['completed', 'skipped'].includes(onboardingState.status);

  useEffect(() => {
    if (!paths.length && setupSnapshot?.repositories?.length) setPaths(setupSnapshot.repositories.map(item => item.path));
  }, [setupSnapshot]);

  // Keep the existing pinned-CLI first-install recovery and its bounded retry.
  useEffect(() => {
    if (runtime?.available !== false || runtime?.bridgeUnavailable) return undefined;
    if (!runtimeAttempt && runtime?.bootstrap?.phase === 'error') { setRuntimeSetup(runtime.bootstrap); return undefined; }
    let cancelled = false, timer;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 150000);
    setRuntimeSetup({ phase: 'preparing', error: '' });
    async function prepare() {
      try {
        await api('/api/setup/runtime', { method: 'POST', signal: controller.signal, body: '{}' });
        while (!cancelled) {
          const snapshot = await api('/api/runtime', { signal: controller.signal });
          if (cancelled) return;
          setRuntimeSetup(snapshot.bootstrap || { phase: snapshot.available ? 'ready' : 'idle' });
          if (snapshot.available) { await refreshRuntimeRef.current?.(); return; }
          if (snapshot.bootstrap?.phase === 'error') return;
          await new Promise(resolve => { timer = window.setTimeout(resolve, 750); });
        }
      } catch (cause) {
        if (!cancelled) setRuntimeSetup({ phase: 'error', error: controller.signal.aborted ? 'Preparing Autohand Code timed out. Check your connection and retry.' : cause.message });
      } finally { window.clearTimeout(deadline); }
    }
    void prepare();
    return () => { cancelled = true; window.clearTimeout(timer); window.clearTimeout(deadline); controller.abort(); };
  }, [api, runtime?.available, runtime?.bridgeUnavailable, runtimeAttempt]);

  useEffect(() => {
    setPlan(null); setError('');
    if (!paths.length) { setBusy(false); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    api('/api/setup/repositories', { method: 'POST', signal: controller.signal, body: JSON.stringify({ paths }) })
      .then(result => { if (!cancelled) setPlan(result); })
      .catch(cause => { if (!cancelled) setError(controller.signal.aborted ? 'Reading the repositories timed out. Retry to continue.' : cause.message); })
      .finally(() => { clearTimeout(timer); if (!cancelled) setBusy(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [api, paths, attempt]);

  function select(next) {
    setPaths(next); setPlan(null); setError('');
    updateOnboardingState({ selectedRepositories: next, selectedWorkspace: next[0] || '', lastStep: 'repositories' });
  }
  function add(value) {
    const folder = value.trim();
    if (!folder || starting || complete) return;
    select([...new Set([...paths, folder])]); setPath('');
  }
  async function pick() {
    setPicking(true); setError('');
    try {
      const result = await api('/api/workspaces/pick', { method: 'POST', body: JSON.stringify({ title: 'Choose a repository for your squad' }) });
      if (result?.path) add(result.path);
    } catch (cause) { setError(cause.message); }
    finally { setPicking(false); }
  }
  async function start() {
    if (startingRef.current || !canStart) return;
    startingRef.current = true; setStarting(true); setError('');
    try { await onStart(plan.repositories.map(item => item.path)); }
    catch (cause) { setError(cause.message || 'Could not prepare your squad. Your repositories are saved; retry to continue.'); }
    finally { startingRef.current = false; setStarting(false); }
  }
  const signedIn = runtime?.account?.signedIn === true;
  const runtimeReady = runtime?.available === true;
  const canStart = !complete && !!setupSnapshot && !setupError && !!plan?.repositories?.length && !busy && signedIn && runtimeReady && providerReady;
  const preparing = ['preparing', 'downloading', 'verifying', 'installing'].includes(runtimeSetup.phase) && !runtime?.bridgeUnavailable;
  const recent = workspaces.filter(item => item.path && !paths.includes(item.path)).slice(0, 5);
  const recommendations = plan?.recommendations || [];

  return <div className="min-h-screen bg-background" data-testid="first-run">
    <div className="mx-auto w-full max-w-2xl px-6 py-12 lg:py-16">
      <header className="flex items-center gap-3">{brand}<div><div className="text-sm font-semibold">Autohand Squad</div><div className="text-xs text-muted-foreground">{complete ? 'Your setup' : 'First run'}</div></div></header>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">{complete ? 'A team that fits your projects.' : 'Start with your repositories.'}</h1>
      <p className="mt-3 text-base text-muted-foreground">{complete ? 'Your saved squad is ready. Review a suggested teammate whenever you need more help.' : 'Choose one or more Git repositories. You’ll start with one Chief of Staff on Autohand Code and one channel, #general.'}</p>

      {!signedIn ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm"><span className="flex-1">Sign in with your Autohand account to continue.</span><Button onClick={onRequestLogin}>Sign in</Button><Button variant="ghost" size="sm" onClick={onRefreshAccount}><RefreshCw />Refresh</Button>{loginRequestStatus ? <span className="basis-full text-muted-foreground">{loginRequestStatus}</span> : null}</div> : null}
      {runtime?.available === false ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm">
        {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        <span className="flex-1" role={runtimeSetup.phase === 'error' ? 'alert' : 'status'}>{runtime?.bridgeUnavailable ? 'The local Autohand runtime is not answering yet.' : runtimeSetup.phase === 'error' ? runtimeSetup.error : runtimeSetup.phase === 'downloading' ? `Downloading Autohand Code…${runtimeSetup.totalBytes > 0 ? ` ${Math.min(100, Math.floor(100 * runtimeSetup.bytes / runtimeSetup.totalBytes))}%` : ''}` : runtimeSetup.phase === 'verifying' ? 'Verifying Autohand Code…' : runtimeSetup.phase === 'installing' ? 'Installing Autohand Code…' : 'Preparing Autohand Code for this computer…'}</span>
        {!preparing ? <Button size="sm" onClick={async () => { await refreshRuntimeRef.current?.(); setRuntimeAttempt(value => value + 1); }}>Retry</Button> : null}
      </div> : null}
      {signedIn && runtimeReady && !providerReady ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm"><span className="flex-1">No model provider is configured. Autohand AI works with your account.</span><Button size="sm" onClick={onOpenProviders}>Open providers</Button></div> : null}
      {setupError ? <p className="mt-6 text-sm text-destructive" role="alert">{setupError} <Button variant="ghost" size="sm" onClick={onRefreshSetup}>Retry setup</Button></p> : null}

      <section className="mt-8" aria-labelledby="repositories-heading">
        <h2 id="repositories-heading" className="text-sm font-semibold">Repositories{!complete ? ' · required' : ''}</h2>
        {!complete ? <>
          <div className="mt-3 flex flex-wrap gap-3"><Button variant="outline" onClick={pick} disabled={picking || starting}>{picking ? <Loader2 className="animate-spin" /> : <FolderOpen />}Choose a repository…</Button></div>
          <form className="mt-3 flex items-end gap-2" onSubmit={event => { event.preventDefault(); add(path); }}>
            <div className="min-w-0 flex-1"><label htmlFor="first-run-repository" className="text-xs text-muted-foreground">Or enter a local repository path</label><Input id="first-run-repository" value={path} onChange={event => setPath(event.target.value)} disabled={starting} placeholder="/path/to/repository" autoComplete="off" /></div>
            <Button type="submit" variant="outline" disabled={!path.trim() || starting}>Add repository</Button>
          </form>
        </> : null}
        <ul className="mt-4 divide-y divide-border/70" aria-label="Selected repositories">{paths.map(folder => {
          const profile = plan?.repositories.find(item => item.path === folder);
          return <li key={folder} className="flex items-start gap-3 py-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{profile?.name || folder.split(/[\\/]/).filter(Boolean).pop()}</div><div className="break-all text-xs text-muted-foreground">{folder}</div>{profile ? <p className="mt-1 text-sm text-muted-foreground">{profile.summary}</p> : null}</div>{!complete ? <Button variant="ghost" size="icon-sm" aria-label={`Remove ${folder}`} disabled={starting} onClick={() => select(paths.filter(item => item !== folder))}><X /></Button> : null}</li>;
        })}</ul>
        {!complete && recent.length ? <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Recent folders</summary><ul className="mt-2">{recent.map(item => <li key={item.path}><Button variant="ghost" size="sm" disabled={starting} onClick={() => add(item.path)}>{item.name || item.path}</Button></li>)}</ul></details> : null}
        {busy ? <p className="mt-3 text-sm text-muted-foreground" role="status">Reading your repositories…</p> : null}
        {error ? <div className="mt-3 text-sm"><p role="alert" className="text-destructive">{error}</p>{paths.length ? <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)} disabled={starting}>Retry repositories</Button> : null}</div> : null}
      </section>

      {plan ? <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="suggestions-heading">
        <h2 id="suggestions-heading" className="text-base font-semibold">Suggested teammates</h2>
        <p className="mt-2 text-sm text-muted-foreground">Based on the languages, frameworks and project files in your repositories. Suggestions stay suggestions until you choose to create someone.</p>
        {recommendations.length ? <ul className="mt-3 divide-y divide-border/70">{recommendations.map(({ template, reason, repositories }) => <li key={template.id} className="flex flex-wrap items-center gap-3 py-4">
          {renderTemplateAvatar?.(template, 'size-9 rounded-md')}
          <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{template.title}</h3><p className="text-sm text-muted-foreground">{reason}</p><p className="mt-1 text-xs text-muted-foreground">{repositories.map(item => item.name).join(', ')}</p></div>
          {complete ? <Button variant="outline" size="sm" onClick={() => onReviewSuggestion(template, repositories[0]?.path)}>Review {template.title}</Button> : null}
        </li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">There isn’t enough project evidence to suggest specialists yet. Your Chief of Staff can help you decide as the project develops.</p>}
      </section> : null}

      <footer className="mt-10 border-t border-border/70 pt-6">
        {complete ? <Button onClick={onContinue}>Open your squad</Button> : <>
          <div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold" aria-hidden="true">CS</div><div><div className="text-sm font-medium">Chief of Staff</div><div className="text-xs text-muted-foreground">Autohand Code · coordinates your selected repositories</div></div></div>
          <Button className="mt-5" onClick={start} disabled={!canStart || starting}>{starting ? <Loader2 className="animate-spin" /> : null}{starting ? 'Preparing your squad…' : 'Start with Chief of Staff'}</Button>
          <p className="mt-3 text-xs text-muted-foreground">Creates only your Chief of Staff and #general. Your repository choices are saved so you can return to setup.</p>
        </>}
      </footer>
    </div>
  </div>;
}
