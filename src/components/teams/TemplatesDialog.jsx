import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Code2, Eye, FileJson, FolderOpen, Inbox, Megaphone, Search, Target, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { filterTemplates, templateFacts, templateMeta } from "@/lib/team-builder";
import { TEAM_FILE_SUFFIX, TEAM_LIMITS, validateTeamFile } from "@/lib/teams";
import { cn } from "@/lib/utils";
import { describeSchedule } from "./NewTeamDialog";

const TABS = [
  { id: "explore", label: "Explore" },
  { id: "import", label: "Import" },
  { id: "folder", label: "From a folder" },
];

const ICONS = {
  "marketing-campaign-team": Megaphone,
  "seo-growth-team": Search,
  "engineering-team": Code2,
  "lead-research-team": Target,
  "competitor-watch": Eye,
  "inbox-follow-up": Inbox,
};

/**
 * Templates (ADR-0118): start with a complete team or bring your own.
 * Explore lists the built-in templates; Import hands a single file to the
 * Import team dialog; From a folder lists every team file in a folder you
 * pick. A row opens the detail: who is in it, what gets created, what stays
 * off. Add team is non-blocking, the same path as New team.
 */
export function TemplatesDialog({ open, onOpenChange, templates = [], agents = [], copy = {}, onAddTeam, onImportFile }) {
  const [tab, setTab] = useState("explore");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [folderEntries, setFolderEntries] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const folderInput = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTab("explore");
    setQuery("");
    setSelected(null);
    setFolderEntries([]);
    setFolderName("");
    setFolderError("");
  }, [open]);

  const shown = useMemo(() => filterTemplates(templates, query), [templates, query]);
  const existingMembers = agents.filter((agent) => agent?.id && agent?.name).length;

  async function readFolder(fileList) {
    const files = [...(fileList || [])].filter((file) => file.name.endsWith(TEAM_FILE_SUFFIX) || file.name.endsWith(".squad-preset.json"));
    const first = fileList?.[0];
    const folder = first?.webkitRelativePath ? first.webkitRelativePath.split("/")[0] : "";
    setFolderName(folder);
    setFolderError("");
    if (!files.length) {
      setFolderEntries([]);
      setFolderError((copy.noTeamFilesInFolder || "No team files in {folder}. A team file ends in .squad-team.json.").replace("{folder}", folder || "that folder"));
      return;
    }
    const entries = [];
    for (const file of files.slice(0, 50)) {
      if (file.size > TEAM_LIMITS.fileBytes) {
        entries.push({ id: file.name, fileName: file.name, error: `larger than ${Math.round(TEAM_LIMITS.fileBytes / 1024 / 1024)} MB` });
        continue;
      }
      let text = "";
      try {
        text = await file.text();
      } catch {
        entries.push({ id: file.name, fileName: file.name, error: "could not be read" });
        continue;
      }
      const result = validateTeamFile(text);
      if (!result.ok) {
        entries.push({ id: file.name, fileName: file.name, error: result.error });
        continue;
      }
      entries.push({ id: file.name, fileName: file.name, name: result.document.team.name, description: result.document.team.description, document: result.document, trusted: false, source: "folder" });
    }
    setFolderEntries(entries);
  }

  function add() {
    if (!selected?.document) return;
    onAddTeam?.(selected.document, { trusted: selected.trusted !== false, source: selected.source || "template" });
    onOpenChange?.(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-xl">
        {selected ? (
          <TemplateDetail entry={selected} existingMembers={existingMembers} copy={copy} onBack={() => setSelected(null)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{copy.templatesTitle || "Templates"}</DialogTitle>
              <DialogDescription>{copy.templatesDescription || "Start with a complete team or bring your own."}</DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 pb-2 text-xs" role="tablist">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={cn("underline-offset-4 transition-colors hover:text-foreground", tab === item.id ? "font-medium text-foreground underline" : "text-muted-foreground")}
                  >
                    {copy[`templatesTab_${item.id}`] || item.label}
                  </button>
                ))}
              </div>

              {tab === "explore" ? (
                <>
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchTemplates || "Search templates"} aria-label={copy.searchTemplates || "Search templates"} className="mt-3 h-8 text-sm" />
                  <SectionHeading count={String(shown.length)}>{copy.builtInTemplates || "Built-in templates"}</SectionHeading>
                  {shown.length ? (
                    <ul className="flex flex-col border-t border-border/60">
                      {shown.map((template) => (
                        <TemplateRow key={template.id} entry={template} copy={copy} onLoad={() => setSelected({ ...template, trusted: true, source: "template" })} />
                      ))}
                    </ul>
                  ) : (
                    <p className="border-y border-border/60 py-2 text-xs text-muted-foreground">{copy.noTemplatesMatch || "No template matches."}</p>
                  )}
                </>
              ) : null}

              {tab === "import" ? (
                <div className="flex flex-col gap-3 pt-3">
                  <p className="text-xs text-muted-foreground">{copy.templatesImportDetail || "A team or preset file someone shared with you. You will see exactly what it creates and what was dropped before anything is added; its members start on the Ask level with skills switched off."}</p>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-6 text-left transition-colors hover:border-foreground/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => {
                      onOpenChange?.(false);
                      onImportFile?.();
                    }}
                  >
                    <FileJson className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block font-medium">{copy.chooseTeamFile || "Choose a file"}</span>
                      <span className="block text-xs text-muted-foreground">{copy.importTeamOpens || "Opens Import team with the file."}</span>
                    </span>
                  </button>
                </div>
              ) : null}

              {tab === "folder" ? (
                <div className="flex flex-col pt-3">
                  <p className="text-xs text-muted-foreground">{copy.templatesFolderDetail || "Pick a folder; every team file in it is listed. Files from a folder are treated like an import: members start on the Ask level with skills switched off."}</p>
                  <input ref={folderInput} type="file" webkitdirectory="" directory="" multiple className="sr-only" onChange={(event) => void readFolder(event.target.files)} />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="outline" size="sm" onClick={() => folderInput.current?.click()}>
                      <FolderOpen data-icon="inline-start" />
                      {copy.chooseFolder || "Choose a folder"}
                    </Button>
                    {folderName ? <span className="truncate text-xs text-muted-foreground">{folderName}</span> : null}
                  </div>
                  {folderError ? <p role="alert" className="pt-3 text-xs text-muted-foreground">{folderError}</p> : null}
                  {folderEntries.length ? (
                    <>
                      <SectionHeading count={String(folderEntries.filter((entry) => entry.document).length)}>{copy.teamFilesInFolder || "Team files"}</SectionHeading>
                      <ul className="flex flex-col border-t border-border/60">
                        {folderEntries.map((entry) =>
                          entry.document ? (
                            <TemplateRow key={entry.id} entry={entry} copy={copy} onLoad={() => setSelected(entry)} />
                          ) : (
                            <li key={entry.id} className="border-b border-border/60 py-2 text-xs text-muted-foreground">
                              <span className="font-mono text-foreground">{entry.fileName}</span> · {entry.error}
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        )}

        <DialogFooter>
          {selected ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.cancel || "Cancel"}</Button>
              <Button onClick={add} data-testid="template-add-team">{copy.addTeam || "Add team"}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.close || "Close"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateRow({ entry, copy, onLoad }) {
  const Icon = ICONS[entry.id] || Users;
  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onLoad} className="block truncate text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline">
          {entry.name}
        </button>
        {entry.description ? <p className="truncate text-xs text-muted-foreground">{entry.description}</p> : null}
        <p className="text-xs text-muted-foreground/80">
          {templateMeta(entry.document)}
          {entry.fileName ? ` · ${entry.fileName}` : ""}
        </p>
      </div>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={onLoad}>
        {copy.loadTemplate || "Load"}
      </Button>
    </li>
  );
}

function TemplateDetail({ entry, existingMembers, copy, onBack }) {
  const document = entry.document;
  const members = document.members || [];
  const facts = templateFacts(document);
  const connectors = document.connectors || [];
  const routines = document.routines || [];
  return (
    <>
      <DialogHeader>
        <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          {copy.templates || "Templates"}
        </button>
        <DialogTitle>{document.team?.name || entry.name}</DialogTitle>
        <DialogDescription>
          {members.length} {members.length === 1 ? "member" : "members"} · {entry.fileName ? copy.portableTeamFile || "portable team file" : copy.builtInTemplate || "built-in template"}
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-w-0 flex-col text-sm">
        {document.team?.description ? <p className="pb-3">{document.team.description}</p> : null}
        {facts.length ? <p className="border-t border-border/60 py-2 text-xs text-muted-foreground">{facts.join(" · ")}</p> : null}

        <SectionHeading count={String(members.length)}>{copy.teamMembers || "Team members"}</SectionHeading>
        <ul className="flex flex-col border-t border-border/60">
          {members.map((member) => (
            <li key={member.key} className="flex items-baseline gap-2 border-b border-border/60 py-2">
              <span className="font-medium">{member.name}</span>
              <span className="truncate text-xs text-muted-foreground">{member.role}</span>
              {document.team?.lead === member.name ? <span className="text-xs text-muted-foreground">· {copy.leads || "leads"}</span> : null}
              {member.skills?.length ? <span className="ml-auto shrink-0 text-xs text-muted-foreground/80">{member.skills.length} {member.skills.length === 1 ? "skill" : "skills"}</span> : null}
            </li>
          ))}
        </ul>

        {routines.length || connectors.length || document.channels?.length ? (
          <>
            <SectionHeading>{copy.whatGetsCreated || "What gets created"}</SectionHeading>
            <ul className="flex flex-col border-t border-border/60">
              {(document.channels || []).map((channel) => (
                <li key={channel.name} className="border-b border-border/60 py-2">
                  <span className="block font-medium">#{channel.name}</span>
                  <span className="block text-xs text-muted-foreground">{channel.members.length} {channel.members.length === 1 ? "member" : "members"}{channel.section ? ` · ${channel.section}` : ""}</span>
                </li>
              ))}
              {routines.map((routine) => (
                <li key={`${routine.member}-${routine.title}`} className="border-b border-border/60 py-2">
                  <span className="block font-medium">{routine.title}</span>
                  <span className="block text-xs text-muted-foreground">{routine.member} · {describeSchedule(routine.schedule)} · {copy.arrivesPaused || "arrives paused"}</span>
                </li>
              ))}
              {connectors.map((connector) => (
                <li key={connector.name} className="border-b border-border/60 py-2">
                  <span className="block font-medium">{connector.name}</span>
                  <span className="block text-xs text-muted-foreground">{connector.kind === "builtin" ? copy.builtInConnector || "built in" : connector.url || connector.command} · {copy.staysOff || "stays off"}{connector.note ? ` · ${connector.note}` : ""}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="pt-4 text-xs text-muted-foreground">
          {entry.trusted === false
            ? copy.templateFileNote || "Members, the channel and the skills listed are created; members start on the Ask level with their skills switched off, as with Import team. Routines arrive paused, and connections stay off until you set them up in Settings → Connectors."
            : copy.templateNote || "Members and the channel are created, with each member's skills switched on. Routines arrive paused, and connections stay off until you add their keys and switch them on in Settings → Connectors."}
        </p>
        <p className="pt-2 text-xs text-muted-foreground">
          {(copy.templateFooter || "Your {count} existing {members} and their conversations stay unchanged. This adds a new team; duplicate names get numbered.")
            .replace("{count}", String(existingMembers))
            .replace("{members}", existingMembers === 1 ? "member" : "members")}
        </p>
      </div>
    </>
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
