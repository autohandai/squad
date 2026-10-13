// "Context 42%" in the member chat meta line, and the one-line warning once
// the window is nearly full (ADR-0111). Renders nothing when the bridge has
// no gauge for the member: an unknown window is not a number to show.
import { cn } from "@/lib/utils";
import { contextGaugeLabel, contextWarning } from "@/lib/member-queue";

export function ContextGaugeMeta({ gauge, copy = {}, className = "", separator = null }) {
  const label = contextGaugeLabel(gauge, copy);
  if (!label) return null;
  return (
    <>
      {separator}
      <span
        className={cn("min-w-0 truncate tabular-nums", gauge?.warning && "text-amber-700 dark:text-amber-300", className)}
        data-context-gauge={gauge.percent}
        title={gauge?.window ? `${gauge.usedTokens.toLocaleString()} of ${gauge.window.toLocaleString()} tokens on the last request` : undefined}
      >
        {label}
      </span>
    </>
  );
}

export function ContextWarningLine({ gauge, copy = {}, className = "" }) {
  const text = contextWarning(gauge, copy);
  if (!text) return null;
  return (
    <p role="status" className={cn("text-xs text-amber-700 dark:text-amber-300", className)} data-context-warning={gauge.percent}>
      {text}
    </p>
  );
}
