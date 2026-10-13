import { useState } from "react";
import { Download, Ellipsis, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The directory header's quiet overflow: Share team… and Import team… (ADR-0106). */
export function TeamMenu({ copy = {}, onShare, onImport }) {
  const [open, setOpen] = useState(false);
  function run(action) {
    setOpen(false);
    action?.();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={copy.teamActions || "Team actions"}>
          <Ellipsis className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <button type="button" className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => run(onShare)}>
          <Download className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{copy.shareTeam || "Share team…"}</span>
        </button>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => run(onImport)}>
          <Upload className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{copy.importTeam || "Import team…"}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
