import { Check, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { runStatusLabel } from "@/lib/workflows";
import { cn } from "@/lib/utils";

/**
 * Small tag placed in the author line of a message a workflow posted
 * (`message.workflowRunId`). Quiet: an icon, the workflow name, and the step
 * position when the run knows it.
 */
export function WorkflowTag({ workflow, run, stepId = "", copy = {}, className }) {
  const name = workflow?.name || run?.workflowName || copy.workflow || "Workflow";
  const index = stepId && workflow?.steps ? workflow.steps.findIndex((step) => step.id === stepId) : -1;
  const position = index >= 0 ? (copy.workflowStepOf || "step {n} of {total}").replace("{n}", String(index + 1)).replace("{total}", String(workflow.steps.length)) : "";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground", className)} title={position || undefined}>
      <Workflow className="size-3" aria-hidden="true" />
      {name}
      {position ? <span className="font-normal">· {position}</span> : null}
    </span>
  );
}

/**
 * The run's row in the channel stream. While the run waits at an approval
 * gate it shows "Waiting for approval", the step that is gated, Approve and
 * Decline, and the emoji hint; afterwards it collapses to one status line.
 *
 * Props: { run, workflow, members?, onApprove(run), onDecline(run), copy, className }
 */
export function WorkflowRunMessage({ run, workflow, members = [], onApprove, onDecline, copy = {}, className }) {
  if (!run) return null;
  const waiting = run.status === "waiting_approval" && run.pendingApproval;
  const step = waiting ? workflow?.steps?.find((item) => item.id === run.pendingApproval.stepId) : null;
  const member = step ? members.find((item) => item.id === step.memberId) : null;
  const stepIndex = step && workflow?.steps ? workflow.steps.indexOf(step) : -1;

  if (!waiting) {
    const tone = run.status === "failed" ? "text-destructive" : run.status === "declined" ? "text-muted-foreground" : "text-muted-foreground";
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-xs", tone, className)} role="status">
        <WorkflowTag workflow={workflow} run={run} copy={copy} />
        <span>{runStatusLabel(run.status, copy)}</span>
        {run.error ? <span className="truncate">· {run.error}</span> : null}
      </div>
    );
  }

  const stepLabel = stepIndex >= 0 ? (copy.workflowStepOf || "step {n} of {total}").replace("{n}", String(stepIndex + 1)).replace("{total}", String(workflow.steps.length)) : "";
  const who = member?.name || step?.memberId || "";
  const summary = step?.prompt ? step.prompt.replace(/\s+/g, " ").slice(0, 160) : "";

  return (
    <div className={cn("flex flex-col gap-2 border-t border-border/70 pt-3 text-sm", className)} role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <WorkflowTag workflow={workflow} run={run} copy={copy} />
        <span className="font-medium">{copy.workflowRunWaiting || "Waiting for approval"}</span>
        {stepLabel ? <span className="text-xs text-muted-foreground">{stepLabel}</span> : null}
      </div>
      {summary ? (
        <p className="text-sm text-muted-foreground">
          {who ? <span className="font-medium text-foreground/90">{who}: </span> : null}
          {summary}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onApprove?.(run)}>
          <Check data-icon="inline-start" />
          {copy.approve || "Approve"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDecline?.(run)}>
          <X data-icon="inline-start" />
          {copy.decline || "Decline"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {(copy.workflowApprovalEmojiHint || "or react {emoji} to this message").replace("{emoji}", run.pendingApproval.emoji)}
        </span>
      </div>
    </div>
  );
}

export default WorkflowRunMessage;
