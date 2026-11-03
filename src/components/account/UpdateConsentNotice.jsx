import { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateView, updateInstallAction } from "@/lib/update-status";

// Visible even in Settings, on a phone, or with the sidebar collapsed.
// Review leads to the explicit download/install choice; it never installs.
export function UpdateConsentNotice({ updates, operation, onReview, hidden = false }) {
  const [dismissed, setDismissed] = useState("");
  const view = updateView(updates, operation);
  const ready = Boolean(updateInstallAction(view.operation));
  const version = ready ? view.operation.version : view.latest;
  const key = `${version}:${ready ? "ready" : "available"}`;
  let snoozed = false;
  try { snoozed = Number(sessionStorage.getItem(`squad.update.${key}`)) > Date.now(); } catch { /* Storage may be unavailable. */ }
  if (hidden || view.busy || (!view.available && !ready) || dismissed === key || snoozed) return null;
  return (
    <div data-testid="update-consent-notice" role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/65 px-6 py-2 text-sm">
      <p className="min-w-0 flex-1">{ready ? `Version ${version} is ready to install.` : `Version ${version} is available.`} <span className="text-muted-foreground">{ready ? "Install and restart when you’re ready." : "Review what’s new and choose when to upgrade."}</span></p>
      <Button size="sm" variant="outline" onClick={onReview}>Review update</Button>
      <Button size="sm" variant="ghost" onClick={() => {
        setDismissed(key);
        try { sessionStorage.setItem(`squad.update.${key}`, String(Date.now() + 24 * 60 * 60_000)); } catch { /* The current window still dismisses it. */ }
      }}>Later</Button>
    </div>
  );
}
