import { ArrowRight, Bot, BrainCog, FolderOpen, Hash, Inbox, KeyRound, MessageSquare, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Section({ title, count, children }) {
  if (!count) return null;
  return (
    <section className="border-b border-border/70 pb-5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, title, detail, time, onOpen, tone, action }) {
  return (
    <button type="button" className="group flex items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}>
      <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", tone)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{detail}</span> : null}
        <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
          {action}
          <ArrowRight className="size-3" aria-hidden="true" />
        </span>
      </span>
      {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
    </button>
  );
}

/**
 * Human decisions come before unread updates. Reading updates never resolves
 * decisions; every row opens the existing surface that owns its action.
 */
export function NeedsYouList({
  replies = [],
  unreadChannels = [],
  handoffs = [],
  approvals = [],
  memoryProposals = [],
  vaultRequests = [],
  folderRequests = [],
  copy = {},
  navigate = {},
  timeLabel = () => "",
  showEmpty = true,
  blockedWork = null,
}) {
  const total = replies.length + unreadChannels.length + handoffs.length + approvals.length + memoryProposals.length + vaultRequests.length + folderRequests.length;
  if (!total && !blockedWork) return showEmpty ? <p className="text-sm text-muted-foreground">{copy.workCaughtUp || "You're caught up. Nothing needs you right now."}</p> : null;
  return (
    <div className="flex flex-col gap-6" data-testid="needs-you-list">
      <Section title={copy.inboxApprovals || "Approvals waiting"} count={approvals.length}>
        {approvals.map((item) => (
          <Row
            key={item.id}
            icon={Workflow}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            tone="text-amber-600 dark:text-amber-300"
            action={copy.reviewApproval || "Review approval"}
            onOpen={() => navigate.approval?.(item)}
          />
        ))}
      </Section>

      <Section title={copy.inboxVault || "Vault requests"} count={vaultRequests.length}>
        {vaultRequests.map((item) => (
          <Row
            key={item.id}
            icon={KeyRound}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            tone="text-amber-600 dark:text-amber-300"
            action={item.request?.type === "payment" ? copy.reviewPayment || "Decide payment" : copy.reviewSecret || "Open secure form"}
            onOpen={() => navigate.vault?.(item)}
          />
        ))}
      </Section>

      <Section title={copy.inboxFolders || "Folder access"} count={folderRequests.length}>
        {folderRequests.map((item) => (
          <Row
            key={item.id}
            icon={FolderOpen}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            tone="text-amber-600 dark:text-amber-300"
            action={copy.decideFolder || "Allow or decline"}
            onOpen={() => navigate.folder?.(item)}
          />
        ))}
      </Section>

      <Section title={copy.inboxHandoffs || "Handoffs waiting"} count={handoffs.length}>
        {handoffs.map((item) => (
          <Row
            key={item.id}
            icon={Bot}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            tone="text-amber-600 dark:text-amber-300"
            action={copy.reviewHandoff || "Review handoff"}
            onOpen={() => navigate.task?.(item)}
          />
        ))}
      </Section>

      {blockedWork}

      <Section title={copy.inboxMemory || "Memory proposals"} count={memoryProposals.length}>
        {memoryProposals.map((item) => (
          <Row
            key={item.id}
            icon={BrainCog}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            action={copy.reviewMemory || "Review memory"}
            onOpen={() => navigate.memory?.(item)}
          />
        ))}
      </Section>

      <Section title={copy.inboxReplies || "Replies"} count={replies.length}>
        {replies.map((item) => (
          <Row
            key={item.id}
            icon={MessageSquare}
            title={item.count > 1 ? `${item.name} · ${item.count}` : item.name}
            detail={item.preview}
            time={timeLabel(item.at)}
            action={copy.openConversation || "Open conversation"}
            onOpen={() => navigate.member?.(item.agentId)}
          />
        ))}
      </Section>

      <Section title={copy.inboxUnreadChannels || "Unread channels"} count={unreadChannels.length}>
        {unreadChannels.map((item) => (
          <Row
            key={item.channel.id}
            icon={Hash}
            title={`#${item.channel.name}`}
            detail={item.preview}
            time={timeLabel(item.latestAt)}
            action={copy.openChannel || "Open channel"}
            onOpen={() => navigate.channel?.(item.channel.id)}
          />
        ))}
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
          <p className="mt-1 text-sm text-muted-foreground">{copy.inboxDescription || "Replies, handoffs, and proposals that need you."}</p>
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
