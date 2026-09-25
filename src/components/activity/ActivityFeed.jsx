import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { collapseActivity } from "@/lib/activity";
import { cn } from "@/lib/utils";

/**
 * Semantic activity feed: one divider-separated row per action, keyed by the
 * item id so a row updates in place as its state moves from pending to done
 * or failed. Runs of quiet rows (reads, searches, thoughts, status) collapse
 * into one "read 12 files" summary row that expands on click. Failed rows use
 * the destructive colour and open their detail. "Raw" swaps the feed for the
 * unprocessed trace list the caller passes in `raw`.
 *
 * Props
 *   items        ActivityItem[] from normalizeActivity / activityFromTrace
 *   raw          the raw list: log lines { source, line, at } or events { type, ... }
 *   showRaw      controlled: render `raw` instead of the feed
 *   onToggleRaw  called when the Raw / Feed text control is pressed; when
 *                omitted the control is hidden (the parent owns the setting)
 *   copy         locale strings (activityRaw, activityFeed, activityEmpty, activityPending)
 *   className
 */
export function ActivityFeed({ items = [], raw = [], showRaw = false, onToggleRaw, copy = {}, className }) {
  const rows = useMemo(() => collapseActivity(items), [items]);
  const rawList = Array.isArray(raw) ? raw : [];
  const canToggle = typeof onToggleRaw === "function";

  return (
    <div className={cn("min-w-0 text-sm", className)}>
      {canToggle ? (
        <div className="flex items-center justify-end pb-1">
          <button
            type="button"
            onClick={onToggleRaw}
            aria-pressed={showRaw}
            className="rounded-sm px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {showRaw ? copy.activityFeed || "Feed" : copy.activityRaw || "Raw"}
            {showRaw ? "" : ` · ${rawList.length}`}
          </button>
        </div>
      ) : null}

      {showRaw ? (
        <RawList raw={rawList} copy={copy} />
      ) : rows.length ? (
        <ol className="divide-y divide-border/60">
          {rows.map((row) =>
            row.kind === "summary" ? <SummaryRow key={row.id} row={row} copy={copy} /> : <ActivityRow key={row.id} item={row} copy={copy} />
          )}
        </ol>
      ) : (
        <p className="py-2 text-xs text-muted-foreground">{copy.activityEmpty || "No activity yet."}</p>
      )}
    </div>
  );
}

const VERB_LABELS = {
  read: ["Reading", "Read"],
  list: ["Listing", "Listed"],
  search: ["Searching", "Searched"],
  fetch: ["Fetching", "Fetched"],
  edit: ["Editing", "Edited"],
  run: ["Running", "Ran"],
  call: ["Calling", "Called"],
  say: ["Writing", "Said"],
  think: ["Thinking", "Thought"],
  plan: ["Planning", "Planned"],
  ask: ["Asking", "Asked"],
  fail: ["Failing", "Failed"],
  status: ["", ""],
  output: ["", ""],
};

function verbLabel(item) {
  const forms = VERB_LABELS[item.verb] || [item.verb, item.verb];
  return item.state === "pending" ? forms[0] : forms[1];
}

function rowTitle(item) {
  if (item.kind === "message") return item.object || (item.state === "pending" ? "Writing…" : "Message");
  if (item.kind === "error") return item.object || "Failed";
  if (item.kind === "status" || item.verb === "output") return item.object;
  const verb = verbLabel(item);
  return verb ? `${verb} ${item.object}`.trim() : item.object;
}

function ActivityRow({ item, copy, nested = false }) {
  const failed = item.state === "failed";
  const pending = item.state === "pending";
  const hasDetail = Boolean(item.detail && item.detail.trim());
  const [open, setOpen] = useState(failed);
  // A row that fails after it was rendered opens its detail in place.
  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);
  const showOutcome = item.outcome && !failed && item.kind !== "message" && item.outcome !== item.object;
  const title = rowTitle(item);
  const time = formatTime(item.endedAt || item.startedAt);

  return (
    <li className={cn("group/row", nested ? "py-1 pl-6" : "py-1.5")} data-activity-id={item.id} data-state={item.state}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-[0.45rem] flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {pending ? <Spinner className="size-3 text-primary" /> : <span className={cn("size-1.5 rounded-full", failed ? "bg-destructive" : item.quiet ? "bg-border" : "bg-foreground/60")} />}
        </span>
        <button
          type="button"
          onClick={hasDetail ? () => setOpen((value) => !value) : undefined}
          disabled={!hasDetail}
          aria-expanded={hasDetail ? open : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-x-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            hasDetail ? "cursor-pointer" : "cursor-default"
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate leading-6",
              failed ? "font-medium text-destructive" : item.quiet ? "text-muted-foreground" : "text-foreground",
              item.kind === "edit" || item.kind === "shell" ? "font-medium" : "",
              item.kind === "shell" || item.kind === "edit" ? "font-mono text-[13px]" : ""
            )}
          >
            {title}
          </span>
          {showOutcome ? <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">· {item.outcome}</span> : null}
          {failed && item.outcome && item.outcome !== item.object ? <span className="min-w-0 truncate text-xs text-destructive/80">· {item.outcome}</span> : null}
          {pending ? <span className="sr-only">{copy.activityPending || "in progress"}</span> : null}
          {hasDetail ? <ChevronRight className={cn("ml-auto size-3.5 shrink-0 self-center text-muted-foreground/70 transition-transform", open && "rotate-90")} aria-hidden="true" /> : null}
        </button>
        {time ? <time className="shrink-0 pt-1 text-[11px] tabular-nums text-muted-foreground/70">{time}</time> : null}
      </div>
      {open && hasDetail ? (
        <pre
          className={cn(
            "mt-1 ml-[1.375rem] max-h-64 overflow-auto whitespace-pre-wrap break-words border-l pl-3 font-mono text-xs leading-5",
            failed ? "border-destructive/40 text-destructive/90" : "border-border/70 text-muted-foreground"
          )}
        >
          {item.detail}
        </pre>
      ) : null}
    </li>
  );
}

function SummaryRow({ row, copy }) {
  const [open, setOpen] = useState(false);
  const pending = row.state === "pending";
  return (
    <li className="py-1.5" data-activity-id={row.id} data-kind="summary">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {pending ? <Spinner className="size-3 text-primary" /> : <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}
        </span>
        <span className="min-w-0 truncate leading-6">{row.label || `${row.items.length} quiet steps`}</span>
      </button>
      {open ? (
        <ol className="mt-0.5 divide-y divide-border/40">
          {row.items.map((item) => (
            <ActivityRow key={item.id} item={item} copy={copy} nested />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function RawList({ raw, copy }) {
  if (!raw.length) return <p className="py-2 text-xs text-muted-foreground">{copy.activityEmpty || "No activity yet."}</p>;
  return (
    <ol className="max-h-[28rem] overflow-auto font-mono text-xs leading-5 text-muted-foreground">
      {raw.map((entry, index) => {
        const line = rawLine(entry);
        return (
          <li key={`${index}-${line.head}`} className="flex gap-2 whitespace-pre-wrap break-words border-b border-border/40 py-0.5 last:border-b-0">
            <span className="shrink-0 text-muted-foreground/60">{line.head}</span>
            <span className="min-w-0">{line.body}</span>
          </li>
        );
      })}
    </ol>
  );
}

function rawLine(entry) {
  if (typeof entry === "string") return { head: "", body: entry };
  if (!entry || typeof entry !== "object") return { head: "", body: String(entry ?? "") };
  if (typeof entry.line === "string" && !("type" in entry)) return { head: `[${entry.source || "run"}]`, body: entry.line };
  const parts = [];
  if (entry.tool?.name || entry.toolName || entry.call?.name || entry.result?.name) parts.push(entry.tool?.name || entry.toolName || entry.call?.name || entry.result?.name);
  if (entry.delta) parts.push(entry.delta);
  if (entry.thought) parts.push(`thought: ${entry.thought}`);
  if (entry.content) parts.push(entry.content);
  if (entry.output) parts.push(entry.output);
  if (entry.result?.content) parts.push(entry.result.content);
  if (entry.error) parts.push(entry.error);
  if (entry.label || entry.title || entry.status) parts.push(entry.label || entry.title || entry.status);
  if (entry.call?.args || entry.tool?.args) parts.push(safeJson(entry.call?.args || entry.tool?.args));
  return { head: `[${entry.type || "event"}]`, body: parts.filter(Boolean).join(" ") || safeJson(entry) };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
