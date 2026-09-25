import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { isMemberRevision, revisionAuthorName } from "@/lib/canvases";
import { diffLines, diffStats } from "@/lib/diff";
import { cn } from "@/lib/utils";

/**
 * One canvas: an inline-editable title, a Markdown editor with a Preview
 * toggle, and a revision rail (ADR-0023). Selecting a revision shows what it
 * changed against the one before it as a quiet line diff, with Accept (keep
 * the body as it is) and Revert (restore the previous body) actions.
 *
 * Props: `canvas` (store shape), `members` (for author names and avatars),
 * `onChange({ title?, body?, summary? })` → PUT /api/canvases/:id,
 * `onRevert(revisionId)` → POST /api/canvases/:id/revert,
 * `renderMarkdown(text)` → React node, `copy` (locale strings).
 */
export function CanvasPanel({ canvas, members = [], onChange, onRevert, onDelete, renderMarkdown, renderAvatar, copy = {}, className }) {
  const [mode, setMode] = useState("edit");
  const [draft, setDraft] = useState(canvas?.body || "");
  const [title, setTitle] = useState(canvas?.title || "");
  const [selectedId, setSelectedId] = useState("");

  const canvasId = canvas?.id || "";
  const canvasBody = canvas?.body || "";
  const canvasTitle = canvas?.title || "";

  // Switching canvases always resets the draft. A body that changed
  // underneath us on the same canvas (a member run just absorbed) replaces
  // the draft only when the user has no unsaved edits.
  const shownIdRef = useRef(canvasId);
  useEffect(() => {
    const switched = shownIdRef.current !== canvasId;
    shownIdRef.current = canvasId;
    setDraft((current) => (switched || current === canvasBody || !current.trim() ? canvasBody : current));
    setSelectedId("");
  }, [canvasId, canvasBody]);
  useEffect(() => {
    setTitle(canvasTitle);
  }, [canvasId, canvasTitle]);

  const revisions = useMemo(() => (Array.isArray(canvas?.revisions) ? canvas.revisions : []), [canvas]);
  const selectedIndex = revisions.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? revisions[selectedIndex] : null;
  const previous = selectedIndex > 0 ? revisions[selectedIndex - 1] : null;
  const isLatest = selectedIndex === revisions.length - 1;
  const diff = useMemo(() => (selected ? diffLines(previous?.body || "", selected.body || "") : []), [selected, previous]);
  const stats = useMemo(() => diffStats(diff), [diff]);
  const dirty = draft !== canvasBody;

  if (!canvas) return null;

  function save() {
    if (!dirty || !onChange) return;
    onChange({ body: draft, summary: copy.canvasEditedSummary || "Edited" });
  }

  function commitTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(canvasTitle);
      return;
    }
    if (next !== canvasTitle) onChange?.({ title: next });
  }

  function revertSelected() {
    if (!selected || !onRevert) return;
    // Undo the selected edit: restore what the canvas said before it.
    const target = previous ? previous.id : null;
    if (target) onRevert(target);
    setSelectedId("");
  }

  const t = {
    edit: copy.canvasEdit || "Edit",
    preview: copy.canvasPreview || "Preview",
    save: copy.canvasSave || "Save",
    saved: copy.canvasSaved || "Saved",
    revisions: copy.canvasRevisions || "Revisions",
    accept: copy.canvasAccept || "Accept",
    revert: copy.canvasRevert || "Revert",
    restore: copy.canvasRestore || "Restore this version",
    titlePlaceholder: copy.canvasTitlePlaceholder || "Untitled canvas",
    bodyPlaceholder: copy.canvasBodyPlaceholder || "Write in Markdown. Members can edit this too; their changes show up as revisions.",
    noChanges: copy.canvasNoChanges || "No line changes",
    changes: copy.canvasChanges || "{added} added · {removed} removed",
    you: copy.canvasYou || "You",
    empty: copy.canvasEmptyPreview || "Nothing to preview yet.",
    delete: copy.canvasDelete || "Delete",
    memberEdit: copy.canvasMemberEdit || "{name} edited this canvas",
    firstVersion: copy.canvasFirstVersion || "First version",
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setTitle(canvasTitle);
              event.currentTarget.blur();
            }
          }}
          placeholder={t.titlePlaceholder}
          aria-label={copy.canvasTitle || "Canvas title"}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70 focus-visible:underline focus-visible:decoration-border focus-visible:underline-offset-4"
        />
        <div className="flex items-center gap-2">
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList variant="line" className="h-8">
              <TabsTrigger value="edit">{t.edit}</TabsTrigger>
              <TabsTrigger value="preview">{t.preview}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" onClick={save} disabled={!dirty}>
            {dirty ? t.save : t.saved}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-8 border-t border-border/70 pt-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <RevisionDiff
              revision={selected}
              previous={previous}
              diff={diff}
              stats={stats}
              isLatest={isLatest}
              members={members}
              t={t}
              onAccept={() => setSelectedId("")}
              onRevert={previous ? revertSelected : null}
              onRestore={!isLatest && onRevert ? () => { onRevert(selected.id); setSelectedId(""); } : null}
            />
          ) : mode === "preview" ? (
            <div className="min-h-0 flex-1 overflow-y-auto text-[15px] leading-7">
              {draft.trim() ? (renderMarkdown ? renderMarkdown(draft) : <pre className="whitespace-pre-wrap font-[inherit]">{draft}</pre>) : (
                <p className="text-sm text-muted-foreground">{t.empty}</p>
              )}
            </div>
          ) : (
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  save();
                }
              }}
              placeholder={t.bodyPlaceholder}
              spellCheck
              aria-label={copy.canvasBody || "Canvas body"}
              className="min-h-[24rem] flex-1 resize-none border-0 bg-transparent px-0 py-0 font-mono text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          )}
        </div>

        <aside className="hidden w-56 shrink-0 flex-col md:flex" aria-label={t.revisions}>
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.revisions}</span>
            {onDelete ? (
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onDelete(canvas)}>
                {t.delete}
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {revisions
              .slice()
              .reverse()
              .map((revision) => {
                const active = revision.id === selectedId;
                const member = isMemberRevision(revision) ? members.find((item) => item.id === revision.authorId) : null;
                return (
                  <button
                    key={revision.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedId(active ? "" : revision.id)}
                    className={cn(
                      "flex w-full items-start gap-2 border-t border-border/60 px-1 py-2 text-left text-sm transition-colors first:border-t-0",
                      active ? "bg-muted/70" : "hover:bg-muted/40"
                    )}
                  >
                    {renderAvatar && member ? (
                      renderAvatar(member, "mt-0.5 size-5 rounded")
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn("mt-2 size-1.5 shrink-0 rounded-full", member ? "bg-primary" : "bg-muted-foreground/50")}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate", member ? "font-medium" : "")}>{revisionAuthorName(revision, members, t.you)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(revision.at)}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{revision.summary || t.firstVersion}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        </aside>
      </div>
    </div>
  );
}

function RevisionDiff({ revision, previous, diff, stats, isLatest, members, t, onAccept, onRevert, onRestore }) {
  const author = revisionAuthorName(revision, members, t.you);
  const heading = isMemberRevision(revision) ? t.memberEdit.replace("{name}", author) : `${author} · ${revision.summary || t.firstVersion}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{heading}</p>
          <p className="text-xs text-muted-foreground">
            {formatAbsolute(revision.at)}
            {" · "}
            {stats.changed ? t.changes.replace("{added}", String(stats.added)).replace("{removed}", String(stats.removed)) : t.noChanges}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRestore ? (
            <Button size="sm" variant="ghost" onClick={onRestore}>
              {t.restore}
            </Button>
          ) : null}
          {onRevert ? (
            <Button size="sm" variant="outline" onClick={onRevert}>
              <Undo2 />
              {t.revert}
            </Button>
          ) : null}
          <Button size="sm" onClick={onAccept}>
            <Check />
            {t.accept}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-border/70 pt-2 font-mono text-[13px] leading-6" role="region" aria-label={`${author} diff`}>
        {diff.length === 0 ? (
          <p className="font-sans text-sm text-muted-foreground">{previous ? t.noChanges : t.firstVersion}</p>
        ) : (
          diff.map((entry, index) => (
            <div
              key={`${index}-${entry.type}`}
              className={cn(
                "flex whitespace-pre-wrap break-words px-1",
                entry.type === "add" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                entry.type === "remove" && "bg-rose-500/10 text-rose-800 line-through decoration-rose-800/40 dark:text-rose-300",
                entry.type === "equal" && "text-muted-foreground"
              )}
            >
              <span aria-hidden="true" className="w-4 shrink-0 select-none opacity-70">
                {entry.type === "add" ? "+" : entry.type === "remove" ? "−" : " "}
              </span>
              <span className="min-w-0 flex-1">{entry.text || " "}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const RELATIVE_UNITS = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

export function formatRelative(iso, now = Date.now()) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 45) return "now";
  let formatter;
  try {
    formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  } catch {
    formatter = null;
  }
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      const value = Math.round(seconds / size);
      return formatter ? formatter.format(value, unit) : `${Math.abs(value)}${unit[0]}`;
    }
  }
  return formatter ? formatter.format(seconds, "second") : `${Math.abs(seconds)}s`;
}

function formatAbsolute(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);
  } catch {
    return new Date(time).toLocaleString();
  }
}
