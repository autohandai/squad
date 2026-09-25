import { CircleCheck, CircleDashed, CircleX, GitCommitHorizontal, GitMerge, GitPullRequest } from "lucide-react";

import { Button } from "@/components/ui/button";
import { eventTitle, relativeTime, statusPill } from "@/lib/git-events";
import { cn } from "@/lib/utils";

function EventIcon({ event, className }) {
  const props = { className: cn("size-3.5 shrink-0", className), "aria-hidden": true };
  if (event.kind === "pr") return event.status === "merged" ? <GitMerge {...props} /> : <GitPullRequest {...props} />;
  if (event.kind === "ci") {
    if (event.status === "success") return <CircleCheck {...props} />;
    if (event.status === "failure") return <CircleX {...props} />;
    return <CircleDashed {...props} />;
  }
  return <GitCommitHorizontal {...props} />;
}

/**
 * One git event (commit, pull request, CI result) between channel messages
 * (ADR-0022): icon, title, status pill, time. Compact and quiet: a single
 * line in muted text, no card. A pull request row adds Review and Open.
 */
export function GitEventRow({ event, copy = {}, locale = "en-US", now, onReview, onOpen, className }) {
  if (!event) return null;
  const pill = statusPill(event, copy);
  const title = eventTitle(event);
  const time = relativeTime(event.updatedAt || event.createdAt, { now, locale, copy });
  const isPr = event.kind === "pr";
  const open = () => (onOpen ? onOpen(event) : event.url ? window.open(event.url, "_blank", "noopener") : undefined);

  return (
    <div
      className={cn("group flex min-w-0 items-center gap-2 py-1 pl-[2.75rem] pr-2 text-xs text-muted-foreground", className)}
      role="listitem"
      aria-label={`${event.kind} ${event.ref || ""} ${pill.label}`.trim()}
      data-kind={event.kind}
      data-status={event.status}
    >
      <EventIcon event={event} className={event.kind === "ci" ? pill.className : ""} />
      {event.ref && event.kind !== "pr" ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground/90">{event.ref}</span> : null}
      {event.url ? (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-foreground/90 underline-offset-2 hover:underline"
          onClick={(mouseEvent) => {
            if (!onOpen) return;
            mouseEvent.preventDefault();
            onOpen(event);
          }}
        >
          {title}
        </a>
      ) : (
        <span className="min-w-0 truncate text-foreground/90">{title}</span>
      )}
      {event.author ? <span className="hidden shrink-0 sm:inline">{event.author}</span> : null}
      <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium", pill.className)}>
        <span className={cn("size-1.5 rounded-full", pill.dotClassName)} aria-hidden="true" />
        {pill.label}
      </span>
      <span className="ml-auto shrink-0 tabular-nums" title={event.updatedAt || event.createdAt}>
        {time}
      </span>
      {isPr ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button variant="ghost" size="xs" className="h-6 px-1.5 text-xs" onClick={() => onReview?.(event)}>
            {copy.gitReview || "Review"}
          </Button>
          <Button variant="ghost" size="xs" className="h-6 px-1.5 text-xs" onClick={open}>
            {copy.gitOpen || "Open"}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
