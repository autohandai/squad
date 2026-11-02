import { useEffect, useRef, useState } from "react";
import { ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PERMISSION_CHOICES, permissionRequestDetail } from "@/lib/permission-requests";

/**
 * A member paused mid-reply because a tool needs permission (ADR-0161). One
 * divider row per waiting request: what it wants, the command or path, and
 * the choices. Answering sends the decision to the engine over the bridge;
 * nothing here writes the member's permanent permissions.
 *
 *   requests  pendingPermissionRequests(message)
 *   onDecide  (request, decisionId) => Promise
 */
export function PermissionApprovalCard({ requests = [], memberName = "The member", onDecide, copy = {} }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  // A request arrives under a reply that is still growing, below the fold
  // of a chat that stopped following; bring it into view once.
  const firstId = requests[0]?.requestId || "";
  useEffect(() => {
    if (firstId) rootRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [firstId]);
  if (!requests.length) return null;

  async function decide(request, decision) {
    if (busy) return;
    setBusy(`${request.requestId}:${decision}`);
    setError("");
    try {
      await onDecide?.(request, decision);
    } catch (failure) {
      setError(failure?.message || "Could not send that decision. Try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div ref={rootRef} className="mt-3 border-t border-border/70 pt-3 text-sm" data-testid="permission-approval" role="group" aria-label={`${memberName} asks for permission`}>
      {requests.map((request) => {
        const detail = permissionRequestDetail(request);
        return (
          <div key={request.requestId} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-1.5" data-testid="permission-request" data-request-id={request.requestId}>
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p>
                <span className="text-foreground">{memberName}</span>{" "}
                <span className="text-muted-foreground">{copy.permissionAsks || "asks:"}</span>{" "}
                <span className="text-foreground">{request.title}</span>
              </p>
              {detail && !request.title.includes(detail) ? <code className="mt-1 block truncate text-xs text-muted-foreground">{detail}</code> : null}
            </div>
            <span className="flex shrink-0 flex-wrap items-center gap-1">
              {PERMISSION_CHOICES.map((choice) => (
                <Button
                  key={choice.id}
                  type="button"
                  size="sm"
                  variant={choice.variant}
                  className={choice.variant === "ghost" ? "h-7 text-muted-foreground" : "h-7"}
                  disabled={Boolean(busy)}
                  onClick={() => decide(request, choice.id)}
                >
                  {busy === `${request.requestId}:${choice.id}` ? "…" : copy[`permission_${choice.id}`] || choice.label}
                </Button>
              ))}
            </span>
          </div>
        );
      })}
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">{copy.permissionNote || "Allow applies to this request or this reply only. To change what this member may do without asking, open its Permissions."}</p>
    </div>
  );
}
