import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LogIn, RefreshCw, RotateCcw, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

/**
 * Full-page sign-in gate. Autohand Squad runs members on the user's Autohand
 * account by default, so the workspace opens only for a signed-in account.
 * The bridge starts the CLI's own login flow; this page shows the URL and
 * device code it prints, waits for the flow to finish, and re-checks the
 * account. Nothing here handles credentials.
 *
 * Closing the window only hides it and the bridge keeps the flow alive, so
 * the gate resumes a running flow and can start over with a fresh code.
 * Copy link exists for the wrong browser profile: opening again would land
 * in the same default browser.
 */
export function SignInGate({
  account,
  bridgeUnavailable = false,
  startLogin,
  loginStatus,
  openLoginPage,
  cancelLogin,
  refreshAccount,
  onSignedIn,
  productName = "Autohand Squad",
}) {
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => window.clearInterval(pollRef.current), []);

  useEffect(() => {
    let active = true;
    loginStatus?.()
      .then((status) => {
        if (!active || status?.state !== "running") return;
        setFlow(status);
        setBusy(true);
        watchFlow();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (account?.signedIn) onSignedIn?.();
  }, [account?.signedIn, onSignedIn]);

  async function beginSignIn() {
    setBusy(true);
    setError("");
    try {
      const started = await startLogin();
      setFlow(started);
      watchFlow();
    } catch (startError) {
      setBusy(false);
      setError(startError?.message || "Could not start the sign-in flow.");
    }
  }

  function watchFlow() {
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
  }

  async function startOver() {
    window.clearInterval(pollRef.current);
    setFlow(null);
    setCopied(false);
    try {
      await cancelLogin?.();
    } catch (cancelError) {
      setBusy(false);
      setError(cancelError?.message || "Could not cancel the sign-in flow.");
      return;
    }
    await beginSignIn();
  }

  async function openPage() {
    setError("");
    try {
      await openLoginPage();
    } catch (openError) {
      setError(openError?.message || "Could not open the sign-in page.");
    }
  }

  async function copyLink() {
    const ok = await copyText(flow?.url);
    setCopied(ok);
    if (!ok) setError("Could not copy the link. Select it below instead.");
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

          {waiting && flow?.url ? (
            <>
              <div className="flex items-center justify-center gap-1">
                <Button type="button" variant="link" size="sm" onClick={openPage}>
                  Open the sign-in page
                  <ExternalLink />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={copyLink}>
                  <Copy data-icon="inline-start" />
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Wrong browser profile? Paste the link into the right one.
              </p>
              <p className="select-all break-all text-center font-mono text-xs text-muted-foreground" data-testid="sign-in-url">
                {flow.url}
              </p>
            </>
          ) : null}

          {flow?.code ? (
            <p className="text-center text-sm text-muted-foreground">
              Enter code <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{flow.code}</code> if the page asks for one.
            </p>
          ) : null}

          {waiting ? (
            <Button type="button" variant="ghost" size="sm" className="self-center text-muted-foreground" onClick={startOver}>
              <RotateCcw data-icon="inline-start" />
              Start over with a new code
            </Button>
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
