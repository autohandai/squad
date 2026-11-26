import { cn } from "@/lib/utils"

/** A thin ring that turns (ADR-0284). Announced as "Loading" unless it is
 * marked aria-hidden beside words that already say what is happening. */
function Spinner({ className, "aria-label": label = "Loading", "aria-hidden": hidden, ...props }) {
  const decorative = hidden === true || hidden === "true";
  return (
    <span
      data-slot="spinner"
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn("loading-ring size-4", className)}
      {...props} />
  );
}

export { Spinner }
