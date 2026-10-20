import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, Reply, SmilePlus, Zap } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { QUICK_REACTIONS, reactionName, searchReactions } from "@/lib/reactions";
import { isNoTextReply } from "@/lib/chat-recovery";
import { channelReplyIndex, channelThreadSummary, isChannelPlaceholder, normalizeChannelReplyMode } from "@/lib/channel-replies";
import { JumpToLatest } from "@/components/chat/JumpToLatest";
import { cn } from "@/lib/utils";

export { QUICK_REACTIONS };

/**
 * Every emoji, grouped and searchable. The hover row keeps the five worth a
 * single click; this is where the other five hundred live, so the row does not
 * have to grow to hold them.
 */
export function ReactionPicker({ onPick, onSetUpFlow, setUpLabel = "Make a reaction do something…", label = "More reactions", className }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => searchReactions(query), [query]);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn("grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground", className)}
        >
          <SmilePlus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 p-0">
        <div className="p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="h-8"
          />
        </div>
        <ScrollArea className="h-64">
          <div className="px-2 pb-2">
            {groups.length ? (
              groups.map((group) => (
                <div key={group.id} className="pb-1">
                  <p className="px-1 py-1 text-xs text-muted-foreground">{group.label}</p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {group.items.map(([emoji, name]) => (
                      <button
                        key={emoji}
                        type="button"
                        title={name}
                        aria-label={name}
                        className="grid size-8 place-items-center rounded text-lg hover:bg-muted"
                        onClick={() => {
                          onPick?.(emoji);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">No emoji named “{query}”.</p>
            )}
          </div>
        </ScrollArea>
        {onSetUpFlow ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            onClick={() => {
              setOpen(false);
              setQuery("");
              onSetUpFlow();
            }}
          >
            <Zap className="size-3.5 shrink-0" aria-hidden="true" />
            {setUpLabel}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function timestampOf(message) {
  const value = Date.parse(message?.createdAt || message?.updatedAt || message?.startedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function dayKey(ms, locale) {
  if (!ms) return "";
  const day = new Date(ms).toDateString();
  if (day === new Date().toDateString()) return "Today";
  if (day === new Date(Date.now() - 86_400_000).toDateString()) return "Yesterday";
  return new Date(ms).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
}

/** The full date and time, for the tooltip on a message's clock time. */
function fullTime(message) {
  const ms = timestampOf(message);
  if (!ms) return undefined;
  try {
    return new Date(ms).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return undefined;
  }
}

function timeLabel(message, locale) {
  const ms = timestampOf(message);
  if (ms) return new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return message?.time || "";
}

export function sortChannelMessages(messages = []) {
  return [...messages].sort((a, b) => timestampOf(a) - timestampOf(b) || String(a.id).localeCompare(String(b.id)));
}

function Divider({ label, emphasis = false }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator" aria-label={label}>
      <span className={cn("h-px flex-1", emphasis ? "bg-destructive/50" : "bg-border")} />
      <span className={cn("text-[11px] font-semibold uppercase tracking-wide", emphasis ? "text-destructive" : "text-muted-foreground")}>{label}</span>
      <span className={cn("h-px flex-1", emphasis ? "bg-destructive/50" : "bg-border")} />
    </div>
  );
}

function MentionChips({ message, agents, userName, channelMemberIds = [] }) {
  const ids = Array.isArray(message?.targetMemberIds) ? message.targetMemberIds : [];
  const label = String(message?.targetLabel || "").trim();
  if (!ids.length && !label) return null;
  // Whole-channel messages are the default; chips only mark targeted members.
  if (label === "channel" || label === "thread recipients") return null;
  if (channelMemberIds.length && ids.length >= channelMemberIds.length && ids.every((id) => channelMemberIds.includes(id))) return null;
  const names = ids.map((id) => agents.find((agent) => agent.id === id)?.name).filter(Boolean);
  const chips = names.length ? names : label ? [label.replace(/^@/, "")] : [];
  if (!chips.length) return null;
  return (
    <span className="mr-1.5 inline-flex flex-wrap gap-1 align-middle">
      {chips.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-foreground/90"
        >
          {name === userName ? null : <Bot className="size-3" aria-hidden="true" />}
          {name}
        </span>
      ))}
    </span>
  );
}

/** A small facepile under your own message: who has actually answered. */
function RepliedFaces({ agents = [], renderMemberAvatar, label = "replied" }) {
  if (!agents.length) return null;
  const names = agents.map((agent) => agent.name).filter(Boolean);
  const sentence = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex -space-x-1">
        {agents.slice(0, 5).map((agent) =>
          renderMemberAvatar ? (
            <span key={agent.id} className="rounded-[4px] ring-1 ring-background">
              {renderMemberAvatar(agent, "size-4 rounded-[4px]")}
            </span>
          ) : (
            <span key={agent.id} className="grid size-4 place-items-center rounded-[4px] bg-muted text-[8px] font-semibold ring-1 ring-background">
              {String(agent.name || "?").slice(0, 1).toUpperCase()}
            </span>
          )
        )}
      </span>
      <span className="truncate">
        {sentence} {label}
      </span>
    </div>
  );
}

function ReactionRow({ reactions = [], onReact, messageId, onSetUpFlow, setUpLabel }) {
  if (!reactions.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-pressed={reaction.mine === true}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
            reaction.mine ? "border-primary/50 bg-primary/10" : "border-border/70 bg-background hover:bg-muted/60"
          )}
          onClick={() => onReact?.(messageId, reaction.emoji)}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="sr-only">{reactionName(reaction.emoji)}</span>
          <span className="font-medium">{reaction.count}</span>
        </button>
      ))}
      <ReactionPicker label="Add a reaction" onPick={(emoji) => onReact?.(messageId, emoji)} onSetUpFlow={onSetUpFlow} setUpLabel={setUpLabel} />
    </div>
  );
}

function HoverActions({ messageId, onReact, onReply, onSetUpFlow, setUpLabel, extra = null }) {
  return (
    <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-md border border-border/70 bg-background p-0.5 shadow-xs group-hover:flex group-focus-within:flex">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="grid size-6 place-items-center rounded text-sm hover:bg-muted"
          aria-label={`React ${reactionName(emoji)}`}
          onClick={() => onReact?.(messageId, emoji)}
        >
          {emoji}
        </button>
      ))}
      <ReactionPicker onPick={(emoji) => onReact?.(messageId, emoji)} onSetUpFlow={onSetUpFlow} setUpLabel={setUpLabel} />
      {onReply ? (
        <button type="button" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Reply in thread" onClick={onReply}>
          <Reply className="size-3.5" />
        </button>
      ) : null}
      {extra}
    </div>
  );
}

/**
 * Channel roots with expandable saved threads, or a chronological stream
 * when the channel chooses direct replies. Both read the same transcript.
 */
export function ChannelStream({
  channel,
  messages = [],
  agents = [],
  userName = "You",
  locale = "en-US",
  lastReadAt = 0,
  reactionsByMessage = {},
  renderBody,
  renderEvent,
  renderAvatar,
  renderMemberAvatar,
  authorName,
  onReact,
  onReply,
  emptyLabel = "No messages yet. Send the first one.",
  newLabel = "New",
  typingLabel = "is typing…",
  repliedLabel = "replied",
  onSetUpReactionFlow,
  setUpFlowLabel = "Make a reaction do something…",
  renderActions,
  noTextLabel = "No reply text. Work details shows what ran.",
  threadView = false,
}) {
  const ordered = useMemo(() => sortChannelMessages(messages), [messages]);
  const replyIndex = useMemo(() => channelReplyIndex(ordered), [ordered]);
  const threaded = !threadView && normalizeChannelReplyMode(channel?.replyMode) === "thread";
  const visible = threaded ? ordered.filter(message => replyIndex.roots.get(message.id) === message.id) : ordered;
  const [openThreads, setOpenThreads] = useState({});
  const endRef = useRef(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (threadView) return undefined;
    if (ordered.length === lastCount.current) return undefined;
    const first = lastCount.current === 0;
    lastCount.current = ordered.length;
    // Opening #general in the installed app left it on 5 July: a smooth
    // scroll on first paint aimed at where the end was before long replies
    // laid out, and could be cut short. The first jump is instant and is
    // repeated once layout settles; later messages still glide in.
    endRef.current?.scrollIntoView({ block: "end", behavior: first ? "auto" : "smooth" });
    if (!first) return undefined;
    const frame = window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior: "auto" }));
    const timer = window.setTimeout(() => endRef.current?.scrollIntoView({ block: "end", behavior: "auto" }), 250);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [ordered.length, threadView]);

  if (!ordered.length) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  let previousDay = "";
  let newShown = false;
  let previousAuthor = "";
  let previousTimestamp = 0;

  return (
    <div className="flex flex-col" aria-label={threadView ? "Thread replies" : channel?.name ? `#${channel.name} messages` : "messages"}>
      {visible.map((message) => {
        // A reply that has not produced text yet is presence, not a message:
        // the PresenceLine under the composer shows it (ADR-0014).
        if (message.status === "loading" && isChannelPlaceholder(message.body)) return null;
        const group = replyIndex.groups.get(message.id);
        const repliers = (group?.replierIds || []).map(id => agents.find(agent => agent.id === id) || { id, name: group.replies.find(reply => reply.agentId === id)?.authorName || "Member" });
        const ms = timestampOf(message);
        const day = dayKey(ms, locale);
        const showDay = !threadView && day && day !== previousDay;
        // Repository events are one muted row, not an authored message, so
        // they keep the day divider but skip the author grouping.
        if (renderEvent && message.role === "event") {
          if (showDay) previousDay = day;
          previousAuthor = "";
          previousTimestamp = ms;
          return (
            <Fragment key={message.id}>
              {showDay ? <Divider label={day} /> : null}
              {renderEvent(message)}
            </Fragment>
          );
        }
        const isNew = !message.archivedThread && !newShown && lastReadAt > 0 && ms > lastReadAt && message.role !== "user";
        const name = authorName ? authorName(message) : message.role === "user" ? userName : message.authorName || "Member";
        const compact = !showDay && !isNew && previousAuthor === name && ms - previousTimestamp < 4 * 60 * 1000;
        const loading = message.status === "loading";
        const failed = message.status === "error";
        if (showDay) previousDay = day;
        if (isNew) newShown = true;
        previousAuthor = name;
        previousTimestamp = ms;
        return (
          <Fragment key={message.id}>
            {showDay ? <Divider label={day} /> : null}
            {isNew ? <Divider label={newLabel} emphasis /> : null}
            <article
              data-channel-message-id={message.id}
              className={cn(
                "group relative flex gap-3 rounded-md px-2 transition-colors hover:bg-muted/30",
                compact ? "py-0.5" : "mt-2 py-1.5"
              )}
            >
              <div className="w-8 shrink-0">
                {compact ? (
                  <span className="hidden text-[10px] text-muted-foreground group-hover:block" title={fullTime(message)}>{timeLabel(message, locale)}</span>
                ) : renderAvatar ? (
                  renderAvatar(message)
                ) : (
                  <span className="grid size-8 place-items-center rounded-md bg-muted text-xs font-semibold">{String(name).slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {!compact ? (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold leading-5">{name}</span>
                    <span className="text-xs text-muted-foreground" title={fullTime(message)}>{timeLabel(message, locale)}</span>
                    {loading ? <Spinner className="size-3" /> : null}
                  </div>
                ) : null}
                <div className={cn("text-sm leading-6", failed ? "text-destructive" : "text-foreground/90", compact && loading && "text-muted-foreground")}>
                  <MentionChips message={message} agents={agents} userName={userName} channelMemberIds={channel?.memberIds || []} />
                  {loading && !message.body?.trim() ? (
                    <span className="text-muted-foreground">
                      {name} {typingLabel}
                    </span>
                  ) : isNoTextReply(message.body) ? (
                    <span className="text-muted-foreground">{noTextLabel}</span>
                  ) : renderBody ? (
                    renderBody(message)
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{message.body}</span>
                  )}
                </div>
                <ReactionRow
                  reactions={reactionsByMessage[message.id] || []}
                  onReact={onReact}
                  messageId={message.id}
                  onSetUpFlow={onSetUpReactionFlow ? () => onSetUpReactionFlow(message) : null}
                  setUpLabel={setUpFlowLabel}
                />
                {!threadView && message.role === "user" ? (
                  <RepliedFaces agents={repliers} renderMemberAvatar={renderMemberAvatar} label={repliedLabel} />
                ) : null}
                {threaded && group?.messages.length ? (
                  <Collapsible open={Boolean(openThreads[message.id])} onOpenChange={open => setOpenThreads(current => ({ ...current, [message.id]: open }))}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-1 -ml-2 h-7 gap-1 px-2" aria-label={`Thread: ${channelThreadSummary(group)}`}>
                        <ChevronRight data-icon="inline-start" className={cn("transition-transform", openThreads[message.id] && "rotate-90")} />
                        {channelThreadSummary(group)}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 border-l border-border/60 pl-2 sm:pl-3">
                      <ChannelStream
                        channel={channel} messages={group.messages} agents={agents} userName={userName} locale={locale}
                        lastReadAt={lastReadAt} reactionsByMessage={reactionsByMessage} renderBody={renderBody}
                        renderEvent={renderEvent} renderAvatar={renderAvatar} renderMemberAvatar={renderMemberAvatar}
                        authorName={authorName} onReact={onReact} onReply={onReply} newLabel={newLabel}
                        typingLabel={typingLabel} onSetUpReactionFlow={onSetUpReactionFlow} setUpFlowLabel={setUpFlowLabel}
                        renderActions={renderActions} noTextLabel={noTextLabel} threadView
                      />
                      {group.working ? <p className="px-2 py-2 text-xs text-muted-foreground" role="status">{group.working} {group.working === 1 ? "member is" : "members are"} still working…</p> : null}
                      {onReply ? <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => onReply(message)}><Reply data-icon="inline-start" />Reply in thread</Button> : null}
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </div>
              {!loading ? (
                <HoverActions
                  messageId={message.id}
                  onReact={onReact}
                  onReply={onReply ? () => {
                    if (threaded) setOpenThreads(current => ({ ...current, [replyIndex.roots.get(message.id) || message.id]: true }));
                    onReply(message);
                  } : null}
                  onSetUpFlow={onSetUpReactionFlow ? () => onSetUpReactionFlow(message) : null}
                  setUpLabel={setUpFlowLabel}
                  extra={renderActions ? renderActions(message) : null}
                />
              ) : null}
            </article>
          </Fragment>
        );
      })}
      <div ref={endRef} />
      {!threadView ? <JumpToLatest anchorRef={endRef} watch={ordered.length} /> : null}
    </div>
  );
}
