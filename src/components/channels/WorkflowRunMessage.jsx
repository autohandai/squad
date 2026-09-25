import { Check, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { renderStepPrompt, runStatusLabel } from "@/lib/workflows";
import { cn } from "@/lib/utils";

/**
 * Small tag placed in the author line of a message a workflow posted
 * (`message.workflowRunId`). Quiet: an icon, the workflow name, and the step
 * position when the run knows it. With `showName={false}` (rows whose author
 * line already is the workflow) it shows only the position, or nothing.
 */
export function WorkflowTag({ workflow, run, stepId = "", showName = true, copy = {}, className }) {
  const name = workflow?.name || run?.workflowName || copy.workflow || "Workflow";
  const index = stepId && workflow?.steps ? workflow.steps.findIndex((step) => step.id === stepId) : -1;
  const position = index >= 0 ? (copy.workflowStepOf || "step {n} of {total}").replace("{n}", String(index + 1)).replace("{total}", String(workflow.steps.length)) : "";
  if (!showName && !position) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground", className)} title={position || undefined}>
      <Workflow className="size-3" aria-hidden="true" />
      {showName ? name : null}
      {position ? <span className={showName ? "font-normal" : undefined}>{showName ? `· ${position}` : position}</span> : null}
    </span>
  );
}

/**
 * The run's row in the channel stream. While the run waits at an approval
 * gate it shows "Waiting for approval", the step that is gated, Approve and
 * Decline, and the emoji hint; afterwards it collapses to one status line.
 *
 * `showName={false}` drops the name tag when the row's author line already
 * names the workflow, so it reads once: "Waiting for approval · step 1 of 1".
 *
 * Props: { run, workflow, members?, showName?, onApprove(run), onDecline(run), copy, className }
 */
export function WorkflowRunMessage({ run, workflow, members = [], showName = true, onApprove, onDecline, copy = {}, className }) {
  if (!run) return null;
  const waiting = run.status === "waiting_approval" && run.pendingApproval;
  const step = waiting ? workflow?.steps?.find((item) => item.id === run.pendingApproval.stepId) : null;
  const member = step ? members.find((item) => item.id === step.memberId) : null;
  const stepIndex = step && workflow?.steps ? workflow.steps.indexOf(step) : -1;

  if (!waiting) {
    const tone = run.status === "failed" ? "text-destructive" : run.status === "declined" ? "text-muted-foreground" : "text-muted-foreground";
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-xs", tone, className)} role="status">
        {showName ? <WorkflowTag workflow={workflow} run={run} copy={copy} /> : null}
        <span>{runStatusLabel(run.status, copy)}</span>
        {run.error ? <span className="truncate">· {run.error}</span> : null}
      </div>
    );
  }

  const stepLabel = stepIndex >= 0 ? (copy.workflowStepOf || "step {n} of {total}").replace("{n}", String(stepIndex + 1)).replace("{total}", String(workflow.steps.length)) : "";
  const who = member?.name || step?.memberId || "";
  // The prompt the member will actually receive: templates filled from the run.
  const summary = step?.prompt ? renderStepPrompt(step, run, workflow).replace(/\s+/g, " ").trim().slice(0, 160) : "";

  return (
    <div className={cn("flex flex-col gap-2 border-t border-border/70 pt-3 text-sm", className)} role="status" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {showName ? <WorkflowTag workflow={workflow} run={run} copy={copy} /> : null}
        <span className="font-medium">{copy.workflowRunWaiting || "Waiting for approval"}</span>
        {stepLabel ? <span className="text-xs text-muted-foreground">{showName ? stepLabel : `· ${stepLabel}`}</span> : null}
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
