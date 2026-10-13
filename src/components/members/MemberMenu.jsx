import { useState } from "react";
import { CalendarClock, CircleUserRound, Copy, Ellipsis, EllipsisVertical, Eye, EyeOff, Mail, MailOpen, MessageSquareText, PauseCircle, Pin, PinOff, Play, Share2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * The one member menu, on a directory row, a sidebar row and the chat header
 * (ADR-0106). Pin, Mark unread, Duplicate, Share as preset, Hide and Remove
 * keep the same order everywhere; an item is shown only when its handler is
 * given, so the chat header can leave out "Open chat". Built from the
 * popover primitive like the other menus here; Remove keeps the caller's
 * confirm dialog and only asks for it.
 */
export function MemberMenu({
  agent,
  copy = {},
  trigger = "ellipsis",
  align = "end",
  side,
  className,
  onChat,
  onProfile,
  onAutomations,
  resting = false,
  toggleStateLabel = "",
  onToggleState,
  pinned = false,
  onPin,
  unread = 0,
  canMarkUnread = true,
  onMarkUnread,
  onMarkRead,
  onDuplicate,
  onSharePreset,
  hidden = false,
  onHide,
  onRemove,
}) {
  const [open, setOpen] = useState(false);
  const name = agent?.name || copy.squadMember || "member";
  function run(action) {
    setOpen(false);
    action?.();
  }
  const navigation = [
    onChat ? { icon: MessageSquareText, label: copy.openChat || "Open chat", action: onChat } : null,
    onProfile ? { icon: CircleUserRound, label: copy.viewProfile || "View profile", action: onProfile } : null,
    onAutomations ? { icon: CalendarClock, label: copy.automations || "Automations", action: onAutomations } : null,
  ].filter(Boolean);
  const unreadItem = unread > 0 && onMarkRead
    ? { icon: MailOpen, label: copy.markRead || "Mark read", action: onMarkRead }
    : onMarkUnread
      ? { icon: Mail, label: copy.markUnread || "Mark unread", action: onMarkUnread, disabled: !canMarkUnread }
      : null;
  const attention = [
    onPin ? { icon: pinned ? PinOff : Pin, label: pinned ? copy.unpin || "Unpin" : copy.pin || "Pin", action: onPin } : null,
    unreadItem,
  ].filter(Boolean);
  const copies = [
    onDuplicate ? { icon: Copy, label: copy.duplicateMember || "Duplicate", action: onDuplicate } : null,
    onSharePreset ? { icon: Share2, label: copy.shareAsPreset || "Share as preset…", action: onSharePreset } : null,
  ].filter(Boolean);
  const visibility = [
    onHide ? { icon: hidden ? Eye : EyeOff, label: hidden ? copy.showMember || "Show" : copy.hideMember || "Hide", action: onHide } : null,
    onToggleState
      ? { icon: resting ? Play : PauseCircle, label: toggleStateLabel || (resting ? copy.setActive || "Set active" : copy.pauseMember || "Pause member"), action: onToggleState }
      : null,
  ].filter(Boolean);
  const groups = [navigation, attention, copies, visibility].filter((group) => group.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={trigger === "vertical" ? "icon-sm" : "icon"}
          className={cn(trigger === "vertical" ? "size-6" : "size-8", "text-muted-foreground hover:text-foreground", className)}
          aria-label={`${copy.memberActions || "Actions for"} ${name}`}
          onClick={(event) => event.stopPropagation()}
        >
          {trigger === "vertical" ? <EllipsisVertical className="size-3.5" /> : <Ellipsis className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-52 p-1">
        {groups.map((group, index) => (
          <div key={index}>
            {index > 0 ? <Separator className="my-1" /> : null}
            {group.map((item) => (
              <MenuItem key={item.label} icon={item.icon} disabled={item.disabled} onClick={() => run(item.action)}>
                {item.label}
              </MenuItem>
            ))}
          </div>
        ))}
        {onRemove ? (
          <>
            {groups.length ? <Separator className="my-1" /> : null}
            <MenuItem icon={Trash2} destructive onClick={() => run(onRemove)}>
              {copy.removeMember || "Remove member"}
            </MenuItem>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ icon: Icon, children, onClick, destructive = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted disabled:hover:bg-transparent"
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
