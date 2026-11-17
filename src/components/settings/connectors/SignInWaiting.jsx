import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * What a person sees while a sign-in is open in their browser: one quiet
 * line, the code to type for a device sign-in, and a way to open the page
 * again (pop-ups can be blocked) or stop waiting.
 */
export function SignInWaiting({ name, state, onOpen, onCancel, compact = false }) {
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  if (state.error) return <p className="text-sm leading-6 text-destructive" role="alert">{state.error}</p>;
  if (state.mode === "device") {
    return (
      <div className="space-y-2" role="status" data-testid="connector-device-code">
        <p className="text-sm leading-6">Go to <a className="underline underline-offset-2" href={state.verificationUri} target="_blank" rel="noreferrer noopener">{state.verificationUri.replace(/^https?:\/\//, "")}</a> and enter this code to sign in to {name}:</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-border/70 px-2.5 py-1 font-mono text-base tracking-widest">{state.userCode}</code>
          <Button type="button" size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(state.userCode); setCopied(true); } catch { setCopied(false); } }}><Copy className="size-3.5" aria-hidden="true" />{copied ? "Copied" : "Copy"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />Waiting for {name} to confirm…</p>
      </div>
    );
  }
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"} role="status" data-testid="connector-signin-waiting">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Finish signing in to {name} in your browser.</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>Open sign-in page</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
