import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { ConnectorLogo } from "./ConnectorLogo";
import { SignInWaiting } from "./SignInWaiting";

const RUNTIME_HELP = {
  "Node.js (npx)": "https://nodejs.org/en/download",
  "uv (uvx)": "https://docs.astral.sh/uv/getting-started/installation/",
  Docker: "https://www.docker.com/products/docker-desktop/",
  ".NET 10 (dnx)": "https://dotnet.microsoft.com/download",
};

/** One labelled input; secrets are masked with a show toggle and never prefilled. */
export function SecretAwareInput({ id, input, value, onChange }) {
  const [shown, setShown] = useState(false);
  if (input.choices?.length) {
    return (
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>{input.choices.map((choice) => <SelectItem key={choice} value={choice}>{choice}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  return (
    <div className="relative">
      <Input
        id={id}
        type={input.secret && !shown ? "password" : "text"}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={input.placeholder || input.default || ""}
        autoComplete="off"
        spellCheck={false}
        className={cn(input.secret && "pr-9 font-mono text-xs")}
      />
      {input.secret ? (
        <button type="button" onClick={() => setShown((current) => !current)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={shown ? "Hide value" : "Show value"}>
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      ) : null}
    </div>
  );
}

function optionLabel(option) {
  if (option.kind === "remote") return "Hosted";
  if (option.kind === "google") return "Squad connector";
  if (option.kind === "composio") return "Through Composio";
  return `On this computer · ${option.label}`;
}

function optionSentence(option, title) {
  if (option.kind === "remote") return `Connects to ${title}'s own server at ${option.detail}. Nothing to install.`;
  if (option.kind === "google" || option.kind === "composio") return option.detail;
  return `Runs ${option.detail} on this computer. Squad starts it with:`;
}

/**
 * Add one catalogue entry: choose how it runs, fill what the registry asks
 * for (nothing for most hosted servers), then Squad installs it, opens the
 * sign-in if the server wants one, checks its tools and turns it on.
 * `phase`: form → working → signin → done | error.
 */
export function InstallDialog({ api, entry, open, onOpenChange, onInstalled, googleClient, onGoogleClient, signIn }) {
  const [option, setOption] = useState("");
  const [values, setValues] = useState({});
  const [phase, setPhase] = useState("form");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [client, setClient] = useState({ clientId: "", clientSecret: "" });

  useEffect(() => {
    if (!open || !entry) return;
    const preferred = entry.options.find((candidate) => candidate.available && !candidate.needs) || entry.options[0];
    setOption(preferred?.id || "");
    setValues({}); setPhase("form"); setResult(null); setError(""); setClient({ clientId: "", clientSecret: "" });
  }, [open, entry]);

  const chosen = useMemo(() => entry?.options.find((candidate) => candidate.id === option) || null, [entry, option]);
  const connectorId = result?.connector?.id || "";
  const waiting = signIn.state[connectorId];

  // The sign-in finished elsewhere (browser callback, device code): show the outcome here.
  useEffect(() => {
    if (phase !== "signin" || !connectorId) return;
    const connector = signIn.connectors.find((item) => item.id === connectorId);
    if (connector?.oauth?.status === "signed-in" && connector.lastTest) {
      setResult((current) => ({ ...current, connector }));
      setPhase(connector.lastTest.ok ? "done" : "error");
      if (!connector.lastTest.ok) setError(connector.health?.message || connector.lastTest.error);
    } else if (waiting?.error) { setPhase("error"); setError(waiting.error); }
  }, [phase, connectorId, signIn.connectors, waiting]);

  if (!entry) return null;
  const missingRequired = (chosen?.inputs || []).some((input) => input.required && !String(values[input.key] || "").trim() && !input.default);
  const needsGoogleClient = chosen?.kind === "google" && !googleClient;

  async function submit(event) {
    event?.preventDefault();
    setError("");
    setPhase("working");
    try {
      if (needsGoogleClient) await onGoogleClient(client);
      const body = entry.squad ? { catalogId: entry.catalogId, option } : { name: entry.name, option, inputs: values };
      const installed = await api("/api/connectors/install", { method: "POST", body: JSON.stringify(body) });
      setResult(installed);
      onInstalled?.(installed.connector);
      if (installed.signIn) {
        signIn.track(installed.connector.id, installed.signIn);
        setPhase("signin");
      } else if (installed.signInError) {
        setPhase("error"); setError(installed.signInError);
      } else if (installed.test?.ok) setPhase("done");
      else { setPhase("error"); setError(installed.connector?.health?.message || installed.test?.error || "The check failed."); }
    } catch (failure) {
      setPhase("error");
      setError(failure?.message || String(failure));
    }
  }

  const doneConnector = result?.connector;
  const toolCount = doneConnector?.lastTest?.tools?.length ?? result?.test?.tools?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" data-testid="connector-install-dialog">
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-3">
            <ConnectorLogo logo={entry.logo} icon={entry.icon} iconDark={entry.iconDark} name={entry.title} size={36} />
            <div className="min-w-0">
              <DialogTitle className="truncate">{entry.title}</DialogTitle>
              {entry.website ? <a href={entry.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">{new URL(entry.website).host}<ExternalLink className="size-3" aria-hidden="true" /></a> : null}
            </div>
          </div>
          <DialogDescription className="text-left">{entry.description}</DialogDescription>
        </DialogHeader>

        {phase === "form" ? (
          <form id="connector-install-form" onSubmit={submit} className="space-y-5">
            {entry.options.length > 1 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">How it runs</p>
                <ToggleGroup type="single" variant="outline" size="sm" value={option} onValueChange={(next) => next && setOption(next)} className="flex-wrap justify-start">
                  {entry.options.map((candidate) => <ToggleGroupItem key={candidate.id} value={candidate.id} className="px-3">{optionLabel(candidate)}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
            ) : null}
            {chosen ? <p className="text-sm leading-6 text-muted-foreground">{optionSentence(chosen, entry.title)}</p> : null}
            {chosen?.preview ? <code className="block overflow-x-auto rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs leading-5 whitespace-pre-wrap break-all text-muted-foreground" data-testid="install-command-preview">{chosen.preview}</code> : null}
            {chosen?.blocked ? <p className="text-sm leading-6 text-destructive">{chosen.blocked}</p> : null}
            {chosen && !chosen.available && chosen.needs && !chosen.blocked && chosen.kind !== "google" ? (
              <p className="text-sm leading-6 text-destructive">
                {chosen.needs} isn't installed on this computer.{" "}
                {RUNTIME_HELP[chosen.needs] ? <a className="underline underline-offset-2" href={RUNTIME_HELP[chosen.needs]} target="_blank" rel="noreferrer noopener">How to install it</a> : null}
                {entry.options.some((candidate) => candidate.available && candidate.id !== option) ? " Or choose another way to run it." : ""}
              </p>
            ) : null}
            {needsGoogleClient ? (
              <div className="space-y-3 border-t border-border/65 pt-4">
                <p className="text-sm leading-6">Squad signs in to Google with your own Google OAuth client. Create a <span className="font-medium">Desktop app</span> client in Google Cloud Console, turn on the {entry.title} API, and paste its details here. They stay on this computer.</p>
                <a className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer noopener">Open Google Cloud credentials<ExternalLink className="size-3" aria-hidden="true" /></a>
                <label className="block space-y-1.5" htmlFor="google-client-id"><span className="text-sm font-medium">Client ID</span>
                  <Input id="google-client-id" value={client.clientId} onChange={(event) => setClient((current) => ({ ...current, clientId: event.target.value }))} placeholder="…apps.googleusercontent.com" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
                </label>
                <label className="block space-y-1.5" htmlFor="google-client-secret"><span className="text-sm font-medium">Client secret</span>
                  <SecretAwareInput id="google-client-secret" input={{ secret: true, placeholder: "GOCSPX-…" }} value={client.clientSecret} onChange={(value) => setClient((current) => ({ ...current, clientSecret: value }))} />
                </label>
              </div>
            ) : null}
            {(chosen?.inputs || []).length ? (
              <div className="space-y-4">
                {chosen.inputs.map((input) => (
                  <label key={input.key} className="block space-y-1.5" htmlFor={`install-${input.key}`}>
                    <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
                      <span className="break-all">{input.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">{input.required ? "Required" : "Optional"}{input.secret ? " · stays on this computer" : ""}</span>
                    </span>
                    <SecretAwareInput id={`install-${input.key}`} input={input} value={values[input.key]} onChange={(value) => setValues((current) => ({ ...current, [input.key]: value }))} />
                    {input.description ? <span className="block text-xs leading-5 text-muted-foreground">{input.description}</span> : null}
                  </label>
                ))}
              </div>
            ) : null}
            {chosen?.kind === "remote" && !(chosen.inputs || []).length ? <p className="text-xs leading-5 text-muted-foreground">If {entry.title} asks you to sign in, Squad opens its sign-in page in your browser.</p> : null}
          </form>
        ) : null}

        {phase === "working" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner className="size-4" />Adding {entry.title} and checking its tools…</p>
        ) : null}
        {phase === "signin" ? <SignInWaiting name={entry.title} state={waiting} onOpen={() => signIn.reopen(connectorId)} onCancel={() => { signIn.cancel(connectorId); onOpenChange(false); }} /> : null}
        {phase === "done" ? (
          <div className="space-y-1" role="status">
            <p className="flex items-center gap-2 text-sm font-medium"><Check className="size-4 text-emerald-600" aria-hidden="true" />{doneConnector?.name || entry.title} is ready</p>
            <p className="text-sm leading-6 text-muted-foreground">{toolCount} {toolCount === 1 ? "tool" : "tools"}{doneConnector?.oauth?.account ? ` · signed in as ${doneConnector.oauth.account}` : ""}. Members whose MCP connectors permission is Allow can use it from their next message.</p>
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="space-y-1" role="alert">
            <p className="text-sm font-medium">{entry.title} isn't ready yet</p>
            <p className="text-sm leading-6 text-destructive">{error}</p>
            {connectorId ? <p className="text-xs leading-5 text-muted-foreground">It's saved and switched off. Fix it from its row in Connectors.</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "form" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" form="connector-install-form" disabled={!chosen || (!chosen.available && chosen.kind !== "google") || missingRequired || (needsGoogleClient && !client.clientId.trim())}>
                {entry.installed ? "Add again" : "Add"}
              </Button>
            </>
          ) : phase === "error" && !connectorId ? (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="button" variant="outline" onClick={() => setPhase("form")}>Back</Button>
            </>
          ) : phase === "working" || phase === "signin" ? null : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
