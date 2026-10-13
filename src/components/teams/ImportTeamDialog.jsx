import { useEffect, useRef, useState } from "react";
import { FileJson } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createMemberId } from "@/lib/member-menus";
import { TEAM_LIMITS, validateTeamFile } from "@/lib/teams";

/**
 * Import team (ADR-0106): pick a file, review exactly what will be created
 * and what was dropped, then add it. Members are created first, one at a
 * time, through the app's confirmed creation (`onCreateMember`, ADR-0077),
 * so each is provisioned like any member; they start on the Ask level with
 * skills switched off. Only when every ticked member exists does the bridge
 * create channels and paused workflows in one call, which it makes whole or
 * not at all. The report says what was created either way.
 */
export function ImportTeamDialog({ open, onOpenChange, agents = [], api, onCreateMember, onImported, copy = {} }) {
  const [step, setStep] = useState("pick");
  const [fileName, setFileName] = useState("");
  const [document, setDocument] = useState(null);
  const [plan, setPlan] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(() => new Set());
  const [choices, setChoices] = useState({ channels: true, workflows: true, skills: true, presets: true });
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setFileName("");
    setDocument(null);
    setPlan(null);
    setWarnings([]);
    setError("");
    setSelectedMembers(new Set());
    setChoices({ channels: true, workflows: true, skills: true, presets: true });
    setProgress("");
    setReport(null);
  }, [open]);

  async function readFile(file) {
    if (!file) return;
    setError("");
    if (file.size > TEAM_LIMITS.fileBytes) {
      setError(`${file.name} is larger than ${Math.round(TEAM_LIMITS.fileBytes / 1024 / 1024)} MB, which is more than a team file can be.`);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      setError("That file could not be read.");
      return;
    }
    // The same validator the bridge runs, so a refusal is immediate and the
    // review shows a file the bridge will accept.
    const local = validateTeamFile(text);
    if (!local.ok) {
      setError(local.error);
      return;
    }
    setFileName(file.name);
    try {
      const data = await api("/api/teams/import/plan", { method: "POST", body: JSON.stringify({ text, existingMemberNames: agents.map((agent) => agent.name) }) });
      setDocument(data.document);
      setPlan(data.plan);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setSelectedMembers(new Set(data.plan.members.map((member) => member.key)));
      setStep("review");
    } catch (caught) {
      setError(caught?.message || "The bridge could not read that file.");
    }
  }

  function toggleMember(key) {
    setSelectedMembers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function add() {
    if (!plan || !document) return;
    setStep("working");
    setError("");
    const created = [];
    const failed = [];
    const memberIds = {};
    const wanted = plan.members.filter((member) => selectedMembers.has(member.key));
    for (const [index, member] of wanted.entries()) {
      setProgress((copy.creatingMember || "Preparing {name} ({index} of {total})…").replace("{name}", member.name).replace("{index}", String(index + 1)).replace("{total}", String(wanted.length)));
      const id = createMemberId();
      try {
        const agent = await onCreateMember(member.draft, { id });
        if (!agent) throw new Error("The bridge did not confirm the member.");
        memberIds[member.key] = agent.id || id;
        created.push({ key: member.key, name: member.name, id: agent.id || id });
      } catch (caught) {
        failed.push({ key: member.key, name: member.name, reason: caught?.message || "could not be prepared" });
        break;
      }
    }
    if (failed.length) {
      setReport({ members: created, failed, skippedMembers: wanted.slice(created.length + 1).map((member) => member.name), channels: [], workflows: [], skills: { added: [], kept: [] }, presets: { added: [], kept: [] }, dropped: plan.dropped, warnings, bridgeSkipped: true });
      setStep("done");
      return;
    }
    setProgress(copy.addingChannels || "Adding channels, workflows, skills and presets…");
    try {
      const data = await api("/api/teams/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          existingMemberNames: agents.map((agent) => agent.name),
          memberIds,
          choices: { ...choices, workflows: choices.channels && choices.workflows },
        }),
      });
      setReport({ members: created, failed: [], skippedMembers: [], channels: data.channels || [], workflows: data.workflows || [], skills: data.skills || { added: [], kept: [] }, presets: data.presets || { added: [], kept: [] }, dropped: data.dropped || plan.dropped, warnings: data.warnings || warnings, bridgeSkipped: false });
      onImported?.(data);
    } catch (caught) {
      setReport({ members: created, failed: [], skippedMembers: [], channels: [], workflows: [], skills: { added: [], kept: [] }, presets: { added: [], kept: [] }, dropped: plan.dropped, warnings, bridgeSkipped: true, bridgeError: caught?.message || "The bridge could not add the rest." });
    }
    setStep("done");
  }

  const busy = step === "working";
  const memberCount = plan ? plan.members.filter((member) => selectedMembers.has(member.key)).length : 0;
  const canAdd = plan && (memberCount > 0 || (choices.channels && plan.channels.length) || (choices.skills && plan.skills.length) || (choices.presets && plan.presets.length));

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange?.(next))}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.importTeamTitle || "Import team"}</DialogTitle>
          <DialogDescription>
            {step === "pick"
              ? copy.importPickDescription || "Choose a .squad-team.json or .squad-preset.json file. You will see what it adds before anything is created."
              : step === "review"
                ? copy.importReviewDescription || "Everything below is new: nothing already here is changed. Members start on the Ask level with their skills switched off; workflows arrive paused."
                : step === "working"
                  ? progress
                  : copy.importDoneDescription || "What was added."}
          </DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="flex flex-col gap-3 text-sm">
            <input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
            <button
              type="button"
              className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-left transition-colors hover:border-foreground/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void readFile(event.dataTransfer?.files?.[0]);
              }}
            >
              <FileJson className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block font-medium">{copy.chooseTeamFile || "Choose a file"}</span>
                <span className="block text-xs text-muted-foreground">{copy.orDropTeamFile || "Or drop one here."}</span>
              </span>
            </button>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}

        {step === "review" && plan ? (
          <div className="flex flex-col text-sm">
            <p className="text-xs text-muted-foreground">
              {fileName}
              {plan.team ? ` · ${plan.team}` : ""}
            </p>
            {warnings.length ? (
              <ul className="mt-2 flex flex-col border-t border-border/60">
                {warnings.map((warning) => (
                  <li key={warning} className="border-b border-border/60 py-1.5 text-xs text-muted-foreground">{warning}</li>
                ))}
              </ul>
            ) : null}

            {plan.members.length ? (
              <>
                <SectionHeading count={`${memberCount} of ${plan.members.length}`}>{copy.members || "Members"}</SectionHeading>
                <ul className="flex flex-col border-t border-border/60">
                  {plan.members.map((member) => (
                    <li key={member.key} className="border-b border-border/60">
                      <label className="flex cursor-pointer items-center gap-3 py-2">
                        <Checkbox checked={selectedMembers.has(member.key)} onCheckedChange={() => toggleMember(member.key)} aria-label={`Create ${member.name}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {member.name}
                            {member.renamed ? <span className="ml-2 text-xs font-normal text-muted-foreground">{(copy.renamedFrom || "was {name}").replace("{name}", member.originalName)}</span> : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {member.draft.role}
                            {member.draft.importedSkills?.length ? ` · ${member.draft.importedSkills.length} ${member.draft.importedSkills.length === 1 ? "skill" : "skills"} off` : ""}
                            {member.draft.notes ? ` · ${copy.starterNotesShort || "starter notes"}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {plan.channels.length ? (
              <>
                <SectionHeading>{copy.channels || "Channels"}</SectionHeading>
                <ul className="flex flex-col border-t border-border/60">
                  <ChoiceRow checked={choices.channels} onCheckedChange={(value) => setChoices((current) => ({ ...current, channels: value }))} label={`${plan.channels.length} ${plan.channels.length === 1 ? "channel" : "channels"}`} detail={plan.channels.map((channel) => `#${channel.name}${channel.renamed ? ` (was #${channel.originalName})` : ""}`).join(", ")} />
                  {plan.workflows.length ? (
                    <ChoiceRow checked={choices.channels && choices.workflows} disabled={!choices.channels} onCheckedChange={(value) => setChoices((current) => ({ ...current, workflows: value }))} label={`${plan.workflows.length} ${plan.workflows.length === 1 ? "workflow" : "workflows"}, paused`} detail={plan.workflows.map((workflow) => workflow.name).join(", ")} />
                  ) : null}
                </ul>
              </>
            ) : null}

            {plan.skills.length || plan.presets.length ? (
              <>
                <SectionHeading>{copy.skillsAndPresets || "Skills and presets"}</SectionHeading>
                <ul className="flex flex-col border-t border-border/60">
                  {plan.skills.length ? (
                    <ChoiceRow checked={choices.skills} onCheckedChange={(value) => setChoices((current) => ({ ...current, skills: value }))} label={`${plan.skills.length} ${plan.skills.length === 1 ? "skill" : "skills"}`} detail={(copy.importSkillsDetail || "SKILL.md text saved to the squad skills folder, switched off; {names}").replace("{names}", plan.skills.map((skill) => `${skill.name}${skill.action === "keep" ? " (already here)" : ""}`).join(", "))} />
                  ) : null}
                  {plan.presets.length ? (
                    <ChoiceRow checked={choices.presets} onCheckedChange={(value) => setChoices((current) => ({ ...current, presets: value }))} label={`${plan.presets.length} ${plan.presets.length === 1 ? "preset" : "presets"} in New member`} detail={plan.presets.map((preset) => `${preset.name}${preset.action === "keep" ? " (already offered)" : ""}`).join(", ")} />
                  ) : null}
                </ul>
              </>
            ) : null}

            {plan.dropped.length ? (
              <>
                <SectionHeading>{copy.droppedFromFile || "Not added"}</SectionHeading>
                <ul className="flex flex-col border-t border-border/60">
                  {plan.dropped.map((entry, index) => (
                    <li key={`${entry.what}-${index}`} className="border-b border-border/60 py-1.5 text-xs text-muted-foreground">{entry.what}: {entry.reason}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {error ? <p role="alert" className="pt-3 text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}

        {step === "working" ? <p role="status" className="text-sm text-muted-foreground">{progress}</p> : null}

        {step === "done" && report ? <ImportReport report={report} copy={copy} /> : null}

        <DialogFooter>
          {step === "pick" ? <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.cancel || "Cancel"}</Button> : null}
          {step === "review" ? (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>{copy.back || "Back"}</Button>
              <Button disabled={!canAdd} onClick={() => void add()}>{copy.addToSquad || "Add to squad"}</Button>
            </>
          ) : null}
          {step === "done" ? <Button onClick={() => onOpenChange?.(false)}>{copy.done || "Done"}</Button> : null}
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

function ChoiceRow({ checked, onCheckedChange, disabled = false, label, detail }) {
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

function ImportReport({ report, copy }) {
  const lines = [];
  if (report.members.length) lines.push(`${report.members.length} ${report.members.length === 1 ? "member" : "members"} created: ${report.members.map((member) => member.name).join(", ")}.`);
  if (report.channels.length) lines.push(`${report.channels.length} ${report.channels.length === 1 ? "channel" : "channels"} created: ${report.channels.map((channel) => `#${channel.name}`).join(", ")}.`);
  if (report.workflows.length) lines.push(`${report.workflows.length} ${report.workflows.length === 1 ? "workflow" : "workflows"} created, paused.`);
  if (report.skills.added.length) lines.push(`${report.skills.added.length} ${report.skills.added.length === 1 ? "skill" : "skills"} saved, switched off: ${report.skills.added.join(", ")}.`);
  if (report.skills.kept.length) lines.push(`${report.skills.kept.length} ${report.skills.kept.length === 1 ? "skill was" : "skills were"} already here: ${report.skills.kept.join(", ")}.`);
  if (report.presets.added.length) lines.push(`${report.presets.added.length} ${report.presets.added.length === 1 ? "preset" : "presets"} added to New member.`);
  if (!lines.length && !report.failed.length && !report.bridgeError) lines.push(copy.nothingAdded || "Nothing was added.");
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="flex flex-col border-t border-border/60">
        {lines.map((line) => (
          <li key={line} className="border-b border-border/60 py-1.5">{line}</li>
        ))}
      </ul>
      {report.failed.length ? (
        <p role="alert" className="text-sm text-destructive">
          {report.failed.map((entry) => `${entry.name} could not be prepared: ${entry.reason}`).join(" ")}
          {report.skippedMembers.length ? ` ${(copy.importStoppedBefore || "Stopped before {names}.").replace("{names}", report.skippedMembers.join(", "))}` : ""}
          {" "}
          {copy.importBridgeSkipped || "Channels, workflows, skills and presets were not added. Fix the cause and import the file again; members already created keep their names and the next copies get a number."}
        </p>
      ) : null}
      {report.bridgeError ? <p role="alert" className="text-sm text-destructive">{report.bridgeError}</p> : null}
      {report.dropped?.length ? (
        <div>
          <p className="font-medium">{copy.droppedFromFile || "Not added"}</p>
          <ul className="mt-1 flex flex-col border-t border-border/60">
            {report.dropped.map((entry, index) => (
              <li key={`${entry.what}-${index}`} className="border-b border-border/60 py-1.5 text-xs text-muted-foreground">{entry.what}: {entry.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
