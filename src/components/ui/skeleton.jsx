import { cn } from "@/lib/utils"

/** A placeholder in the final layout with a light sweep (ADR-0284); still
 * under reduced motion. */
function Skeleton({ className, ...props }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("loading-skeleton rounded-md", className)}
      {...props} />
  );
}

export { Skeleton }
