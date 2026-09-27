import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What the app is waiting for while it starts, with the squad arriving as it
 * becomes ready. Shown only while the bridge has not answered: once it has,
 * the app itself is the better thing to look at.
 *
 * Every row reflects a real check. Nothing here is a fake progress bar.
 *
 * Props
 *   checks   [{ id, label, state: "waiting" | "ok" | "failed", detail? }]
 *   members  [{ id, name }] for the avatars that land as the squad wakes
 *   renderAvatar(member, className)
 *   brand    the logo element
 *   copy
 */
export function BootChecks({ checks = [], members = [], renderAvatar, brand = null, copy = {} }) {
  const ready = members.length;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-background px-6 text-foreground">
      <div className="flex flex-col items-center gap-2.5">
        {brand}
        <p className="text-[15px] font-semibold tracking-tight">Autohand Squad</p>
      </div>

      <ul className="flex w-full max-w-[19rem] flex-col">
        {checks.map((check) => (
          <li key={check.id} className="flex items-center gap-2.5 border-b border-border/55 py-2.5 last:border-b-0">
            <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
              {check.state === "ok" ? (
                <Check className="size-3.5 text-foreground" />
              ) : check.state === "failed" ? (
                <X className="size-3.5 text-destructive" />
              ) : (
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70" />
              )}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-sm", check.state === "waiting" && "text-muted-foreground")}>
              {check.label}
            </span>
            {check.detail ? <span className="shrink-0 truncate text-xs text-muted-foreground">{check.detail}</span> : null}
          </li>
        ))}
      </ul>

      {/* The squad arriving. Each avatar settles in as its member is read, so
          the wait shows something true rather than a spinner. */}
      <div className="flex min-h-8 items-center gap-1.5">
        {members.slice(0, 8).map((member, index) => (
          <span
            key={member.id}
            className="boot-member"
            // A short stagger reads as arriving; longer reads as a queue.
            style={{ animationDelay: `${Math.min(index, 7) * 70}ms` }}
          >
            {renderAvatar ? renderAvatar(member, "size-7 rounded-md") : null}
          </span>
        ))}
      </div>

      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {ready ? `${ready} ${ready === 1 ? copy.memberReady || "member ready" : copy.membersReady || "members ready"}` : copy.wakingSquad || "Waking the squad…"}
      </p>
    </div>
  );
}
