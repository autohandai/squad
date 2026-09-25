import { useEffect, useState } from "react";
import { FolderGit2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { bindingSummary } from "@/lib/git-events";
import { cn } from "@/lib/utils";

/**
 * "Repository" section of the channel settings popover (ADR-0022): a folder
 * picker, branch and remote inputs, one status line, and Bind / Unbind.
 * Calm form rows, no card. The component never fetches; the integrator
 * supplies `onPickFolder` (the `/api/workspaces/pick` dialog), `onBind`
 * (`POST /api/git/watch`) and `onUnbind` (`DELETE /api/git/watch/:id`).
 *
 * Props
 *   channel      the channel; `channel.git` is `{ repoPath, remote, branch }` when bound
 *   status       last `gitStatus` result for the binding (optional)
 *   busy         true while a bind/unbind request is in flight
 *   error        a message from the last failed request (optional)
 *   copy         locale strings (falls back to English literals)
 *   onPickFolder async () => string | null   (a folder path, or null when cancelled)
 *   onBind       ({ channelId, repoPath, remote, branch }) => void
 *   onUnbind     (channelId) => void
 */
export function RepositorySettings({ channel, status = null, busy = false, error = "", copy = {}, onPickFolder, onBind, onUnbind, className }) {
  const bound = channel?.git?.repoPath ? channel.git : null;
  const [repoPath, setRepoPath] = useState(bound?.repoPath || "");
  const [branch, setBranch] = useState(bound?.branch || "");
  const [remote, setRemote] = useState(bound?.remote || "origin");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setRepoPath(bound?.repoPath || "");
    setBranch(bound?.branch || "");
    setRemote(bound?.remote || "origin");
  }, [bound?.repoPath, bound?.branch, bound?.remote]);

  const dirty = repoPath !== (bound?.repoPath || "") || branch !== (bound?.branch || "") || remote !== (bound?.remote || "origin");
  const canBind = Boolean(repoPath.trim()) && !busy && (dirty || !bound);
  const idBase = `repo-${channel?.id || "channel"}`;

  async function pickFolder() {
    if (!onPickFolder || picking) return;
    setPicking(true);
    try {
      const picked = await onPickFolder(repoPath || undefined);
      if (picked) setRepoPath(String(picked));
    } finally {
      setPicking(false);
    }
  }

  function bind(submitEvent) {
    submitEvent?.preventDefault?.();
    if (!canBind) return;
    onBind?.({ channelId: channel.id, repoPath: repoPath.trim(), remote: remote.trim() || "origin", branch: branch.trim() });
  }

  return (
    <form className={cn("flex flex-col gap-2", className)} onSubmit={bind} aria-labelledby={`${idBase}-title`}>
      <div>
        <span id={`${idBase}-title`} className="block text-sm font-medium">
          {copy.gitRepository || "Repository"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {copy.gitRepositoryDetail || "Bind a folder and branch; new commits, pull requests, and CI results show in the stream."}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          id={`${idBase}-path`}
          value={repoPath}
          onChange={(changeEvent) => setRepoPath(changeEvent.target.value)}
          placeholder={copy.gitFolderPlaceholder || "Folder path"}
          aria-label={copy.gitFolder || "Repository folder"}
          className="h-8 min-w-0 flex-1 text-xs"
          spellCheck={false}
        />
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={pickFolder} disabled={picking || busy || !onPickFolder}>
          {picking ? <Spinner /> : <FolderGit2 data-icon="inline-start" />}
          {copy.choose || "Choose…"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${idBase}-branch`}>
          {copy.gitBranch || "Branch"}
          <Input
            id={`${idBase}-branch`}
            value={branch}
            onChange={(changeEvent) => setBranch(changeEvent.target.value)}
            placeholder={status?.head || "main"}
            className="h-8 text-xs"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`${idBase}-remote`}>
          {copy.gitRemote || "Remote"}
          <Input
            id={`${idBase}-remote`}
            value={remote}
            onChange={(changeEvent) => setRemote(changeEvent.target.value)}
            placeholder="origin"
            className="h-8 text-xs"
            spellCheck={false}
          />
        </label>
      </div>

      <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")} role="status">
        {error || bindingSummary(bound, status, copy)}
      </p>

      <div className="flex items-center gap-1.5">
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={!canBind}>
          {busy ? <Spinner /> : null}
          {bound ? copy.gitUpdateBinding || "Update" : copy.gitBind || "Bind"}
        </Button>
        {bound ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onUnbind?.(channel.id)} disabled={busy}>
            {copy.gitUnbind || "Unbind"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
