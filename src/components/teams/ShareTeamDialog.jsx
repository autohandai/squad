import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TEAM_LIMITS } from "@/lib/teams";

/**
 * Share team… (ADR-0106): one dialog that says exactly what the file will
 * hold, with a tick box per member and per skill, and switches for channels,
 * workflows and starter notes. With `preset` set to a member it shares that
 * one member as a preset instead. The bridge assembles the bridge-side parts
 * (POST /api/teams/export or /api/teams/presets/export) and the browser
 * saves the JSON it gets back. Nothing is written until Save file.
 */
export function ShareTeamDialog({ open, onOpenChange, agents = [], channels = [], workflowsByChannel = {}, api, defaultTeamName = "Squad", preset = null, copy = {}, renderAvatar, roleFor }) {
  const presetMode = Boolean(preset);
  const members = useMemo(() => (presetMode ? agents.filter((agent) => agent.id === preset.id) : agents.filter((agent) => agent?.id && agent?.name)), [agents, preset, presetMode]);
  const [teamName, setTeamName] = useState(defaultTeamName);
  const [description, setDescription] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(() => new Set(members.map((agent) => agent.id)));
  const [excludedSkills, setExcludedSkills] = useState(() => new Set());
  const [includeChannels, setIncludeChannels] = useState(true);
  const [includeWorkflows, setIncludeWorkflows] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTeamName(presetMode ? preset.name : defaultTeamName);
    setDescription(presetMode ? String(preset.description || "") : "");
    setSelectedMembers(new Set(members.map((agent) => agent.id)));
    setExcludedSkills(new Set());
    setIncludeChannels(!presetMode);
    setIncludeWorkflows(!presetMode);
    setIncludeNotes(false);
    setBusy(false);
    setError("");
    setResult(null);
    // The member list is derived from props; resetting on open is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = members.filter((agent) => selectedMembers.has(agent.id));
  const skillNames = useMemo(() => {
    const seen = new Map();
    for (const agent of chosen) {
      for (const skill of Array.isArray(agent.skills) ? agent.skills : []) {
        const name = String(typeof skill === "string" ? skill : skill?.name || "").trim();
        if (!name) continue;
        if (!seen.has(name)) seen.set(name, []);
        seen.get(name).push(agent.name);
      }
    }
    return [...seen.entries()].map(([name, owners]) => ({ name, owners }));
  }, [chosen]);
  const carriedSkills = skillNames.filter((skill) => !excludedSkills.has(skill.name));
  const workflowCount = Object.values(workflowsByChannel).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const notesCount = chosen.length;

  function toggleMember(id) {
    setSelectedMembers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSkill(name) {
    setExcludedSkills((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function memberPayload(agent) {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      instructions: agent.instructions,
      brainCard: agent.brainCard,
      avatar: agent.avatar,
      employeeType: agent.employeeType,
      skills: Array.isArray(agent.skills) ? agent.skills : [],
      harness: agent.harness,
    };
  }

  async function save() {
    if (busy || !api) return;
    setBusy(true);
    setError("");
    try {
      const data = presetMode
        ? await api("/api/teams/presets/export", {
            method: "POST",
            body: JSON.stringify({ member: memberPayload(members[0]), presetName: teamName.trim() || members[0].name, description: description.trim(), skills: carriedSkills.map((skill) => skill.name), notes: includeNotes }),
          })
        : await api("/api/teams/export", {
            method: "POST",
            body: JSON.stringify({
              team: teamName.trim() || defaultTeamName,
              members: chosen.map(memberPayload),
              include: { skills: carriedSkills.map((skill) => skill.name), channels: includeChannels, workflows: includeChannels && includeWorkflows, notes: includeNotes },
            }),
          });
      downloadJson(data.filename, data.document);
      setResult(data);
    } catch (caught) {
      setError(caught?.message || "The file could not be assembled.");
    } finally {
      setBusy(false);
    }
  }

  const title = presetMode ? (copy.sharePresetTitle || "Share {name} as a preset").replace("{name}", preset.name) : copy.shareTeamTitle || "Share team";
  const canSave = presetMode ? Boolean(members.length) : chosen.length > 0 || (includeChannels && channels.length > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange?.(next))}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {copy.shareTeamDescription ||
              "One JSON file with what is ticked below. Never credentials, conversations, permission grants, provider or model keys, folders or computers. Anything in the text that looks like a secret is removed and listed afterwards."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <ShareResult result={result} copy={copy} presetMode={presetMode} />
        ) : (
          <div className="flex flex-col text-sm">
            <label className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-6">
              <span className="shrink-0 text-muted-foreground sm:w-[160px]">{presetMode ? copy.presetName || "Preset name" : copy.teamName || "Team name"}</span>
              <Input value={teamName} maxLength={TEAM_LIMITS.name} onChange={(event) => setTeamName(event.target.value)} className="h-8" />
            </label>
            {presetMode ? (
              <label className="flex flex-col gap-1.5 border-t border-border/60 py-3 sm:flex-row sm:items-center sm:gap-6">
                <span className="shrink-0 text-muted-foreground sm:w-[160px]">{copy.presetDescription || "One line about it"}</span>
                <Input value={description} maxLength={TEAM_LIMITS.line} onChange={(event) => setDescription(event.target.value)} className="h-8" placeholder={copy.presetDescriptionPlaceholder || "QA for release trains"} />
              </label>
            ) : null}

            <SectionHeading count={`${chosen.length} of ${members.length}`}>{copy.members || "Members"}</SectionHeading>
            <p className="pb-2 text-xs text-muted-foreground">{copy.shareMembersDetail || "Name, role title, instructions and brain card, look. Permissions, folders and model settings stay here."}</p>
            <ul className="flex flex-col border-t border-border/60">
              {members.map((agent) => (
                <li key={agent.id} className="border-b border-border/60">
                  <label className="flex cursor-pointer items-center gap-3 py-2">
                    <Checkbox checked={selectedMembers.has(agent.id)} disabled={presetMode} onCheckedChange={() => toggleMember(agent.id)} aria-label={`Include ${agent.name}`} />
                    {renderAvatar ? renderAvatar(agent, "size-7") : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{agent.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{roleFor ? roleFor(agent) : agent.role}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <SectionHeading count={`${carriedSkills.length} of ${skillNames.length}`}>{copy.skills || "Skills"}</SectionHeading>
            <p className="pb-2 text-xs text-muted-foreground">{copy.shareSkillsDetail || "The SKILL.md text of each skill the ticked members have installed. Never scripts or other files in a skill folder."}</p>
            {skillNames.length ? (
              <ul className="flex flex-col border-t border-border/60">
                {skillNames.map((skill) => (
                  <li key={skill.name} className="border-b border-border/60">
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <Checkbox checked={!excludedSkills.has(skill.name)} onCheckedChange={() => toggleSkill(skill.name)} aria-label={`Include skill ${skill.name}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">{skill.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{skill.owners.join(", ")}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-y border-border/60 py-2 text-xs text-muted-foreground">{copy.noSkillsToShare || "The ticked members have no skills installed."}</p>
            )}

            {!presetMode ? (
              <>
                <SectionHeading>{copy.channelsAndWorkflows || "Channels and workflows"}</SectionHeading>
                <ul className="flex flex-col border-t border-border/60">
                  <SwitchRow checked={includeChannels} onCheckedChange={setIncludeChannels} label={`${channels.length} ${channels.length === 1 ? "channel" : "channels"}`} detail={copy.shareChannelsDetail || "Name, visibility, section and member names. Folders and messages stay here."} />
                  <SwitchRow checked={includeChannels && includeWorkflows} disabled={!includeChannels} onCheckedChange={setIncludeWorkflows} label={`${workflowCount} ${workflowCount === 1 ? "workflow" : "workflows"}`} detail={copy.shareWorkflowsDetail || "Saved paused. Webhook tokens are minted again on import."} />
                </ul>
              </>
            ) : null}

            <SectionHeading>{copy.starterNotes || "Starter notes"}</SectionHeading>
            <ul className="flex flex-col border-t border-border/60">
              <SwitchRow checked={includeNotes} onCheckedChange={setIncludeNotes} label={presetMode ? copy.includeMemberNotes || "Include MEMORY.md" : `${notesCount} MEMORY.md ${notesCount === 1 ? "file" : "files"}`} detail={copy.shareNotesDetail || "What each member has learnt. Off unless you tick it, because notes can hold details about you."} />
            </ul>
            {error ? <p role="alert" className="pt-3 text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange?.(false)}>{copy.done || "Done"}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange?.(false)}>{copy.cancel || "Cancel"}</Button>
              <Button disabled={busy || !canSave} onClick={() => void save()}>{busy ? copy.assembling || "Assembling…" : copy.saveFile || "Save file"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({ children, count }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-5 pb-1.5">
      <h3 className="text-sm font-semibold">{children}</h3>
      {count ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
    </div>
  );
}

function SwitchRow({ checked, onCheckedChange, disabled = false, label, detail }) {
  return (
    <li className="border-b border-border/60">
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" aria-label={label} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </label>
    </li>
  );
}

function ShareResult({ result, copy, presetMode }) {
  const { filename, summary = {}, redacted = [], skipped = [] } = result;
  const parts = presetMode
    ? [`${summary.presets || 0} preset`, `${summary.skills || 0} ${summary.skills === 1 ? "skill" : "skills"}`]
    : [
        `${summary.members || 0} ${summary.members === 1 ? "member" : "members"}`,
        `${summary.skills || 0} ${summary.skills === 1 ? "skill" : "skills"}`,
        `${summary.channels || 0} ${summary.channels === 1 ? "channel" : "channels"}`,
        `${summary.workflows || 0} ${summary.workflows === 1 ? "workflow" : "workflows"}`,
      ];
  if (summary.notes) parts.push(`${summary.notes} ${summary.notes === 1 ? "note" : "notes"}`);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {copy.savedFile || "Saved"} <code translate="no" className="rounded-sm bg-muted/50 px-1 py-0.5 text-xs">{filename}</code>: {parts.join(", ")}.
      </p>
      {redacted.length ? (
        <div>
          <p className="font-medium">{copy.removedFromText || "Removed from the text"}</p>
          <ul className="mt-1 flex flex-col border-t border-border/60">
            {redacted.map((entry) => (
              <li key={entry.path} className="border-b border-border/60 py-1.5 text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{entry.path}</span> · {entry.count} {entry.count === 1 ? "part" : "parts"} that looked like {entry.kinds.join(" or ")}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.nothingRemoved || "Nothing in the text looked like a secret."}</p>
      )}
      {skipped.length ? (
        <div>
          <p className="font-medium">{copy.leftOut || "Left out"}</p>
          <ul className="mt-1 flex flex-col border-t border-border/60">
            {skipped.map((entry, index) => (
              <li key={`${entry.what}-${index}`} className="border-b border-border/60 py-1.5 text-xs text-muted-foreground">
                {entry.what}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function downloadJson(filename, document) {
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
