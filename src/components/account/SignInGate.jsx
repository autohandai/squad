import { useEffect, useRef, useState } from "react";
import { ExternalLink, LogIn, RefreshCw, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Full-page sign-in gate. Autohand Squad runs members on the user's Autohand
 * account by default, so the workspace opens only for a signed-in account.
 * The bridge starts the CLI's own login flow; this page shows the URL and
 * device code it prints, waits for the flow to finish, and re-checks the
 * account. Nothing here handles credentials.
 */
export function SignInGate({
  account,
  bridgeUnavailable = false,
  startLogin,
  loginStatus,
  refreshAccount,
  onSignedIn,
  productName = "Autohand Squad",
}) {
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  useEffect(() => {
    if (account?.signedIn) onSignedIn?.();
  }, [account?.signedIn, onSignedIn]);

  async function beginSignIn() {
    setBusy(true);
    setError("");
    try {
      const started = await startLogin();
      setFlow(started);
      window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await loginStatus();
          setFlow(status);
          if (status?.state === "done" || status?.state === "failed" || status?.state === "cancelled") {
            window.clearInterval(pollRef.current);
            setBusy(false);
            if (status.state === "failed") setError(status.error || "Sign-in did not complete.");
            await refreshAccount?.();
          } else if (status?.state === "running") {
            await refreshAccount?.();
          }
        } catch (pollError) {
          setError(pollError?.message || "Could not check the sign-in status.");
        }
      }, 2500);
    } catch (startError) {
      setBusy(false);
      setError(startError?.message || "Could not start the sign-in flow.");
    }
  }

  const waiting = busy && flow?.state === "running";

  return (
    <main className="flex min-h-[100svh] w-full flex-col items-center justify-center bg-background px-6 py-16 text-foreground" data-testid="sign-in-gate">
      <div className="app-drag-strip" data-tauri-drag-region aria-hidden="true" />
      <div className="w-full max-w-sm">
        <div className="mb-9 text-center">
          <img src="/brand/autohand-squad/autohand-squad-mark-light.webp" alt="" aria-hidden="true" className="mx-auto mb-4 size-14 object-contain dark:hidden" />
          <img src="/brand/autohand-squad/autohand-squad-mark-dark.webp" alt="" aria-hidden="true" className="mx-auto mb-4 hidden size-14 object-contain dark:block" />
          <h1 className="text-xl font-semibold tracking-tight">{productName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your team of agents, in one place.</p>
        </div>

        <div className="mb-5">
          <h2 className="text-base font-medium">Sign in to your squad</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your Autohand account to get started.</p>
        </div>

        {bridgeUnavailable ? (
          <p className="mb-5 text-sm text-muted-foreground" role="status">
            The local bridge is not answering yet. Sign-in continues once it is back.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button type="button" size="lg" className="h-11 w-full justify-center" onClick={beginSignIn} disabled={busy || bridgeUnavailable}>
            {busy ? <Spinner /> : <LogIn data-icon="inline-start" />}
            {waiting ? "Waiting for the browser…" : busy ? "Opening sign-in…" : "Continue with Autohand account"}
          </Button>

          {flow?.url ? (
            <a
              href={flow.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              Open the sign-in page
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}

          {flow?.code ? (
            <p className="text-center text-sm text-muted-foreground">
              Enter code <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{flow.code}</code> if the page asks for one.
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>

        <div className={cn("mt-8 border-t border-border/70 pt-5 text-sm text-muted-foreground")}>
          <p className="flex items-start gap-2">
            <TerminalSquare className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Prefer a terminal? Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">autohand login</code>, then check again.
            </span>
          </p>
          <Button type="button" variant="ghost" size="sm" className="mt-3 -ml-2 text-muted-foreground" onClick={() => refreshAccount?.()}>
            <RefreshCw data-icon="inline-start" />
            Check again
          </Button>
        </div>
      </div>
    </main>
  );
}
