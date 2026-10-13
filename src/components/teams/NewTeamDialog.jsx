import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OBJECTIVE_LIMIT, proposalProblems, proposeTeam, updateProposal } from "@/lib/team-builder";
import { cn } from "@/lib/utils";

/**
 * New team (ADR-0118): one question, the team's primary objective, and the
 * proposal it produces: members with a name, role, purpose and skills, a
 * lead, a channel and routines that will arrive paused. Everything in the
 * proposal can be changed before Add team. Adding is non-blocking: the
 * dialog closes at once and the directory shows each member being prepared.
 */
export function NewTeamDialog({ open, onOpenChange, agents = [], roleTemplates = [], pendingNames = [], copy = {}, onAddTeam }) {
  const [objective, setObjective] = useState("");
  const [name, setName] = useState("");
  const [edits, setEdits] = useState({});
  const [leadKey, setLeadKey] = useState("");

  useEffect(() => {
    if (!open) return;
    setObjective("");
    setName("");
    setEdits({});
    setLeadKey("");
  }, [open]);

  const existingNames = useMemo(() => [...agents.map((agent) => agent?.name).filter(Boolean), ...pendingNames], [agents, pendingNames]);
  const proposal = useMemo(() => {
    if (!objective.trim()) return null;
    let next = proposeTeam({ objective, name, roleTemplates, existingNames });
    for (const [key, edit] of Object.entries(edits)) next = updateProposal(next, { member: { key, ...edit } });
    if (leadKey) next = updateProposal(next, { leadKey });
    return next;
  }, [objective, name, roleTemplates, existingNames, edits, leadKey]);
  const problems = proposal ? proposalProblems(proposal) : ["objective"];
  const selectedCount = proposal ? proposal.members.filter((member) => member.selected).length : 0;
  const memberByKey = new Map((proposal?.members || []).map((member) => [member.key, member]));

  function editMember(key, patch) {
    setEdits((current) => ({ ...current, [key]: { ...(current[key] || {}), ...patch } }));
  }

  function add() {
    if (!proposal || problems.length) return;
    onAddTeam?.(proposal);
    onOpenChange?.(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.newTeamTitle || "New team"}</DialogTitle>
          <DialogDescription>
            {copy.newTeamDescription || "Say what the team is for. Squad proposes who to hire, who leads, where they talk and what runs on a schedule. Change anything below, then add the team; members are prepared in the background."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col text-sm">
          <label className="flex flex-col gap-1.5 pb-3">
            <span className="text-muted-foreground">{copy.teamObjective || "Primary objective"}</span>
            <Textarea
              autoFocus
              value={objective}
              maxLength={OBJECTIVE_LIMIT}
              rows={2}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={copy.teamObjectivePlaceholder || "Marketing team for our NZ launch"}
              className="min-h-[3.25rem] text-sm"
              data-testid="new-team-objective"
            />
          </label>
          <label className="flex flex-col gap-1.5 border-t border-border/60 py-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="shrink-0 text-muted-foreground sm:w-[160px]">{copy.teamName || "Team name"}</span>
            <Input value={name || proposal?.name || ""} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={proposal ? "" : copy.teamNamePlaceholder || "Optional"} className="h-8" disabled={!proposal} />
          </label>

          {proposal ? (
            <>
              <SectionHeading count={`${selectedCount} of ${proposal.members.length}`}>{copy.members || "Members"}</SectionHeading>
              <p className="pb-2 text-xs text-muted-foreground">
                {copy.newTeamMembersDetail || "Each is prepared like a member made in New member: its role's instructions, brain card and skills, plus the team's objective and roster. Untick anyone you do not need; names can be changed."}
              </p>
              <ul className="flex flex-col border-t border-border/60">
                {proposal.members.map((member) => (
                  <li key={member.key} className="group border-b border-border/60 py-2">
                    <div className="flex items-start gap-3">
                      <Checkbox checked={member.selected} onCheckedChange={(value) => editMember(member.key, { selected: value === true })} className="mt-1.5" aria-label={`Create ${member.name}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Input
                            value={member.name}
                            maxLength={60}
                            disabled={!member.selected}
                            onChange={(event) => editMember(member.key, { name: event.target.value })}
                            aria-label={`Name for ${member.role}`}
                            className="h-7 w-[7.5rem] text-sm"
                          />
                          <span className={cn("truncate text-sm", member.selected ? "font-medium" : "text-muted-foreground")}>{member.role}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{member.purpose}</p>
                        {member.skills.length ? <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{member.skills.join(" · ")}</p> : null}
                      </div>
                      {proposal.leadKey === member.key ? (
                        <span className="mt-1.5 shrink-0 text-xs font-medium text-foreground underline underline-offset-4">{copy.lead || "Lead"}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={!member.selected}
                          onClick={() => setLeadKey(member.key)}
                          className="mt-1.5 shrink-0 text-xs text-muted-foreground underline-offset-4 opacity-0 transition-opacity hover:text-foreground hover:underline focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                        >
                          {copy.makeLead || "Make lead"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <SectionHeading>{copy.channelAndRoutines || "Channel and routines"}</SectionHeading>
              <ul className="flex flex-col border-t border-border/60">
                <li className="border-b border-border/60 py-2">
                  <span className="block font-medium">#{proposal.channel.name}</span>
                  <span className="block text-xs text-muted-foreground">{(copy.newTeamChannelDetail || "Everyone in the team, in the {section} section of the sidebar.").replace("{section}", proposal.channel.section)}</span>
                </li>
                {proposal.routines.map((routine) => {
                  const owner = memberByKey.get(routine.memberKey);
                  return (
                    <li key={`${routine.memberKey}-${routine.title}`} className={cn("border-b border-border/60 py-2", owner && !owner.selected && "opacity-50")}>
                      <span className="block font-medium">{routine.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {owner ? `${owner.name} · ` : ""}
                        {describeSchedule(routine.schedule)} · {copy.arrivesPaused || "arrives paused"}
                        {owner && !owner.selected ? ` · ${copy.needsItsMember || "needs its member"}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.cancel || "Cancel"}</Button>
          <Button disabled={problems.length > 0} onClick={add} data-testid="new-team-add">{copy.addTeam || "Add team"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The rule in words, for the few shapes a proposal uses. */
export function describeSchedule(schedule = {}) {
  const time = schedule.time || "09:00";
  switch (schedule.kind) {
    case "weekdays": {
      const days = Array.isArray(schedule.days) ? schedule.days : [];
      if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return `Weekdays at ${time}`;
      if (days.length === 7) return `Every day at ${time}`;
      return `${days.map((day) => DAY_LABELS[day]).join(", ")} at ${time}`;
    }
    case "monthly":
      return schedule.day === "last" ? `Last day of the month at ${time}` : `Day ${schedule.day || 1} of the month at ${time}`;
    case "interval":
      return `Every ${schedule.everyMinutes || 60} minutes`;
    case "once":
      return `Once on ${schedule.date || "a date"} at ${time}`;
    case "yearly":
      return `Yearly on ${schedule.day || 1}/${schedule.month || 1} at ${time}`;
    case "cron":
      return `Cron ${schedule.cron || ""}`.trim();
    default:
      return `At ${time}`;
  }
}

function SectionHeading({ children, count }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-5 pb-1.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {count ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
    </div>
  );
}
