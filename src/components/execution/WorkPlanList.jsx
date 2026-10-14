import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dueLabel, isOpenWorkTask, relativeAge, workDotStatus, workStatusWord } from "@/lib/work-plans";
import { cn } from "@/lib/utils";

import { EmptyLine, GroupLabel, StatusDot, StatusWord } from "./bits";

/**
 * The member's own plan (ADR-0124) in the Tasks tab: the tasks it added for
 * itself, the ones you added for it, and the recurring item a routine keeps.
 * Same row grammar as the launched tasks under it: dot, title, dot-and-word
 * status, one muted line. Actions are text, revealed on hover: Done, Edit,
 * Remove, and "Ask <member> to work on it", which sends a message.
 *
 *   tasks       bridge tasks for this member
 *   member      the member (name for the Ask action)
 *   onCreate    (input) => Promise
 *   onUpdate    (id, patch) => Promise      (status: open|doing|blocked|done)
 *   onRemove    (id) => Promise
 *   onAsk       (text) => void              sends a chat message
 */
export function WorkPlanList({ tasks = [], member, copy = {}, now = Date.now(), onCreate, onUpdate, onRemove, onAsk }) {
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const open = tasks.filter(isOpenWorkTask).sort(byPlanOrder);
  const done = tasks.filter((task) => task.status === "done").sort((a, b) => String(b.doneAt || b.updatedAt || "").localeCompare(String(a.doneAt || a.updatedAt || ""))).slice(0, 6);
  const name = member?.name || copy.member || "the member";

  async function run(action) {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure?.message || copy.workSaveFailed || "Could not save this change. Try again.");
    }
  }

  return (
    <section data-testid="work-plan" aria-label={copy.workPlan || "Plan"}>
      <div className="flex items-baseline justify-between">
        <GroupLabel>{(copy.workPlanOf || "{name}'s plan").replace("{name}", name)}</GroupLabel>
        {!adding ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setAdding(true)}>
            {copy.workAdd || "Add a task"}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <TaskForm
          copy={copy}
          onCancel={() => setAdding(false)}
          onSave={(input) => run(async () => { await onCreate?.(input); setAdding(false); })}
        />
      ) : null}
      {!open.length && !adding ? (
        <EmptyLine>{(copy.workPlanEmpty || "Nothing planned yet. Tell {name} what to do, in plain English, and the plan appears here.").replace("{name}", name)}</EmptyLine>
      ) : (
        <div className="divide-y divide-border/70">
          {open.map((task) => (
            editing === task.id ? (
              <TaskForm
                key={task.id}
                task={task}
                copy={copy}
                onCancel={() => setEditing("")}
                onSave={(input) => run(async () => { await onUpdate?.(task.id, input); setEditing(""); })}
              />
            ) : (
              <PlanRow key={task.id} task={task} copy={copy} now={now} name={name} onEdit={() => setEditing(task.id)} onDone={() => run(() => onUpdate?.(task.id, { status: "done" }))} onStatus={(status) => run(() => onUpdate?.(task.id, { status }))} onRemove={() => run(() => onRemove?.(task.id))} onAsk={onAsk} />
            )
          ))}
        </div>
      )}
      {done.length ? (
        <>
          <GroupLabel>{copy.workDoneRecently || "Done"}</GroupLabel>
          <div className="divide-y divide-border/70">
            {done.map((task) => (
              <PlanRow key={task.id} task={task} copy={copy} now={now} name={name} finished onReopen={() => run(() => onUpdate?.(task.id, { status: "open" }))} onRemove={() => run(() => onRemove?.(task.id))} />
            ))}
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="pt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function byPlanOrder(a, b) {
  const order = { doing: 0, blocked: 1, open: 2 };
  const byStatus = (order[a.status] ?? 3) - (order[b.status] ?? 3);
  if (byStatus) return byStatus;
  return String(a.due || "9999").localeCompare(String(b.due || "9999")) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function sourceLabel(task, copy, name) {
  if (task.recurring) return copy.workRecurring || "recurring";
  if (task.source === "person") return copy.workAddedByYou || "you added it";
  if (task.source === "handoff") return copy.workHandedOff || "handed off";
  return (copy.workAddedByMember || "{name} added it").replace("{name}", name);
}

function PlanRow({ task, copy, now, name, finished = false, onEdit, onDone, onStatus, onRemove, onAsk, onReopen }) {
  const due = finished ? "" : dueLabel(task.due, { now, copy });
  const overdue = due.startsWith("overdue");
  const outcome = task.lastOutcome?.status ? `${copy.workLastRun || "last run"} ${task.lastOutcome.status}${task.lastOutcome.preview ? `: ${task.lastOutcome.preview}` : ""}` : task.outcome ? task.outcome : "";
  const meta = [due, sourceLabel(task, copy, name), outcome, relativeAge(finished ? task.doneAt || task.updatedAt : task.updatedAt, now)].filter(Boolean);
  return (
    <article className="group py-2.5" data-testid="work-task" data-status={task.status}>
      <div className="flex items-center gap-2.5">
        <StatusDot status={workDotStatus(task.status)} />
        <span className={cn("min-w-0 flex-1 truncate text-sm", finished ? "text-muted-foreground" : "text-foreground")}>{task.title}</span>
        <StatusWord status={workDotStatus(task.status)} label={workStatusWord(task.status, copy)} />
      </div>
      <p className={cn("mt-0.5 truncate pl-[1.125rem] text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>{meta.join(" · ")}</p>
      {task.detail ? <p className="mt-1 line-clamp-2 pl-[1.125rem] text-sm leading-6 text-muted-foreground">{task.detail}</p> : null}
      <div className="mt-1 flex flex-wrap gap-x-3 pl-[1.125rem] text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100">
        {finished ? (
          <TextAction onClick={onReopen}>{copy.workReopen || "Reopen"}</TextAction>
        ) : (
          <>
            <TextAction onClick={onDone}>{copy.workMarkDone || "Done"}</TextAction>
            {task.status !== "doing" ? <TextAction onClick={() => onStatus?.("doing")}>{copy.workStart || "Start"}</TextAction> : null}
            {task.status !== "blocked" ? <TextAction onClick={() => onStatus?.("blocked")}>{copy.workBlock || "Blocked"}</TextAction> : null}
            <TextAction onClick={onEdit}>{copy.edit || "Edit"}</TextAction>
            {onAsk ? <TextAction onClick={() => onAsk((copy.workAskPrompt || "Please work on this task from your plan now: {title}").replace("{title}", task.title))}>{(copy.workAsk || "Ask {name} to work on it").replace("{name}", name)}</TextAction> : null}
          </>
        )}
        <TextAction onClick={onRemove} tone="destructive">{copy.remove || "Remove"}</TextAction>
      </div>
    </article>
  );
}

function TextAction({ children, onClick, tone }) {
  return (
    <button type="button" onClick={onClick} className={cn("underline-offset-2 hover:underline focus-visible:underline", tone === "destructive" ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

function TaskForm({ task = null, copy = {}, onSave, onCancel }) {
  const [title, setTitle] = useState(task?.title || "");
  const [detail, setDetail] = useState(task?.detail || "");
  const [due, setDue] = useState(task?.due || "");
  const valid = title.trim().length > 0;
  function submit(event) {
    event.preventDefault();
    if (!valid) return;
    onSave?.({ title: title.trim(), detail: detail.trim(), due });
  }
  return (
    <form onSubmit={submit} className="space-y-2 py-3" data-testid="work-task-form">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.workTitlePlaceholder || "What has to be done"} aria-label={copy.workTitle || "Task"} autoFocus />
      <Textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder={copy.workDetailPlaceholder || "Detail (optional)"} aria-label={copy.workDetail || "Detail"} rows={2} className="min-h-[3.5rem]" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span>{copy.workDue || "Due"}</span>
          <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="h-8 w-auto text-xs" />
        </label>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onCancel}>
          {copy.cancel || "Cancel"}
        </Button>
        <Button type="submit" variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={!valid}>
          {task ? copy.save || "Save" : copy.workAddShort || "Add"}
        </Button>
      </div>
    </form>
  );
}
