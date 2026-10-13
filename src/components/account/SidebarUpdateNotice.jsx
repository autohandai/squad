import { ArrowDownToLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Contextual update notice, shown only after a successful repository check. */
export function SidebarUpdateNotice({ updates, checking = false, upgrading = false, error = "", upgradeResult = null, onDownload, onOpenReleases, className }) {
  const snapshot = updates?.snapshot;
  const available = updates?.status === "available" && snapshot?.success === true && snapshot?.updateAvailable === true && snapshot?.source === "github:autohandai/squad";
  if (!available) return null;
  const verifiedDownload = snapshot.downloadUrl && snapshot.downloadName && /^[a-f0-9]{64}$/i.test(snapshot.downloadSha256 || "");
  const busy = checking || upgrading;
  const download = verifiedDownload ? onDownload : onOpenReleases;

  return (
    <section aria-label="Squad update" className={cn("mx-4 border-t border-border/65 py-3", className)} data-testid="sidebar-update-notice">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">New update available</p>
          {snapshot.latestAllowedVersion ? <p className="mt-0.5 text-xs text-muted-foreground">Version {snapshot.latestAllowedVersion}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2" onClick={download} disabled={busy || !download} aria-label={upgrading ? "Preparing Squad update" : "Download Squad update"}>
          {upgrading ? <Spinner /> : <ArrowDownToLine aria-hidden="true" className="size-3.5" />}
          {upgrading ? "Preparing…" : "Download"}
        </Button>
      </div>
      {upgrading ? <p className="mt-2 text-xs text-muted-foreground" role="status">Downloading and verifying the installer…</p> : null}
      {upgradeResult?.message ? <p className="mt-2 text-xs leading-5 text-muted-foreground" role="status">{upgradeResult.message}</p> : null}
      {error ? <p className="mt-2 text-xs leading-5 text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
