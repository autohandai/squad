import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Creating a default folder is a person-owned choice, never a chat side effect. */
export function DefaultWorkspaceConsent({ api, setup, onChoose, onBrowse }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(create) {
    setBusy(true); setError('');
    try {
      const path = create
        ? (await api('/api/workspaces/default', { method: 'POST', body: JSON.stringify({ consent: true }) })).path
        : await onBrowse();
      if (path) await onChoose(path);
    } catch (problem) { setError(problem.message || 'The folder could not be selected. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="mx-4 border-b border-border/70 py-3 text-sm sm:mx-6" aria-label="Choose a work folder" data-testid="default-workspace-consent">
    <p className="font-medium">{setup?.exists ? 'Choose a folder for this conversation' : 'Create your default work folder?'}</p>
    <p className="mt-1 text-muted-foreground">Squad can work in <span className="select-text break-all font-mono text-xs" title={setup?.path}>~/Documents/autohand-desktop/</span>. Git is optional and is never initialized by this choice.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => choose(true)}>{setup?.exists ? 'Use default folder' : 'Create folder'}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => choose(false)}>Choose another folder</Button>
    </div>
    {busy ? <p role="status" className="mt-2 text-xs text-muted-foreground">Preparing your work folder…</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  </section>;
}
