import { ArrowRight, Bot, BrainCog, Hash, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Section({ title, count, children, empty }) {
  return (
    <section className="border-b border-border/70 pb-5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count ? <span className="text-xs text-muted-foreground">{count}</span> : null}
      </div>
      {count ? <div className="flex flex-col">{children}</div> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function Row({ icon: Icon, title, detail, time, onOpen, tone }) {
  return (
    <button type="button" className="group flex items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40" onClick={onOpen}>
      <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", tone)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{detail}</span> : null}
      </span>
      {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </button>
  );
}

/**
 * Inbox: unread channel activity, pending handoffs, and memory proposals in
 * one calm list. Everything links back to the surface that owns it.
 */
export function InboxPage({
  unreadChannels = [],
  handoffs = [],
  memoryProposals = [],
  copy = {},
  navigate = {},
  onMarkAllRead,
  timeLabel = () => "",
}) {
  const total = unreadChannels.length + handoffs.length + memoryProposals.length;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:px-10 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
            {copy.inbox || "Inbox"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.inboxDescription || "Replies, handoffs, and proposals that need you."}</p>
        </div>
        {total && onMarkAllRead ? (
          <Button variant="ghost" size="sm" onClick={onMarkAllRead}>
            {copy.markAllRead || "Mark all read"}
          </Button>
        ) : null}
      </header>

      <Section title={copy.inboxUnreadChannels || "Unread channels"} count={unreadChannels.length} empty={copy.inboxNoUnread || "You're caught up on every channel."}>
        {unreadChannels.map((item) => (
          <Row
            key={item.channel.id}
            icon={Hash}
            title={`#${item.channel.name}`}
            detail={item.preview}
            time={timeLabel(item.latestAt)}
            onOpen={() => navigate.channel?.(item.channel.id)}
          />
        ))}
      </Section>

      <Section title={copy.inboxHandoffs || "Handoffs waiting"} count={handoffs.length} empty={copy.inboxNoHandoffs || "No handoffs are waiting for a decision."}>
        {handoffs.map((item) => (
          <Row
            key={item.id}
            icon={Bot}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            tone="text-amber-600 dark:text-amber-300"
            onOpen={() => navigate.task?.(item)}
          />
        ))}
      </Section>

      <Section title={copy.inboxMemory || "Memory proposals"} count={memoryProposals.length} empty={copy.inboxNoMemory || "No memory proposals are pending."}>
        {memoryProposals.map((item) => (
          <Row
            key={item.id}
            icon={BrainCog}
            title={item.title}
            detail={item.detail}
            time={timeLabel(item.at)}
            onOpen={() => navigate.memory?.(item)}
          />
        ))}
      </Section>
    </div>
  );
}
