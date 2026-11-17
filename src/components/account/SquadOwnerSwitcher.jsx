import { createContext, useContext, useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ownershipFetch } from "@/lib/ownership-client";
import { cn } from "@/lib/utils";

/** The verified ownership context, provided by OwnershipBootstrap. */
export const SquadOwnershipContext = createContext(null);
export const useSquadOwnership = () => useContext(SquadOwnershipContext);

async function request(path, generation, init = {}) {
  const response = await ownershipFetch(path, { ...init, headers: { ...init.headers, "x-squad-context": generation } });
  const value = await response.json();
  if (!response.ok || value.success !== true) throw Error(typeof value.error === "string" ? value.error : value.error?.message || "Squad could not switch.");
  return value.data;
}

const describe = (owner) => (owner?.kind === "team" ? "Team-owned members and data" : "Your personal members and data");

export const squadOwnerKey = (owner) => `${owner?.kind}:${owner?.id}`;

/**
 * The Squads this account belongs to (personal first, then teams), read from
 * the ownership broker under the current context. While team Squads are off
 * for the account (`context.teamSquads`), the broker lists only the Personal
 * Squad. `owners` is empty until it resolves; `error` carries a broker or
 * team-lookup problem as one sentence.
 */
export function useSquadOwners(context) {
  const [owners, setOwners] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!context?.generation) return undefined;
    let active = true;
    request("/api/ownership/owners", context.generation).then(
      (value) => { if (active) { setOwners(value.owners || []); setError(value.error || ""); } },
      (failure) => { if (active) setError(failure.message); }
    );
    return () => { active = false; };
    // Team Squads can be turned on or off for the account without a new context (ADR-0239).
  }, [context?.generation, context?.teamSquads]);
  return { owners, error, setError };
}

/**
 * Switch to another Squad through the broker. The broker revokes the current
 * context, drains background work and verifies the new owner before it is
 * ready; the page then reloads into a fresh JavaScript realm for that owner
 * (OwnershipBootstrap shows "Finishing background work…" meanwhile). Resolves
 * false when `item` is already the selected Squad; throws with a sentence when
 * the broker refuses.
 */
export async function switchSquadOwner(context, item) {
  if (!context?.owner || squadOwnerKey(item.owner) === squadOwnerKey(context.owner)) return false;
  await request("/api/ownership/select", context.generation, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: item.owner, expectedGeneration: context.generation }),
  });
  window.location.replace("/squad");
  return true;
}

/**
 * A backup sync failure, as one muted line. It used to ride along with the
 * sidebar switcher; the sidebar keeps only this line (ADR-0234).
 */
export function SquadSyncNotice() {
  const [error, setError] = useState("");
  useEffect(() => {
    const show = (event) => setError(event.detail || "Current conversations could not be saved for backups.");
    window.addEventListener("squad:backup-sync-error", show);
    return () => window.removeEventListener("squad:backup-sync-error", show);
  }, []);
  return error ? <p className="px-1.5 text-xs text-destructive" role="status">{error}</p> : null;
}

/**
 * Quiet personal/team Squad switcher for the pages that stand outside the app
 * shell (the read-only team page and the restore-complete page), where
 * Settings is not reachable and a person still needs a way to leave. Inside
 * the app, switching lives in Settings › Squads (ADR-0234).
 */
export function SquadOwnerSwitcher({ context, className, alwaysShow = false }) {
  const { owners, error, setError } = useSquadOwners(context);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = (event) => setError(event.detail || "Current conversations could not be saved for backups.");
    window.addEventListener("squad:backup-sync-error", show);
    return () => window.removeEventListener("squad:backup-sync-error", show);
  }, [setError]);

  if (!context?.owner) return null;
  const selected = `${context.owner.kind}:${context.owner.id}`;
  const status = context.state !== "ready" ? "Work paused" : context.canWrite ? "" : "Read only";
  const hasChoice = owners.length > 1;
  const errorLine = error ? <p className="px-1.5 text-xs text-destructive" role="status">{error}</p> : null;
  if (!hasChoice && !alwaysShow && !status) return errorLine;

  async function choose(item) {
    setOpen(false);
    if (squadOwnerKey(item.owner) === selected) return;
    setBusy(true); setError("");
    try { await switchSquadOwner(context, item); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy || !hasChoice}
            className={cn(
              "flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors enabled:hover:bg-muted/55 enabled:hover:text-foreground",
              className
            )}
            aria-label={`Squad: ${context.ownerLabel}. Choose personal or team Squad`}
          >
            <span className="min-w-0 truncate">{context.ownerLabel}</span>
            {status ? <span className="shrink-0">· {status}</span> : null}
            {hasChoice ? <ChevronDown className="size-3 shrink-0" aria-hidden="true" /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Squads</p>
          <ul className="flex flex-col" role="listbox" aria-label="Squads">
            {owners.map((item) => {
              const key = `${item.owner.kind}:${item.owner.id}`;
              const isSelected = key === selected;
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/55", isSelected ? "text-foreground" : "text-foreground/85")}
                    onClick={() => void choose(item)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("truncate", isSelected && "font-medium")}>{item.label}{item.canWrite ? "" : " · Read only"}</span>
                      <span className="truncate text-xs text-muted-foreground">{describe(item.owner)}</span>
                    </span>
                    {isSelected ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      {errorLine}
    </div>
  );
}
