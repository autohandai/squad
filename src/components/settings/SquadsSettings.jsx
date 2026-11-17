import { useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSectionHeader } from "@/components/settings/SettingsShell";
import { squadOwnerKey, switchSquadOwner, useSquadOwners, useSquadOwnership } from "@/components/account/SquadOwnerSwitcher";

const ROLE_LABELS = { owner: "Owner", admin: "Admin", editor: "Editor" };

/** The quiet second line under a Squad's name: what kind it is and what you can do in it. */
export function squadDetail(item) {
  if (item.owner?.kind !== "team") return "Personal · Your own members and data";
  const parts = ["Team"];
  if (!item.canWrite) parts.push("Read only");
  else if (ROLE_LABELS[item.role]) parts.push(ROLE_LABELS[item.role]);
  return parts.join(" · ");
}

/**
 * Settings › Squads (ADR-0234, ADR-0239). Lists the Squads this account belongs to,
 * marks the current one and switches through the same broker flow the old
 * sidebar switcher used: drain, verify, then reload into the new owner.
 */
export function SquadsSettings() {
  const context = useSquadOwnership();
  const { owners, error, setError } = useSquadOwners(context);
  const [switching, setSwitching] = useState(null);
  const current = context?.owner ? squadOwnerKey(context.owner) : "";
  // Team Squads sit behind the squad_team_squads flag (ADR-0239); while it is
  // off the list is the Personal Squad alone and says nothing about teams.
  const teamSquads = context?.teamSquads === true;

  async function choose(item) {
    setSwitching(item); setError("");
    try { if (!(await switchSquadOwner(context, item))) setSwitching(null); }
    catch (failure) { setError(failure.message); setSwitching(null); }
  }

  // The current Squad is always listed, even before the owners call returns.
  const list = owners.length ? owners : context?.owner ? [{ owner: context.owner, label: context.ownerLabel, canWrite: context.canWrite, role: "" }] : [];

  return (
    <>
      <SettingsSectionHeader
        title="Squads"
        description={teamSquads
          ? "Each Squad has its own members, conversations and data, and switching opens the one you choose."
          : "Your Personal Squad holds your own members, conversations and data."}
      />
      {!context?.owner ? (
        <p className="text-sm text-muted-foreground">Your Squads appear here once Squad has verified your account.</p>
      ) : (
        <div className="max-w-2xl">
          <ul className="divide-y border-y" aria-label="Your Squads">
            {list.map((item) => {
              const key = squadOwnerKey(item.owner);
              const isCurrent = key === current;
              const isSwitching = switching && squadOwnerKey(switching.owner) === key;
              return (
                <li key={key} className="flex min-h-14 items-center gap-4 py-2.5" data-squad-row={key} aria-current={isCurrent ? "true" : undefined}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{squadDetail(item)}</span>
                  </span>
                  {isCurrent ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="size-3.5" aria-hidden="true" />
                      Current
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={Boolean(switching)}
                      onClick={() => void choose(item)}
                      aria-label={`Switch to ${item.label}`}
                    >
                      {isSwitching ? <Spinner data-icon="inline-start" /> : null}
                      {isSwitching ? "Switching…" : "Switch"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {switching ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              Finishing background work, then opening {switching.label}.
            </p>
          ) : null}
          {teamSquads && owners.length === 1 ? (
            <p className="mt-3 text-sm text-muted-foreground">Teams you belong to on Autohand appear here as their own Squads.</p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
      )}
    </>
  );
}
