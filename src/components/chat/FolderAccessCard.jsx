import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Folder access request (ADR-0116): one quiet block under a reply whose
 * tools were refused a folder. One line per folder with the path in mono,
 * Allow (adds the folder to the member and lets it continue) and Not now.
 *
 *   folders   paths still to decide (pendingFolderRequests)
 *   memberName
 *   onDecide  (folder, "allow" | "dismiss")
 *   busy      true while the member is answering (Allow still records the folder; the continuation waits)
 */
export function FolderAccessCard({ folders = [], memberName = "The member", onDecide, busy = false, copy = {} }) {
  if (!folders.length) return null;
  return (
    <div className="mt-3 border-t border-border/70 pt-3 text-sm" data-testid="folder-access">
      <p className="flex items-center gap-2 text-foreground">
        <FolderOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        <span>{(copy.folderAccessTitle || "{name} needs a folder outside its own.").replace("{name}", memberName)}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{copy.folderAccessHint || "Allow adds it to the member's folders for every later turn, then asks it to continue. The engine's own folders are already allowed."}</p>
      <ul className="mt-2 divide-y divide-border/60">
        {folders.map((folder) => (
          <li key={folder} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <code className="min-w-0 truncate text-xs">{folder}</code>
            <span className="flex shrink-0 items-center gap-1">
              <Button type="button" size="sm" className="h-7" onClick={() => onDecide?.(folder, "allow")}>
                {copy.folderAccessAllow || (busy ? "Allow" : "Allow and continue")}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => onDecide?.(folder, "dismiss")}>
                {copy.folderAccessDismiss || "Not now"}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
