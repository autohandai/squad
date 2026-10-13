import { useId, useMemo } from "react";
import { Check, Circle, CircleX, LoaderCircle, Pause, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { normalizeTaskProgress, taskProgressFromMessage, taskProgressSummary } from "@/lib/task-progress";

const ITEM_STATES = {
  completed: { icon: Check, label: "Completed" },
  in_progress: { icon: LoaderCircle, label: "In progress" },
  pending: { icon: Circle, label: "Pending" },
  failed: { icon: CircleX, label: "Failed" },
  blocked: { icon: Pause, label: "Blocked" },
  cancelled: { icon: Minus, label: "Cancelled" },
  unknown: { icon: Circle, label: "State not reported" },
};

function useTaskProgress(message, progress) {
  return useMemo(() => normalizeTaskProgress(progress) || taskProgressFromMessage(message), [message, progress]);
}

/** Read-only reported tasks: the member updates them, the human reads them. */
export function AgentTaskChecklist({ message, progress, isLoading = false, className, title = "Task checklist" }) {
  const checklist = useTaskProgress(message, progress);
  const headingId = useId();
  if (!checklist?.items.length) return null;
  const summary = taskProgressSummary(checklist, { isLoading, status: message?.goal?.status || checklist.outcome || message?.status });

  return (
    <section aria-labelledby={headingId} aria-live="off" className={cn("my-3", className)} data-testid="agent-task-checklist">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-xs font-medium text-muted-foreground">{title}</h3>
        <span role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted-foreground">{summary}</span>
      </div>
      <ol className="flex flex-col gap-2" role="list">
        {checklist.items.map((item) => {
          const state = ITEM_STATES[item.status] || ITEM_STATES.unknown;
          const Icon = state.icon;
          const completed = item.status === "completed";
          const failed = item.status === "failed";
          return (
            <li key={item.id} data-task-id={item.id} data-task-status={item.status} className="relative flex items-start gap-2 text-sm leading-5">
              <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground", failed && "text-destructive", item.status === "in_progress" && isLoading && "motion-safe:animate-spin text-foreground")} />
              {/* `relative` on the item keeps the sr-only (absolute) label inside the
                  scrolled list; otherwise it is placed against the ScrollArea root,
                  escapes the viewport clip and stretches the Quick Chat document. */}
              <span className="min-w-0 flex-1">
                <span className={cn("break-words", completed && "text-muted-foreground line-through decoration-muted-foreground/60", item.status === "in_progress" && "font-medium", failed && "text-destructive")}>{item.title}</span>
                <span className={cn("ml-2 text-xs text-muted-foreground", completed && "sr-only", failed && "text-destructive")}>{state.label}{item.status === "in_progress" && !isLoading ? " · no completion update" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A compact final update reports actual checklist states without closing them. */
export function AgentWorkUpdate({ message, progress, isLoading = false, className }) {
  const checklist = useTaskProgress(message, progress);
  if (isLoading || !checklist || (!checklist.items.length && !checklist.summary)) return null;
  const summary = taskProgressSummary(checklist, { status: message?.goal?.status || checklist.outcome || message?.status });
  const body = typeof message?.body === "string" ? message.body.trim() : "";
  const workSummary = checklist.summary && checklist.summary !== body ? checklist.summary : "";
  if (!workSummary && !summary) return null;
  return (
    <div className={cn("mt-3 text-sm leading-6 text-muted-foreground", className)} data-testid="agent-work-update">
      {workSummary ? <p className="break-words">{workSummary}</p> : null}
      {summary ? <p className={cn(workSummary && "mt-0.5", "text-xs")}>{summary}</p> : null}
    </div>
  );
}
