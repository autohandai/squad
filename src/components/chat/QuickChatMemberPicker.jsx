import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleUserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { PresenceDot } from "@/components/members/PresenceDot";
import { isOnBreak } from "@/lib/member-availability";
import { presenceDescription, presenceFor } from "@/lib/presence-states";

function visibleMembers(members) {
  return (Array.isArray(members) ? members : []).filter((member) => member?.id && member?.name);
}
function memberPresence(member, entryFor) {
  return entryFor?.(member) || presenceFor(member.id, null, { memberStatus: member.status });
}
function displayedPresence(member, entryFor) {
  const entry = memberPresence(member, entryFor);
  return isOnBreak(member) ? { ...entry, state: "offline" } : entry;
}
const carouselOptions = { align: "start", containScroll: "trimSnaps", dragFree: true, inViewThreshold: 0.95, loop: false };
/** Use the same result for the picker and Conversation; explicit choices win. */
export function quickChatMemberSelection(members, activeMemberId, entryFor) {
  const list = visibleMembers(members);
  return list.find((member) => member.id === activeMemberId)
    || list.find((member) => !isOnBreak(member) && ["online", "idle", "working"].includes(memberPresence(member, entryFor).state))
    || list.find((member) => !isOnBreak(member) && !["archived", "disabled"].includes(member.status))
    || list[0] || null;
}

/** Visible portraits are the recipient switcher; one quiet line names the choice. */
export function QuickChatMemberPicker({ members = [], activeMemberId, onSelect, entryFor, copy = {}, renderAvatar }) {
  const list = visibleMembers(members);
  const selected = quickChatMemberSelection(list, activeMemberId, entryFor);
  const [api, setApi] = useState(null);
  const [scrollable, setScrollable] = useState({ previous: false, next: false });
  const buttons = useRef(new Map());
  const selectedIndex = list.findIndex(member => member.id === selected?.id);

  useEffect(() => {
    if (!api) return;
    const sync = () => setScrollable({ previous: api.canScrollPrev(), next: api.canScrollNext() });
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => { api.off("select", sync); api.off("reInit", sync); };
  }, [api]);

  useEffect(() => {
    if (!api || selectedIndex < 0 || api.slidesInView().includes(selectedIndex)) return;
    api.scrollTo(selectedIndex);
  }, [api, selectedIndex, list.length]);

  useEffect(() => {
    if (!api) return;
    const viewport = api.rootNode();
    let distance = 0;
    let lastAt = 0;
    const wheel = event => {
      const delta = event.shiftKey ? event.deltaY || event.deltaX : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
      if (!delta || event.ctrlKey || (!api.canScrollNext() && !api.canScrollPrev())) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastAt > 250 || Math.sign(distance) !== Math.sign(delta)) distance = 0;
      lastAt = now;
      distance += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1);
      if (Math.abs(distance) < 32) return;
      const steps = Math.trunc(distance / 32);
      distance -= steps * 32;
      const target = Math.max(0, Math.min(api.scrollSnapList().length - 1, api.selectedScrollSnap() + steps));
      api.scrollTo(target);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [api]);

  if (!selected) return <p className="px-3 py-3 text-sm text-muted-foreground">Add a squad member to start a conversation.</p>;
  function avatar(member) {
    return renderAvatar ? renderAvatar(member, "size-9") : <Avatar key={`${member.id}:${member.avatar || "placeholder"}`} className="size-9 rounded-md">
      {member.avatar ? <AvatarImage src={member.avatar} alt="" className="object-cover" /> : null}
      <AvatarFallback className="rounded-md"><CircleUserRound className="size-5" aria-hidden="true" /></AvatarFallback>
    </Avatar>;
  }
  function stateLabel(member) {
    return isOnBreak(member) ? copy.memberBreakLabel || "On a break" : presenceDescription(memberPresence(member, entryFor), copy);
  }
  function selectWithKeyboard(event) {
    const memberId = event.target.closest?.("button[data-member-id]")?.dataset.memberId;
    if (!memberId || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const index = list.findIndex(member => member.id === memberId);
    const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(list[next].id);
    api?.scrollTo(next);
    buttons.current.get(list[next].id)?.focus({ preventScroll: true });
  }
  const overflow = scrollable.previous || scrollable.next;
  return (
    <div className="shrink-0 border-b border-border/60 px-3 pb-2 pt-1" data-testid="quick-chat-member-picker">
      <div className="flex min-w-0 items-center gap-1">
        {overflow ? <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label="Previous squad members" disabled={!scrollable.previous} onClick={() => api?.scrollPrev()}><ChevronLeft className="size-3.5" /></Button> : null}
        <Carousel opts={carouselOptions} setApi={setApi} className="min-w-0 flex-1" aria-label="Squad members" data-testid="quick-chat-member-carousel" onKeyDownCapture={selectWithKeyboard}>
          <CarouselContent className="ml-0 gap-1 py-1">
            {list.map(member => <CarouselItem key={member.id} className="basis-auto pl-0">
              <Button ref={node => { if (node) buttons.current.set(member.id, node); else buttons.current.delete(member.id); }} type="button" variant="ghost" size="icon" className="relative size-11 rounded-md border border-transparent p-[3px] aria-pressed:border-primary/65 aria-pressed:ring-1 aria-pressed:ring-primary/15" data-member-id={member.id} aria-pressed={member.id === selected.id} tabIndex={member.id === selected.id ? 0 : -1} aria-label={[member.name, member.role, stateLabel(member)].filter(Boolean).join(" · ")} title={[member.name, member.role, stateLabel(member)].filter(Boolean).join(" · ")} onClick={event => { if (!event.defaultPrevented) onSelect?.(member.id); }}>
                {avatar(member)}
                <PresenceDot entry={displayedPresence(member, entryFor)} copy={copy} className="absolute bottom-0.5 right-0.5" />
              </Button>
            </CarouselItem>)}
          </CarouselContent>
        </Carousel>
        {overflow ? <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label="Next squad members" disabled={!scrollable.next} onClick={() => api?.scrollNext()}><ChevronRight className="size-3.5" /></Button> : null}
      </div>
      <p className="flex min-w-0 items-baseline gap-1.5 px-1 text-xs" data-testid="quick-chat-selected-member">
        <span className="max-w-[8rem] shrink-0 truncate font-medium">{selected.name}</span>
        <span className="min-w-0 truncate text-muted-foreground">{[selected.role, stateLabel(selected)].filter(Boolean).join(" · ")}</span>
      </p>
    </div>
  );
}
