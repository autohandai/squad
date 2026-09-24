import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A member asking to join the channel, shown to the user only (ADR-0015).
 * Calm, divider-separated, two actions. Never part of the message stream that
 * members see.
 */
export function JoinProposal({ proposal, copy = {}, renderAvatar, onAccept, onDismiss, className }) {
  const { agent, title, body } = proposal;
  return (
    <div className={cn("flex items-start gap-3 border-t border-border/70 px-1 pb-1 pt-3 text-sm", className)} role="status">
      {renderAvatar ? renderAvatar(agent, "size-8 rounded-md") : <UserPlus className="mt-1 size-4 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{copy.onlyYouSeeThis || "Only you see this"}</span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onAccept?.(proposal)}>
            {(copy.addMember || "Add {name}").replace("{name}", agent.name)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDismiss?.(proposal)}>
            {copy.notNow || "Not now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
