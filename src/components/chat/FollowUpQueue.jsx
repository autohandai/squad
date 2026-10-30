// The follow-up list above the composer, as a view of the bridge-owned member
// queue (ADR-0111). Pure presentation: the integrator passes the queue and
// the handlers that call /api/queues. Divider rows, no cards; status is a dot.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, LayoutList, PencilLine, Send, Trash2, X, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isQueueRunning, queueItemStatusLabel, queuedItems, runningQueueItem } from "@/lib/member-queue";
import { AttachmentList } from "@/components/chat/Attachments";

function StatusDot({ status }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "running" ? "animate-pulse bg-primary" : "bg-muted-foreground/45"
      )}
    />
  );
}

function IconAction({ label, onClick, disabled, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * @param {object} props
 * @param {object} props.queue      `{ paused, pauseReason, items }` from the bridge
 * @param {object} props.copy       locale block (English fallbacks inline)
 * @param {boolean} props.compact   quick-chat layout: count plus controls, shorter rows
 * @param {boolean} props.busy      a control call is in flight
 * @param {string} props.error      last control error, shown under the header
 * @param {function} props.onEdit   (id, text)
 * @param {function} props.onMove   (id, delta)
 * @param {function} props.onCancel (id)
 * @param {function} props.onSendNow (item) cancel it and send it immediately
 * @param {function} props.onPause  ()
 * @param {function} props.onResume ()
 */
export function FollowUpQueue({ queue, copy = {}, compact = false, busy = false, error = "", onEdit, onMove, onCancel, onSendNow, onPause, onResume }) {
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");
  const items = queuedItems(queue);
  const running = runningQueueItem(queue);
  const editingItem = items.find((item) => item.id === editingId);

  useEffect(() => {
    if (editingId && !editingItem) { setEditingId(""); setDraft(""); }
  }, [editingId, editingItem]);

  if (!items.length && !running && !queue?.paused) return null;

  function startEdit(item) { setEditingId(item.id); setDraft(item.text); }
  function cancelEdit() { setEditingId(""); setDraft(""); }
  function saveEdit() {
    if (!editingId) return;
    const text = draft.trim();
    if (text) onEdit?.(editingId, text); else onCancel?.(editingId);
    cancelEdit();
  }

  const title = copy.queuedFollowups || "Queued follow-ups";
  const pauseLabel = copy.queuePause || "Pause";
  const resumeLabel = copy.queueResume || "Resume";
  const count = items.length + (running ? 1 : 0);

  return (
    <div className="border-b bg-background/30" data-queued-followups data-queue-paused={queue?.paused ? "true" : "false"} data-queue-count={items.length}>
      <div className={cn("flex min-h-9 items-center justify-between gap-3 px-3 text-xs text-muted-foreground", compact ? "py-1.5" : "py-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <LayoutList className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium text-foreground/80">{title}</span>
          <span className="tabular-nums" aria-label={`${count} queued`}>{count}</span>
          {queue?.paused ? <span className="truncate">· {copy.queuePaused || "Paused"}</span> : isQueueRunning(queue) ? <span className="truncate">· {copy.queueItemRunning || "Running"}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {queue?.paused ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => onResume?.()}>{resumeLabel}</Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => onPause?.()}>{pauseLabel}</Button>
          )}
        </div>
      </div>
      {queue?.paused && queue.pauseReason && !compact ? <p className="px-3 pb-2 text-xs text-muted-foreground">{queue.pauseReason}</p> : null}
      {error ? <p role="alert" className="px-3 pb-2 text-xs text-destructive">{error}</p> : null}
      <div className="divide-y divide-border/70">
        {running ? (
          <div className={cn("grid items-center gap-2 px-3 [grid-template-columns:auto_minmax(0,1fr)_auto]", compact ? "min-h-9 py-1.5" : "min-h-11 py-2")} data-queue-item={running.id} data-queue-status="running">
            <StatusDot status="running" />
            <span className="min-w-0 truncate text-sm text-foreground/88">{running.text}</span>
            <span className="text-xs text-muted-foreground">{queueItemStatusLabel(running, copy)}</span>
          </div>
        ) : null}
        {items.map((item, index) => {
          const editing = item.id === editingId;
          return (
            <div key={item.id} className={cn("grid items-center gap-2 px-3 [grid-template-columns:auto_minmax(0,1fr)_auto]", compact ? "min-h-9 py-1.5" : "min-h-11 py-2")} data-queue-item={item.id} data-queue-status={item.status}>
              <StatusDot status={item.status} />
              {editing ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); saveEdit(); }
                    if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
                  }}
                  className="h-8 border-0 bg-background/70 px-2 text-sm shadow-none focus-visible:ring-2"
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate rounded-sm text-left text-sm text-foreground/88 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  onClick={() => startEdit(item)}
                >
                  {item.text}
                </button>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {!compact ? <span className="mr-1 hidden text-[11px] text-muted-foreground sm:inline">{index === 0 ? copy.nextQueuedFollowup || "Next" : `#${index + 1}`}</span> : null}
                {editing ? (
                  <>
                    <IconAction label={copy.saveQueuedFollowup || "Save queued follow-up"} onClick={saveEdit}><CheckCircle2 /></IconAction>
                    <IconAction label={copy.cancelQueuedEdit || "Cancel edit"} onClick={cancelEdit}><X /></IconAction>
                  </>
                ) : (
                  <>
                    <IconAction label={copy.queueMoveUp || "Move up"} disabled={busy || index === 0} onClick={() => onMove?.(item.id, -1)}><ArrowUp /></IconAction>
                    <IconAction label={copy.queueMoveDown || "Move down"} disabled={busy || index === items.length - 1} onClick={() => onMove?.(item.id, 1)}><ArrowDown /></IconAction>
                    {onSendNow && !compact ? <IconAction label={copy.queueSendNow || "Send now (interrupts the current reply)"} disabled={busy} onClick={() => onSendNow(item)}><Send /></IconAction> : null}
                    {!compact ? <IconAction label={copy.editQueuedFollowup || "Edit queued follow-up"} disabled={busy} onClick={() => startEdit(item)}><PencilLine /></IconAction> : null}
                    <IconAction label={copy.removeQueuedFollowup || "Remove queued follow-up"} disabled={busy} onClick={() => onCancel?.(item.id)}><Trash2 /></IconAction>
                  </>
                )}
              </div>
              <AttachmentList files={item.attachments || []} className="col-span-2 col-start-2" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
