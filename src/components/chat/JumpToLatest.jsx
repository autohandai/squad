import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";

function scrollParentOf(node) {
  // Radix's ScrollArea switches its viewport to overflow: scroll only after
  // its own effects run, so on first render it still reads "hidden" and an
  // overflow search alone found nothing. Its viewport is marked; prefer it.
  const viewport = node?.closest?.("[data-radix-scroll-area-viewport]");
  if (viewport) return viewport;
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const overflow = window.getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el;
  }
  return null;
}

/**
 * "Jump to latest", pinned to the bottom of the scrolling conversation once
 * the reader is more than a screen up. Long threads otherwise meant dragging
 * the scrollbar back down after reading an earlier answer. `anchorRef` is the
 * element at the end of the stream; `watch` changes when messages arrive.
 */
export function JumpToLatest({ anchorRef, watch, label = "Jump to latest" }) {
  const [away, setAway] = useState(false);
  // How many messages arrived since the reader scrolled up: "3 new".
  const seenAtRef = useRef(watch);
  useEffect(() => {
    if (!away) seenAtRef.current = watch;
  }, [away, watch]);
  const arrived = away && typeof watch === "number" && typeof seenAtRef.current === "number" ? Math.max(0, watch - seenAtRef.current) : 0;
  useEffect(() => {
    const scroller = scrollParentOf(anchorRef.current);
    if (!scroller) return undefined;
    const check = () => setAway(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > scroller.clientHeight * 0.75);
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    return () => scroller.removeEventListener("scroll", check);
  }, [anchorRef, watch]);
  if (!away) return null;
  return (
    <div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-events-auto h-7 gap-1.5 bg-background/95 text-xs shadow-sm"
        onClick={() => anchorRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" })}
      >
        <ArrowDown className="size-3.5" />
        {arrived ? `${arrived} new` : label}
      </Button>
    </div>
  );
}
