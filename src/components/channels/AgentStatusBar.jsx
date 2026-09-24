import { cn } from "@/lib/utils";

/**
 * Quiet status footer under the composer: "Honey: Working". Renders nothing
 * when no member is active so the surface stays calm.
 */
export function AgentStatusBar({ items = [], renderAvatar, workingLabel = "Working", className }) {
  if (!items.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted-foreground", className)} aria-live="polite">
      {items.map((item) => (
        <span key={item.agent.id} className="inline-flex items-center gap-1.5">
          {renderAvatar ? renderAvatar(item.agent, "size-4 rounded") : null}
          <span className="font-medium text-foreground/80">{item.agent.name}:</span>
          <span>{item.label || workingLabel}</span>
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
        </span>
      ))}
    </div>
  );
}
