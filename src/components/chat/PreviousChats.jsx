import { useEffect, useState } from "react";
import { History, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { chatMetaLine, sortChats } from "@/lib/chat-sessions";
import { harnessLabel } from "@/lib/harness";
import { relativeTime } from "@/lib/member-history";
import { cn } from "@/lib/utils";

/**
 * Previous chats (ADR-0113): an icon button beside New chat that opens a
 * plain popover list of the conversations put away for this member. Each row
 * is the first question, a muted meta line (turns, engine, when) and a quiet
 * Remove; the row itself opens the chat, bringing its engine session back.
 *
 *   chats      summaries from GET /api/members/:id/chats
 *   loading    whether a list request is in flight
 *   onLoad     called when the popover opens (refetch)
 *   onOpen     (chat) => bring it back
 *   onRemove   (chat) => delete it
 *   disabled   true while the member is answering (opening would cut it off)
 */
export function PreviousChats({ chats = [], loading = false, onLoad, onOpen, onRemove, disabled = false, copy = {}, locale = "en-US", className = "" }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [armedId, setArmedId] = useState("");
  const list = sortChats(chats);
  const label = copy.previousChats || "Previous chats";

  // Refetch when the list opens, not on every render while it is open.
  useEffect(() => {
    if (open) onLoad?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function act(chat, fn) {
    if (!fn || busyId) return;
    setBusyId(chat.id);
    try {
      await fn(chat);
    } finally {
      setBusyId("");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className={cn("relative", className)} aria-label={label} data-testid="previous-chats">
              <History />
              {list.length ? <span className="sr-only">{list.length}</span> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="px-3 pb-2 pt-3">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.previousChatsHint || "New chat keeps the conversation here. Open one to continue it with the engine's own session."}</p>
        </div>
        <div className="max-h-80 overflow-y-auto border-t border-border/70">
          {list.length ? (
            <ul className="divide-y divide-border/60">
              {list.map((chat) => (
                <li key={chat.id} className="flex items-start gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md px-1 py-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
                    disabled={disabled || busyId === chat.id}
                    onClick={() => act(chat, async (item) => { await onOpen?.(item); setOpen(false); })}
                  >
                    <span className="block truncate text-sm">{chat.title || copy.chat || "Chat"}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {chatMetaLine(chat, { harnessName: harnessLabel, relative: (value, now) => relativeTime(value, { now, locale, copy }), copy })}
                      {chat.resumable ? "" : ` · ${copy.chatSessionGone || "new engine session"}`}
                    </span>
                  </button>
                  {/* One click on a small bin used to delete a whole
                      conversation for good; the first click now asks, as
                      Delete channel does. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size={armedId === chat.id ? "sm" : "icon-sm"}
                    className={cn("mt-0.5 text-muted-foreground", armedId === chat.id && "text-destructive hover:text-destructive")}
                    aria-label={armedId === chat.id ? `${copy.confirmRemovePreviousChat || "Remove for good?"} ${chat.title || ""}`.trim() : `${copy.removePreviousChat || "Remove"} ${chat.title || ""}`.trim()}
                    disabled={busyId === chat.id}
                    onBlur={() => setArmedId((current) => (current === chat.id ? "" : current))}
                    onClick={() => {
                      if (armedId !== chat.id) { setArmedId(chat.id); return; }
                      setArmedId("");
                      void act(chat, onRemove);
                    }}
                  >
                    {armedId === chat.id ? copy.confirmRemoveShort || "Remove?" : <Trash2 />}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">{loading ? copy.loading || "Loading…" : copy.noPreviousChats || "No previous chats yet."}</p>
          )}
        </div>
        {disabled ? <p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">{copy.previousChatsBusy || "Wait for the current reply to finish, or stop it, before opening another chat."}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
