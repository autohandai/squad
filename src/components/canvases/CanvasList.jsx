import { useState } from "react";
import { FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isMemberRevision, revisionAuthorName } from "@/lib/canvases";
import { cn } from "@/lib/utils";

import { formatRelative } from "./CanvasPanel";

/**
 * The canvases a channel or member owns: a divider-separated list plus a
 * "New canvas" action that asks for a title inline (ADR-0023).
 *
 * Props: `canvases` (store shape, already filtered to the owner),
 * `activeCanvasId`, `members` (author names), `onSelect(id)`,
 * `onCreate({ title })` → POST /api/canvases, `copy`.
 */
export function CanvasList({ canvases = [], activeCanvasId = "", members = [], onSelect, onCreate, copy = {}, className }) {
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

  const t = {
    heading: copy.canvases || "Canvases",
    create: copy.canvasNew || "New canvas",
    none: copy.canvasNone || "No canvases yet. Start one for a plan, a spec, or a report members can edit with you.",
    titlePlaceholder: copy.canvasTitlePlaceholder || "Untitled canvas",
    you: copy.canvasYou || "You",
    lastEdit: copy.canvasLastEdit || "{name} · {time}",
    cancel: copy.cancel || "Cancel",
  };

  function submit(event) {
    event?.preventDefault?.();
    const title = draftTitle.trim() || t.titlePlaceholder;
    onCreate?.({ title });
    setDraftTitle("");
    setCreating(false);
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="text-sm font-medium text-muted-foreground">{t.heading}</span>
        {!creating ? (
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t.create}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-border/70 py-2">
          <Input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCreating(false);
                setDraftTitle("");
              }
            }}
            placeholder={t.titlePlaceholder}
            aria-label={t.create}
            className="h-8"
          />
          <Button type="submit" size="sm">
            {t.create}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setDraftTitle(""); }}>
            {t.cancel}
          </Button>
        </form>
      ) : null}

      {canvases.length === 0 && !creating ? (
        <p className="border-t border-border/70 py-3 text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {canvases.map((canvas) => {
            const active = canvas.id === activeCanvasId;
            const last = Array.isArray(canvas.revisions) && canvas.revisions.length ? canvas.revisions[canvas.revisions.length - 1] : null;
            const memberEdited = last ? isMemberRevision(last) : false;
            return (
              <button
                key={canvas.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect?.(canvas.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-t border-border/70 px-1 py-2.5 text-left text-sm transition-colors",
                  active ? "bg-muted/70" : "hover:bg-muted/40"
                )}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", memberEdited ? "font-medium" : "")}>{canvas.title || t.titlePlaceholder}</span>
                  {last ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.lastEdit.replace("{name}", revisionAuthorName(last, members, t.you)).replace("{time}", formatRelative(last.at))}
                    </span>
                  ) : null}
                </span>
                {memberEdited ? <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
