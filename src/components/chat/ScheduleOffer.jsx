import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Schedule this?" (ADR-0124 §4): one quiet line under a reply when the
 * person named recurring work and the member proposed no schedule. Nothing
 * is created until the schedule editor, opened pre-filled, is saved.
 *
 *   offer      { phrase, title, description, timeZone, schedule, instructions }
 *   onSchedule opens the editor with the offer
 *   onDismiss  hides the line for this message
 */
export function ScheduleOffer({ offer, memberName = "The member", copy = {}, onSchedule, onDismiss }) {
  if (!offer?.schedule) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 pt-3 text-sm" data-testid="schedule-offer">
      <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        <span className="text-foreground">{copy.scheduleOfferTitle || "Schedule this?"}</span>{" "}
        {(copy.scheduleOfferHint || "You said “{phrase}”; {name} did not set it up. {description}.").replace("{phrase}", offer.phrase).replace("{name}", memberName).replace("{description}", offer.description || "")}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onSchedule?.(offer)}>
          {copy.scheduleOfferAction || "Set it up"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => onDismiss?.(offer)}>
          {copy.folderAccessDismiss || "Not now"}
        </Button>
      </span>
    </div>
  );
}
