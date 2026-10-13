import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NOTIFY_MODES, notifyModeDescription, notifyModeLabel, remoteAccessSentence } from "@/lib/remote-access";

function Row({ title, description, children, htmlFor }) {
  return (
    <Field orientation="horizontal" className="items-center justify-between gap-6 py-4">
      <FieldContent className="w-[220px] shrink-0 gap-1">
        <FieldTitle>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</FieldTitle>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </Field>
  );
}

function NotifyChoice({ mode, selected, copy, onSelect, disabled }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-md px-2 py-3.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
      onClick={() => onSelect(mode)}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", selected ? "font-medium text-foreground" : "text-foreground/90")}>{notifyModeLabel(mode, copy)}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{notifyModeDescription(mode, copy)}</span>
      </span>
      {selected ? <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" /> : null}
    </button>
  );
}

/**
 * Settings › Remote access (Telegram). Props:
 *   status           from GET /api/remote-access/status
 *   onConnect(token) -> Promise   PUT /api/remote-access/token
 *   onDisconnect()   -> Promise   DELETE /api/remote-access/token
 *   onUnpair()       -> Promise   POST /api/remote-access/unpair
 *   onRotatePairing()-> Promise   POST /api/remote-access/pairing/rotate
 *   onNotifyMode(m)  -> Promise   PUT /api/remote-access/settings
 *   onRefresh()      -> Promise   re-read status; called every few seconds
 *                                 while a bot is connected so pairing shows up
 *   copy             locale strings (fallbacks inline)
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function RemoteAccessSettings({ status = {}, onConnect, onDisconnect, onUnpair, onRotatePairing, onNotifyMode, onRefresh, copy = {}, className }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!status?.configured || !onRefresh) return undefined;
    const timer = window.setInterval(() => { onRefresh().catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, [status?.configured, onRefresh]);

  async function run(label, action) {
    if (!action) return;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setBusy("");
    }
  }

  const connect = () => run("connect", async () => { await onConnect?.(token.trim()); setToken(""); });
  const sentence = remoteAccessSentence(status, copy);
  const pairing = status?.pairing || null;
  const paired = status?.paired || null;

  return (
    <div className={cn("divide-y divide-border/65", className)}>
      <Row
        title={copy.remoteBotToken || "Bot token"}
        description={status?.configured
          ? `${copy.remoteTokenStored || "A token is stored"} (${status.tokenHint}). ${copy.remoteTokenReplace || "Paste a new one to replace it."}`
          : copy.remoteBotTokenDetail || "From @BotFather in Telegram: send /newbot, copy the token it gives you. Stored on this machine only."}
        htmlFor="remote-access-token"
      >
        <div className="flex w-full max-w-sm items-center gap-2">
          <Input
            id="remote-access-token"
            type="password"
            value={token}
            placeholder={status?.configured ? "••••••••" : "123456789:AAH…"}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && token.trim()) connect(); }}
          />
          <Button size="sm" variant="outline" disabled={!token.trim() || busy === "connect"} onClick={connect}>
            {busy === "connect" ? copy.connecting || "Connecting…" : copy.connect || "Connect"}
          </Button>
        </div>
      </Row>

      <div className="flex items-center justify-between gap-6 py-4">
        <p className={cn("min-w-0 text-sm leading-6", status?.error ? "text-destructive" : "text-muted-foreground")} data-testid="remote-access-sentence">
          {error || sentence}
        </p>
        {status?.configured ? (
          <Button size="sm" variant="ghost" disabled={busy === "disconnect"} onClick={() => run("disconnect", onDisconnect)}>
            {copy.disconnect || "Disconnect"}
          </Button>
        ) : null}
      </div>

      {pairing ? (
        <Row
          title={copy.remotePairing || "Pair your account"}
          description={copy.remotePairingDetail || "Open the link on your phone and tap Start, or send /pair with this code to the bot. One account only; a wrong code issues a new one."}
        >
          <div className="flex w-full max-w-sm flex-col items-end gap-2">
            <code translate="no" className="rounded-md bg-muted/35 px-2.5 py-1.5 text-sm tracking-[0.2em]" data-testid="remote-access-code">{pairing.code}</code>
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={pairing.link} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {copy.openInTelegram || "Open in Telegram"}
                </a>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === "rotate"} onClick={() => run("rotate", onRotatePairing)} aria-label={copy.newPairingCode || "New code"}>
                <RefreshCw className={cn("size-3.5", busy === "rotate" && "animate-spin")} aria-hidden="true" />
                {copy.newPairingCode || "New code"}
              </Button>
            </div>
          </div>
        </Row>
      ) : null}

      {paired ? (
        <Row
          title={copy.remotePairedAccount || "Paired account"}
          description={paired.pairedAt ? `${copy.remotePairedSince || "Since"} ${new Date(paired.pairedAt).toLocaleString()}.` : ""}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm" data-testid="remote-access-owner">{paired.name}</span>
            <Button size="sm" variant="ghost" disabled={busy === "unpair"} onClick={() => run("unpair", onUnpair)}>
              {copy.unpair || "Unpair"}
            </Button>
          </div>
        </Row>
      ) : null}

      <div className="py-2">
        <p className="px-2 pb-1 pt-2 text-sm font-medium">{copy.remoteNotify || "Notify me on Telegram about"}</p>
        {NOTIFY_MODES.map((mode) => (
          <NotifyChoice
            key={mode}
            mode={mode}
            selected={(status?.notifyMode || "long") === mode}
            copy={copy}
            disabled={busy === "notify"}
            onSelect={(next) => run("notify", () => onNotifyMode?.(next))}
          />
        ))}
      </div>
    </div>
  );
}
