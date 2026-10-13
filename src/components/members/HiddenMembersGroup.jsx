import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The directory's "Hidden" group (ADR-0106): a collapsed disclosure under
 * the member list, divider rows inside, one Show action per row. A hidden
 * member is out of the sidebar and the main list, not out of the squad, so
 * the way back sits where the member went.
 */
export function HiddenMembersGroup({ members = [], copy = {}, renderAvatar, roleFor, onShow, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!members.length) return null;
  return (
    <section aria-labelledby="squad-hidden" className="mt-2">
      <button
        type="button"
        id="squad-hidden"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {copy.hiddenMembers || "Hidden"}
        <span className="text-muted-foreground/70">· {members.length}</span>
      </button>
      {open ? (
        <ul className="flex flex-col border-t border-border/60">
          {members.map((agent) => (
            <li key={agent.id} className="group flex items-center gap-3 border-b border-border/60 px-2 py-2.5">
              {renderAvatar ? renderAvatar(agent, "size-8") : null}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
                  onClick={() => onOpen?.(agent)}
                >
                  {agent.name}
                </button>
                <p className="truncate text-xs text-muted-foreground">{roleFor ? roleFor(agent) : agent.role}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => onShow?.(agent)}>
                {copy.showMember || "Show"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
