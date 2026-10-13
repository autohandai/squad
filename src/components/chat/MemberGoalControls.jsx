import { Button } from "@/components/ui/button";

const LABELS = { running: "In progress", paused: "Paused", completed: "Completed", blocked: "Blocked", failed: "Failed", cancelled: "Cancelled" };

export function MemberGoalControls({ goal, onAction, busy = false, error = "", onBreak = false }) {
  if (!goal) return null;
  const limitMinutes = Math.max(1, Math.ceil((goal.maxRuntimeMs || 14_400_000) / 60_000));
  const limitLabel = limitMinutes < 60 ? `${limitMinutes}m` : `${Math.round(limitMinutes / 60)}h`;
  const canResume = ["paused", "blocked", "failed"].includes(goal.status);
  const canCancel = ["running", "paused", "blocked", "failed"].includes(goal.status);
  return (
    <section aria-label="Current goal" data-testid="agent-goal-progress" data-goal-status={goal.status} data-goal-id={goal.id} className="mx-auto w-full max-w-3xl px-4 py-3 text-sm sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">Goal</span>
        <span className="text-xs text-muted-foreground">{LABELS[goal.status] || goal.status} · {goal.turnCount || 0}/{goal.maxTurns || 24} turns · {limitLabel} limit · {goal.harness || "Selected harness"}</span>
        <div className="ml-auto flex items-center gap-1">
          {goal.status === "running" ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction("pause", goal)}>Pause goal</Button> : null}
          {canResume ? <Button variant="ghost" size="sm" disabled={busy || onBreak} onClick={() => onAction("resume", goal)}>Resume goal</Button> : null}
          {canCancel ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAction("cancel", goal)}>Cancel goal</Button> : null}
        </div>
      </div>
      <p className="mt-1 break-words text-foreground/90">{goal.prompt}</p>
      {goal.pauseReason && goal.status !== "running" ? <p className="mt-1 text-xs text-muted-foreground">{goal.pauseReason}</p> : null}
      {onBreak && canResume ? <p className="mt-1 text-xs text-muted-foreground">End the break with /break off before resuming.</p> : null}
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
