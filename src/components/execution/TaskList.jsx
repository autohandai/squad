import { Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { latestFailedHandoff, latestHandoff, latestPendingHandoff, taskOwner } from "@/lib/handoffs";
import { OPEN_TASK_STATUSES } from "@/lib/execution-panel";
import { cn } from "@/lib/utils";

import { EmptyLine, GroupLabel, StatusDot, StatusWord } from "./bits";

/**
 * "Now": the member's open tasks as a short divider list under the title.
 * Renders nothing when nothing is open, so a quiet member shows no strip.
 */
export function NowList({ tasks = [], agents = [], copy = {}, statusLabel, limit = 3 }) {
  const open = tasks.filter((task) => OPEN_TASK_STATUSES.has(task?.status)).slice(0, limit);
  if (!open.length) return null;
  return (
    <section className="px-5" aria-label={copy.executionNow || "Now"}>
      <GroupLabel className="pt-3">{copy.executionNow || "Now"}</GroupLabel>
      <div className="divide-y divide-border/70 border-b border-border/70">
        {open.map((task) => {
          const owner = taskOwner(task, agents);
          return (
            <div key={task.id} className="flex items-center gap-2.5 py-2 text-sm">
              <StatusDot status={task.status} />
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{owner?.name || task.currentOwnerId || copy.unassigned || "unassigned"}</span>
              <StatusWord status={task.status} label={statusLabel?.(task.status, copy) || task.status} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Tasks tab: divider rows with the same grammar as Needs you — what it is,
 * one line of detail, a dot-and-word status. A handoff is an indented block
 * of plain text with its decisions as small buttons; no tinted box.
 */
export function TaskList({
  tasks = [],
  agents = [],
  copy = {},
  handoffRetryMode = "checkpoint",
  statusLabel,
  formatDate,
  onHandoff,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
  silentEmpty = false,
}) {
  if (!tasks.length) {
    // Under the member's plan the empty sentence would be a second one (ADR-0124).
    return silentEmpty ? null : <EmptyLine>{copy.tasksAppearAfterHandoff || "Tasks appear here once work is launched or handed to this member."}</EmptyLine>;
  }
  return (
    <div className="divide-y divide-border/70" data-testid="execution-tasks">
      {tasks.map((task) => {
        const owner = taskOwner(task, agents);
        const handoff = latestHandoff(task);
        const pendingHandoff = latestPendingHandoff(task);
        const failedHandoff = latestFailedHandoff(task);
        const fromAgent = agents.find((agent) => agent.id === handoff?.fromAgentId);
        const toAgent = agents.find((agent) => agent.id === handoff?.toAgentId);
        const assignments = Array.isArray(task.assignments) ? task.assignments.length : 0;
        return (
          <article key={task.id} className="group py-3">
            <div className="flex items-center gap-2.5">
              <StatusDot status={task.status} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
              <StatusWord status={task.status} label={statusLabel?.(task.status, copy) || task.status} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={copy.handoff || "Handoff"}
                title={copy.handoff || "Handoff"}
                onClick={() => onHandoff?.(task)}
              >
                <Workflow className="size-3.5" />
              </Button>
            </div>
            <p className="mt-0.5 truncate pl-[1.125rem] text-xs text-muted-foreground">
              {[
                owner?.name || task.currentOwnerId || task.agentId || copy.unassigned || "unassigned",
                task.project || "",
                assignments ? `${assignments} ${assignments === 1 ? copy.assignment || "assignment" : copy.assignments || "assignments"}` : "",
                formatDate ? formatDate(task.updatedAt) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {task.summary ? <p className="mt-1.5 line-clamp-2 pl-[1.125rem] text-sm leading-6 text-muted-foreground">{task.summary}</p> : null}

            {handoff ? (
              <div className="mt-2 ml-[1.125rem] border-l border-border/80 pl-3">
                <p className="text-sm">
                  <span className="font-medium">{fromAgent?.name || copy.source || "Source"}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="font-medium">{toAgent?.name || copy.target || "Target"}</span>
                  <span className={cn("ml-2 text-xs", handoff.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                    {statusLabel?.(handoff.status, copy) || handoff.status}
                    {handoff.attempt > 1 ? ` · attempt ${handoff.attempt}` : ""}
                  </span>
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{handoff.reason || copy.noReasonProvided || "No reason provided."}</p>
                {handoff.failureReason ? <p className="mt-1 text-xs text-destructive">{handoff.failureReason}</p> : null}
                {pendingHandoff || failedHandoff ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pendingHandoff ? (
                      <>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onCancelHandoff?.(task, pendingHandoff)}>
                          {copy.cancel || "Cancel"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onHandoff?.(task, pendingHandoff)}>
                          {copy.reroute || "Reroute"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onFailHandoff?.(task, pendingHandoff)}>
                          {copy.markBlocked || "Mark blocked"}
                        </Button>
                      </>
                    ) : null}
                    {failedHandoff && handoffRetryMode === "checkpoint" ? (
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onRetryHandoff?.(task, failedHandoff)}>
                        {copy.retryCheckpoint || "Retry checkpoint"}
                      </Button>
                    ) : null}
                    {failedHandoff && handoffRetryMode === "manual" ? (
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onHandoff?.(task, failedHandoff)}>
                        {copy.rerouteManually || "Reroute manually"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <TaskTimelinePreview task={task} agents={agents} formatDate={formatDate} />
          </article>
        );
      })}
    </div>
  );
}

function TaskTimelinePreview({ task, agents = [], formatDate }) {
  const timeline = Array.isArray(task.timeline) ? task.timeline.slice(-4) : [];
  if (!timeline.length) return null;
  return (
    <div className="mt-2 ml-[1.125rem] border-l border-border/80 pl-3">
      {timeline.map((event) => {
        const actor = agents.find((agent) => agent.id === event.actorAgentId);
        const target = agents.find((agent) => agent.id === event.targetAgentId);
        return (
          <div key={event.id || `${event.type}-${event.at}`} className="pb-2 last:pb-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{event.type?.replaceAll(".", " ") || "timeline"}</span>
              {formatDate ? <span>{formatDate(event.at)}</span> : null}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {event.summary}
              {target && target.id !== actor?.id ? ` Current target: ${target.name}.` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
