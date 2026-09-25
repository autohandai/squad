import { useState } from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { groupNotifications, relativeTime } from "@/lib/notifications";
import { cn } from "@/lib/utils";

function NotificationRow({ item, now, onOpen }) {
  const unread = !item.read;
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
      onClick={() => onOpen?.(item)}
    >
      <span className={cn("min-w-0 truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>{item.title}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <time dateTime={item.at}>{relativeTime(item.at, now)}</time>
        {unread ? <span className="size-1.5 rounded-full bg-foreground" aria-label="unread" /> : null}
      </span>
      {item.body ? <span className="col-span-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.body}</span> : null}
    </button>
  );
}

/**
 * Sidebar bell with an unread dot and a popover feed. Purely presentational:
 * `items` come from GET /api/notifications, `onOpen(item)` navigates and
 * `onMarkAllRead()` posts to /api/notifications/read.
 */
export function NotificationBell({ items = [], unread = 0, onOpen, onMarkAllRead, copy = {} }) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const label = copy.notifications || "Notifications";
  const groups = groupNotifications(items, now);

  function openItem(item) {
    setOpen(false);
    onOpen?.(item);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={unread ? `${label} · ${unread} unread` : label}
            >
              <Bell />
              {unread ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden="true" /> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border/70 px-3">
          <span className="text-sm font-medium">{label}</span>
          {items.length ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" disabled={!unread} onClick={() => onMarkAllRead?.()}>
              {copy.markAllRead || "Mark all read"}
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{copy.notificationsEmpty || "Nothing yet. Finished runs, handoffs and mentions land here."}</p>
        ) : (
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {copy[`notifications${group.label}`] || group.label}
                </div>
                <div className="divide-y divide-border/60">
                  {group.items.map((item) => (
                    <NotificationRow key={item.id} item={item} now={now} onOpen={openItem} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
