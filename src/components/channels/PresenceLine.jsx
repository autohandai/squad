import { cn } from "@/lib/utils";
import { STATE_ORDER, presenceSentence } from "@/lib/presence";

export { presenceFromMessages, presenceSentence } from "@/lib/presence";

/**
 * One living line under the composer: who is thinking, typing, or running
 * tools right now. Groups members by state and reads like a sentence
 * ("Iris, Noah and 2 others are thinking…"). Renders nothing when idle and
 * reserves no height, so it never shifts the layout. See ADR-0014.
 */
export function PresenceLine({ items = [], renderAvatar, copy = {}, className }) {
  const groups = STATE_ORDER.map((state) => ({ state, items: items.filter((item) => item.state === state) })).filter((group) => group.items.length);
  if (!groups.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-2 text-xs text-muted-foreground", className)} aria-live="polite">
      {groups.map((group) => (
        <span key={group.state} className="inline-flex items-center gap-2">
          {renderAvatar ? (
            <span className="flex -space-x-1.5">
              {group.items.slice(0, 3).map((item) => (
                <span key={item.agent.id} className="rounded-full ring-2 ring-background">
                  {renderAvatar(item.agent, "size-4 rounded-full")}
                </span>
              ))}
            </span>
          ) : null}
          <span>{presenceSentence(group.items.map((item) => item.agent.name), group.state, copy)}</span>
          <span className="presence-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </span>
      ))}
    </div>
  );
}
