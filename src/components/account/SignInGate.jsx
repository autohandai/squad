import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LogIn, RefreshCw, TerminalSquare } from "lucide-react";

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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const pollRef = useRef(null);
  const generation = useRef(0);
  const mutation = useRef(Promise.resolve());
  function mutate(action) {
    const next = mutation.current.then(action, action);
    mutation.current = next.catch(() => {});
    return next;
  }

  // Pending flows belong to this view's lifetime, not a restored app session.
  useEffect(() => {
    resetSignIn();
    const reset = () => { resetSignIn(); };
    window.addEventListener("squad:sign-in-reset", reset);
    return () => {
      generation.current += 1;
      window.clearInterval(pollRef.current);
      window.removeEventListener("squad:sign-in-reset", reset);
    };
    // This is an initialization boundary, not a response to parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (account?.signedIn) onSignedIn?.();
  }, [account?.signedIn, onSignedIn]);

  async function beginSignIn() {
    const current = ++generation.current;
    window.clearInterval(pollRef.current);
    setBusy(true);
    setError("");
    setCopied("");
    try {
      const started = await mutate(startLogin);
      if (current !== generation.current) return;
      setFlow(started);
      if (started?.state !== "running") {
        setBusy(false);
        if (started?.state === "failed") setError(started.error || "Sign-in did not complete.");
        await refreshAccount?.();
        return;
      }
      let polling = false;
      pollRef.current = window.setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const status = await loginStatus();
          if (current !== generation.current) return;
          setFlow(status);
          if (status?.state !== "running") {
            window.clearInterval(pollRef.current);
            setBusy(false);
            if (status?.state === "failed") setError(status.error || "Sign-in did not complete.");
          }
          await refreshAccount?.();
        } catch (pollError) {
          if (current === generation.current) setError(pollError?.message || "Could not check the sign-in status.");
        } finally { polling = false; }
      }, 1000);
    } catch (startError) {
      if (current !== generation.current) return;
      setBusy(false);
      setError(startError?.message || "Could not start the sign-in flow.");
    }
  }

  async function resetSignIn(restart = false) {
    const current = ++generation.current;
    window.clearInterval(pollRef.current);
    setBusy(true);
    setFlow(null);
    setError("");
    setCopied("");
    try {
      await mutate(cancelLogin);
      if (current !== generation.current) return;
      setBusy(false);
      if (restart) await beginSignIn();
    } catch (cancelError) {
      if (current !== generation.current) return;
      setBusy(false);
      setError(cancelError?.message || "Could not cancel sign-in. Try again.");
    }
  }

  async function openPage() {
    setError("");
    try { await openLoginPage(); }
    catch (openError) { setError(openError?.message || "Could not open the sign-in page. Copy the link instead."); }
  }

  async function copy(value, label) {
    const ok = await copyText(value);
    setCopied(ok ? label : "");
    if (!ok) setError("Could not copy. Select the text below instead.");
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
                  Open the sign-in page <ExternalLink />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => copy(flow.url, "link")} aria-label="Copy link">
                  <Copy /> {copied === "link" ? "Copied" : "Copy link"}
                </Button>
              </div>
              <p className="select-all break-all text-center font-mono text-xs text-muted-foreground" data-testid="sign-in-url">{flow.url}</p>
              <p className="text-center text-xs text-muted-foreground">Wrong browser profile? Paste the link into the right one.</p>
            </>
          ) : null}

          {waiting && flow?.code ? (
            <div className="text-center text-sm text-muted-foreground">
              <p>Enter code <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" data-testid="sign-in-code">{flow.code}</code> if the page asks for one.</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => copy(flow.code, "code")} aria-label="Copy code">
                <Copy /> {copied === "code" ? "Copied" : "Copy code"}
              </Button>
            </div>
          ) : null}

          {waiting ? (
            <div className="flex justify-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSignIn()}>Cancel sign-in</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSignIn(true)}>Start over</Button>
            </div>
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
