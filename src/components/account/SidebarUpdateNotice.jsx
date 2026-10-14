import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpdateProgress } from "./UpdateProgress";
import { updateView } from "@/lib/update-status";
import { cn } from "@/lib/utils";
/** The same operation appears in Settings and every sidebar skin. */
export function SidebarUpdateNotice({
  updates,
  checking = false,
  error = "",
  operation = {},
  onDownload,
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
        <Button
          variant="ghost"
          size="sm"
          onClick={
            ready || view.busy || view.phase === "failed"
              ? onReview
              : view.downloadable
                ? onDownload
                : onOpenReleases
          }
          disabled={checking && !view.busy}
          aria-label={ready ? "Review Squad update" : "Download Squad update"}
        >
          {view.busy || ready || view.phase === "failed" ? (
            "View"
          ) : (
            <>
              <ArrowDownToLine data-icon="inline-start" />
              Download
            </>
          )}
        </Button>
      </div>
      <UpdateProgress operation={operation} compact />
      {view.failure ? (
        <p className="text-xs text-destructive" role="alert">
          {view.failure}
        </p>
      ) : null}
    </section>
  );
}
