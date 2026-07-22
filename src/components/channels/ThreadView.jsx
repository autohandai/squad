import { useState } from "react";
import { CornerDownRight, MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function formatCount(template, count) {
  return String(template || "{count}").replace("{count}", String(count));
}

function initialsFor(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ThreadMessage({ message, authorName, isRoot }) {
  const loading = message.status === "loading";
  return (
    <div className={cn("flex gap-2.5", !isRoot && "pl-6")}>
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
          isRoot ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        )}
        aria-hidden="true"
      >
        {initialsFor(authorName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          {message.time ? <span className="text-xs text-muted-foreground">{message.time}</span> : null}
          {loading ? <Spinner className="size-3" /> : null}
        </div>
        <p
          className={cn(
            "mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed",
            message.status === "error" ? "text-destructive" : "text-foreground/90"
          )}
        >
          {message.body}
        </p>
      </div>
    </div>
  );
}

// Renders one channel thread: the root prompt plus the grouped in-thread
// member replies, and a follow-up composer so replies stay in the same thread.
export function ThreadView({
  thread,
  rootMessage,
  replies = [],
  agents = [],
  userName = "You",
  copy,
  busy = false,
  onFollowUp,
}) {
  const [followUp, setFollowUp] = useState("");

  function authorFor(message) {
    if (message.role === "user") return userName;
    const agent = agents.find((item) => item.id === message.agentId);
    return agent?.name || message.authorName || "Squad member";
  }

  function submitFollowUp() {
    const text = followUp.trim();
    if (!text || busy) return;
    onFollowUp?.({ prompt: text, threadId: thread.id });
    setFollowUp("");
  }

  return (
    <section className="flex flex-col gap-3" aria-label={thread.title}>
      {rootMessage ? <ThreadMessage message={rootMessage} authorName={authorFor(rootMessage)} isRoot /> : null}

      {replies.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
            <MessageSquareText className="size-3.5" aria-hidden="true" />
            {formatCount(copy.threadReplies, replies.length)}
          </div>
          {replies.map((message) => (
            <ThreadMessage key={message.id} message={message} authorName={authorFor(message)} isRoot={false} />
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 pl-6">
        <CornerDownRight className="mb-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Textarea
          value={followUp}
          placeholder={copy.threadFollowUpPlaceholder}
          rows={1}
          className="min-h-[40px] flex-1 resize-none"
          disabled={busy}
          aria-label={copy.threadFollowUp}
          onChange={(event) => setFollowUp(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitFollowUp();
            }
          }}
        />
        <Button variant="outline" size="sm" disabled={busy || !followUp.trim()} onClick={submitFollowUp}>
          {copy.threadFollowUp}
        </Button>
      </div>

      <Separator className="mt-1" />
    </section>
  );
}
