import { useCallback, useEffect, useState } from "react";
import { Cpu, Info, MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EffortSlider } from "@/components/chat/EffortSlider";
import { HarnessModelSelect } from "./HarnessModelSelect";
import { effortLevelsFor, fetchHarnesses, harnessLabel } from "@/lib/harness";
import { connectedHarnesses, MAX_FALLBACKS, normalizeModelRouting, primaryRoute, routeKey } from "@/lib/model-routing";

// Why a route is cooling down, in the words of the router's failure kinds
// (server/harness/fallback-router.mjs routingFailure).
const REASONS = {
  quota: { short: "Usage limit reached", phrase: "has reached its usage limit" },
  "sign-in": { short: "Needs sign-in", phrase: "needs sign-in" },
  overload: { short: "Overloaded", phrase: "is overloaded" },
  startup: { short: "Could not start", phrase: "could not start" },
  timeout: { short: "Did not respond", phrase: "did not respond" },
  runtime: { short: "Kept failing", phrase: "kept failing" },
};
const reasonOf = (route) => REASONS[route?.reason] || { short: "Unavailable", phrase: "can't answer" };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const modelName = (harness) => harness.model || "Default";

/**
 * Fallback engines for one member, in the shape people know from Codync:
 * a live line saying which engine is answering (with Switch back), compact
 * numbered rows with an In use badge and a … menu, a + to add, and the long
 * explanation behind an info button. Structural changes save immediately;
 * a row's engine/model/effort save when its editor is closed with Done. A
 * failed save keeps the edit and offers Retry (ADR-0222).
 */
export function MemberFallbacks({ agent, api, providerSettings, updateAgent, compact = false, onChanged }) {
  const saved = normalizeModelRouting(agent.modelRouting);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [harnesses, setHarnesses] = useState([]);
  const [health, setHealth] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const name = agent.name || "This member";

  useEffect(() => { setDraft(JSON.parse(savedKey)); setError(""); }, [agent.id, savedKey]);

  const loadHealth = useCallback(async () => {
    const state = await api(`/api/members/${encodeURIComponent(agent.id)}/model-routing`);
    setHealth(state.health || {}); setNow(Date.now());
  }, [api, agent.id]);
  useEffect(() => {
    let active = true; setLoaded(false);
    Promise.all([fetchHarnesses(api), api(`/api/members/${encodeURIComponent(agent.id)}/model-routing`)])
      .then(([engines, state]) => { if (active) { setHarnesses(engines); setHealth(state.health || {}); setNow(Date.now()); } })
      .catch((problem) => { if (active) setError(problem.message); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [api, agent.id]);
  // Keep "In use" current: a cooled-down primary takes over again on its own.
  useEffect(() => {
    const refresh = () => { void loadHealth().catch(() => {}); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadHealth]);

  const connected = connectedHarnesses(harnesses);
  const providers = Object.values(providerSettings?.providers || {}).filter((item) => item.enabled && (item.apiKeyConfigured || item.accountReady || !item.requiresApiKey));
  const dirty = JSON.stringify(draft) !== savedKey;

  const primary = primaryRoute({ agent });
  const primaryLabel = harnessLabel(primary.harness.id);
  const blocked = (route) => { const entry = health[routeKey(route)]; return entry && Number(entry.blockedUntil) > now ? entry : null; };
  const ready = (route) => { const engine = harnesses.find((item) => item.id === route.harness.id); return !engine || engine.status === "ready"; };
  const primaryBlocked = blocked(primary);
  // -1 = the primary is answering; n = fallback n; null = nothing can answer.
  const savedRows = saved.fallbacks;
  const inUse = !primaryBlocked ? -1 : (() => { const index = savedRows.findIndex((row) => !blocked(row) && ready(row)); return index >= 0 ? index : null; })();

  async function persist(next, { closeEditor = false } = {}) {
    setDraft(next); setError(""); setSaving(true);
    try {
      const normalized = normalizeModelRouting(next, { strict: true });
      const result = await updateAgent(agent.id, { modelRouting: normalized, updatedAt: new Date().toISOString() });
      if (result?.error) throw new Error(result.error);
      setDraft(normalized);
      if (closeEditor) setEditing(null);
      onChanged?.();
    } catch (problem) { setError(problem.message); } finally { setSaving(false); }
  }
  const patch = (index, update) => setDraft((current) => ({ ...current, fallbacks: current.fallbacks.map((row, i) => (i === index ? { ...row, ...update } : row)) }));
  function add() {
    const engine = connected.find((item) => item.id !== agent.harness?.id && !draft.fallbacks.some((row) => row.harness.id === item.id)) || connected.find((item) => item.id !== agent.harness?.id) || connected[0];
    if (!engine) return;
    const listed = Array.isArray(engine.models) ? engine.models.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean) : [];
    const row = { harness: { id: engine.id, model: engine.defaults?.model || listed[0] || "", effort: engine.defaults?.effort || "" }, ...(engine.id === "autohand" ? { provider: providerSettings?.defaultProvider || "autohandai" } : {}) };
    setDraft((current) => ({ ...current, fallbacks: [...current.fallbacks, row] }));
    setEditing(draft.fallbacks.length);
  }
  function move(index, delta) {
    const rows = [...draft.fallbacks]; [rows[index], rows[index + delta]] = [rows[index + delta], rows[index]];
    void persist({ ...draft, fallbacks: rows });
  }
  function remove(index) {
    setEditing(null);
    void persist({ ...draft, fallbacks: draft.fallbacks.filter((_, i) => i !== index) });
  }
  async function switchBack() {
    try { await api(`/api/members/${encodeURIComponent(agent.id)}/model-routing/reset`, { method: "POST", body: "{}" }); setError(""); await loadHealth(); onChanged?.(); }
    catch (problem) { setError(problem.message); }
  }

  const inUseLabel = inUse >= 0 && savedRows[inUse] ? harnessLabel(savedRows[inUse].harness.id) : "";

  // Compact: the chat header's engine menu. Every fallback shows its engine
  // and model as pickers straight away, filled from what each connected
  // engine reports, and each change saves at once (ADR-0231).
  if (compact) {
    const choose = (index, update) => {
      const fallbacks = draft.fallbacks.map((row, i) => (i === index ? { ...row, ...update } : row));
      void persist({ ...draft, fallbacks });
    };
    const append = () => {
      const engine = connected.find((item) => item.id !== agent.harness?.id && !draft.fallbacks.some((row) => row.harness.id === item.id));
      if (!engine) return;
      const listed = Array.isArray(engine.models) ? engine.models.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean) : [];
      const row = { harness: { id: engine.id, model: engine.defaults?.model || listed[0] || "", effort: engine.defaults?.effort || "" }, ...(engine.id === "autohand" ? { provider: providerSettings?.defaultProvider || "autohandai" } : {}) };
      void persist({ ...draft, fallbacks: [...draft.fallbacks, row] });
    };
    return (
      <section className="mt-3 grid gap-2 border-t border-border/70 pt-3" aria-label="Fallbacks">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">If {primaryLabel} can’t answer</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!loaded || !connected.some((item) => item.id !== agent.harness?.id && !draft.fallbacks.some((row) => row.harness.id === item.id)) || draft.fallbacks.length >= MAX_FALLBACKS || saving} onClick={append}><Plus className="size-3.5" />Add</Button>
        </div>
        {inUse === null && primaryBlocked ? <p className="text-xs text-destructive">{primaryLabel} {reasonOf(primaryBlocked).phrase} and no fallback can answer right now.</p> : null}
        {inUse >= 0 && primaryBlocked ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Using {inUseLabel} while {primaryLabel} {reasonOf(primaryBlocked).phrase}. Back at {clock(primaryBlocked.blockedUntil)}.</span>
            <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={switchBack}>Switch back</Button>
          </div>
        ) : null}
        {draft.fallbacks.length ? (
          <ol className="divide-y divide-border/60">
            {draft.fallbacks.map((row, index) => {
              const readiness = harnesses.find((item) => item.id === row.harness.id);
              const cooling = blocked(row);
              const levels = effortLevelsFor(row.harness.id, readiness, row.harness.model);
              // Never the primary, never an engine another row already uses.
              const choices = connected.filter((engine) => engine.id === row.harness.id || (engine.id !== agent.harness?.id && !draft.fallbacks.some((other, i) => i !== index && other.harness.id === engine.id)));
              return (
                <li key={index} className="grid gap-1.5 py-2 first:pt-0" data-fallback-row={index}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <Select value={row.harness.id} disabled={saving} onValueChange={(id) => { const engine = connected.find((item) => item.id === id); const listed = Array.isArray(engine?.models) ? engine.models.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean) : []; choose(index, { harness: { id, model: engine?.defaults?.model || listed[0] || "", effort: engine?.defaults?.effort || "" }, provider: id === "autohand" ? providerSettings?.defaultProvider || "autohandai" : "" }); }}>
                      <SelectTrigger aria-label={`Fallback ${index + 1} engine`} className="h-8 min-w-0 flex-1 text-xs font-medium"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {choices.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.label}</SelectItem>)}
                        {!connected.some((engine) => engine.id === row.harness.id) ? <SelectItem value={row.harness.id}>{readiness?.label || harnessLabel(row.harness.id)}{loaded ? " · unavailable" : ""}</SelectItem> : null}
                      </SelectContent>
                    </Select>
                    {inUse === index ? <Badge variant="secondary" className="shrink-0">In use</Badge> : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={`Fallback ${index + 1} options`} disabled={saving}><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, -1)}>Move up</DropdownMenuItem>
                        <DropdownMenuItem disabled={index === draft.fallbacks.length - 1} onSelect={() => move(index, 1)}>Move down</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(index)}>Remove</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-start gap-2 pl-5 pr-10">
                    <div className="min-w-0 flex-1">
                      <HarnessModelSelect compact api={api} harness={row.harness.id} executablePath={row.harness.executablePath} provider={row.provider || ""} workspace={agent.workspace} value={row.harness.model || ""} label={`Fallback ${index + 1} model`} onChange={(model) => choose(index, { harness: { ...row.harness, model, effort: effortLevelsFor(row.harness.id, readiness, model).includes(row.harness.effort) ? row.harness.effort : "" } })} />
                    </div>
                    {levels.length ? (
                      <Select value={row.harness.effort || "__default"} disabled={saving} onValueChange={(effort) => choose(index, { harness: { ...row.harness, effort: effort === "__default" ? "" : effort } })}>
                        <SelectTrigger aria-label={`Fallback ${index + 1} reasoning effort`} title="Reasoning effort" className="h-8 w-28 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default">Default effort</SelectItem>
                          {levels.map((level) => <SelectItem key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                  {cooling ? <span className="pl-5 text-[11px] text-muted-foreground">{reasonOf(cooling).short} · tries again at {clock(cooling.blockedUntil)}</span> : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="text-xs text-muted-foreground">{loaded && !connected.length ? "Connect another engine in Settings to add a fallback." : "No fallbacks. Add one so work carries on when this engine runs out."}</p>}
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="grid gap-5 border-t border-border/70 pt-7 lg:grid-cols-[220px_minmax(0,1fr)]" aria-label="Fallbacks">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-medium">Fallbacks</h2>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/55 hover:text-foreground" aria-label="About fallbacks"><Info className="size-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 text-sm leading-6">
              <p className="font-medium">Fallbacks</p>
              <p className="mt-1 text-muted-foreground">When {name}'s engine runs out of usage, is rate limited, signed out, overloaded or won't start, the next engine here carries on in the same chat, with the same memory and workspace. Squad goes back to the primary after five minutes, or now with Switch back.</p>
              <p className="mt-2 text-muted-foreground">Your permission choices stay in force. A fallback that uses an API key costs money with its provider. To fall back between one engine's models, set that in the engine itself.</p>
            </PopoverContent>
          </Popover>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">If {primaryLabel} runs out of usage or can't answer, {name} carries on with the next one. Chat, memory and workspace carry over.</p>
      </div>

      <div className="grid gap-3">
        {primaryBlocked ? (
          <div className="flex items-center justify-between gap-4 rounded-md bg-muted/45 px-3 py-2.5" role="status" data-fallback-status>
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Cpu className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {inUse !== null
                ? <span>Using {inUseLabel} while {primaryLabel} {reasonOf(primaryBlocked).phrase}</span>
                : <span>{primaryLabel} {reasonOf(primaryBlocked).phrase} and no fallback can answer. Tries again at {clock(primaryBlocked.blockedUntil)}.</span>}
            </span>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={switchBack}>Switch back</Button>
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{draft.fallbacks.length ? `In order, after ${primaryLabel}` : "No fallbacks yet."}</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Add fallback" disabled={!loaded || !connected.length || draft.fallbacks.length >= MAX_FALLBACKS || editing !== null || saving} onClick={add}><Plus className="size-4" /></Button>
        </div>

        {draft.fallbacks.length ? (
          <ol className="divide-y divide-border/60">
            {draft.fallbacks.map((row, index) => {
              const readiness = harnesses.find((item) => item.id === row.harness.id);
              const cooling = blocked(row);
              const status = cooling ? `${reasonOf(cooling).short} · tries again at ${clock(cooling.blockedUntil)}` : readiness && readiness.status !== "ready" ? `${readiness.detail || "Not ready"} Skipped until it can start.` : "";
              const isEditing = editing === index;
              const levels = effortLevelsFor(row.harness.id, readiness, row.harness.model);
              const providerId = row.provider || providerSettings?.defaultProvider || "autohandai";
              return (
                <li key={index} className="py-3" data-fallback-row={index}>
                  <div className="flex items-center gap-3">
                    <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <Cpu className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{harnessLabel(row.harness.id)} <span className="text-muted-foreground">· {modelName(row.harness)}</span></span>
                      {status ? <span className="block text-xs text-muted-foreground">{status}</span> : null}
                    </span>
                    {inUse === index && !isEditing ? <Badge variant="secondary" data-fallback-in-use>In use</Badge> : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Fallback ${index + 1} options`} disabled={saving}><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(index)}>Change engine or model</DropdownMenuItem>
                        <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, -1)}>Move up</DropdownMenuItem>
                        <DropdownMenuItem disabled={index === draft.fallbacks.length - 1} onSelect={() => move(index, 1)}>Move down</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(index)}>Remove</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {isEditing ? (
                    <div className="mt-3 grid gap-3 pl-11">
                      <Select value={row.harness.id} onValueChange={(id) => patch(index, { harness: { id, model: "", effort: "" }, provider: id === "autohand" ? providerSettings?.defaultProvider || "autohandai" : "" })}>
                        <SelectTrigger aria-label={`Fallback engine ${index + 1}`} className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {connected.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.label}</SelectItem>)}
                          {!connected.some((engine) => engine.id === row.harness.id) ? <SelectItem value={row.harness.id}>{readiness?.label || row.harness.id} · unavailable</SelectItem> : null}
                        </SelectContent>
                      </Select>
                      {row.harness.id === "autohand" ? (
                        <Select value={providerId} onValueChange={(provider) => patch(index, { provider, harness: { ...row.harness, model: "" } })}>
                          <SelectTrigger aria-label={`Fallback ${index + 1} provider`} className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label || provider.id}</SelectItem>)}
                            {!providers.some((provider) => provider.id === providerId) ? <SelectItem value={providerId}>{providerSettings?.providers?.[providerId]?.label || providerId} · unavailable</SelectItem> : null}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <HarnessModelSelect api={api} harness={row.harness.id} executablePath={row.harness.executablePath} provider={row.provider || ""} workspace={agent.workspace} value={row.harness.model || ""} label={`Fallback ${index + 1} model`} onChange={(model) => patch(index, { harness: { ...row.harness, model } })} />
                      {levels.length ? <EffortSlider id={`fallback-${index}-effort`} levels={levels} value={row.harness.effort || ""} onChange={(effort) => patch(index, { harness: { ...row.harness, effort } })} /> : null}
                      <div className="flex gap-2">
                        <Button type="button" size="sm" disabled={saving} onClick={() => persist(draft, { closeEditor: true })}>{saving ? "Saving…" : "Done"}</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(saved); setEditing(null); setError(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {loaded && !connected.length ? <p className="text-xs text-muted-foreground">Connect a coding engine in Engine settings to add a fallback.</p> : null}

        {error ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <span className="text-sm text-destructive">{error}</span>
            {dirty ? <span className="flex shrink-0 gap-1"><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => persist(draft, { closeEditor: editing !== null })}>Retry</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(saved); setEditing(null); setError(""); }}>Discard</Button></span> : null}
          </div>
        ) : null}

        <label className="flex items-start justify-between gap-6 border-t border-border/60 pt-4">
          <span>
            <span className="block text-sm font-medium">Let {name} change its fallbacks</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">It can set this list itself, for example when you ask it to. It cannot turn this on.</span>
          </span>
          <Switch aria-label="Let this member manage fallbacks" checked={draft.allowAgentChanges} disabled={saving} onCheckedChange={(allowAgentChanges) => persist({ ...draft, allowAgentChanges })} />
        </label>
      </div>
    </section>
  );
}
