import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A member proposed teammates with squad_propose_team (ADR-0161). The roster
 * reads as divider rows under the reply: name, role, one line of purpose, the
 * lead marked. Create team runs the same import as New team; nothing exists
 * until then. Not now keeps the proposal in the message for later.
 *
 *   proposal  { name, objective, members: [{ key, name, role, purpose, skills }], leadKey }
 *   decided   "created" | "dismissed" | ""
 */
export function TeamProposalCard({ proposal, memberName = "The member", decided = "", busy = false, onCreate, onDismiss, copy = {} }) {
  const members = Array.isArray(proposal?.members) ? proposal.members : [];
  if (!members.length) return null;
  return (
    <section className="mt-3 border-t border-border/70 pt-3 text-sm" data-testid="team-proposal" aria-label={`${memberName} proposes the ${proposal.name} team`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="text-foreground">{memberName}</span>{" "}
          <span className="text-muted-foreground">{copy.teamProposes || "proposes a team:"}</span>{" "}
          <span className="font-medium text-foreground">{proposal.name}</span>
        </p>
        {decided === "created" ? <span className="text-xs text-muted-foreground">{copy.teamCreated || "Members are being prepared; they appear in Squad as they get ready."}</span> : null}
        {decided === "dismissed" ? <span className="text-xs text-muted-foreground">{copy.teamDismissed || "Not created."}</span> : null}
      </div>
      {proposal.objective ? <p className="mt-1 text-muted-foreground">{proposal.objective}</p> : null}
      <ul className="mt-2 divide-y divide-border/60 border-y border-border/60">
        {members.map((member) => (
          <li key={member.key || member.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
            <span className="text-foreground">{member.name}</span>
            <span className="text-muted-foreground">{member.role}</span>
            {member.key === proposal.leadKey ? <span className="text-xs text-muted-foreground">· {copy.teamLead || "leads"}</span> : null}
            {member.purpose ? <span className="basis-full text-xs text-muted-foreground">{member.purpose}</span> : null}
          </li>
        ))}
      </ul>
      {!decided ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => onCreate?.(proposal)}>
            {busy ? copy.teamCreating || "Creating…" : copy.teamCreate || `Create team · ${members.length} ${members.length === 1 ? "member" : "members"}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground" disabled={busy} onClick={() => onDismiss?.(proposal)}>
            {copy.folderAccessDismiss || "Not now"}
          </Button>
          <span className="text-xs text-muted-foreground">{copy.teamProposalNote || "Each member starts at the Edit files level and asks here before writing; adjust their Permissions afterwards."}</span>
        </div>
      ) : null}
    </section>
  );
}
