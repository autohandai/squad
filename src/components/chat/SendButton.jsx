import { forwardRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The composer's send and stop button (ADR-0261): one filled circle in every
 * composer. Ready to send: the foreground circle with an up-arrow. Nothing to
 * send: the same circle, quiet, so it never reads as a broken control. A reply
 * running: the same circle with a stop square (the owner liked that state and
 * the send state now matches it). The paper-plane icon is gone.
 */
export const SendButton = forwardRef(function SendButton({ sending = false, disabled = false, size = "md", label, className, ...props }, ref) {
  const dimension = size === "sm" ? "size-8" : "size-9";
  return (
    <button
      ref={ref}
      type={sending ? "button" : "submit"}
      disabled={!sending && disabled}
      aria-label={label}
      title={label}
      data-send-state={sending ? "stop" : disabled ? "empty" : "ready"}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full transition-[background-color,color,transform] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95",
        dimension,
        sending || !disabled ? "bg-foreground text-background hover:bg-foreground/85" : "cursor-default bg-muted text-muted-foreground/70",
        className,
      )}
      {...props}
    >
      {sending ? <Square className={cn("fill-current", size === "sm" ? "size-3" : "size-3.5")} aria-hidden="true" /> : <ArrowUp className={size === "sm" ? "size-4" : "size-[18px]"} strokeWidth={2.5} aria-hidden="true" />}
    </button>
  );
});
