import { useState } from "react";
import { LayoutTemplate, Plus, UserPlus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ROW = "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The "+" where members are created (ADR-0118): New member, New team…,
 * Templates…. One popover of plain rows, like every menu here; the trigger
 * is whatever the caller already had (the sidebar's small plus).
 */
export function CreateMenu({ copy = {}, onNewMember, onNewTeam, onTemplates, trigger, align = "end" }) {
  const [open, setOpen] = useState(false);
  function run(action) {
    setOpen(false);
    action?.();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createLabel || "Create"}>
            <Plus className="size-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-44 p-1">
        <button type="button" className={ROW} onClick={() => run(onNewMember)}>
          <UserPlus className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{copy.newMember || "New member"}</span>
        </button>
        {onNewTeam ? (
          <button type="button" className={ROW} onClick={() => run(onNewTeam)}>
            <Users className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{copy.newTeamMenu || "New team…"}</span>
          </button>
        ) : null}
        {onTemplates ? (
          <button type="button" className={ROW} onClick={() => run(onTemplates)}>
            <LayoutTemplate className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{copy.templatesMenu || "Templates…"}</span>
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
