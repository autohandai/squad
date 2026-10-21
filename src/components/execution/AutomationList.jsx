import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { EmptyLine, StatusDot } from "./bits";
import { routineNextLabel } from "@/lib/routines";

/**
 * Automations tab: one divider row per automation — name, the schedule in
 * words and the workspace in muted text, the enabled switch and a text
 * "Run now". Same rows as the Automations page, no card.
 */
export function AutomationList({ automations = [], setAutomations, onRoutineSync, runAutomation, copy = {}, scheduleLabel, workspaceName }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  async function toggle(automation) {
    setError(""); setPending(automation.id);
    const patch = { ...automation, status: automation.status === "active" ? "paused" : "active" };
    try {
      if (onRoutineSync) await onRoutineSync(patch);
      setAutomations?.(current => current.map(item => item.id === patch.id ? patch : item));
    } catch (problem) { setError(problem.message); }
    finally { setPending(""); }
  }
  if (!automations.length) {
    return <EmptyLine>{copy.automationsAppearHere || "Automations you set up for this member appear here."}</EmptyLine>;
  }
  return (
    <div className="divide-y divide-border/70" data-testid="execution-automations">
      {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}</p> : null}
      {automations.map((automation) => {
        const active = automation.status === "active";
        return (
          <div key={automation.id} className="flex items-center gap-3 py-3">
            <StatusDot status={active ? "online" : "paused"} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{automation.name}</div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[scheduleLabel ? scheduleLabel(automation) : automation.schedule, workspaceName ? workspaceName(automation.workspace) || automation.target : automation.target]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {automation.record ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{[routineNextLabel(automation.record), automation.record.lastRun?.preview, automation.record.needsApp ? "Needs Squad open" : ""].filter(Boolean).join(" · ")}</p> : null}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => runAutomation?.(automation)}>
              {copy.runNow || "Run now"}
            </Button>
            <Switch
              checked={active}
              disabled={pending === automation.id}
              aria-label={automation.name}
              onCheckedChange={() => void toggle(automation)}
            />
          </div>
        );
      })}
    </div>
  );
}
