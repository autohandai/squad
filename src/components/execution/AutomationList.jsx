import { useState } from "react";
import { Play, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

import { StatusDot } from "./bits";
import { automationTriggerWords, routineLastRunLabel, routineNextLabel } from "@/lib/routines";

/**
 * Automations tab (ADR-0117, ADR-0254): a quiet header line with New
 * automation, then one divider row per automation — the name (opens the
 * editor), the trigger in words and the folder, one muted line with what
 * happens next and how the last run went, a Run now text button and the
 * enabled switch. Run now goes through the same bridge path as a scheduled
 * or webhook start and then shows the Runs tab, where the run appears.
 * Empty, the tab says how automations start and offers the same button.
 */
export function AutomationList({ automations = [], setAutomations, onRoutineSync, runAutomation, onNewAutomation, onEditAutomation, onRunStarted, memberName = "", copy = {}, scheduleLabel, workspaceName }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [starting, setStarting] = useState("");

  async function toggle(automation) {
    setError(""); setPending(automation.id);
    const patch = { ...automation, status: automation.status === "active" ? "paused" : "active" };
    try {
      if (onRoutineSync) await onRoutineSync(patch);
      setAutomations?.(current => current.map(item => item.id === patch.id ? patch : item));
    } catch (problem) { setError(problem.message); }
    finally { setPending(""); }
  }

  async function runNow(automation) {
    if (!runAutomation || starting) return;
    setError(""); setStarting(automation.id);
    try {
      await runAutomation(automation);
      onRunStarted?.(automation);
    } catch (problem) { setError(problem?.message || `Could not start ${automation.name}.`); }
    finally { setStarting(""); }
  }

  const who = memberName || "this member";
  const newButton = onNewAutomation ? (
    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onNewAutomation()} data-testid="execution-new-automation">
      <Plus className="size-3.5" aria-hidden="true" />
      {copy.newAutomation || "New automation"}
    </Button>
  ) : null;

  if (!automations.length) {
    return (
      <div className="flex flex-col items-start gap-3 py-6" data-testid="execution-automations-empty">
        <div className="grid gap-1">
          <p className="text-sm text-foreground">{(copy.automationsEmptyTitle || "Nothing runs on its own for {name} yet.").replace("{name}", who)}</p>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            {copy.automationsEmptyHint || "Ask in chat, “remind me every weekday at 9am to check the inbox”, or set one up here. A schedule or a webhook can start it."}
          </p>
        </div>
        {newButton ? <Button type="button" variant="outline" size="sm" onClick={() => onNewAutomation()} data-testid="execution-new-automation">
          <Plus data-icon="inline-start" />
          {copy.newAutomation || "New automation"}
        </Button> : null}
      </div>
    );
  }

  const paused = automations.filter(item => item.status !== "active").length;
  return (
    <div data-testid="execution-automations">
      <div className="flex items-center justify-between gap-3 pb-1 pt-3">
        <p className="text-xs text-muted-foreground">
          {automations.length} {automations.length === 1 ? "automation" : "automations"}{paused ? ` · ${paused} paused` : ""}
        </p>
        {newButton}
      </div>
      {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}</p> : null}
      <div className="divide-y divide-border/70">
        {automations.map((automation) => {
          const active = automation.status === "active";
          const record = automation.record;
          const live = record?.activeRun;
          const trigger = automation.triggerType === "webhook" || automation.record ? automationTriggerWords(automation) : scheduleLabel ? scheduleLabel(automation) : automation.schedule;
          const folder = workspaceName ? workspaceName(automation.workspace) || automation.target : automation.target;
          const meta = record ? [routineNextLabel(record), routineLastRunLabel(record), record.needsApp ? "Needs Squad open" : ""].filter(Boolean) : [];
          return (
            <div key={automation.id} className="flex items-start gap-3 py-3" data-testid="execution-automation-row">
              <StatusDot status={live ? "running" : active ? "online" : "paused"} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                {onEditAutomation ? (
                  <button type="button" className="block max-w-full truncate text-left text-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={() => onEditAutomation(automation)}>
                    {automation.name}
                  </button>
                ) : <div className="truncate text-sm text-foreground">{automation.name}</div>}
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{[trigger, folder].filter(Boolean).join(" · ")}</p>
                {meta.length ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                disabled={Boolean(starting) || Boolean(live)}
                aria-label={`${copy.runNow || "Run now"}: ${automation.name}`}
                onClick={() => void runNow(automation)}
              >
                {starting === automation.id ? <Spinner className="size-3.5" /> : <Play className="size-3.5" aria-hidden="true" />}
                {starting === automation.id ? copy.automationStarting || "Starting…" : live ? copy.automationRunning || "Running" : copy.runNow || "Run now"}
              </Button>
              <Switch
                checked={active}
                disabled={pending === automation.id}
                aria-label={automation.name}
                onCheckedChange={() => void toggle(automation)}
                className="mt-0.5"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
