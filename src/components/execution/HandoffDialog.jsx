import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { compactRecordId } from "@/lib/execution-panel";
import { normalizeSquadMemberId } from "@/lib/member-roster";

/** Members who could take the work, best fit first, by role. */
export function recommendedHandoffTargets(source, agents = [], activeAgent, whyAgent) {
  const sourceAgentId = normalizeSquadMemberId(source?.sourceAgentId || source?.task?.currentOwnerId || source?.task?.agentId || activeAgent?.id);
  const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || activeAgent;
  const role = String(sourceAgent?.role || sourceAgent?.employeeType || "").toLowerCase();
  const preferredRoles = role.includes("qa")
    ? ["frontend", "full stack", "backend"]
    : role.includes("frontend")
      ? ["qa", "solution", "devops"]
      : role.includes("backend")
        ? ["qa", "security", "devops"]
        : ["qa", "frontend", "devops"];
  return agents
    .filter((agent) => agent.id !== sourceAgentId)
    .map((agent) => {
      const targetRole = `${agent.role || ""} ${agent.employeeType || ""}`.toLowerCase();
      const score = preferredRoles.findIndex((preferred) => targetRole.includes(preferred));
      return { agent, recommended: score >= 0, score: score >= 0 ? score : 99, recommendation: whyAgent?.(agent) || "" };
    })
    .sort((left, right) => left.score - right.score || String(left.agent.name).localeCompare(String(right.agent.name)));
}

/**
 * Hand a task or a run to another member. The source is one line of text
 * under the title, never a boxed summary; the form is label-and-field rows.
 *
 *   source     { type: "task" | "run", task?, run?, handoff?, sourceAgentId? }
 *   roleLabel  (agent) => the member's role in the current language
 *   whyAgent   (agent) => one sentence on why this member fits
 */
export function HandoffDialog({ open, source, agents = [], activeAgent, copy = {}, roleLabel, whyAgent, onOpenChange, onSave }) {
  const sourceTask = source?.task;
  const sourceRun = source?.run;
  const sourceHandoff = source?.handoff;
  const sourceAgentId = normalizeSquadMemberId(source?.sourceAgentId || sourceTask?.currentOwnerId || sourceTask?.agentId || sourceRun?.agentId || activeAgent?.id);
  const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || activeAgent;
  const targets = recommendedHandoffTargets(source, agents, activeAgent, whyAgent);
  const firstTarget = targets[0]?.agent;
  const [draft, setDraft] = useState({ targetAgentId: "", reason: "", requiredContext: "", expectedOutput: "", sourceEvidence: "" });

  useEffect(() => {
    if (!open) return;
    const defaultEvidence = sourceRun
      ? `Run ${sourceRun.id?.slice(0, 8) || "unknown"} / ${sourceRun.status || "status unknown"} / ${sourceRun.workspace || "workspace"}`
      : sourceTask?.runtimeId
        ? `Runtime ${sourceTask.runtimeId}`
        : sourceTask?.project || "";
    setDraft({
      targetAgentId: sourceHandoff?.toAgentId || firstTarget?.id || "",
      reason: sourceHandoff?.failureReason ? `Retry after blocked handoff: ${sourceHandoff.failureReason}` : sourceHandoff?.reason || "",
      requiredContext: sourceHandoff?.requiredContext || sourceTask?.summary || sourceRun?.command || sourceRun?.title || "",
      expectedOutput: sourceHandoff?.expectedOutput || "Inspect the preserved context, continue the same parent task, and report evidence.",
      sourceEvidence: sourceHandoff?.sourceEvidence || defaultEvidence,
    });
  }, [open, sourceHandoff, sourceRun, sourceTask, firstTarget?.id]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event) {
    event.preventDefault();
    if (!draft.targetAgentId || draft.targetAgentId === sourceAgentId) return;
    onSave?.(draft);
  }

  const selectedTarget = agents.find((agent) => agent.id === draft.targetAgentId);
  const selectedRecommendation = selectedTarget ? whyAgent?.(selectedTarget) || "" : "";
  const validTargets = targets.length > 0;
  const sourceLine = [
    `From ${sourceAgent?.name || "current owner"}`,
    selectedTarget ? `to ${selectedTarget.name}` : "",
    sourceTask ? `parent ${compactRecordId(sourceTask.id)}` : "",
    sourceRun ? `run ${compactRecordId(sourceRun.id)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.close || "Close"} className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{copy.handoffTitle || "Handoff parent task"}</DialogTitle>
          <DialogDescription>{copy.handoffDescription || "Keep the same parent task and create a child assignment for the receiving squad member."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="grid gap-5 p-6">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{sourceTask?.title || sourceRun?.title || copy.runHandoff || "Run handoff"}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{sourceLine}</p>
            </div>

            <Field>
              <FieldLabel>{copy.nextSquadMember || "Next squad member"}</FieldLabel>
              <Select value={draft.targetAgentId} onValueChange={(targetAgentId) => updateDraft({ targetAgentId })} disabled={!validTargets}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={copy.chooseReceivingMember || "Choose receiving squad member"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{copy.onlineSquadMembers || "Online squad members"}</SelectLabel>
                    {targets.map(({ agent, recommended }) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} / {roleLabel ? roleLabel(agent) : agent.role}
                        {recommended ? ` / ${copy.recommended || "recommended"}` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {copy.handoffRecommendationNote || "Recommendations do not require user confirmation by default; saved recipes or automations can add approval rules later."}
              </FieldDescription>
              {selectedRecommendation ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  <span className="font-medium text-foreground">{copy.whyThisAgent || "Why this member?"}</span> {selectedRecommendation}
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel>{copy.reason || "Reason"}</FieldLabel>
              <Input value={draft.reason} onChange={(event) => updateDraft({ reason: event.target.value })} placeholder={copy.handoffReasonPlaceholder || "Why this squad member should take over"} />
            </Field>

            <Field>
              <FieldLabel>{copy.requiredContext || "Required context"}</FieldLabel>
              <Textarea
                value={draft.requiredContext}
                onChange={(event) => updateDraft({ requiredContext: event.target.value })}
                className="min-h-24 resize-y"
                placeholder={copy.handoffContextPlaceholder || "What the receiving member needs to know"}
              />
            </Field>

            <Field>
              <FieldLabel>{copy.expectedOutput || "Expected output"}</FieldLabel>
              <Textarea
                value={draft.expectedOutput}
                onChange={(event) => updateDraft({ expectedOutput: event.target.value })}
                className="min-h-20 resize-y"
                placeholder={copy.handoffOutputPlaceholder || "What the receiving member should produce"}
              />
            </Field>

            <Field>
              <FieldLabel>{copy.sourceEvidence || "Source evidence"}</FieldLabel>
              <Textarea
                value={draft.sourceEvidence}
                onChange={(event) => updateDraft({ sourceEvidence: event.target.value })}
                className="min-h-20 resize-y font-mono text-sm"
                placeholder={copy.handoffEvidencePlaceholder || "Run IDs, files, screenshots, logs, findings"}
              />
            </Field>
          </div>
          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-6 py-4 backdrop-blur">
            <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)}>
              {copy.cancel || "Cancel"}
            </Button>
            <Button type="submit" disabled={!draft.targetAgentId || draft.targetAgentId === sourceAgentId}>
              {copy.createHandoff || "Create handoff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
