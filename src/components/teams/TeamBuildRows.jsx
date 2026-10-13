import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { buildProgress, pendingBuildMembers } from "@/lib/team-builder";
import { cn } from "@/lib/utils";

/**
 * The directory's rows for a team being added (ADR-0118): one row per member
 * not yet prepared, in the same grammar as a member row, with "Preparing…"
 * or the reason it failed and Retry / Dismiss. A member that is ready has
 * already become an ordinary row, so these only ever shrink. One more row
 * says when the channel and routines are being added or could not be.
 */
export function TeamBuildRows({ builds = [], copy = {}, renderAvatar, onRetry, onDismiss }) {
  const rows = [];
  for (const build of builds) {
    const progress = buildProgress(build);
    const pending = pendingBuildMembers(build);
    const stuck = ["failed", "interrupted", "bridge-failed"].includes(build.status);
    for (const member of pending) {
      const failed = member.status === "failed" || member.status === "interrupted";
      rows.push(
        <li key={`${build.id}-${member.key}`} className="group flex items-start gap-3 border-b border-border/60 px-2 py-3" data-testid="team-build-row">
          <span className="relative inline-flex shrink-0 opacity-70">
            {renderAvatar ? renderAvatar({ id: member.id, name: member.name, role: member.role, avatar: member.draft?.avatar, employeeType: member.draft?.employeeType }) : null}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-medium">{member.name}</span>
              <span className="truncate text-xs text-muted-foreground">{member.role}</span>
            </div>
            <p className={cn("mt-0.5 truncate text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
              {failed
                ? `${member.status === "interrupted" ? copy.preparationInterrupted || "Preparation was interrupted" : copy.couldNotBePrepared || "Could not be prepared"}${member.error ? `: ${member.error}` : "."}`
                : (copy.preparingMember || "Preparing… ({ready} of {total} ready)").replace("{ready}", String(progress.ready)).replace("{total}", String(progress.total))}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {!failed ? <Spinner className="size-3" aria-hidden="true" /> : null}
              <span className="truncate">{(copy.joiningTeam || "Joining {team}").replace("{team}", build.name)}</span>
            </div>
          </div>
          {failed && stuck ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onRetry?.(build.id)}>{copy.retry || "Retry"}</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onDismiss?.(build.id)}>{copy.dismiss || "Dismiss"}</Button>
            </div>
          ) : null}
        </li>
      );
    }
    if (build.status === "finishing" || build.status === "bridge-failed") {
      const failed = build.status === "bridge-failed";
      rows.push(
        <li key={`${build.id}-bridge`} className="flex items-start gap-3 border-b border-border/60 px-2 py-2.5" data-testid="team-build-bridge-row">
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
              {failed
                ? (copy.teamBridgeFailed || "{team}: the members are ready, but the channel and routines could not be added: {error}").replace("{team}", build.name).replace("{error}", build.error || "")
                : (copy.teamFinishing || "{team}: adding the channel, routines and connections…").replace("{team}", build.name)}
            </p>
          </div>
          {failed ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onRetry?.(build.id)}>{copy.retry || "Retry"}</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onDismiss?.(build.id)}>{copy.dismiss || "Dismiss"}</Button>
            </div>
          ) : (
            <Spinner className="mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </li>
      );
    }
  }
  return rows;
}
