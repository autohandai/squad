import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * "Runs on" control for a member: two divider rows (This machine / Remote
 * bridge), URL + token inputs with a Test button and one status sentence,
 * and a "Share this machine" disclosure that mints a token for another
 * machine and shows it exactly once.
 *
 * Props
 *   remote       public shape from GET /api/remote/members ({ url, label, hasToken, addedAt }) or null
 *   onSave       async ({ url, token, label }) => saved shape (may include `probe`)
 *   onRemove     async () => void — the member runs here again
 *   onProbe      async ({ url, token, label }) => probe summary; throws with the remote's name on failure
 *   onMintToken  async ({ label }) => { token, url, id, label } — shown once
 *   copy         locale strings (src/locales.js); fallbacks below
 */
export function RunsOnSettings({ remote = null, onSave, onRemove, onProbe, onMintToken, copy = {}, id = "member-runs-on" }) {
  const [mode, setMode] = useState(remote ? "remote" : "local");
  const [url, setUrl] = useState(remote?.url || "");
  const [label, setLabel] = useState(remote?.label || "");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState(null); // { tone: "ok" | "error" | "muted", text }
  const [busy, setBusy] = useState(""); // "test" | "save" | "remove" | "mint"
  const [shareOpen, setShareOpen] = useState(false);
  const [minted, setMinted] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMode(remote ? "remote" : "local");
    setUrl(remote?.url || "");
    setLabel(remote?.label || "");
    setToken("");
    setStatus(null);
  }, [remote?.url, remote?.label, remote?.hasToken]);

  const candidate = { url: url.trim(), token: token.trim(), label: label.trim() };
  const hasToken = Boolean(candidate.token) || Boolean(remote?.hasToken && remote?.url === candidate.url);
  const canTest = mode === "remote" && Boolean(candidate.url) && hasToken && !busy;
  const dirty =
    mode === "local" ? Boolean(remote) : Boolean(candidate.url) && (candidate.url !== remote?.url || candidate.label !== (remote?.label || "") || Boolean(candidate.token));
  const canSave = mode === "local" ? Boolean(remote) && !busy : Boolean(candidate.url) && hasToken && dirty && !busy;

  async function test() {
    if (!onProbe) return;
    setBusy("test");
    setStatus({ tone: "muted", text: copy.runsOnTesting || "Reaching the bridge…" });
    try {
      const result = await onProbe(candidate);
      setStatus({ tone: "ok", text: probeSentence(result, copy) });
    } catch (error) {
      setStatus({ tone: "error", text: error?.message || copy.runsOnUnreachable || "The remote bridge did not answer." });
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy(mode === "local" ? "remove" : "save");
    try {
      if (mode === "local") {
        await onRemove?.();
        setStatus({ tone: "muted", text: copy.runsOnNowLocal || "This member runs on this machine." });
      } else {
        const saved = await onSave?.(candidate);
        setToken("");
        setStatus({ tone: "ok", text: saved?.probe ? probeSentence(saved.probe, copy) : copy.runsOnSaved || "Saved. Mentions now route to the remote bridge." });
      }
    } catch (error) {
      setStatus({ tone: "error", text: error?.message || copy.runsOnSaveFailed || "Could not save the remote bridge." });
    } finally {
      setBusy("");
    }
  }

  async function mint() {
    if (!onMintToken) return;
    setBusy("mint");
    setCopied(false);
    try {
      setMinted(await onMintToken({ label: copy.runsOnSharedTokenLabel || "Shared machine" }));
    } catch (error) {
      setMinted({ error: error?.message || copy.runsOnMintFailed || "Could not create a token." });
    } finally {
      setBusy("");
    }
  }

  async function copyToken() {
    if (!minted?.token) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const rows = [
    { value: "local", title: copy.runsOnThisMachine || "This machine", detail: copy.runsOnThisMachineDetail || "Runs as a local process through this bridge." },
    { value: "remote", title: copy.runsOnRemote || "Remote bridge", detail: copy.runsOnRemoteDetail || "Mentions and runs are forwarded to another machine's bridge; replies stream back here." },
  ];

  return (
    <div className="flex flex-col">
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-col">
        <span id={`${id}-label`} className="sr-only">
          {copy.runsOn || "Runs on"}
        </span>
        {rows.map((row) => {
          const selected = mode === row.value;
          return (
            <button
              key={row.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setMode(row.value);
                setStatus(null);
              }}
              className="flex w-full items-start gap-3 border-b border-border/75 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {selected ? <Check className="size-4 text-foreground" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", selected ? "font-medium text-foreground" : "text-foreground/80")}>{row.title}</span>
                <span className="block text-xs text-muted-foreground">{row.detail}</span>
              </span>
              {row.value === "remote" && remote ? (
                <span className="text-xs text-muted-foreground">{remote.label}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {mode === "remote" ? (
        <div className="flex flex-col gap-3 py-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-url`} className="text-xs">
                {copy.runsOnUrl || "Bridge URL"}
              </Label>
              <Input
                id={`${id}-url`}
                value={url}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://192.168.1.20:19821"
                className="h-9 bg-card font-mono text-xs"
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`} className="text-xs">
                {copy.runsOnLabel || "Name"}
              </Label>
              <Input id={`${id}-name`} value={label} placeholder={copy.runsOnLabelPlaceholder || "Studio Mac"} className="h-9 bg-card" onChange={(event) => setLabel(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-token`} className="text-xs">
              {copy.runsOnToken || "Token"}
            </Label>
            <Input
              id={`${id}-token`}
              type="password"
              value={token}
              autoComplete="off"
              placeholder={remote?.hasToken && remote?.url === candidate.url ? copy.runsOnTokenKept || "Saved — leave blank to keep it" : "ahs_…"}
              className="h-9 bg-card font-mono text-xs"
              onChange={(event) => setToken(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {copy.runsOnTokenHint || "Created on the other machine under Share this machine. Stored locally with owner-only permissions."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={test} disabled={!canTest}>
              {busy === "test" ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
              {copy.runsOnTest || "Test"}
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={!canSave}>
              {busy === "save" ? <Spinner /> : null}
              {copy.save || "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 py-4">
          {remote ? (
            <Button type="button" size="sm" onClick={save} disabled={!canSave}>
              {busy === "remove" ? <Spinner /> : null}
              {copy.runsOnUseThisMachine || "Use this machine"}
            </Button>
          ) : null}
        </div>
      )}

      {status ? (
        <p
          role={status.tone === "error" ? "alert" : "status"}
          className={cn("pb-4 text-sm", status.tone === "error" ? "text-destructive" : status.tone === "ok" ? "text-foreground" : "text-muted-foreground")}
        >
          {status.text}
          {status.tone === "error" && mode === "remote" && !busy ? (
            <>
              {" "}
              <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={test} disabled={!canTest}>
                {copy.retry || "Retry"}
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border/75 pt-3">
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={shareOpen}
          onClick={() => setShareOpen((open) => !open)}
        >
          {shareOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {copy.runsOnShare || "Share this machine"}
        </button>
        {shareOpen ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {copy.runsOnShareHint || "Create a token, then paste it with this machine's bridge URL into the other machine's Runs on settings. The token is shown once."}
            </p>
            {!minted || minted.error ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={mint} disabled={busy === "mint" || !onMintToken}>
                  {busy === "mint" ? <Spinner /> : null}
                  {copy.runsOnCreateToken || "Create a token"}
                </Button>
                {minted?.error ? <span className="text-xs text-destructive">{minted.error}</span> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs" title={minted.token}>
                    {minted.token}
                  </code>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.copyToClipboard || "Copy"} onClick={copyToken}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.dismiss || "Dismiss"} onClick={() => setMinted(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {minted.url ? (
                    <>
                      {copy.runsOnBridgeUrlIs || "This bridge answers at"} <code className="rounded bg-muted px-1 py-0.5 font-mono">{minted.url}</code>.{" "}
                    </>
                  ) : null}
                  {copy.runsOnShareReach || "Other machines need to reach that address: start the bridge with --host 0.0.0.0 on a trusted network, or put a tunnel in front of it."}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One sentence for a probe result: who answered and what it runs. */
export function probeSentence(result, copy = {}) {
  if (!result) return "";
  if (result.ok === false || result.error) return result.error || copy.runsOnUnreachable || "The remote bridge did not answer.";
  const parts = [`${copy.runsOnReached || "Reached"} ${result.label}${Number.isFinite(result.latencyMs) ? ` in ${result.latencyMs} ms` : ""}`];
  if (result.squadVersion) parts.push(`Squad ${result.squadVersion}`);
  if (result.cliVersion) parts.push(`autohand ${result.cliVersion}`);
  else if (result.cliAvailable === false) parts.push(copy.runsOnNoCli || "autohand CLI not installed there");
  if (result.account) parts.push(result.account);
  return `${parts.join(" · ")}.`;
}
