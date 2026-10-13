import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeResponder, responderStatus, responderTagLabel } from "@/lib/channel-responders";

// One choice row in the channel settings form (ADR-0108): who answers a
// message that mentions nobody. Saved with the form's single Save action.
const MODE_DETAIL = {
  everyone: "Every member answers a message that mentions nobody.",
  lead: "Only the lead answers a message that mentions nobody; mentions still reach whoever is named.",
  auto: "A quick model call picks who answers. Below 60% confidence the lead answers, or everyone when there is no lead.",
};

export function useAutoAvailability(loadAutoAvailability, enabled) {
  const [state, setState] = useState({ loaded: false, available: true, reason: "" });
  useEffect(() => {
    if (!enabled || typeof loadAutoAvailability !== "function") return undefined;
    let cancelled = false;
    loadAutoAvailability()
      .then((data) => { if (!cancelled) setState({ loaded: true, available: data?.available !== false, reason: String(data?.reason || "") }); })
      .catch((error) => { if (!cancelled) setState({ loaded: true, available: false, reason: `Auto is unavailable: ${error.message}` }); });
    return () => { cancelled = true; };
  }, [enabled, loadAutoAvailability]);
  return state;
}

export function ResponderSettings({ channel, draft, members = [], disabled = false, onChange, loadAutoAvailability }) {
  const responder = normalizeResponder(draft);
  const roster = members.filter((member) => (channel?.memberIds || []).includes(member.id));
  const availability = useAutoAvailability(loadAutoAvailability, responder.mode === "auto");
  const autoUnavailable = responder.mode === "auto" && availability.loaded && !availability.available ? availability.reason : "";
  const saved = responderStatus(channel, { autoUnavailable });
  const leadMissing = Boolean(responder.leadMemberId) && !roster.some((member) => member.id === responder.leadMemberId);
  const update = (patch) => onChange?.({ ...responder, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="channel-responder-mode">Responder</Label>
      <Select value={responder.mode} disabled={disabled} onValueChange={(mode) => update({ mode })}>
        <SelectTrigger id="channel-responder-mode" aria-label="Responder"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="everyone">Everyone</SelectItem>
          <SelectItem value="lead">Lead</SelectItem>
          <SelectItem value="auto">Auto</SelectItem>
        </SelectContent>
      </Select>
      {responder.mode !== "everyone" ? (
        <Select value={responder.leadMemberId || "none"} disabled={disabled || !roster.length} onValueChange={(value) => update({ leadMemberId: value === "none" ? "" : value })}>
          <SelectTrigger id="channel-responder-lead" aria-label="Lead member">
            <SelectValue placeholder={responder.mode === "lead" ? "Choose a lead" : "No lead"} />
          </SelectTrigger>
          <SelectContent>
            {responder.mode === "auto" ? <SelectItem value="none">No lead</SelectItem> : null}
            {roster.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      <p className="text-xs text-muted-foreground" data-testid="responder-detail">
        {leadMissing
          ? "The lead is no longer in this channel, so everyone answers. Choose another lead."
          : autoUnavailable
            ? `${autoUnavailable} ${saved.leadMemberId ? "The lead answers" : "Everyone answers"} until the provider can be called directly.`
            : responder.mode === "lead" && !responder.leadMemberId
              ? "Choose a lead from the channel members."
              : MODE_DETAIL[responder.mode]}
      </p>
    </div>
  );
}

/** "Answered by Noah (auto · 80%)" under a thread root; nothing for plain fan-out. */
export function AnsweredByTag({ responder, members = [] }) {
  const label = responderTagLabel(responder, members);
  if (!label) return null;
  return <span data-testid="answered-by">{label}</span>;
}
