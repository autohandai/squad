import { ArrowDownToLine, RotateCw } from "lucide-react";

import { SquadFlock } from "@/components/brand/SquadFlock";
import { Button } from "@/components/ui/button";
import { updateView } from "@/lib/update-status";

// What each install step is called, and the one true sentence about it.
// Installing stops running work (ADR-0144): saying the squad keeps working
// here would be false, so the copy says what is kept instead.
const STEPS = {
  preparing: {
    word: "Getting ready",
    line: "Stopping running work so nothing is cut off mid-step. Paused goals and queued messages are kept.",
  },
  installing: {
    word: "Installing",
    line: "Squad closes, installs the update and reopens by itself. Members, conversations and settings stay as they are.",
  },
  restarting: {
    word: "Reopening",
    line: "Squad is reopening with your saved data.",
  },
};

/**
 * The window during an install-and-restart (ADR-0245). Opens when the person
 * chooses Install and restart and stays until Squad closes; if the install is
 * refused or fails, it says why and offers Try again, the release download,
 * and a way back. It never opens for a download: downloads run in the
 * background while the squad keeps working.
 */
export function UpdateScreen({ updates, operation = {}, error = "", requested = false, onRetry, onDownload, onOpenReleases, onClose, flockSeed }) {
  const view = updateView(updates, operation, { error });
  const step = STEPS[view.phase];
  // `requested` covers the moment between the click and the bridge's answer;
  // an error from closing Squad wins over a phase that still says installing.
  const failed = !requested && (!step || Boolean(error));
  const version = view.operation.version || view.latest;
  const status = failed ? "Didn’t finish" : step?.word || "Starting";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-screen-title"
      data-testid="update-screen"
      data-phase={failed ? "failed" : view.phase}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-6 text-foreground"
    >
      <div className="app-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <SquadFlock mood={failed ? "error" : "waiting"} size={44} gap={16} seed={flockSeed} className="mb-10" />
        <h1 id="update-screen-title" className="text-2xl font-semibold tracking-tight">
          {failed ? "The update didn’t finish" : version ? `Updating Squad to ${version}` : "Updating Squad"}
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {failed
            ? "Squad is still open and nothing was replaced. Your members, conversations and settings are unchanged."
            : (step || STEPS.preparing).line}
        </p>
        {/* The heading already says it failed; the step word is for progress. */}
        <p className={failed ? "sr-only" : "mt-6 text-sm font-medium text-muted-foreground"} role="status" aria-live="polite" data-testid="update-screen-status">
          {status}{failed ? "" : "…"}
        </p>
        {failed ? (
          <>
            {view.failure ? <p className="mt-5 text-sm text-destructive [overflow-wrap:anywhere]" role="alert" data-selectable>{view.failure}</p> : null}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {/* Retrying a download a newer release replaced would install
                  the old version again (ADR-0279): fetch the new one instead. */}
              {view.superseded && view.downloadable ? (
                <Button onClick={() => onDownload?.()} disabled={!onDownload}><ArrowDownToLine data-icon="inline-start" />Download {view.latest}</Button>
              ) : (
                <Button onClick={() => onRetry?.()} disabled={!onRetry}><RotateCw data-icon="inline-start" />Try again</Button>
              )}
              <Button variant="ghost" onClick={onClose}>Back to Squad</Button>
            </div>
            <Button variant="link" size="sm" className="mt-3 text-muted-foreground" onClick={onOpenReleases}>Download the latest version</Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Phases in which the update screen owns the window. */
export const UPDATE_SCREEN_PHASES = new Set(["preparing", "installing", "restarting"]);
