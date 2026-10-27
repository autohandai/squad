import { ArrowDownToLine, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UpdateProgress } from "@/components/account/UpdateProgress";
import { checkedTime, updateView, updateInstallAction } from "@/lib/update-status";
export function UpdatesSettings({
  updates,
  checking = false,
  error = "",
  operation = {},
  onCheck,
  onDownload,
  onInstall,
  onCancel,
  onOpenReleases,
  renderNotes,
}) {
  const view = updateView(updates, operation, { checking, error });
  const date = checkedTime(updates?.snapshot?.checkedAt);
  const installAction = updateInstallAction(operation);
  const ready = Boolean(installAction);
  const cancellable = ["checking", "downloading", "verifying"].includes(
    view.phase,
  );
  return (
    <section
      aria-label="Software update"
      className="flex flex-col gap-6"
      data-testid="software-update"
    >
      <div className="flex flex-col gap-3">
        <h3
          className="text-xl font-semibold tracking-tight"
          role="status"
          aria-live="polite"
        >
          {view.title}
        </h3>
        <p className="text-sm text-muted-foreground">
          {view.phase === "ready"
            ? "The download is verified. Installing stops any running work first, and paused goals can be resumed afterwards."
            : view.phase === "complete"
              ? "Your members, conversations, and settings are here."
              : view.phase === "installer-open"
                ? operation.message
                : view.phase === "installing" || view.phase === "restarting"
                  ? "Squad will close briefly and reopen with your saved data."
                  : view.preview
                    ? "This local version is newer than the latest public release."
                    : view.available
                      ? "Download in the background, then install when you’re ready."
                      : updates?.status === "offline"
                        ? "Start the Squad service, then try again."
                        : "New releases appear here automatically when checks are enabled."}
        </p>
        <UpdateProgress operation={operation} />
        {view.failure ? (
          <p role="alert" className="text-sm text-destructive" data-selectable>
            {view.failure}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {ready ? (
            <Button onClick={onInstall} disabled={view.busy || !onInstall}>
              <RotateCw data-icon="inline-start" />
              {installAction}
            </Button>
          ) : view.downloadable && !view.busy ? (
            <Button onClick={onDownload} disabled={checking || !onDownload}>
              <ArrowDownToLine data-icon="inline-start" />
              {view.phase === "failed" ? "Retry download" : "Download update"}
            </Button>
          ) : null}
          {ready && operation.installMode === "restart" ? (
            <Button variant="ghost" size="sm" onClick={() => onInstall?.({ mode: "installer" })} disabled={view.busy || !onInstall}>Open installer</Button>
          ) : null}
          {cancellable ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel download
            </Button>
          ) : null}
          {!view.busy ? (
            <Button
              variant={view.downloadable || ready ? "ghost" : "outline"}
              size="sm"
              onClick={onCheck}
              disabled={checking}
            >
              <RefreshCw data-icon="inline-start" />
              {checking ? "Checking…" : "Check for updates"}
            </Button>
          ) : null}
        </div>
      </div>
      <Separator />
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 text-sm">
        <dt className="text-muted-foreground">Installed version</dt>
        <dd className="tabular-nums">{view.current || "Unknown"}</dd>
        {view.latest ? (
          <>
            <dt className="text-muted-foreground">Latest public release</dt>
            <dd className="tabular-nums">{view.latest}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {date ? (
            <time dateTime={date.toISOString()} title={date.toLocaleString()}>
              Last checked{" "}
              {date.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          ) : (
            "No successful check yet"
          )}
        </span>
        <Button
          variant="link"
          size="sm"
          onClick={onOpenReleases}
          disabled={view.busy}
        >
          Release notes
        </Button>
      </div>
      {view.available && updates?.snapshot?.notes ? (
        <div data-selectable>
          <h4 className="mb-3 text-sm font-medium">What’s new</h4>
          {renderNotes?.(updates.snapshot.notes)}
        </div>
      ) : null}
      {view.available && !view.downloadable ? (
        <p className="text-sm text-muted-foreground">
          An installer for this computer isn’t available yet. See Release notes
          for downloads.
        </p>
      ) : null}
    </section>
  );
}
