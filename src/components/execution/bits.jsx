import { cn } from "@/lib/utils";

/**
 * One small dot in the app's presence vocabulary (ADR-0016): accent and
 * breathing while something runs, quiet grey once it is done, destructive
 * when it failed or is blocked, amber when it was stopped or is waiting.
 */
export function StatusDot({ status, className }) {
  const live = status === "running" || status === "launching" || status === "queued" || status === "active";
  const on = status === "online" || status === "ready";
  const bad = status === "failed" || status === "blocked";
  const held = status === "stopped" || status === "paused" || status === "handoff-pending" || status === "pending" || status === "interrupted";
  return (
    <span
      aria-hidden="true"
      data-status={status || "idle"}
      className={cn(
        "inline-flex size-2 shrink-0 rounded-full",
        live ? "bg-primary animate-pulse" : on ? "bg-emerald-500" : bad ? "bg-destructive" : held ? "bg-amber-500" : "bg-muted-foreground/45",
        className
      )}
    />
  );
}

/** Dot and word, for task rows ("● handoff pending"). */
export function StatusWord({ status, label, className }) {
  const bad = status === "failed" || status === "blocked";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", bad ? "text-destructive" : "text-muted-foreground", className)}>
      <StatusDot status={status} className="size-1.5" />
      <span className="[&::first-letter]:uppercase">{label}</span>
    </span>
  );
}

/** An empty tab is one sentence, not an icon tile. */
export function EmptyLine({ children }) {
  return <p className="py-6 text-sm text-muted-foreground">{children}</p>;
}

/** Small uppercase day or section label above a divider list. */
export function GroupLabel({ children, className }) {
  return <div className={cn("pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground first:pt-3", className)}>{children}</div>;
}

/** Underlined text tabs, the same control as History and Needs you. */
export function TextTabs({ tabs = [], value, onChange, label, className }) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-x-5 border-b border-border/75", className)}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(tab.id)}
            className={cn(
              "-mb-px border-b-2 px-0.5 pb-2 pt-1 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
