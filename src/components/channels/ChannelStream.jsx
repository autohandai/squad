import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Reply, SmilePlus } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { QUICK_REACTIONS, reactionName, searchReactions } from "@/lib/reactions";
import { cn } from "@/lib/utils";

export { QUICK_REACTIONS };

/**
 * Every emoji, grouped and searchable. The hover row keeps the five worth a
 * single click; this is where the other five hundred live, so the row does not
 * have to grow to hold them.
 */
function ReactionPicker({ onPick, label = "More reactions", className }) {
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
  return new Date(ms).toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
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

/**
 * Who answered each of your messages: every member who posted after it and
 * before your next one. That window is what "replied to me" means in a channel
 * where members answer on their own initiative rather than in a thread.
 */
function repliersByUserMessage(ordered, agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const result = new Map();
  let openId = "";
  let seen = null;
  const close = () => {
    if (openId && seen && seen.size) result.set(openId, [...seen.values()]);
    openId = "";
    seen = null;
  };
  for (const message of ordered) {
    if (message.role === "user") {
      close();
      openId = message.id;
      seen = new Map();
      continue;
    }
    if (!openId || message.role === "event") continue;
    const agent = byId.get(message.agentId);
    if (agent && !seen.has(agent.id)) seen.set(agent.id, agent);
  }
  close();
  return result;
}

/** A small facepile under your own message: who picked it up. */
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

function ReactionRow({ reactions = [], onReact, messageId }) {
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
      <ReactionPicker label="Add a reaction" onPick={(emoji) => onReact?.(messageId, emoji)} />
    </div>
  );
}

function HoverActions({ messageId, onReact, onReply }) {
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
      <ReactionPicker onPick={(emoji) => onReact?.(messageId, emoji)} />
      {onReply ? (
        <button type="button" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Reply in thread" onClick={onReply}>
          <Reply className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Flat, chronological channel stream: day separators, a NEW divider at the
 * last-read boundary, author + time, mention chips, reactions, and quick
 * actions on hover. Thread replies render inline under their root with a
 * subtle indent so existing thread data keeps its grouping.
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
}) {
  const ordered = useMemo(() => sortChannelMessages(messages), [messages]);
  const repliers = useMemo(() => repliersByUserMessage(ordered, agents), [ordered, agents]);
  const endRef = useRef(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (ordered.length !== lastCount.current) {
      lastCount.current = ordered.length;
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [ordered.length]);

  if (!ordered.length) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  let previousDay = "";
  let newShown = false;
  let previousAuthor = "";
  let previousTimestamp = 0;

  return (
    <div className="flex flex-col" aria-label={channel?.name ? `#${channel.name} messages` : "messages"}>
      {ordered.map((message) => {
        // A reply that has not produced text yet is presence, not a message:
        // the PresenceLine under the composer shows it (ADR-0014).
        if (message.status === "loading" && isPlaceholderBody(message.body)) return null;
        const ms = timestampOf(message);
        const day = dayKey(ms, locale);
        const showDay = day && day !== previousDay;
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
        const isNew = !newShown && lastReadAt > 0 && ms > lastReadAt && message.role !== "user";
        const name = authorName ? authorName(message) : message.role === "user" ? userName : message.authorName || "Member";
        const compact = !showDay && !isNew && previousAuthor === name && ms - previousTimestamp < 4 * 60 * 1000;
        const loading = message.status === "loading";
        const failed = message.status === "error";
        const isReply = Boolean(message.parentMessageId) && !String(message.id).endsWith("-root");
        if (showDay) previousDay = day;
        if (isNew) newShown = true;
        previousAuthor = name;
        previousTimestamp = ms;
        return (
          <Fragment key={message.id}>
            {showDay ? <Divider label={day} /> : null}
            {isNew ? <Divider label={newLabel} emphasis /> : null}
            <article
              className={cn(
                "group relative flex gap-3 rounded-md px-2 transition-colors hover:bg-muted/30",
                compact ? "py-0.5" : "mt-2 py-1.5",
                isReply && "ml-6 border-l border-border/60 pl-3"
              )}
            >
              <div className="w-8 shrink-0">
                {compact ? (
                  <span className="hidden text-[10px] text-muted-foreground group-hover:block">{timeLabel(message, locale)}</span>
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
                    <span className="text-xs text-muted-foreground">{timeLabel(message, locale)}</span>
                    {loading ? <Spinner className="size-3" /> : null}
                  </div>
                ) : null}
                <div className={cn("text-sm leading-6", failed ? "text-destructive" : "text-foreground/90", compact && loading && "text-muted-foreground")}>
                  <MentionChips message={message} agents={agents} userName={userName} channelMemberIds={channel?.memberIds || []} />
                  {loading && !message.body?.trim() ? (
                    <span className="text-muted-foreground">
                      {name} {typingLabel}
                    </span>
                  ) : renderBody ? (
                    renderBody(message)
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{message.body}</span>
                  )}
                </div>
                <ReactionRow reactions={reactionsByMessage[message.id] || []} onReact={onReact} messageId={message.id} />
                {message.role === "user" ? (
                  <RepliedFaces agents={repliers.get(message.id) || []} renderMemberAvatar={renderMemberAvatar} label={repliedLabel} />
                ) : null}
              </div>
              {!loading ? (
                <HoverActions messageId={message.id} onReact={onReact} onReply={onReply ? () => onReply(message) : null} />
              ) : null}
            </article>
          </Fragment>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function isPlaceholderBody(body) {
  const text = String(body || "").trim();
  return !text || /\bis typing(\.{3}|…)$/.test(text);
}
