import { useEffect, useMemo, useState } from "react";
import { Play, Plus, Trash2, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_APPROVAL_EMOJI,
  DEFAULT_TRIGGER_EMOJI,
  STEP_CONDITIONS,
  TRIGGER_TYPES,
  normalizeWorkflow,
  runStatusLabel,
  triggerSummary,
  validateWorkflow,
} from "@/lib/workflows";
import { cn } from "@/lib/utils";

/**
 * Channel settings › Workflows (ADR-0021). A divider list of the channel's
 * workflows (trigger summary, last run, enabled switch) and an editor drawer
 * for name, trigger, steps and approval gates. The component owns only its
 * draft; saving, deleting, toggling and manual runs are the caller's.
 *
 * Props: { workflows, members, onSave(workflow), onDelete(id), onToggle(id, enabled), onRunNow(id), copy, className }
 */
export function WorkflowsSettings({ workflows = [], members = [], onSave, onDelete, onToggle, onRunNow, copy = {}, className }) {
  const [editing, setEditing] = useState(null); // null | { id: "" (new) | workflow id }

  const editingWorkflow = useMemo(() => (editing?.id ? workflows.find((item) => item.id === editing.id) || null : null), [editing, workflows]);

  return (
    <section className={cn("flex flex-col gap-2", className)} aria-labelledby="channel-workflows-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span id="channel-workflows-heading" className="block text-sm font-medium">
            {copy.workflows || "Workflows"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {copy.workflowsDetail || "Start members from a message, a reaction, a schedule or a webhook. A step can wait for your approval."}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => setEditing({ id: "" })}>
          <Plus data-icon="inline-start" />
          {copy.newWorkflow || "New"}
        </Button>
      </div>

      {workflows.length ? (
        <ul className="divide-y divide-border/60 text-sm">
          {workflows.map((workflow) => (
            <WorkflowRow key={workflow.id} workflow={workflow} copy={copy} onOpen={() => setEditing({ id: workflow.id })} onToggle={onToggle} onRunNow={onRunNow} />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-xs text-muted-foreground">{copy.workflowNoWorkflows || "No workflows yet."}</p>
      )}

      <WorkflowEditor
        key={editing ? editing.id || "new" : "closed"}
        open={editing !== null}
        workflow={editingWorkflow}
        members={members}
        copy={copy}
        onClose={() => setEditing(null)}
        onSave={(draft) => {
          onSave?.(draft);
          setEditing(null);
        }}
        onDelete={
          editingWorkflow
            ? () => {
                onDelete?.(editingWorkflow.id);
                setEditing(null);
              }
            : null
        }
      />
    </section>
  );
}

function WorkflowRow({ workflow, copy, onOpen, onToggle, onRunNow }) {
  const lastRun = workflow.runs?.length ? workflow.runs[workflow.runs.length - 1] : null;
  const stepsLabel = (workflow.steps.length === 1 ? copy.workflowStepCountOne || "1 step" : copy.workflowStepCount || "{count} steps").replace("{count}", String(workflow.steps.length));
  return (
    <li className="flex items-center gap-2 py-2">
      <button type="button" className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" onClick={onOpen}>
        <span className={cn("block truncate font-medium", !workflow.enabled && "text-muted-foreground")}>{workflow.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {triggerSummary(workflow, copy)} · {stepsLabel}
          {lastRun ? ` · ${(copy.workflowLastRun || "Last run {status}").replace("{status}", runStatusLabel(lastRun.status, copy).toLowerCase())}` : ""}
        </span>
      </button>
      <Button variant="ghost" size="icon-xs" aria-label={(copy.workflowRunNow || "Run {name} now").replace("{name}", workflow.name)} onClick={() => onRunNow?.(workflow.id)} disabled={!workflow.enabled}>
        <Play />
      </Button>
      <Switch
        aria-label={(copy.workflowEnabled || "{name} enabled").replace("{name}", workflow.name)}
        checked={workflow.enabled !== false}
        onCheckedChange={(checked) => onToggle?.(workflow.id, checked === true)}
      />
    </li>
  );
}

function emptyStep(index) {
  return { id: `step_${Date.now().toString(36)}_${index}`, memberId: "", prompt: "", when: "always", approval: null };
}

function draftFrom(workflow) {
  if (!workflow) {
    return { name: "", enabled: true, trigger: { type: "message", pattern: "", emoji: DEFAULT_TRIGGER_EMOJI, cron: "0 9 * * 1-5", token: "" }, steps: [emptyStep(0)] };
  }
  const normalized = normalizeWorkflow(workflow);
  return {
    ...normalized,
    trigger: {
      type: normalized.trigger.type,
      pattern: normalized.trigger.pattern,
      emoji: normalized.trigger.emoji || DEFAULT_TRIGGER_EMOJI,
      cron: normalized.trigger.cron || "0 9 * * 1-5",
      token: normalized.trigger.token,
    },
    steps: normalized.steps.length ? normalized.steps : [emptyStep(0)],
  };
}

function WorkflowEditor({ open, workflow, members, copy, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(() => draftFrom(workflow));
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (open) setDraft(draftFrom(workflow));
  }, [open, workflow]);

  const problems = useMemo(() => validateWorkflow(draft), [draft]);
  const triggerLabels = {
    message: copy.workflowTriggerMessage || "A message matches",
    reaction: copy.workflowTriggerReaction || "Someone reacts",
    schedule: copy.workflowTriggerSchedule || "On a schedule",
    webhook: copy.workflowTriggerWebhook || "A webhook is called",
  };
  const whenLabels = {
    always: copy.workflowWhenAlways || "Always",
    previous_failed: copy.workflowWhenPreviousFailed || "Only if the previous step failed",
    previous_succeeded: copy.workflowWhenPreviousSucceeded || "Only if the previous step succeeded",
  };

  const setTrigger = (patch) => setDraft((current) => ({ ...current, trigger: { ...current.trigger, ...patch } }));
  const setStep = (index, patch) => setDraft((current) => ({ ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) }));

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Workflow className="size-4 text-muted-foreground" aria-hidden="true" />
            {workflow ? copy.editWorkflow || "Edit workflow" : copy.newWorkflowTitle || "New workflow"}
          </SheetTitle>
          <SheetDescription>{copy.workflowEditorDetail || "Steps run in order as messages from the chosen member. A gated step waits until you approve it."}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-5 pb-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-name">{copy.workflowName || "Name"}</Label>
            <Input id="workflow-name" value={draft.name} placeholder={copy.workflowNamePlaceholder || "Smoke suite on approval"} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <Label htmlFor="workflow-trigger">{copy.workflowTrigger || "Starts when"}</Label>
            <Select value={draft.trigger.type} onValueChange={(type) => setTrigger({ type })}>
              <SelectTrigger id="workflow-trigger" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {TRIGGER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {triggerLabels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {draft.trigger.type === "message" ? (
              <div className="flex flex-col gap-1.5">
                <Input value={draft.trigger.pattern} placeholder={copy.workflowPatternPlaceholder || "deploy   or   /^release\\b/i"} onChange={(event) => setTrigger({ pattern: event.target.value })} aria-label={copy.workflowPattern || "Pattern"} />
                <span className="text-xs text-muted-foreground">{copy.workflowPatternHint || "A word to look for, or a /regular expression/. Messages posted by this workflow never count."}</span>
              </div>
            ) : null}
            {draft.trigger.type === "reaction" ? (
              <div className="flex items-center gap-2">
                <Input className="w-16 text-center" value={draft.trigger.emoji} maxLength={4} onChange={(event) => setTrigger({ emoji: event.target.value })} aria-label={copy.workflowEmoji || "Emoji"} />
                <span className="text-xs text-muted-foreground">{copy.workflowEmojiHint || "Each reaction with this emoji starts one run."}</span>
              </div>
            ) : null}
            {draft.trigger.type === "schedule" ? (
              <div className="flex flex-col gap-1.5">
                <Input className="font-[family-name:var(--font-code)]" value={draft.trigger.cron} onChange={(event) => setTrigger({ cron: event.target.value })} aria-label={copy.workflowCron || "Cron"} aria-invalid={problems.includes("trigger.cron")} />
                <span className="text-xs text-muted-foreground">{copy.workflowCronHint || "Five-field cron, local time: minute hour day month weekday. 0 9 * * 1-5 is weekdays at 09:00."}</span>
              </div>
            ) : null}
            {draft.trigger.type === "webhook" ? (
              <div className="flex flex-col gap-1">
                <code className="truncate text-xs text-muted-foreground">{draft.trigger.token ? `POST /api/webhooks/${draft.trigger.token}` : copy.workflowWebhookPending || "A webhook address is assigned when you save."}</code>
                <span className="text-xs text-muted-foreground">{copy.workflowWebhookHint || "The JSON body is passed to the first step; a text or message field fills {{message}}."}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
            <span className="text-sm font-medium">{copy.workflowSteps || "Steps"}</span>
            <ol className="divide-y divide-border/60">
              {draft.steps.map((step, index) => (
                <li key={step.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>
                    <Select value={step.memberId} onValueChange={(memberId) => setStep(index, { memberId })}>
                      <SelectTrigger className="h-8 min-w-0 flex-1 text-sm" aria-label={copy.workflowStepMember || "Member"}>
                        <SelectValue placeholder={copy.workflowStepMemberPlaceholder || "Choose a member"} />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {members.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                            {member.role ? <span className="ml-1 text-muted-foreground">· {member.role}</span> : null}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={copy.workflowRemoveStep || "Remove step"}
                      disabled={draft.steps.length === 1}
                      onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((_, i) => i !== index) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-20 text-sm"
                    value={step.prompt}
                    placeholder={copy.workflowStepPromptPlaceholder || "Run the smoke suite and post the result. {{message}} is the triggering message, {{previous}} the previous step's result."}
                    onChange={(event) => setStep(index, { prompt: event.target.value })}
                    aria-label={copy.workflowStepPrompt || "Prompt"}
                  />
                  {index > 0 ? (
                    <Select value={step.when || "always"} onValueChange={(when) => setStep(index, { when })}>
                      <SelectTrigger className="h-8 w-full text-xs" aria-label={copy.workflowStepWhen || "Run this step"}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {STEP_CONDITIONS.map((when) => (
                          <SelectItem key={when} value={when}>
                            {whenLabels[when]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`approval-${step.id}`}>
                    <span className="min-w-0">
                      <span className="block">{copy.workflowRequiresApproval || "Requires approval"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {step.approval
                          ? (copy.workflowApprovalHint || "Waits until you click Approve or react {emoji} to the request.").replace("{emoji}", step.approval.emoji || DEFAULT_APPROVAL_EMOJI)
                          : copy.workflowApprovalOff || "Runs as soon as it is reached."}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {step.approval ? (
                        <Input
                          className="h-7 w-12 px-1 text-center text-sm"
                          value={step.approval.emoji}
                          maxLength={4}
                          onChange={(event) => setStep(index, { approval: { ...step.approval, emoji: event.target.value } })}
                          aria-label={copy.workflowApprovalEmoji || "Approval emoji"}
                        />
                      ) : null}
                      <Switch id={`approval-${step.id}`} checked={Boolean(step.approval)} onCheckedChange={(checked) => setStep(index, { approval: checked ? { by: "user", emoji: DEFAULT_APPROVAL_EMOJI } : null })} />
                    </span>
                  </label>
                </li>
              ))}
            </ol>
            <Button variant="ghost" size="sm" className="w-fit text-xs" onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, emptyStep(current.steps.length)] }))}>
              <Plus data-icon="inline-start" />
              {copy.workflowAddStep || "Add step"}
            </Button>
          </div>
        </div>

        <SheetFooter className="mt-auto flex-row items-center gap-2 border-t border-border/60 px-5 py-3">
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (!deleteArmed) {
                  setDeleteArmed(true);
                  return;
                }
                onDelete();
              }}
              onBlur={() => setDeleteArmed(false)}
            >
              {deleteArmed ? `${copy.workflowDelete || "Delete"}?` : copy.workflowDelete || "Delete"}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            {copy.cancel || "Cancel"}
          </Button>
          <Button size="sm" disabled={problems.length > 0} onClick={() => onSave(draft)}>
            {copy.workflowSave || "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default WorkflowsSettings;
