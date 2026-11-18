import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/copy-text";
import { webhookCurlExample } from "@/lib/routines";
import { cn } from "@/lib/utils";

function CopyButton({ text, label, className }) {
  const [state, setState] = useState("idle");
  async function copy() {
    const done = await copyText(text);
    setState(done ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1600);
  }
  return (
    <Button type="button" variant="ghost" size="sm" className={cn("h-7 gap-1.5 px-2 text-xs text-muted-foreground", className)} onClick={copy} disabled={!text}>
      {state === "copied" ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}

function relative(iso, now = Date.now()) {
  const at = Date.parse(iso || "");
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * A webhook automation's URL (ADR-0254): the secret URL in mono with Copy,
 * an example curl, how often it was called, and New URL / Turn off. The URL
 * is on this computer's bridge; the line under it says how a service on the
 * internet reaches it. Plain text and a thin rule, no box.
 *
 *   webhook   the bridge's public webhook ({ active, url, calls, lastCalledAt,
 *             maxBodyBytes, maxCallsPerMinute }), or null before the first save
 */
export function AutomationWebhook({ webhook, onRotate, onRevoke, memberName = "the member", className }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(kind, action) {
    if (!action) return;
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (problem) {
      setError(problem?.message || "That did not work.");
    } finally {
      setBusy("");
    }
  }

  if (!webhook) {
    return (
      <p className={cn("text-sm leading-6 text-muted-foreground", className)} data-testid="automation-webhook-pending">
        Squad makes a private URL for this automation when you save it. Anything that POSTs JSON to it starts {memberName}, with the body as context.
      </p>
    );
  }

  const curl = webhookCurlExample(webhook.url);
  const kb = Math.round((webhook.maxBodyBytes || 65536) / 1024);
  const usage = webhook.calls ? `Called ${webhook.calls} ${webhook.calls === 1 ? "time" : "times"}, last ${relative(webhook.lastCalledAt)}` : "Not called yet";

  return (
    <div className={cn("grid gap-3", className)} data-testid="automation-webhook">
      {webhook.active ? (
        <>
          <div className="grid gap-1">
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 select-all break-all font-mono text-xs leading-5 text-foreground" data-testid="automation-webhook-url">{webhook.url}</code>
              <CopyButton text={webhook.url} label="Copy URL" className="-mt-1 shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground">{usage} · JSON up to {kb} KB · {webhook.maxCallsPerMinute || 10} calls a minute · one run at a time</p>
          </div>
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Try it</span>
              <CopyButton text={curl} label="Copy" />
            </div>
            <pre className="overflow-x-auto border-l-2 border-border pl-3 font-mono text-[11px] leading-5 text-muted-foreground" data-testid="automation-webhook-curl">{curl}</pre>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            This URL is on this computer. A service on the internet reaches it only through a tunnel you already run, such as your secure tunnel in Settings › Computers. Treat it like a password.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="automation-webhook-off">The URL is turned off. Calls answer “not found” until you make a new one.</p>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {onRotate || onRevoke ? (
        <div className="flex flex-wrap items-center gap-1">
          {onRotate ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={Boolean(busy)} onClick={() => act("rotate", onRotate)}>
              {busy === "rotate" ? <Spinner className="size-3.5" /> : null}
              {webhook.active ? "New URL" : "Make a new URL"}
            </Button>
          ) : null}
          {onRevoke && webhook.active ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={Boolean(busy)} onClick={() => act("revoke", onRevoke)}>
              {busy === "revoke" ? <Spinner className="size-3.5" /> : null}
              Turn off URL
            </Button>
          ) : null}
          {webhook.active && onRotate ? <span className="text-xs text-muted-foreground">New URL stops the old one at once.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
