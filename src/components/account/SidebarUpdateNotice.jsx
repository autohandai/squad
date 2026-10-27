import { ArrowDownToLine, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpdateProgress } from "./UpdateProgress";
import { updateView, updateInstallAction } from "@/lib/update-status";
import { cn } from "@/lib/utils";
/** The same operation appears in Settings and every sidebar skin. */
export function SidebarUpdateNotice({
  updates,
  checking = false,
  error = "",
  operation = {},
  onDownload,
  onInstall,
  onReview,
  onOpenReleases,
  className,
}) {
  const view = updateView(updates, operation, { checking, error });
  if (
    !view.available &&
    !view.busy &&
    !["ready", "failed", "complete", "installer-open"].includes(view.phase)
  )
    return null;
  const ready = ["ready", "installer-open", "complete"].includes(view.phase);
  const installAction = updateInstallAction(operation);
  return (
    <section
      aria-label="Squad update"
      className={cn("flex flex-col gap-2 py-3", className)}
      data-testid="sidebar-update-notice"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {view.busy ? view.title : ready ? view.title : "Update available"}
          </p>
          {!view.busy && !ready ? (
            <p className="text-xs text-muted-foreground">
              Version {view.latest}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={
            installAction
              ? onInstall
              : ready || view.busy
                ? onReview
              : view.downloadable || view.phase === "failed"
                ? onDownload
                : onOpenReleases
          }
          disabled={(checking && !view.busy) || Boolean(installAction && !onInstall)}
        >
          {installAction ? (
            <><RotateCw data-icon="inline-start" />{installAction}</>
          ) : view.busy || ready ? (
            "Details"
          ) : (
            <>
              <ArrowDownToLine data-icon="inline-start" />
              {view.phase === "failed" ? "Retry download" : "Download"}
            </>
          )}
        </Button>
        {installAction && operation.installMode === "restart" && view.phase === "failed" ? (
          <Button variant="link" size="sm" onClick={() => onInstall?.({ mode: "installer" })}>Open installer</Button>
        ) : null}
      </div>
      <UpdateProgress operation={operation} compact />
      {view.failure ? (
        <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert" data-selectable>
          {view.failure}
        </p>
      ) : null}
    </section>
  );
}
