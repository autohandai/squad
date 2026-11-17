import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

import { SquadFlock } from "@/components/brand/SquadFlock";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

// Before the owned app sets a theme class the root carries the dark tokens
// (OwnershipBootstrap), which painted sign-in dark for a person in light mode
// right after a light boot screen. Follow the same choice the boot screen
// makes: the saved theme, else the system's.
function startupTheme() {
  if (typeof document === "undefined") return "";
  const root = document.documentElement.classList;
  if (root.contains("light") || root.contains("dark")) return "";
  try {
    const mode = JSON.parse(localStorage.getItem("autohandSquad.v1.theme") || "{}").mode;
    if (mode === "light" || mode === "dark") return mode;
  } catch { /* Storage may be unavailable; fall back to the system. */ }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "";
}

export const TERMS_URL = "https://autohand.ai/policies/";
export const PRIVACY_URL = "https://autohand.ai/policies/privacy-policy/";

// Apple's mark for the "Continue with Apple" action, as Apple's sign-in
// button guidance asks: the logo beside the words, never on its own.
function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="size-4">
      <path d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8-1.29-1.82-2.32-4.63-2.32-7.28 0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z" />
    </svg>
  );
}

/**
 * Full-page sign-in (ADR-0245). Squad runs members on the person's Autohand
 * account, so the workspace opens only for a signed-in account. The bridge
 * starts the device login of the Autohand CLI bundled with Squad; one sign-in
 * covers both, so this page never mentions the CLI. It shows the link and
 * code the login prints, waits for the browser, and re-checks the account.
 * Nothing here handles credentials.
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
  flockSeed,
}) {
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [provider, setProvider] = useState("");
  const [starting, setStarting] = useState(false);
  const [theme] = useState(startupTheme);
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

  async function beginSignIn(nextProvider = provider) {
    const current = ++generation.current;
    window.clearInterval(pollRef.current);
    setProvider(nextProvider);
    setBusy(true);
    setError("");
    setNotice("");
    setCopied("");
    setStarting(true);
    try {
      const started = await mutate(() => startLogin(nextProvider ? { provider: nextProvider } : undefined));
      if (current !== generation.current) return;
      setStarting(false);
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
            if (status?.state === "cancelled") setNotice("Sign-in was cancelled. Start again when you’re ready.");
          }
          await refreshAccount?.();
        } catch (pollError) {
          if (current === generation.current) setError(pollError?.message || "Could not check the sign-in status.");
        } finally { polling = false; }
      }, 1000);
    } catch (startError) {
      if (current !== generation.current) return;
      setStarting(false);
      setBusy(false);
      setError(startError?.message || "Could not start the sign-in flow.");
    }
  }

  async function resetSignIn(restart = false, { cancelled = false } = {}) {
    const current = ++generation.current;
    window.clearInterval(pollRef.current);
    setBusy(true);
    setStarting(false);
    setFlow(null);
    setError("");
    setNotice("");
    setCopied("");
    try {
      await mutate(cancelLogin);
      if (current !== generation.current) return;
      setBusy(false);
      if (cancelled) setNotice("Sign-in was cancelled. Start again when you’re ready.");
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
  const mood = bridgeUnavailable ? "asleep" : error ? "error" : waiting || starting ? "waiting" : "idle";
  const apple = provider === "apple";

  return (
    <main className={cn("flex min-h-[100svh] w-full flex-col items-center bg-background px-6 text-foreground", theme === "light" && "light")} data-testid="sign-in-gate" data-state={mood}>
      <div className="app-drag-strip" data-tauri-drag-region aria-hidden="true" />
      {/* Anchored from the top, not centred: a state that adds lines (the
          link and code) grows downward, so the mark and the perch never move. */}
      <div className="flex w-full max-w-md flex-1 flex-col pt-[max(3rem,calc(50svh-13rem))] pb-12">
        <header className="text-center">
          {/* The root's own tokens are dark; `.light` (on the root or this page) is the exception. */}
          <img src="/brand/autohand-squad/autohand-squad-mark-light.webp" alt="" aria-hidden="true" className="mx-auto mb-5 hidden size-14 object-contain [.light_&]:block" />
          <img src="/brand/autohand-squad/autohand-squad-mark-dark.webp" alt="" aria-hidden="true" className="mx-auto mb-5 size-14 object-contain [.light_&]:hidden" />
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{productName}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">Your team of agents, in one place.</p>
        </header>

        <SquadFlock mood={mood} seed={flockSeed} size={48} gap={16} className="mt-10 mb-10" />

        {bridgeUnavailable ? (
          <p className="mb-5 text-center text-sm text-muted-foreground" role="status">
            Squad’s local service isn’t answering yet. Sign-in opens as soon as it’s back.
          </p>
        ) : null}

        {waiting ? (
          <div className="flex flex-col gap-4 text-center" role="status" aria-live="polite">
            <div>
              <p className="flex items-center justify-center gap-2 text-base font-medium"><Spinner /> Waiting for your browser…</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {apple
                  ? "Continue with Apple on autohand.ai. Squad picks it up on its own."
                  : "Sign in on autohand.ai. Squad picks it up on its own."}
              </p>
            </div>

            {flow?.code ? (
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs text-muted-foreground">If the page asks for a code</p>
                <div className="flex items-center gap-1">
                  <code className="select-all font-mono text-xl font-medium tracking-[0.12em] text-foreground" data-testid="sign-in-code">{flow.code}</code>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copy(flow.code, "code")} aria-label="Copy code">
                    <Copy /> {copied === "code" ? "Copied" : "Copy code"}
                  </Button>
                </div>
              </div>
            ) : null}

            {flow?.url ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center justify-center gap-1">
                  <Button type="button" variant="link" size="sm" onClick={openPage}>
                    Open the sign-in page <ExternalLink />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => copy(flow.url, "link")} aria-label="Copy link">
                    <Copy /> {copied === "link" ? "Copied" : "Copy link"}
                  </Button>
                </div>
                <p className="select-all break-all font-mono text-xs text-muted-foreground" data-testid="sign-in-url">{flow.url}</p>
                <p className="text-xs text-muted-foreground">Wrong browser profile? Paste the link into the right one.</p>
              </div>
            ) : null}

            <div className="flex justify-center gap-1 border-t border-border/70 pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSignIn(false, { cancelled: true })}>Cancel sign-in</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => resetSignIn(true)}>Start over</Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-sm flex-col gap-2.5">
            <Button type="button" size="lg" className="h-11 w-full justify-center" onClick={() => beginSignIn("")} disabled={busy || bridgeUnavailable}>
              {busy && !apple && starting ? <Spinner /> : null}
              {busy && !apple && starting ? "Opening your browser…" : "Continue with Autohand account"}
            </Button>
            <Button type="button" size="lg" variant="outline" className="h-11 w-full justify-center" onClick={() => beginSignIn("apple")} disabled={busy || bridgeUnavailable}>
              {busy && apple && starting ? <Spinner /> : <AppleLogo />}
              {busy && apple && starting ? "Opening your browser…" : "Continue with Apple"}
            </Button>
            {notice && !error ? <p className="mt-2 text-center text-sm text-muted-foreground" role="status">{notice}</p> : null}
          </div>
        )}

        {error ? (
          <div className="mt-4 flex flex-col items-center gap-1 text-center">
            <p className="text-sm text-destructive" role="alert">{error}</p>
            {!waiting ? (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => beginSignIn()} disabled={busy || bridgeUnavailable}>Try again</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => refreshAccount?.()}>Check again</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="pb-6 text-center text-xs text-muted-foreground">
        By continuing, you agree to Autohand’s{" "}
        <a href={TERMS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">Terms</a>
        {" "}and{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</a>.
      </footer>
    </main>
  );
}
