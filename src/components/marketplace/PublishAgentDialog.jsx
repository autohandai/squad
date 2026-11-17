import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, TEMPLATE_LIMITS } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

const WEB_BASE = "https://autohand.ai/squad/marketplace/";

/** "members[0].instructions" → "Instructions", for a person reading the finding. */
export function findingPlace(path, document) {
  const skill = /^skills\[(\d+)\]/.exec(path);
  if (skill) return `Skill ${document?.skills?.[Number(skill[1])]?.name || Number(skill[1]) + 1}`;
  if (path.startsWith("members[0].notes")) return "Starter memory";
  if (path.startsWith("members[0].brainCard")) return "Brain card";
  if (path.startsWith("members[0].instructions")) return "Instructions";
  if (path.startsWith("members[0].description")) return "Description";
  if (path.startsWith("team.description") || path === "tagline") return "Tagline";
  return path;
}

function Row({ label, htmlFor, children, hint }) {
  return (
    <div className="grid gap-1.5 border-b border-border/60 py-2.5 sm:grid-cols-[9rem_1fr] sm:items-start sm:gap-3">
      <label htmlFor={htmlFor} className="pt-1.5 text-xs text-muted-foreground">{label}</label>
      <div className="min-w-0">
        {children}
        {hint ? <p className="pt-1 text-xs text-muted-foreground/80">{hint}</p> : null}
      </div>
    </div>
  );
}

/**
 * Publish to marketplace… (ADR-0246). The dialog is the preview: what is
 * listed, which skills go, and the starter memory, off until switched on and
 * then shown in full. Anything the secret scanner finds blocks Publish and
 * says where it is. Conversations, files, folders, permissions, connectors
 * and engine settings are never part of a template.
 */
export function PublishAgentDialog({ open, onOpenChange, member, api, copy = {} }) {
  const [context, setContext] = useState(null);
  const [mine, setMine] = useState([]);
  const [preview, setPreview] = useState(null);
  const [skills, setSkills] = useState([]);
  const [includeMemory, setIncludeMemory] = useState(false);
  const [form, setForm] = useState({ tagline: "", description: "", category: "", tags: "", owner: "user", creatorName: "", note: "" });
  const [asVersion, setAsVersion] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);
  const [copied, setCopied] = useState(false);
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    if (!open || !member) return;
    setPublished(null); setError(""); setIncludeMemory(false); setCopied(false); setAsVersion(true);
    setRequestId(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setForm({ tagline: String(member.description || "").slice(0, TEMPLATE_LIMITS.tagline), description: "", category: "", tags: "", owner: "user", creatorName: "", note: "" });
    setSkills((member.skills || []).map((skill) => String(skill?.name || skill?.id || skill)));
    api("/api/marketplace/publish/context").then(setContext).catch((failure) => setContext({ signedIn: false, owners: [], error: failure.message }));
    api("/api/marketplace/mine").then((data) => setMine(data.agents || [])).catch(() => setMine([]));
  }, [open, member, api]);

  useEffect(() => {
    if (!open || !member) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api("/api/marketplace/publish/preview", { method: "POST", body: JSON.stringify({ member, skills, includeMemory, tagline: form.tagline }) })
        .then((data) => { if (!cancelled) setPreview(data); })
        .catch((failure) => { if (!cancelled) setPreview({ error: failure.message, findings: [], skills: [] }); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, member, skills, includeMemory, form.tagline, api]);

  const previous = useMemo(() => mine.find((agent) => agent.name === member?.name && ["published", "unpublished"].includes(agent.status)), [mine, member]);
  const update = Boolean(previous && asVersion);
  const findings = preview?.findings || [];
  const memberSkills = (member?.skills || []).map((skill) => String(skill?.name || skill?.id || skill));
  const ready = context?.signedIn && form.tagline.trim() && form.category && preview && !preview.error && !busy;

  async function publish() {
    setBusy(true);
    setError("");
    try {
      const owner = form.owner === "user" ? { kind: "user" } : { kind: "team", id: form.owner };
      const data = await api("/api/marketplace/publish", {
        method: "POST",
        body: JSON.stringify({
          member, skills, includeMemory, requestId, note: form.note,
          listing: { tagline: form.tagline, description: form.description, category: form.category, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) },
          ...(update ? { listingId: previous.id, baseVersion: previous.version } : { owner }),
          ...(form.creatorName.trim() ? { creatorName: form.creatorName.trim() } : {}),
        }),
      });
      setPublished(data.agent);
    } catch (failure) {
      setError(failure.message || "It could not be published.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const link = published ? `${WEB_BASE}${published.id}/` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-xl" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle>{published ? (copy.publishedTitle || "{name} is in the marketplace").replace("{name}", published.name) : (copy.publishTitle || "Publish {name} to the marketplace").replace("{name}", member?.name || "")}</DialogTitle>
          <DialogDescription>
            {published
              ? copy.publishedDescription || "Anyone can find it on autohand.ai and in Squad, and add it to their squad."
              : copy.publishDescription || "Anyone can find it and add it to their squad. Conversations, files, folders, permissions, connectors and engine settings are never included."}
          </DialogDescription>
        </DialogHeader>

        {published ? (
          <div className="flex min-w-0 flex-col gap-3 text-sm">
            <p className="text-xs text-muted-foreground">{copy.version || "Version"} {published.version} · {published.creator?.name}</p>
            <div className="flex items-center gap-2 border-y border-border/60 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" data-testid="published-link">{link}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? copy.copied || "Copied" : copy.copyLink || "Copy link"}
              </Button>
            </div>
          </div>
        ) : !context ? (
          <p className="text-xs text-muted-foreground" role="status">{copy.loading || "Loading…"}</p>
        ) : !context.signedIn ? (
          <p className="text-xs text-muted-foreground">{context.error || copy.marketplaceSignIn || "Sign in to Autohand to publish agents."}</p>
        ) : (
          <div className="flex min-w-0 flex-col text-sm">
            {previous ? (
              <label className="flex items-start gap-2 border-b border-border/60 pb-2.5 text-xs">
                <Checkbox checked={asVersion} onCheckedChange={(value) => setAsVersion(value === true)} className="mt-0.5" />
                <span>{(copy.publishAsVersion || "Publish as version {next} of your listing {name}. People who added it can update.").replace("{next}", String(previous.version + 1)).replace("{name}", previous.name)}</span>
              </label>
            ) : null}
            <Row label={copy.tagline || "Tagline"} htmlFor="publish-tagline" hint={`${form.tagline.length}/${TEMPLATE_LIMITS.tagline}`}>
              <Input id="publish-tagline" value={form.tagline} maxLength={TEMPLATE_LIMITS.tagline} onChange={set("tagline")} placeholder={copy.taglinePlaceholder || "What it does, in one line"} className="h-8 text-sm" />
            </Row>
            <Row label={copy.descriptionOptional || "Description"} htmlFor="publish-description">
              <Textarea id="publish-description" value={form.description} maxLength={TEMPLATE_LIMITS.description} onChange={set("description")} rows={3} placeholder={copy.descriptionPlaceholder || "How it works and what you get (optional)"} className="text-sm" />
            </Row>
            <Row label={copy.category || "Category"} htmlFor="publish-category">
              <Select value={form.category} onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}>
                <SelectTrigger id="publish-category" size="sm" className="w-full"><SelectValue placeholder={copy.chooseCategory || "Choose…"} /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Row>
            <Row label={copy.tags || "Tags"} htmlFor="publish-tags" hint={copy.tagsHint || "Up to five, separated by commas."}>
              <Input id="publish-tags" value={form.tags} onChange={set("tags")} placeholder="release, writing" className="h-8 text-sm" />
            </Row>
            {update ? null : (
              <Row label={copy.publishAs || "Publish as"} htmlFor="publish-owner">
                <Select value={form.owner} onValueChange={(value) => setForm((current) => ({ ...current, owner: value }))}>
                  <SelectTrigger id="publish-owner" size="sm" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{context.owners.map((owner) => <SelectItem key={owner.kind === "user" ? "user" : owner.id} value={owner.kind === "user" ? "user" : owner.id}>{owner.kind === "user" ? `${copy.personal || "Personal"} · ${owner.label}` : owner.label}</SelectItem>)}</SelectContent>
                </Select>
              </Row>
            )}
            {form.owner === "user" ? (
              <Row label={copy.creatorName || "Creator name"} htmlFor="publish-creator" hint={copy.creatorNameHint || "Shown as “by …”. Your account name if left empty; never an email address."}>
                <Input id="publish-creator" value={form.creatorName} maxLength={60} onChange={set("creatorName")} className="h-8 text-sm" />
              </Row>
            ) : null}
            {update ? (
              <Row label={copy.whatChanged || "What changed"} htmlFor="publish-note">
                <Input id="publish-note" value={form.note} maxLength={TEMPLATE_LIMITS.note} onChange={set("note")} placeholder={copy.whatChangedPlaceholder || "Shorter replies, a new skill"} className="h-8 text-sm" />
              </Row>
            ) : null}

            <h3 className="pt-5 pb-1.5 text-sm font-semibold">{copy.skills || "Skills"}</h3>
            {memberSkills.length ? (
              <ul className="flex flex-col border-t border-border/60">
                {memberSkills.map((name) => {
                  const known = preview?.skills?.find((skill) => skill.name === name);
                  const missing = preview?.missingSkills?.includes(name);
                  return (
                    <li key={name} className="flex items-start gap-2 border-b border-border/60 py-2">
                      <Checkbox checked={skills.includes(name)} disabled={missing} onCheckedChange={(value) => setSkills((current) => value === true ? [...new Set([...current, name])] : current.filter((item) => item !== name))} aria-label={name} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs">{name}</span>
                        <span className="block text-xs text-muted-foreground">{missing ? copy.skillNotInstalled || "Not installed in this member's home, so it cannot be shared." : known?.description || ""}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="border-y border-border/60 py-2 text-xs text-muted-foreground">{copy.noSkills || "This member has no skills switched on."}</p>}

            <label className="flex items-start gap-2 pt-4 text-sm">
              <Checkbox checked={includeMemory} onCheckedChange={(value) => setIncludeMemory(value === true)} className="mt-0.5" data-testid="publish-include-memory" />
              <span>
                <span className="block">{copy.includeMemory || "Include starter memory"}</span>
                <span className="block text-xs text-muted-foreground">{copy.includeMemoryHint || "Its MEMORY.md becomes public. Read it below first."}</span>
              </span>
            </label>
            {includeMemory ? (
              preview?.memory ? (
                <div className="mt-2 max-h-40 overflow-y-auto border-y border-border/60 py-2 text-xs whitespace-pre-wrap text-muted-foreground" data-testid="publish-memory-preview">
                  {preview.memory.slice(0, TEMPLATE_LIMITS.notes)}
                  {preview.memoryTruncated ? `\n… ${copy.memoryTruncated || "cut at 4,000 characters"}` : ""}
                </div>
              ) : <p className="pt-2 text-xs text-muted-foreground">{copy.noMemory || "This member's MEMORY.md is empty."}</p>
            ) : null}

            {findings.length ? (
              <div className="pt-4 text-xs text-destructive" role="alert" data-testid="publish-findings">
                <p>{copy.publishSecrets || "Remove these before publishing. They look like keys or passwords:"}</p>
                <ul className="list-disc pl-5">
                  {findings.map((finding) => <li key={finding.path}>{findingPlace(finding.path, preview.document)}: {finding.kinds.join(", ")}</li>)}
                </ul>
              </div>
            ) : preview?.error ? <p className="pt-4 text-xs text-destructive" role="alert">{preview.error}</p> : null}
            {error ? <p className={cn("pt-4 text-xs text-destructive")} role="alert" data-testid="publish-error">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {published ? (
            <>
              <Button asChild variant="outline"><a href={link} target="_blank" rel="noreferrer">{copy.viewOnWeb || "View on the web"}</a></Button>
              <Button onClick={() => onOpenChange?.(false)}>{copy.done || "Done"}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.cancel || "Cancel"}</Button>
              <Button disabled={!ready} onClick={() => void publish()} data-testid="publish-submit">
                {busy ? copy.publishing || "Publishing…" : update ? (copy.publishVersion || "Publish version {next}").replace("{next}", String(previous.version + 1)) : copy.publish || "Publish"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
