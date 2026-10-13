import { formatInZone, routineNextLabel, runStatusTone, runStatusWord } from "@/lib/routines";
import { cn } from "@/lib/utils";

// A routine's run history as quiet text rows (ADR-0110): one summary line
// (last run, outcome, next run, whether it needs Squad open) and, on the
// detail page, a divider list of recorded occurrences including the ones
// that were skipped or missed. No cards, no tinted fills; status is a dot.

const TONE_CLASS = {
  ok: "bg-emerald-500",
  busy: "bg-primary animate-pulse",
  bad: "bg-destructive",
  warn: "bg-amber-500",
  quiet: "bg-muted-foreground/50",
};

export function RunStatusDot({ status, className }) {
  return <span aria-hidden="true" className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_CLASS[runStatusTone(status)], className)} />;
}

export function RoutineRunRow({ routine, locale, className, compact = false }) {
  if (!routine) return null;
  const timeZone = routine.schedule?.timeZone;
  const last = routine.activeRun || routine.lastRun || null;
  const lastText = last
    ? `${last.status === "running" ? "Started" : last.status === "queued" ? "Queued" : "Last run"} ${formatInZone(last.startedAt || last.queuedAt || last.scheduledFor, timeZone, locale)} · ${runStatusWord(last.status)}`
    : "No runs yet";
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground", className)} data-testid="routine-run-row">
      <span className="inline-flex min-w-0 items-center gap-2">
        {last ? <RunStatusDot status={last.status} /> : null}
        <span className="truncate">{lastText}</span>
      </span>
      <span aria-hidden="true" className="text-border">
        ·
      </span>
      <span className="truncate">{routineNextLabel(routine, locale)}</span>
      {routine.needsApp ? (
        <>
          <span aria-hidden="true" className="text-border">
            ·
          </span>
          <span className="truncate text-amber-600 dark:text-amber-400">{compact ? "Needs Squad open" : "Needs Squad open to run"}</span>
        </>
      ) : null}
    </div>
  );
}

export function RoutineRunList({ routine, locale, className, emptyText = "No scheduled runs yet" }) {
  const runs = Array.isArray(routine?.runs) ? routine.runs : [];
  const timeZone = routine?.schedule?.timeZone;
  if (!runs.length) return <p className={cn("py-3 text-sm text-muted-foreground", className)}>{emptyText}</p>;
  return (
    <ol className={cn("divide-y divide-border/60", className)} aria-label="Scheduled runs">
      {runs.map((run) => (
        <li key={run.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[minmax(0,220px)_110px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
          <span className="text-foreground">{formatInZone(run.scheduledFor || run.queuedAt, timeZone, locale, { year: true })}</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <RunStatusDot status={run.status} />
            {runStatusWord(run.status)}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            {run.reason || run.preview || (run.trigger === "manual" ? "Run now" : run.dispatch === "bridge" ? "Ran on the bridge" : "")}
          </span>
        </li>
      ))}
    </ol>
  );
}
