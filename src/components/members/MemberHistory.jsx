import { ArrowRightLeft, Download, FilePen, MessageSquareText, Play, ShieldCheck, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  HISTORY_FILTERS,
  groupRecordsByDay,
  kindLabel,
  kindTitle,
  normalizeFilter,
  recordFailed,
  recordLinks,
  recordSummary,
  relativeTime,
} from "@/lib/member-history";
import { cn } from "@/lib/utils";

const KIND_ICONS = {
  message: MessageSquareText,
  run: Play,
  edit: FilePen,
  shell: TerminalSquare,
  handoff: ArrowRightLeft,
  approval: ShieldCheck,
};

/**
 * Profile "History" section (ADR-0018): a member's attributed, append-only
 * contribution trail. One heading, one sentence, underlined text filters,
 * a divider-separated list grouped by day, a quiet Load more, and Export.
 *
 * Data and callbacks come from the integrator (docs/integration/audit.md):
 *   records     decoded records from GET /api/members/:id/activity (any order)
 *   hasMore     whether another page exists
 *   onLoadMore  fetch the next page (before = oldest id shown)
 *   filter      "all" | "message" | "run" | "edit" | "shell" | "handoff" | "approval"
 *   onFilter    change the filter (refetch from the first page)
 *   onExport    download GET /api/members/:id/activity/export
 *   renderLink  ({ type, id, label, messageId? }) => node | null — a link to the run, channel, task, workflow, or member
 *   copy        locale copy (fallback literals below)
 */
export function MemberHistory({
  records = [],
  hasMore = false,
  onLoadMore,
  onFilter,
  filter = "all",
  onExport,
  copy = {},
  renderLink,
  loading = false,
  locale = "en-US",
  now,
}) {
  const active = normalizeFilter(filter);
  const groups = groupRecordsByDay(records, { locale, copy, now });
  const empty = !groups.length && !loading;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="member-history-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="member-history-heading" className="text-base font-semibold">
            {copy.history || "History"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.historyDescription || "Everything this member did, newest first. Each row links to the run or channel it came from."}
          </p>
        </div>
        {onExport ? (
          <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={loading && !records.length}>
            <Download data-icon="inline-start" />
            {copy.historyExport || "Export"}
          </Button>
        ) : null}
      </div>

      <div role="tablist" aria-label={copy.historyFilter || "Filter history"} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border/75">
        {HISTORY_FILTERS.map((kind) => {
          const selected = kind === active;
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onFilter?.(kind)}
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-2 pt-1 text-sm transition-colors",
                selected ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {kindLabel(kind, copy)}
            </button>
          );
        })}
      </div>

      {empty ? (
        <p className="py-6 text-sm text-muted-foreground">
          {active === "all"
            ? copy.historyEmpty || "Nothing recorded yet. Runs, replies, edits, shell commands, handoffs, and approvals will appear here."
            : copy.historyEmptyFiltered || "Nothing of this kind yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.day || "unknown"}>
              <div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</div>
              <ul className="divide-y divide-border/75">
                {group.records.map((record) => (
                  <HistoryRow key={record.id} record={record} copy={copy} renderLink={renderLink} locale={locale} now={now} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {loading ? <p className="text-sm text-muted-foreground">{copy.historyLoading || "Loading…"}</p> : null}

      {hasMore && !loading ? (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onLoadMore}>
            {copy.historyLoadMore || "Load more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function HistoryRow({ record, copy, renderLink, locale, now }) {
  const Icon = KIND_ICONS[record.kind] || Play;
  const failed = recordFailed(record);
  const links = typeof renderLink === "function" ? recordLinks(record, copy).map((ref) => ({ ref, node: renderLink(ref) })).filter((item) => item.node) : [];
  const time = relativeTime(record.at, { locale, copy, now });
  const absolute = record.at ? new Date(record.at).toLocaleString(locale) : "";

  return (
    <li className="flex gap-3 py-3">
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground", failed && "text-destructive")} aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-6", failed && "text-destructive")}>{recordSummary(record, copy)}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{kindTitle(record.kind, copy)}</span>
          {time ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={record.at} title={absolute}>
                {time}
              </time>
            </>
          ) : null}
          {links.map(({ ref, node }) => (
            <span key={`${ref.type}:${ref.id}`} className="flex items-center gap-x-2">
              <span aria-hidden="true">·</span>
              {node}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

export default MemberHistory;
