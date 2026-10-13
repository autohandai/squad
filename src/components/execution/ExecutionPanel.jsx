import { useEffect, useState } from "react";

import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { executionSummary } from "@/lib/execution-panel";
import { cn } from "@/lib/utils";

import { AutomationList } from "./AutomationList";
import { HandoffDialog } from "./HandoffDialog";
import { RunList } from "./RunList";
import { NowList, TaskList } from "./TaskList";
import { TextTabs } from "./bits";

/**
 * The Execution panel (ADR-0117): a plain sheet beside the chat. Title, one
 * sentence saying only what is true now, a "Now" list of open tasks when
 * there are any, underlined text tabs, then one divider list per tab.
 *
 * Props are the chat integrator's state plus the app-level pieces the rows
 * need and cannot import from a component file:
 *
 *   AgentAvatar  the app's avatar component ({ agent, className })
 *   api          the bridge client (path, options) => data
 *   format       { statusLabel(status, copy), date(iso), schedule(automation),
 *                  workspaceName(path), role(agent), whyAgent(agent) }
 */
export function ExecutionPanel({
  agents = [],
  activeAgent,
  tasks = [],
  runs = [],
  automations = [],
  setAutomations,
  runAutomation,
  activeTab = "runs",
  setActiveTab,
  focusRunId = "",
  copy = {},
  locale = "en-US",
  handoffRetryMode = "checkpoint",
  AgentAvatar,
  api,
  format = {},
  onCreateHandoff,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
}) {
  const [handoffSource, setHandoffSource] = useState(null);
  // One clock for the relative times, ticking while the sheet is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const summary = executionSummary({ runs, tasks, copy });
  const tabs = [
    { id: "runs", label: copy.runs || "Runs" },
    { id: "tasks", label: copy.tasks || "Tasks" },
    { id: "automations", label: copy.automations || "Automations" },
  ];

  function openTaskHandoff(task, handoff = null) {
    setHandoffSource({ type: "task", task, handoff, sourceAgentId: task.currentOwnerId || task.agentId });
  }

  function openRunHandoff(run) {
    const linkedTask = tasks.find((task) => task.runtimeId === run.id);
    setHandoffSource({ type: "run", run, task: linkedTask, sourceAgentId: run.agentId || activeAgent?.id });
  }

  function saveHandoff(draft) {
    onCreateHandoff?.(handoffSource, draft);
    setHandoffSource(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="execution-panel">
      <SheetHeader className="gap-0.5 px-5 pb-0 pt-5 pr-12">
        <SheetTitle className="text-base">{copy.execution || "Execution"}</SheetTitle>
        <SheetDescription className="sr-only">{copy.executionDescription || "Runs, tasks and automations for this member."}</SheetDescription>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {summary.map((part, index) => (
            <span key={part.text} className={cn(part.tone === "destructive" && "text-destructive")}>
              {index ? " · " : ""}
              {part.text}
            </span>
          ))}
        </p>
      </SheetHeader>
      <NowList tasks={tasks} agents={agents} copy={copy} statusLabel={format.statusLabel} />
      <TextTabs tabs={tabs} value={activeTab} onChange={setActiveTab} label={copy.execution || "Execution"} className="mx-5 mt-3" />
      {/* A plain scrolling column: the ScrollArea primitive lays its content out
          as a table, which keeps a long title from truncating and lets a
          scrollIntoView shift the list sideways. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-5 pb-6" role="tabpanel">
          {activeTab === "tasks" ? (
            <TaskList
              tasks={tasks}
              agents={agents}
              copy={copy}
              handoffRetryMode={handoffRetryMode}
              statusLabel={format.statusLabel}
              formatDate={format.date}
              onHandoff={openTaskHandoff}
              onCancelHandoff={onCancelHandoff}
              onFailHandoff={onFailHandoff}
              onRetryHandoff={onRetryHandoff}
            />
          ) : activeTab === "automations" ? (
            <AutomationList
              automations={automations}
              setAutomations={setAutomations}
              runAutomation={runAutomation}
              copy={copy}
              scheduleLabel={format.schedule}
              workspaceName={format.workspaceName}
            />
          ) : (
            <RunList
              runs={runs}
              tasks={tasks}
              agents={agents}
              copy={copy}
              locale={locale}
              now={now}
              AgentAvatar={AgentAvatar}
              api={api}
              onHandoff={openRunHandoff}
              focusRunId={focusRunId}
            />
          )}
        </div>
      </div>
      <HandoffDialog
        open={Boolean(handoffSource)}
        source={handoffSource}
        agents={agents}
        activeAgent={activeAgent}
        copy={copy}
        roleLabel={format.role}
        whyAgent={format.whyAgent}
        onOpenChange={(open) => !open && setHandoffSource(null)}
        onSave={saveHandoff}
      />
    </div>
  );
}
