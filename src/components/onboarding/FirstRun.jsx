import { useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DefaultWorkspaceConsent } from "@/components/chat/DefaultWorkspaceConsent";

const memberFolders = member => [...new Set([member?.workspace, ...(member?.projects || []).map(project => project.path)].filter(Boolean))];

/** First install creates one coordinator. Review edits an existing member’s
 * folders; analysis only suggests specialists for explicit creation. */
export function FirstRun({ runtime, agents = [], remoteByMember = {}, workspaces = [], onboardingState, updateOnboardingState, api, loginRequestStatus = '', onRequestLogin, onRefreshAccount, onRefreshRuntime, providerReady, onOpenProviders, renderTemplateAvatar, onStart, onSaveWorkspaces, onRefreshMembers, onContinue, onReviewSuggestion, setupSnapshot, setupError, onRefreshSetup, brand }) {
  const existing = ['completed', 'existing'].includes(setupSnapshot?.status);
  const [memberId, setMemberId] = useState('');
  const reviewInitialized = useRef(false);
  const selectedMember = agents.find(member => member.id === memberId && !remoteByMember[member.id]);
  const canEditFolders = !!setupSnapshot && (!existing || !!selectedMember);
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
  const complete = existing;
  useEffect(() => {
    if (!existing || reviewInitialized.current || !agents.length) return;
    const local = agents.filter(member => !remoteByMember[member.id]);
    const initial = local.find(member => member.id === setupSnapshot?.memberId) || (local.length === 1 ? local[0] : null);
    reviewInitialized.current = true;
    setMemberId(initial?.id || '');
    setPaths(initial ? memberFolders(initial) : []);
  }, [existing, agents, setupSnapshot, remoteByMember]);

  useEffect(() => {
    if (!existing && !paths.length && setupSnapshot?.repositories?.length) setPaths(setupSnapshot.repositories.map(item => item.path));
  }, [setupSnapshot, existing]);

  // Keep the existing pinned-CLI first-install recovery and its bounded retry.
  useEffect(() => {
    if (!setupSnapshot || runtime?.available !== false || runtime?.bridgeUnavailable || (existing && !runtimeAttempt)) return undefined;
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
  }, [api, runtime?.available, runtime?.bridgeUnavailable, runtimeAttempt, existing, setupSnapshot?.status]);

  useEffect(() => {
    setPlan(null); setError('');
    if (!setupSnapshot || !paths.length || (existing && !selectedMember)) { setBusy(false); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    setBusy(true);
    api('/api/setup/repositories', { method: 'POST', signal: controller.signal, body: JSON.stringify({ paths, preserveFolders: existing }) })
      .then(result => { if (!cancelled) setPlan(result); })
      .catch(cause => { if (!cancelled) setError(controller.signal.aborted ? 'Reading the repositories timed out. Retry to continue.' : cause.message); })
      .finally(() => { clearTimeout(timer); if (!cancelled) setBusy(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [api, paths, attempt, existing, selectedMember?.id, setupSnapshot?.status]);

  function select(next) {
    setPaths(next); setPlan(null); setError('');
    updateOnboardingState({ selectedRepositories: next, selectedWorkspace: next[0] || '', lastStep: 'repositories' });
  }
  function add(value) {
    const folder = value.trim();
    if (!folder || starting || !canEditFolders) return;
    select([...new Set([...paths, folder])]); setPath('');
  }
  async function pick() {
    setPicking(true); setError('');
    try {
      const result = await api('/api/workspaces/pick', { method: 'POST', body: JSON.stringify({ title: 'Choose a work folder for your squad' }) });
      if (result?.path) add(result.path);
    } catch (cause) { setError(cause.message); }
    finally { setPicking(false); }
  }
  async function start() {
    if (startingRef.current || !(existing ? canSave : canStart)) return;
    startingRef.current = true; setStarting(true); setError('');
    try {
      const folders = existing ? paths : plan.repositories.map(item => item.path);
      if (existing) await onSaveWorkspaces({ memberId, workspace: folders[0], directories: folders.slice(1), expectedRevision: selectedMember.profileRevision || 0 });
      else await onStart(folders);
    }
    catch (cause) { setError(cause.message || 'Could not save setup. Your folder choices are kept; retry to continue.'); }
    finally { startingRef.current = false; setStarting(false); }
  }
  const signedIn = runtime?.account?.signedIn === true;
  const runtimeReady = runtime?.available === true;
  const canStart = !existing && !!setupSnapshot && !setupError && !!plan?.repositories?.length && !busy && signedIn && runtimeReady && providerReady;
  const canSave = existing && !!selectedMember && typeof onSaveWorkspaces === 'function' && !!setupSnapshot && !setupError && !!plan?.repositories?.length && !busy && signedIn;
  const preparing = ['preparing', 'downloading', 'verifying', 'installing'].includes(runtimeSetup.phase) && !runtime?.bridgeUnavailable;
  const recent = workspaces.filter(item => item.path && !paths.includes(item.path)).slice(0, 5);
  const recommendations = plan?.recommendations || [];

  return <div className="min-h-screen bg-background" data-testid="first-run">
    <div className="mx-auto w-full max-w-2xl px-6 py-12 lg:py-16">
      <header className="flex items-center gap-3">{brand}<div><div className="text-sm font-semibold">Autohand Squad</div><div className="text-xs text-muted-foreground">{complete ? 'Review setup' : 'First run'}</div></div></header>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">{complete ? 'Review where your squad works.' : 'Choose where your squad works.'}</h1>
      <p className="mt-3 text-base text-muted-foreground">{complete ? 'Choose an existing member and review their work folders. Saved changes apply to future work.' : 'Choose one or more project folders. Git is optional. You’ll start with one Chief of Staff on Autohand Code and one channel, #general.'}</p>

      {!signedIn ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm"><span className="flex-1">Sign in with your Autohand account to continue.</span><Button onClick={onRequestLogin}>Sign in</Button><Button variant="ghost" size="sm" onClick={onRefreshAccount}><RefreshCw />Refresh</Button>{loginRequestStatus ? <span className="basis-full text-muted-foreground">{loginRequestStatus}</span> : null}</div> : null}
      {runtime?.available === false ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm">
        {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        <span className="flex-1" role={runtimeSetup.phase === 'error' ? 'alert' : 'status'}>{runtime?.bridgeUnavailable ? 'The local Autohand runtime is not answering yet.' : runtimeSetup.phase === 'error' ? runtimeSetup.error : runtimeSetup.phase === 'downloading' ? `Downloading Autohand Code…${runtimeSetup.totalBytes > 0 ? ` ${Math.min(100, Math.floor(100 * runtimeSetup.bytes / runtimeSetup.totalBytes))}%` : ''}` : runtimeSetup.phase === 'verifying' ? 'Verifying Autohand Code…' : runtimeSetup.phase === 'installing' ? 'Installing Autohand Code…' : existing && !runtimeAttempt ? 'Autohand Code is not ready on this computer.' : 'Preparing Autohand Code for this computer…'}</span>
        {!preparing ? <Button size="sm" onClick={async () => { await refreshRuntimeRef.current?.(); setRuntimeAttempt(value => value + 1); }}>{existing && !runtimeAttempt ? 'Prepare runtime' : 'Retry'}</Button> : null}
      </div> : null}
      {signedIn && runtimeReady && !providerReady ? <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-4 text-sm"><span className="flex-1">No model provider is configured. Autohand AI works with your account.</span><Button size="sm" onClick={onOpenProviders}>Open providers</Button></div> : null}
      {setupError ? <p className="mt-6 text-sm text-destructive" role="alert">{setupError} <Button variant="ghost" size="sm" onClick={onRefreshSetup}>Retry setup</Button></p> : null}

      {existing ? <section className="mt-8" aria-labelledby="setup-member-heading">
        <h2 id="setup-member-heading" className="text-sm font-semibold">Member</h2>
        <div className="mt-3 flex items-center gap-2">
          <Select value={memberId} onValueChange={id => { setMemberId(id); select(memberFolders(agents.find(member => member.id === id))); }} disabled={starting}>
            <SelectTrigger aria-label="Member whose work folders to update" className="min-w-0 flex-1"><SelectValue className="truncate" placeholder="Choose an existing member" /></SelectTrigger>
            <SelectContent>{agents.map(member => <SelectItem key={member.id} value={member.id} disabled={!!remoteByMember[member.id]}>{member.name}{remoteByMember[member.id] ? " · another computer" : member.role ? ` · ${member.role}` : ''}</SelectItem>)}</SelectContent>
          </Select>
          {onRefreshMembers ? <Button variant="ghost" size="sm" disabled={starting} onClick={async () => { try { await onRefreshMembers(); } catch (cause) { setError(cause.message); } }}>Refresh members</Button> : null}
        </div>
        {Object.keys(remoteByMember).length ? <p className="mt-2 text-xs text-muted-foreground">Members running on another computer choose their work folders in that computer’s Squad.</p> : null}
        {!agents.length ? <p className="mt-2 text-sm text-muted-foreground">Open your squad to add a member, then return to choose their work folders.</p> : memberId && !selectedMember ? <p className="mt-2 text-sm text-destructive" role="alert">This member is no longer available. Choose another member.</p> : null}
      </section> : null}

      <section className="mt-8" aria-labelledby="repositories-heading">
        <h2 id="repositories-heading" className="text-sm font-semibold">Work folders · required</h2>
        {canEditFolders && !paths.length ? <DefaultWorkspaceConsent api={api} setup={runtime?.defaultWorkspaceSetup} onChoose={folder => add(folder)} onBrowse={async () => (await api('/api/workspaces/pick', { method: 'POST', body: JSON.stringify({ title: 'Choose a work folder for your squad' }) }))?.path} /> : null}
        {canEditFolders ? <>
          <div className="mt-3 flex flex-wrap gap-3"><Button variant="outline" onClick={pick} disabled={picking || starting}>{picking ? <Loader2 className="animate-spin" /> : <FolderOpen />}Choose a folder…</Button></div>
          <form className="mt-3 flex items-end gap-2" onSubmit={event => { event.preventDefault(); add(path); }}>
            <div className="min-w-0 flex-1"><label htmlFor="first-run-repository" className="text-xs text-muted-foreground">Or enter a local folder path</label><Input id="first-run-repository" value={path} onChange={event => setPath(event.target.value)} disabled={starting} placeholder="/path/to/folder" autoComplete="off" /></div>
            <Button type="submit" variant="outline" disabled={!path.trim() || starting}>Add folder</Button>
          </form>
        </> : null}
        <ul className="mt-4 divide-y divide-border/70" aria-label="Selected work folders">{paths.map(folder => {
          const profile = plan?.repositories.find(item => item.path === folder);
          return <li key={folder} className="flex items-start gap-3 py-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{profile?.name || folder.split(/[\\/]/).filter(Boolean).pop()}</div><div className="break-all text-xs text-muted-foreground">{folder}</div>{profile ? <p className="mt-1 text-sm text-muted-foreground">{profile.summary}</p> : null}</div>{canEditFolders ? <Button variant="ghost" size="icon-sm" aria-label={`Remove ${folder}`} disabled={starting} onClick={() => select(paths.filter(item => item !== folder))}><X /></Button> : null}</li>;
        })}</ul>
        {canEditFolders && recent.length ? <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Recent folders</summary><ul className="mt-2">{recent.map(item => <li key={item.path}><Button variant="ghost" size="sm" disabled={starting} onClick={() => add(item.path)}>{item.name || item.path}</Button></li>)}</ul></details> : null}
        {busy ? <p className="mt-3 text-sm text-muted-foreground" role="status">Reading your folders…</p> : null}
        {error ? <div className="mt-3 text-sm"><p role="alert" className="text-destructive">{error}</p>{paths.length ? <Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)} disabled={starting}>Retry folders</Button> : null}</div> : null}
      </section>

      {plan ? <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="suggestions-heading">
        <h2 id="suggestions-heading" className="text-base font-semibold">Suggested teammates</h2>
        <p className="mt-2 text-sm text-muted-foreground">Based on the languages, frameworks and project files in your folders. Suggestions stay suggestions until you choose to create someone.</p>
        {recommendations.length ? <ul className="mt-3 divide-y divide-border/70">{recommendations.map(({ template, reason, repositories }) => <li key={template.id} className="flex flex-wrap items-center gap-3 py-4">
          {renderTemplateAvatar?.(template, 'size-9 rounded-md')}
          <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{template.title}</h3><p className="text-sm text-muted-foreground">{reason}</p><p className="mt-1 text-xs text-muted-foreground">{repositories.map(item => item.name).join(', ')}</p></div>
          {complete ? <Button variant="outline" size="sm" onClick={() => onReviewSuggestion(template, repositories[0]?.path)}>Review {template.title}</Button> : null}
        </li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">There isn’t enough project evidence to suggest specialists yet. {existing ? 'Your selected member can help you decide as the project develops.' : 'Your Chief of Staff can help you decide as the project develops.'}</p>}
      </section> : null}

      <footer className="mt-10 border-t border-border/70 pt-6">
        {existing ? <>
          <div className="flex flex-wrap items-center gap-2"><Button onClick={start} disabled={!canSave || starting}>{starting ? <Loader2 className="animate-spin" /> : null}{starting ? 'Saving work folders…' : 'Save work folders'}</Button><Button variant="ghost" onClick={onContinue} disabled={starting}>Open your squad</Button></div>
          <p className="mt-3 text-xs text-muted-foreground">Replaces this member’s primary and additional work folders. Files stay where they are.</p>
        </> : <>
          <div className="flex items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold" aria-hidden="true">CS</div><div><div className="text-sm font-medium">Chief of Staff</div><div className="text-xs text-muted-foreground">Autohand Code · coordinates your selected folders</div></div></div>
          <Button className="mt-5" onClick={start} disabled={!canStart || starting}>{starting ? <Loader2 className="animate-spin" /> : null}{starting ? 'Preparing your squad…' : 'Start with Chief of Staff'}</Button>
          <p className="mt-3 text-xs text-muted-foreground">Creates only your Chief of Staff and #general. Your repository choices are saved so you can return to setup.</p>
        </>}
      </footer>
    </div>
  </div>;
}
