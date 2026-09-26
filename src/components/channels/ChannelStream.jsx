import { Fragment, useEffect, useMemo, useRef } from "react";
import { Bot, Reply } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const QUICK_REACTIONS = ["👀", "✅", "🎬", "❤️", "🚀"];

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

function ReactionRow({ reactions = [], onReact, messageId }) {
  if (!reactions.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
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
          <span className="font-medium">{reaction.count}</span>
        </button>
      ))}
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
          aria-label={`React ${emoji}`}
          onClick={() => onReact?.(messageId, emoji)}
        >
          {emoji}
        </button>
      ))}
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
  authorName,
  onReact,
  onReply,
  emptyLabel = "No messages yet. Send the first one.",
  newLabel = "New",
  typingLabel = "is typing…",
}) {
  const ordered = useMemo(() => sortChannelMessages(messages), [messages]);
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
