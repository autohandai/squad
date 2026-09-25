import { presenceDescription, presenceMeta } from "@/lib/presence-states";
import { cn } from "@/lib/utils";

/**
 * A member's presence as one small dot (ADR-0016). Green online, accent and
 * breathing while working, amber idle, grey offline, and a dotted ring when
 * the bridge cannot be asked. The pulse is reserved for work in progress so
 * the sidebar stays still otherwise.
 *
 * `entry` is what `presenceFor()` returns; `state` alone also works.
 */
export function PresenceDot({ entry, state, size = "sm", ring = true, className, copy = {} }) {
  const meta = presenceMeta(entry?.state ?? state, copy);
  const description = presenceDescription(entry || { state: meta.state }, copy);
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      data-presence={meta.state}
      className={cn(
        "inline-flex shrink-0 rounded-full",
        size === "xs" ? "size-1.5" : size === "md" ? "size-3" : "size-2",
        // Sidebar avatars sit on `bg-card`; the ring cuts the dot out of the
        // avatar edge like the existing badge did.
        ring && "ring-2 ring-background",
        meta.dotClassName,
        meta.pulse && "animate-pulse",
        className
      )}
    />
  );
}

/** Dot plus label, for meta lines ("● Working"). */
export function PresenceLabel({ entry, state, className, copy = {} }) {
  const meta = presenceMeta(entry?.state ?? state, copy);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <PresenceDot entry={entry} state={state} size="xs" ring={false} copy={copy} />
      <span className={cn("truncate", meta.textClassName)}>{meta.label}</span>
    </span>
  );
}
