import { Check, CircleX, Minus, Pause } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Squad's loading patterns (ADR-0284, DESIGN.md › Loading). Which one when:
// a known total → LoadingProgress; a save → SaveStatus; a reply being
// composed → TextShimmer; a list's first load → Skeleton rows in the final
// layout; an unknown wait inside a card → IndeterminateBar; reported steps
// → ProgressChecklist.

/** Words with a light sweep across them ("Thinking…"). Still text for
 * assistive technology; static under reduced motion. */
export function TextShimmer({ as: Tag = "span", className, children, ...props }) {
  return <Tag data-slot="text-shimmer" className={cn("loading-text-shimmer", className)} {...props}>{children}</Tag>;
}

/** A thin segment sliding along the top of a card while something of
 * unknown length loads. Put it in a `relative` container; it marks the
 * container busy for assistive technology through `label`. */
export function IndeterminateBar({ className, label = "Loading", ...props }) {
  return <div data-slot="indeterminate-bar" role="progressbar" aria-label={label} aria-busy="true" className={cn("loading-indeterminate w-full rounded-full", className)} {...props} />;
}

/** A determinate bar with its value at the right: a thin track, a dark
 * fill, tabular digits. */
export function LoadingProgress({ value = 0, label = "Progress", valueText, showValue = true, className, ...props }) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div data-slot="loading-progress" className={cn("flex items-center gap-3", className)} {...props}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={valueText || `${percent}%`} className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/80 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      {showValue ? <span aria-hidden="true" className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span> : null}
    </div>
  );
}

/** "Saving" with the ring, then "Saved" with a green check; "error" shows
 * the message in the destructive colour. Renders nothing when idle. */
export function SaveStatus({ state = "idle", savingLabel = "Saving…", savedLabel = "Saved", error = "", className }) {
  if (state === "idle" || (!state)) return <span role="status" aria-live="polite" className="sr-only" />;
  return (
    <span data-slot="save-status" data-state={state} role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", state === "error" && "text-destructive", className)}>
      {state === "saving" ? <Spinner className="size-3" aria-hidden="true" /> : null}
      {state === "saved" ? <span className="loading-check-in grid size-3.5 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true"><Check className="size-2.5" strokeWidth={3} /></span> : null}
      {state === "saving" ? savingLabel : state === "saved" ? savedLabel : error || "Couldn’t save"}
    </span>
  );
}

const STEP_GLYPHS = { completed: "done", in_progress: "doing", pending: "todo", failed: "failed", blocked: "blocked", cancelled: "cancelled" };

/** One step's mark in a progress checklist: an empty circle to do, the ring
 * while doing (only while work is live), a green check when done. */
export function StepGlyph({ status = "pending", live = true, className }) {
  const kind = STEP_GLYPHS[status] || "todo";
  const box = cn("mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full", className);
  if (kind === "done") return <span aria-hidden="true" className={cn(box, "loading-check-in bg-emerald-500 text-white")}><Check className="size-2.5" strokeWidth={3} /></span>;
  if (kind === "doing" && live) return <span aria-hidden="true" className={cn(box, "text-foreground")}><Spinner className="size-3.5" aria-hidden="true" /></span>;
  if (kind === "failed") return <CircleX aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0 text-destructive", className)} />;
  if (kind === "blocked") return <Pause aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground", className)} />;
  if (kind === "cancelled") return <Minus aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground", className)} />;
  return <span aria-hidden="true" className={cn(box, "border border-muted-foreground/45", kind === "doing" && "border-foreground/60")} />;
}

/** A list of named steps with their marks ("Reading files", "Searching",
 * "Writing"). For a member's reported tasks use AgentTaskChecklist, which
 * draws the same marks. */
export function ProgressChecklist({ steps = [], live = true, label = "Progress", className }) {
  const done = steps.filter(step => step.status === "completed").length;
  return (
    <ol data-slot="progress-checklist" aria-label={label} aria-busy={live && done < steps.length ? "true" : undefined} className={cn("flex flex-col gap-1.5 text-sm", className)}>
      {steps.map(step => (
        <li key={step.id || step.title} data-step-status={step.status} className="flex items-start gap-2 leading-5">
          <StepGlyph status={step.status} live={live} />
          <span className={cn(step.status === "pending" ? "text-muted-foreground" : "text-foreground", step.status === "in_progress" && "font-medium")}>{step.title}</span>
          <span className="sr-only">{step.status === "completed" ? "Done" : step.status === "in_progress" ? "In progress" : "Not started"}</span>
        </li>
      ))}
    </ol>
  );
}
