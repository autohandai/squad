import { Crosshair, Film, Image as ImageIcon, X } from "lucide-react";

import { anchorLabel, normalizeAnchor, normalizeAttachment } from "@/lib/anchors";
import { cn } from "@/lib/utils";

/**
 * A pending anchor in the composer: file name, "0:12 · region", and a remove
 * button. Derived from a `[[anchor:…]]` token in the draft; removing the chip
 * strips the token. One quiet outlined chip, no fill.
 */
export function AnchorChip({ anchor, attachment, onRemove, copy = {}, className }) {
  const target = normalizeAnchor(anchor);
  if (!target) return null;
  const file = normalizeAttachment(attachment);
  const label = anchorLabel(target, copy.anchorRegion || "region");
  const Icon = file?.kind === "video" ? Film : file?.kind === "image" ? ImageIcon : Crosshair;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 py-0.5 pl-1.5 pr-1 text-xs text-foreground/90",
        className
      )}
      data-anchor-id={target.attachmentId}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      {file?.name ? <span className="min-w-0 max-w-[12rem] truncate">{file.name}</span> : null}
      <span className="tabular-nums text-muted-foreground">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(target)}
          aria-label={copy.anchorRemove || "Remove anchor"}
          className="grid size-4 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

export default AnchorChip;
