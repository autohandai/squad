import { useState } from "react";
import { Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Stop a member from the UI (ADR-0016): closes its warm session and aborts
 * its runs through `onStop(memberId)`, which the integrator maps to
 * `POST /api/members/:id/stop`. The confirm is a small popover, not a
 * dialog: it is a routine action, and the copy says what ends.
 */
export function StopMemberButton({
  member,
  onStop,
  disabled = false,
  iconOnly = false,
  size = "sm",
  className,
  copy = {},
}) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const name = member?.name || copy.squadMember || "this member";
  const label = copy.stopMember || "Stop";
  const question = (copy.stopMemberConfirm || "Stop {name}? Running work will end.").replace("{name}", name);

  async function confirm() {
    if (!member?.id || stopping) return;
    setStopping(true);
    setError("");
    try {
      await onStop?.(member.id);
      setOpen(false);
    } catch (cause) {
      // Keep the popover open so the person sees why nothing changed.
      setError(cause?.message || copy.stopMemberFailed || "Could not stop this member.");
    } finally {
      setStopping(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (stopping) return;
        setOpen(next);
        if (!next) setError("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={iconOnly ? "icon-sm" : size}
          disabled={disabled || !member?.id}
          aria-label={iconOnly ? `${label} ${name}` : undefined}
          className={cn("text-muted-foreground hover:text-foreground", className)}
        >
          <Square className="size-3.5 fill-current" aria-hidden="true" />
          {iconOnly ? null : <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-3">
        <p className="text-sm leading-5 text-foreground">{question}</p>
        {error ? <p className="mt-2 text-xs leading-4 text-destructive">{error}</p> : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={stopping} onClick={() => setOpen(false)}>
            {copy.cancel || "Cancel"}
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={stopping} onClick={confirm}>
            {stopping ? <Spinner className="size-3.5" /> : <Square className="size-3 fill-current" aria-hidden="true" />}
            {stopping ? copy.stopMemberStopping || "Stopping…" : label}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
