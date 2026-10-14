import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, LogIn, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EffortSlider } from "@/components/chat/EffortSlider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { engineVersion,
  ACCESS_IDS,
  HARNESS_OPTIONS,
  accessOption,
  acpAvailabilityLabel,
  acpOption,
  effortLevelsFor,
  fetchAcpRegistry,
  harnessLoginStatus,
  harnessTakesModel,
  isAcpHarnessId,
  listAcpAgents,
  modelChoices,
  harnessNeedsSignIn,
  harnessOption,
  normalizeHarnessAssignment,
  readinessFor,
  readinessLabel,
  readinessTone,
  signInAlternative,
  signInLabel,
  startHarnessLogin,
} from "@/lib/harness";
import { cn } from "@/lib/utils";

/**
 * "Runs with" control. One restrained select plus a single readiness line.
 * When the chosen engine is installed but signed out, a single sign-in
 * button starts that vendor's own browser flow (ChatGPT for Codex, claude.ai
 * for Claude Code, the Autohand account for Autohand Code) through the local
 * bridge and re-checks readiness when it finishes. Advanced fields
 * (executable path, harness-native model) sit behind a disclosure.
 *
 * The list is two groups (ADR-0122): the built-in engines, then "From the
 * ACP registry" with every agent the registry knows, each with its one-line
 * description and whether it is installed or fetched on first use. The
 * registry is read when the chooser opens (the bridge refreshes it at most
 * daily) and Re-check forces a fetch.
 */
function sortAcpAgents(agents) {
  return [...agents].sort((a, b) => {
    const rank = (item) => (item.builtIn ? 0 : item.installed ? 1 : item.fetchOnUse ? 2 : 3);
    return rank(a) - rank(b) || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function HarnessSelect({
  value,
  onChange,
  harnesses = [],
  loading = false,
  onRefresh,
  onTest,
  testing = false,
  testResult = null,
  api,
  id = "member-harness",
  label = "Runs with",
  description = "The engine that executes this member. Personality, model, and permissions stay the same when you change it.",
  showAdvanced = true,
  compact = false,
  defaultAdvancedOpen = false,
}) {
  const assignment = normalizeHarnessAssignment(value);
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen || Boolean(assignment.executablePath || assignment.model || assignment.effort || assignment.access));
  const [customModel, setCustomModel] = useState(false);
  const external = assignment.id !== "autohand";
  const [signIn, setSignIn] = useState({ state: "idle" });
  const [acpAgents, setAcpAgents] = useState(() => sortAcpAgents(listAcpAgents()));
  const [acpLoading, setAcpLoading] = useState(false);
  const pollRef = useRef(null);
  const acpSelected = isAcpHarnessId(assignment.id);
  const selectedAgent = acpSelected ? acpOption(assignment.id) : null;
  const readiness = testResult?.id === assignment.id ? testResult : readinessFor(harnesses, assignment.id);
  const option = harnessOption(assignment.id);
  const needsSignIn = harnessNeedsSignIn(readiness);
  const accountLabel = readiness?.account?.label || readiness?.account?.email || "";

  useEffect(() => () => window.clearInterval(pollRef.current), []);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setAcpLoading(true);
    fetchAcpRegistry(api).finally(() => {
      if (cancelled) return;
      setAcpAgents(sortAcpAgents(listAcpAgents()));
      setAcpLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function refreshAll() {
    onRefresh?.();
    if (!api) return;
    setAcpLoading(true);
    await fetchAcpRegistry(api, { refresh: true });
    setAcpAgents(sortAcpAgents(listAcpAgents()));
    setAcpLoading(false);
  }
  useEffect(() => {
    setSignIn({ state: "idle" });
    window.clearInterval(pollRef.current);
  }, [assignment.id]);

  function update(patch) {
    onChange?.(normalizeHarnessAssignment({ ...assignment, ...patch }));
  }

  async function beginSignIn() {
    if (!api) return;
    setSignIn({ state: "starting" });
    try {
      const flow = await startHarnessLogin(api, assignment.id);
      setSignIn(flow);
      window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await harnessLoginStatus(api, assignment.id);
          setSignIn(status);
          if (status.state !== "running") {
            window.clearInterval(pollRef.current);
            onRefresh?.();
          }
        } catch (error) {
          setSignIn({ state: "failed", error: error.message });
          window.clearInterval(pollRef.current);
        }
      }, 2500);
    } catch (error) {
      setSignIn({ state: "failed", error: error.message || "Could not start sign-in." });
    }
  }

  const signingIn = signIn.state === "starting" || signIn.state === "running";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {onRefresh ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={refreshAll} disabled={loading || acpLoading}>
            <RefreshCw className={cn("size-3.5", (loading || acpLoading) && "animate-spin")} data-icon="inline-start" />
            Re-check
          </Button>
        ) : null}
      </div>
      <Select value={assignment.id} onValueChange={(next) => update({ id: next })}>
        <SelectTrigger id={id} className={cn("w-full bg-card", compact ? "h-9" : "sm:max-w-sm")}>
          <SelectValue placeholder="Choose an engine" />
        </SelectTrigger>
        <SelectContent className="max-h-[min(24rem,60vh)]">
          <SelectGroup>
            <SelectLabel>Built-in engines</SelectLabel>
            {HARNESS_OPTIONS.map((item) => {
              const itemReadiness = readinessFor(harnesses, item.id);
              return (
                <SelectItem key={item.id} value={item.id}>
                  <span className="flex items-center gap-2">
                    <span>{item.label}</span>
                    {item.isDefault ? <span className="text-xs text-muted-foreground">Default</span> : null}
                    {/* In the open list only: in the closed field it repeated
                        the status line right under it ("Ready", "Ready · …"). */}
                    {itemReadiness ? (
                      <span className={cn("text-xs [[data-slot=select-value]_&]:hidden", readinessTone(itemReadiness.status))}>{readinessLabel(itemReadiness.status)}</span>
                    ) : null}
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>From the ACP registry</SelectLabel>
            {acpSelected && !acpAgents.some((item) => item.harnessId === assignment.id) ? (
              <SelectItem value={assignment.id}>{selectedAgent.label}</SelectItem>
            ) : null}
            {acpAgents.map((item) => (
              <SelectItem key={item.harnessId} value={item.harnessId} textValue={item.name}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span>{item.name}</span>
                    <span className={cn("text-xs", item.installed ? "text-emerald-700 dark:text-emerald-300" : item.fetchOnUse ? "text-muted-foreground" : "text-destructive")}>{acpAvailabilityLabel(item)}</span>
                  </span>
                  {item.description ? <span className="max-w-[22rem] truncate text-xs text-muted-foreground">{item.description}</span> : null}
                </span>
              </SelectItem>
            ))}
            {!acpAgents.length ? <div className="px-2 py-1.5 text-xs text-muted-foreground">{acpLoading ? "Reading the registry…" : "The registry is not available."}</div> : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        <span className={cn("font-medium", readinessTone(loading && !readiness ? "checking" : readiness?.status))}>
          {loading && !readiness ? readinessLabel("checking") : readinessLabel(readiness?.status)}
        </span>
        {readiness?.version ? <span> · {option.short} {engineVersion(readiness.version)}</span> : null}
        {accountLabel ? <span> · {accountLabel}</span> : readiness?.detail ? <span> · {readiness.detail}</span> : null}
        {readiness?.setup && !needsSignIn ? (
          <span>
            {" "}
            · <code className="rounded bg-muted px-1 py-0.5 text-xs">{readiness.setup}</code>
          </span>
        ) : null}
      </p>

      {needsSignIn ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={beginSignIn} disabled={signingIn || !api}>
              {signingIn ? <Spinner /> : <LogIn data-icon="inline-start" />}
              {signingIn ? "Waiting for the browser…" : readiness?.signIn?.label || signInLabel(assignment.id)}
            </Button>
            <span className="text-xs text-muted-foreground">{readiness?.signIn?.alternative || signInAlternative(assignment.id)}</span>
          </div>
          {signIn.url ? (
            <a href={signIn.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
              Open the sign-in page
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
          {signIn.code ? (
            <p className="text-xs text-muted-foreground">
              Code: <code className="rounded bg-background px-1 py-0.5 font-mono text-foreground">{signIn.code}</code>
            </p>
          ) : null}
          {signIn.state === "done" ? <p className="text-xs text-emerald-700 dark:text-emerald-300">Signed in. Readiness updated.</p> : null}
          {signIn.state === "failed" ? <p className="text-xs text-destructive">{signIn.error || "Sign-in did not complete."}</p> : null}
          {!api ? <p className="text-xs text-muted-foreground">Run <code className="rounded bg-background px-1 py-0.5 text-xs">{readiness?.setup}</code> in a terminal.</p> : null}
        </div>
      ) : null}

      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

      {showAdvanced ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Advanced
          </button>
          {advancedOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {harnessTakesModel(assignment.id) ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-model`} className="text-xs">
                  {option.short} model
                </Label>
                {external ? (
                  <>
                    <Select
                      value={customModel ? "__custom" : assignment.model || "__default"}
                      onValueChange={(next) => {
                        if (!next) return;
                        if (next === "__custom") { setCustomModel(true); return; }
                        setCustomModel(false);
                        update({ model: next === "__default" ? "" : next });
                      }}
                    >
                      <SelectTrigger id={`${id}-model`} className="h-9 w-full bg-card">
                        <SelectValue placeholder="Engine default" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelChoices(readiness, { current: customModel ? "" : assignment.model }).map((item) => (
                          <SelectItem key={item.id || "__default"} value={item.id || "__default"}>
                            {item.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom">Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                    {customModel ? (
                      <Input
                        value={assignment.model}
                        placeholder={assignment.id === "claude" ? "claude-opus-5-5" : "gpt-6.1-sol"}
                        className="h-9 bg-card"
                        autoFocus
                        onChange={(event) => update({ model: event.target.value })}
                      />
                    ) : null}
                  </>
                ) : (
                  <Input
                    id={`${id}-model`}
                    value={assignment.model}
                    placeholder="Use the workspace model"
                    className="h-9 bg-card"
                    onChange={(event) => update({ model: event.target.value })}
                  />
                )}
              </div>
              ) : (
                <p className="text-xs text-muted-foreground sm:col-span-2">{option.label} chooses its own model; change it in that agent's settings.</p>
              )}
              {effortLevelsFor(assignment.id, readiness, assignment.model || readiness?.defaults?.model || "").length ? (
                <div className="sm:col-span-2">
                  <EffortSlider
                    id={`${id}-effort`}
                    levels={effortLevelsFor(assignment.id, readiness, assignment.model || readiness?.defaults?.model || "")}
                    value={assignment.effort}
                    defaultLabel={readiness?.defaults?.effort ? `Engine default (${readiness.defaults.effort})` : "Engine default"}
                    onChange={(next) => update({ effort: next })}
                  />
                </div>
              ) : null}
              {external ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-access`} className="text-xs">
                    Access
                  </Label>
                  <Select value={assignment.access || "__default"} onValueChange={(next) => next && update({ access: next === "__default" ? "" : next })}>
                    <SelectTrigger id={`${id}-access`} className="h-9 w-full bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default">From the permission level</SelectItem>
                      {ACCESS_IDS.map((accessId) => (
                        <SelectItem key={accessId} value={accessId}>
                          {accessOption(assignment.id, accessId).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {assignment.access ? accessOption(assignment.id, assignment.access).detail : "Plan when the level is Chat only, full when it is unrestricted, edits otherwise. The composer can change it per message."}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-path`} className="text-xs">
                  Executable path
                </Label>
                <Input
                  id={`${id}-path`}
                  value={assignment.executablePath}
                  placeholder="Detected automatically"
                  className="h-9 bg-card font-mono text-xs"
                  onChange={(event) => update({ executablePath: event.target.value })}
                />
              </div>
              {onTest ? (
                <div className="sm:col-span-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onTest(assignment)} disabled={testing}>
                    {testing ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
                    Test harness
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
