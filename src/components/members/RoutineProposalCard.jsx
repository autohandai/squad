import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatInZone } from "@/lib/routines";
import { cn } from "@/lib/utils";

// Schedule proposals a member made from chat (ADR-0110). Nothing is
// scheduled until Confirm; Decline records the decision. The rule in words,
// the timezone and the next three dates come from the bridge. Rendered as a
// quiet divider section at the top of the member's chat, like channel
// proposals: no card frame, no tinted fill.

export function RoutineProposalCard({ proposals = [], members = [], onDecision, locale, className, copy = {} }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  if (!proposals.length) return null;

  async function decide(id, decision) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      await onDecision(id, decision);
    } catch (failure) {
      setError(failure?.message || "Could not save this decision. Try again.");
    } finally {
      setPending("");
    }
  }

  return (
    <section aria-label={copy.routineProposals || "Schedule proposals"} className={cn("mx-auto w-full max-w-3xl px-4 sm:px-6", className)} data-testid="routine-proposals">
      <p className="pt-4 text-sm font-medium">{copy.routineProposals || "Schedule proposals"}</p>
      <ul className="divide-y divide-border/60">
        {proposals.map((proposal) => {
          const member = members.find((item) => item.id === proposal.memberId);
          return (
            <li key={proposal.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1 text-sm">
                <p>
                  {member?.name || "A teammate"} proposes a routine: <strong>{proposal.title}</strong>
                </p>
                {proposal.instructions ? <p className="text-muted-foreground">{proposal.instructions}</p> : null}
                <p>
                  {proposal.description}
                  {proposal.timeZone ? <span className="text-muted-foreground"> · {proposal.timeZone}</span> : null}
                </p>
                {Array.isArray(proposal.next) && proposal.next.length ? (
                  <ol className="text-xs text-muted-foreground">
                    {proposal.next.map((iso) => (
                      <li key={iso}>{formatInZone(iso, proposal.timeZone, locale, { year: true })}</li>
                    ))}
                  </ol>
                ) : null}
                {proposal.expired ? <p className="text-xs text-destructive">This proposal expired. Ask the member to propose it again.</p> : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost" disabled={Boolean(pending)} onClick={() => decide(proposal.id, "decline")}>
                  {copy.decline || "Decline"}
                </Button>
                <Button size="sm" variant="outline" disabled={Boolean(pending) || proposal.expired} onClick={() => decide(proposal.id, "confirm")}>
                  {pending === proposal.id ? "Saving…" : copy.confirm || "Confirm"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="pb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
