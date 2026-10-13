import { ArrowRight, Bot, BrainCog, CalendarClock, FolderOpen, Hash, Inbox, KeyRound, MessageSquare, RefreshCw, Workflow } from "lucide-react";

import { GroupLabel, StatusDot } from "@/components/execution/bits";
import { Button } from "@/components/ui/button";
import { DECISION_KINDS, decisionRows, stoppedWorkRows, unreadRows } from "@/lib/work-attention";
import { cn } from "@/lib/utils";

/**
 * Needs you (ADR-0121) is three divider sections in a fixed order, each with
 * a count and one sentence when empty: the decisions only a person can make,
 * the replies not yet read, and the work that stopped. Every row opens the
 * surface that owns its action; nothing is decided here.
 */

const DECISION_ICONS = { approval: Workflow, vault: KeyRound, folder: FolderOpen, handoff: Bot, channel: Hash, routine: CalendarClock, memory: BrainCog };

function Section({ title, count, empty, children, testId }) {
  return (
    <section className="border-b border-border/70 pb-5 last:border-b-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {count ? <div className="flex flex-col">{children}</div> : <p className="py-2 text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

const rowShell = "group flex w-full items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** What is asked, who asks and since when, and the one action word. */
function DecisionRow({ row, time, onOpen }) {
  const Icon = DECISION_ICONS[row.kind] || Workflow;
  const meta = [row.who, row.detail].filter(Boolean).join(" · ");
  return (
    <button type="button" data-row-kind="decision" data-decision-kind={row.kind} data-decision-id={row.id} className={rowShell} onClick={onOpen}>
      <Icon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.title}</span>
        {meta ? <span className="mt-0.5 block truncate text-sm text-muted-foreground">{meta}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 group-hover:underline group-focus-visible:underline">
          {row.action}
          <ArrowRight className="size-3" aria-hidden="true" />
        </span>
        {time ? <span className="text-xs text-muted-foreground">{time}</span> : null}
      </span>
    </button>
  );
}

/** A reply or a channel not read yet: name, the latest line, when. */
function UnreadRow({ row, time, onOpen }) {
  const Icon = row.kind === "channel" ? Hash : MessageSquare;
  return (
    <button type="button" data-row-kind="unread" className={rowShell} onClick={onOpen}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.title}</span>
        {row.detail ? <span className="mt-0.5 block truncate text-sm text-muted-foreground">{row.detail}</span> : null}
      </span>
      {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
    </button>
  );
}

/**
 * One line per record that stopped, in the Execution panel's grammar: a
 * status dot, the member, the person's question, "failed · 2m ago", and
 * the one action the record deserves. Never the command line.
 */
function StoppedRow({ row, time, checks, selected, copy, navigate, onReplay, replaying }) {
  const bad = row.status === "failed" || row.status === "blocked";
  const actionLabel = row.action === "retry-chat" ? copy.retryInChat || "Retry in chat" : row.action === "replay" ? copy.replay || "Replay" : copy.openChat || "Open chat";
  function act() {
    if (row.action === "retry-chat") return navigate.retryChat?.(row);
    if (row.action === "replay") return onReplay?.(row.row);
    return row.memberId ? navigate.member?.(row.memberId) : navigate.work?.(row);
  }
  return (
    <div data-row-kind="stopped" data-stopped-kind={row.kind} className={cn("flex items-center gap-3 py-2.5 pr-1", selected ? "border-l-2 border-l-foreground/40 pl-3" : "pl-2")}>
      <StatusDot status={row.status} />
      <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline" onClick={() => navigate.work?.(row)}>
        <span className="block truncate text-sm">
          {row.member ? <span className="font-medium">{row.member}</span> : null}
          {row.member ? <span className="text-muted-foreground"> {"·"} </span> : null}
          <span>{row.title}</span>
        </span>
        {row.reason ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.reason}</span> : null}
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">
        <span className={cn("[&::first-letter]:uppercase", bad && "text-destructive")}>{row.statusLabel}</span>
        {time ? ` · ${time}` : ""}
        {checks ? ` · ${checks}` : ""}
      </span>
      {row.action === "replay" && !onReplay ? null : (
        <Button variant="ghost" size="sm" className="shrink-0" disabled={replaying} onClick={act}>
          {row.action === "replay" ? <RefreshCw className={cn("size-3.5", replaying && "animate-spin")} aria-hidden="true" /> : null}
          {replaying ? copy.replayStarting || "Starting…" : actionLabel}
        </Button>
      )}
    </div>
  );
}

export function NeedsYouList({
  replies = [],
  unreadChannels = [],
  handoffs = [],
  approvals = [],
  memoryProposals = [],
  vaultRequests = [],
  folderRequests = [],
  channelProposals = [],
  routineProposals = [],
  rows = [],
  copy = {},
  navigate = {},
  timeLabel = () => "",
  checksLabel = () => "",
  onReplay,
  replayingRowId = "",
  selectedRowId = "",
}) {
  const decisions = decisionRows({ approvals, vaultRequests, folderRequests, handoffs, channelProposals, routineProposals, memoryProposals }, copy);
  const unread = unreadRows({ replies, unreadChannels });
  const stopped = stoppedWorkRows(rows, handoffs, copy);
  const kindLabel = {
    approval: copy.inboxApprovals || "Approvals",
    vault: copy.inboxVault || "Vault",
    folder: copy.inboxFolders || "Folder access",
    handoff: copy.inboxHandoffs || "Handoffs",
    channel: copy.inboxChannelProposals || "Channel proposals",
    routine: copy.inboxRoutineProposals || "Routine proposals",
    memory: copy.inboxMemory || "Memory proposals",
  };
  const openDecision = (row) => {
    const item = row.item;
    switch (row.kind) {
      case "approval": return navigate.approval?.(item);
      case "vault": return navigate.vault?.(item);
      case "folder": return navigate.folder?.(item);
      case "handoff": return navigate.task?.(item);
      case "channel": return navigate.channelProposal?.(item);
      case "routine": return navigate.routine?.(item);
      case "memory": return navigate.memory?.(item);
      default: return undefined;
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="needs-you-list">
      <Section title={copy.inboxDecisions || "Decisions"} count={decisions.length} empty={copy.inboxNoDecisions || "Nothing is waiting for a decision."} testId="needs-you-decisions">
        {DECISION_KINDS.map((kind) => {
          const group = decisions.filter((row) => row.kind === kind);
          if (!group.length) return null;
          return (
            <div key={kind}>
              <GroupLabel className="px-2">{kindLabel[kind]}</GroupLabel>
              <div className="flex flex-col divide-y divide-border/50">
                {group.map((row) => <DecisionRow key={row.id} row={row} time={timeLabel(row.at)} onOpen={() => openDecision(row)} />)}
              </div>
            </div>
          );
        })}
      </Section>

      <Section title={copy.inboxUnread || "Unread"} count={unread.length} empty={copy.inboxNoUnreadUpdates || "No unread replies."} testId="needs-you-unread">
        <div className="flex flex-col divide-y divide-border/50">
          {unread.map((row) => (
            <UnreadRow key={row.id} row={row} time={timeLabel(row.at)} onOpen={() => (row.kind === "channel" ? navigate.channel?.(row.item.channel?.id) : navigate.member?.(row.item.agentId))} />
          ))}
        </div>
      </Section>

      <Section title={copy.inboxStopped || "Work that stopped"} count={stopped.length} empty={copy.inboxNoStopped || "Nothing has stopped."} testId="needs-you-stopped">
        <div className="flex flex-col divide-y divide-border/50">
          {stopped.map((row) => (
            <StoppedRow
              key={row.id}
              row={row}
              time={timeLabel(row.at)}
              checks={row.kind === "launched" ? checksLabel(row.row) : ""}
              selected={Boolean(selectedRowId) && row.id === selectedRowId}
              copy={copy}
              navigate={navigate}
              onReplay={onReplay}
              replaying={replayingRowId === row.id}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Compatibility wrapper while callers move to the shared activity surface. */
export function InboxPage({ onMarkAllRead, ...props }) {
  const { copy = {}, replies = [], unreadChannels = [] } = props;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:px-10 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
            {copy.workNeedsYou || "Needs you"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.inboxDescription || "Decisions, unread replies, and work that stopped."}</p>
        </div>
        {replies.length + unreadChannels.length > 0 && onMarkAllRead ? (
          <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
            {copy.markUpdatesRead || "Mark updates read"}
          </Button>
        ) : null}
      </header>
      <NeedsYouList {...props} />
    </div>
  );
}
