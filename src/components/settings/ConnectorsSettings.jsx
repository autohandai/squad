import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, MoreHorizontal, Plus, Search, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { ConnectorLogo } from "./connectors/ConnectorLogo";
import { CustomConnectorDialog } from "./connectors/CustomConnectorDialog";
import { InstallDialog, SecretAwareInput } from "./connectors/InstallDialog";
import { SignInWaiting } from "./connectors/SignInWaiting";

const RUNTIME_LINKS = { "Node.js": "https://nodejs.org/en/download", uv: "https://docs.astral.sh/uv/getting-started/installation/", Docker: "https://www.docker.com/products/docker-desktop/", ".NET 10": "https://dotnet.microsoft.com/download" };
const TONE_DOT = { ok: "bg-emerald-500", muted: "bg-muted-foreground/40", error: "bg-destructive" };
const POLL_MS = 1500;

const path = (id, action = "") => `/api/connectors/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

function openExternal(url) {
  // The desktop shell hands window.open to the system browser.
  try { window.open(url, "_blank", "noopener"); } catch { /* the row keeps an Open sign-in page button */ }
}

/** The connectors list, the Google client and the package runners, from the bridge. */
function useConnectorsState(api) {
  const [state, setState] = useState({ connectors: [], googleClient: null, runtimes: {}, loaded: false, error: "" });
  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/connectors");
      setState({ connectors: data.connectors || [], googleClient: data.googleClient || null, runtimes: data.runtimes || {}, loaded: true, error: "" });
      return data.connectors || [];
    } catch (failure) {
      setState((current) => ({ ...current, loaded: true, error: failure?.message || String(failure) }));
      return null;
    }
  }, [api]);
  const patch = useCallback((record) => {
    if (!record?.id) return;
    setState((current) => ({ ...current, connectors: current.connectors.some((item) => item.id === record.id) ? current.connectors.map((item) => (item.id === record.id ? record : item)) : [...current.connectors, record] }));
  }, []);
  const drop = useCallback((id) => setState((current) => ({ ...current, connectors: current.connectors.filter((item) => item.id !== id) })), []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...state, refresh, patch, drop };
}

/**
 * Sign-ins in progress, per connector. Browser sign-ins finish at the
 * bridge's callback; this only polls until the connector reports signed in
 * and checked, so closing Settings never loses a sign-in.
 */
function useSignIn(api, connectors, refresh) {
  const [state, setState] = useState({});
  const timers = useRef({});
  const stop = useCallback((id) => { clearTimeout(timers.current[id]); delete timers.current[id]; }, []);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const poll = useCallback((id, startedAt) => {
    stop(id);
    timers.current[id] = setTimeout(async () => {
      let progress = null;
      try { progress = await api(path(id, "sign-in")); } catch { /* keep polling; the bridge may be restarting */ }
      const connector = progress?.connector;
      const signedIn = connector?.oauth?.status === "signed-in";
      const checked = signedIn && connector.lastTest && Date.parse(connector.lastTest.at) >= startedAt - 1000;
      if (checked || (progress && !progress.waiting && !signedIn) || progress?.error) {
        await refresh();
        setState((current) => {
          const next = { ...current };
          if (progress?.error || (!signedIn && connector?.oauth?.lastError)) next[id] = { ...current[id], error: progress?.error || connector.oauth.lastError };
          else delete next[id];
          return next;
        });
        stop(id);
        return;
      }
      if (progress?.mode === "device") setState((current) => ({ ...current, [id]: { ...current[id], ...progress, connector: undefined } }));
      poll(id, startedAt);
    }, POLL_MS);
  }, [api, refresh, stop]);

  const track = useCallback((id, started) => {
    setState((current) => ({ ...current, [id]: { mode: started.mode, url: started.url, userCode: started.userCode, verificationUri: started.verificationUri, error: "" } }));
    if (started.mode === "browser" && started.url) openExternal(started.url);
    poll(id, Date.now());
  }, [poll]);

  const begin = useCallback(async (id) => {
    try { track(id, await api(path(id, "sign-in"), { method: "POST" })); }
    catch (failure) { setState((current) => ({ ...current, [id]: { error: failure?.message || String(failure) } })); }
  }, [api, track]);

  const cancel = useCallback(async (id) => {
    stop(id);
    setState((current) => { const next = { ...current }; delete next[id]; return next; });
    await api(path(id, "sign-in"), { method: "DELETE" }).catch(() => {});
    await refresh();
  }, [api, refresh, stop]);

  const dismiss = useCallback((id) => setState((current) => { const next = { ...current }; delete next[id]; return next; }), []);
  return { state, track, begin, reopen: begin, cancel, dismiss, connectors };
}

function StatusLine({ connector, overrideError }) {
  const health = connector.health;
  if (overrideError) return <p className="text-xs leading-5 text-destructive">{overrideError}</p>;
  if (!health) return null;
  return (
    <p className={cn("flex min-w-0 items-start gap-1.5 text-xs leading-5", health.tone === "error" ? "text-destructive" : "text-muted-foreground")} data-testid="connector-status">
      <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", !connector.enabled && health.tone === "ok" ? TONE_DOT.muted : TONE_DOT[health.tone] || TONE_DOT.muted)} />
      <span className="min-w-0 break-words">{!connector.enabled && health.state === "ready" ? `Off · ${health.message}` : health.message}{health.update && health.state !== "ready" ? ` · version ${health.update.latest} available` : ""}</span>
    </p>
  );
}

function ToolList({ tools = [], id }) {
  if (!tools.length) return <p id={id} className="pb-3 text-xs text-muted-foreground sm:pl-10">No tools listed yet. Test the connector to see them.</p>;
  return (
    <ul id={id} className="divide-y divide-border/50 pb-3 sm:pl-10">
      {tools.map((tool) => (
        <li key={tool.name || tool} className="py-2"><code className="text-xs">{tool.name || tool}</code>{tool.description ? <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">{tool.description}</p> : null}</li>
      ))}
    </ul>
  );
}

function summary(connector) {
  if (connector.kind === "google") return "Squad's Google connector";
  if (connector.registry?.name) return connector.kind === "url" ? `Hosted · ${hostOf(connector.url)}` : `${connector.command} · version ${connector.registry.version}`;
  if (connector.kind === "stdio") return [connector.command, ...(connector.args || [])].join(" ");
  return `${connector.transport === "sse" ? "SSE" : "HTTP"} · ${connector.url}`;
}
function hostOf(url) { try { return new URL(url).host; } catch { return url; } }

/** One installed connector: mark, name, plain status, the one action that fixes it, its switch and a menu. */
function ConnectorRow({ connector, catalogEntry, busy, signIn, onAction, onToggle, onRename, onRemove, menu }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(connector.name);
  const [confirming, setConfirming] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const waiting = signIn.state[connector.id];
  const action = connector.health?.action;
  const tools = connector.lastTest?.toolDetails?.length ? connector.lastTest.toolDetails : (connector.lastTest?.tools || []).map((toolName) => ({ name: toolName }));
  return (
    <div data-testid="connector-row" data-connector-id={connector.id} data-health={connector.health?.state || ""}>
      <div className="flex items-start gap-3 py-3">
        <ConnectorLogo logo={catalogEntry?.logo || ""} icon={catalogEntry?.icon || ""} iconDark={catalogEntry?.iconDark || ""} name={connector.name} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {renaming ? (
            <form className="flex items-center gap-2" onSubmit={async (event) => { event.preventDefault(); if (await onRename(name)) setRenaming(false); }}>
              <Input aria-label="Connector name" value={name} onChange={(event) => setName(event.target.value)} className="h-7 max-w-xs text-sm" autoFocus />
              <Button type="submit" size="xs" variant="outline" disabled={!name.trim()}>Save</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => { setRenaming(false); setName(connector.name); }}>Cancel</Button>
            </form>
          ) : (
            <p className="truncate text-sm font-medium">{connector.name}</p>
          )}
          <p className="truncate text-xs text-muted-foreground" title={summary(connector)}>{summary(connector)}</p>
          {waiting && !waiting.error ? null : <StatusLine connector={connector} overrideError={busy?.error || waiting?.error} />}
          {waiting && !waiting.error ? <div className="pt-1"><SignInWaiting compact name={connector.name} state={waiting} onOpen={() => signIn.reopen(connector.id)} onCancel={() => signIn.cancel(connector.id)} /></div> : null}
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 pt-1" role="alert">
              <span className="text-xs">Remove {connector.name}{connector.oauth?.status === "signed-in" ? " and sign out of it" : ""}? Members lose its tools on their next message.</span>
              <Button type="button" size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { setConfirming(false); onRemove(); }}>Remove</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {busy?.action ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
          {action && !waiting && !busy?.action && (connector.health?.state !== "ready" || action.kind === "update") ? (
            <Button type="button" size="sm" variant={connector.health?.state === "ready" ? "ghost" : "outline"} className="hidden sm:inline-flex" onClick={() => onAction(action)}>{action.label}</Button>
          ) : null}
          <Switch checked={connector.enabled} disabled={Boolean(busy?.action)} onCheckedChange={onToggle} aria-label={`${connector.name} on or off`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label={`More for ${connector.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {action && !waiting && connector.health?.state !== "ready" ? <DropdownMenuItem className="sm:hidden" onSelect={() => onAction(action)}>{action.label}</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => onAction({ kind: "test" })}>Test</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowTools((value) => !value)}>{showTools ? "Hide tools" : "Show tools"}</DropdownMenuItem>
              {menu.map((item) => <DropdownMenuItem key={item.kind} onSelect={() => onAction(item)}>{item.label}</DropdownMenuItem>)}
              <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirming(true)}>Remove…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showTools ? <ToolList tools={tools} id={`connector-tools-${connector.id}`} /> : null}
    </div>
  );
}

function WebResearchRows({ connector, busy, onSaveKey, onTest, onToggle, keyRef }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setKey(""); }, [connector.hasKey, connector.keyHint]);
  async function saveKey(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await onSaveKey(key.trim()); setKey(""); }
    catch (failure) { setError(failure?.message || String(failure)); }
    finally { setSaving(false); }
  }
  const credits = typeof connector.lastTest?.credits === "number" ? ` · ${connector.lastTest.credits.toLocaleString()} Firecrawl credits left` : "";
  return (
    <div data-testid="connector-row" data-connector-id={connector.id} data-health={connector.health?.state || ""}>
      <div className="flex items-start gap-3 py-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground"><Search className="size-3.5" /></span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">{connector.name}</p>
          <p className="text-xs text-muted-foreground">Built in · members search the web and read pages through Firecrawl, and cite their sources.</p>
          <StatusLine connector={connector.health?.state === "ready" ? { ...connector, health: { ...connector.health, message: `${connector.health.message}${credits}` } } : connector} overrideError={busy?.error} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {busy?.action ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
          <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy?.action)} onClick={onTest}>Test</Button>
          <Switch checked={connector.enabled} disabled={Boolean(busy?.action)} onCheckedChange={onToggle} aria-label={`${connector.name} on or off`} />
        </div>
      </div>
      <form onSubmit={saveKey} className="flex flex-wrap items-center gap-2 pb-3 sm:pl-10">
        <label htmlFor="connector-firecrawl-key" className="text-xs text-muted-foreground">{connector.hasKey ? `Firecrawl key stored (${connector.keyHint}). Enter a new one to replace it.` : "Firecrawl key, from firecrawl.dev. Sealed on this computer."}</label>
        <Input ref={keyRef} id="connector-firecrawl-key" type="password" value={key} placeholder={connector.hasKey ? "••••••••" : "fc-…"} autoComplete="off" onChange={(event) => setKey(event.target.value)} className="h-8 max-w-56 font-mono text-xs" />
        <Button type="submit" size="sm" variant="outline" disabled={!key.trim() || saving}>{saving ? "Saving…" : "Save"}</Button>
        {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
      </form>
    </div>
  );
}

function GoogleClientDialog({ open, onOpenChange, current, onSave, onForget }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setClientId(current?.provided === "build" ? "" : current?.clientId || ""); setClientSecret(""); setError(""); } }, [open, current]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="google-client-dialog">
        <DialogHeader>
          <DialogTitle>Google sign-in</DialogTitle>
          <DialogDescription className="text-left">Squad's Gmail, Google Drive and Google Calendar connectors sign in with a Google OAuth client you own. In Google Cloud Console, create an OAuth client of type Desktop app, turn on the Gmail, Drive and Calendar APIs, and paste the client here. It stays on this computer.</DialogDescription>
        </DialogHeader>
        <form id="google-client-form" className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await onSave({ clientId: clientId.trim(), clientSecret }); onOpenChange(false); } catch (failure) { setError(failure?.message || String(failure)); } finally { setBusy(false); } }}>
          {current?.provided === "build" ? <p className="text-xs leading-5 text-muted-foreground">This copy of Squad comes with a Google client. One you add here replaces it on this computer.</p> : null}
          <label className="block space-y-1.5" htmlFor="google-client-dialog-id"><span className="text-sm font-medium">Client ID</span>
            <Input id="google-client-dialog-id" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          </label>
          <label className="block space-y-1.5" htmlFor="google-client-dialog-secret"><span className="text-sm font-medium">Client secret</span>
            <SecretAwareInput id="google-client-dialog-secret" input={{ secret: true, placeholder: current?.secretHint ? `Stored (${current.secretHint}), leave blank to keep` : "GOCSPX-…" }} value={clientSecret} onChange={setClientSecret} />
          </label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </form>
        <DialogFooter className="gap-2">
          {current && current.provided !== "build" ? <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy} onClick={async () => { await onForget(); onOpenChange(false); }}>Remove client</Button> : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="google-client-form" disabled={busy || !clientId.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The catalogue: Squad's Google connectors and the featured servers first, then the MCP Registry. */
function useCatalogue(api) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ items: [], nextCursor: null, source: "", notice: "", loading: true, loadingMore: false, error: "" });
  const request = useRef(0);
  const load = useCallback(async (query) => {
    const id = ++request.current;
    setPage((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await api(`/api/connectors/catalog?search=${encodeURIComponent(query)}`);
      if (id === request.current) setPage({ items: data.items || [], nextCursor: data.nextCursor || null, source: data.source || "", notice: data.notice || "", loading: false, loadingMore: false, error: "" });
    } catch (failure) {
      if (id === request.current) setPage({ items: [], nextCursor: null, source: "", notice: "", loading: false, loadingMore: false, error: failure?.message || String(failure) });
    }
  }, [api]);
  useEffect(() => {
    const timer = setTimeout(() => { void load(search.trim()); }, search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);
  const more = useCallback(async () => {
    const id = request.current;
    setPage((current) => ({ ...current, loadingMore: true, error: "" }));
    try {
      const data = await api(`/api/connectors/catalog?search=${encodeURIComponent(search.trim())}&cursor=${encodeURIComponent(page.nextCursor || "")}`);
      if (id !== request.current) return;
      setPage((current) => {
        const known = new Set(current.items.map((item) => item.name));
        return { ...current, items: [...current.items, ...(data.items || []).filter((item) => !known.has(item.name))], nextCursor: data.nextCursor || null, loadingMore: false };
      });
    } catch (failure) {
      if (id === request.current) setPage((current) => ({ ...current, loadingMore: false, error: failure?.message || String(failure) }));
    }
  }, [api, page.nextCursor, search]);
  return { search, setSearch, ...page, more, reload: () => load(search.trim()) };
}

function CatalogRow({ item, onOpen }) {
  return (
    <div className="flex items-center gap-3 py-2.5" data-testid="catalog-row" data-catalog-name={item.name}>
      <ConnectorLogo logo={item.logo} icon={item.icon} iconDark={item.iconDark} name={item.title} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.description || item.name}</span>
      </button>
      {item.installed ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${item.title} added`}><Check className="size-3.5" aria-hidden="true" />Added</span>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={onOpen} aria-label={`Add ${item.title}`}>Add</Button>
      )}
    </div>
  );
}

/**
 * Settings › Connectors. `api` is the app's bridge helper (returns `data`).
 * Your connectors first (Squad's managed tools, Web research, then each added
 * server with its status and one fix), then Add a connector: a custom one, or
 * the catalogue from the official MCP Registry with Squad's Google connectors.
 * The heading is rendered by the integrator's SettingsSectionHeader.
 */
export function ConnectorsSettings({ api, className }) {
  const data = useConnectorsState(api);
  const signIn = useSignIn(api, data.connectors, data.refresh);
  const catalogue = useCatalogue(api);
  const [busy, setBusy] = useState({});
  const [installing, setInstalling] = useState(null);
  const [custom, setCustom] = useState({ open: false, connector: null });
  const [googleDialog, setGoogleDialog] = useState(false);
  const [showSquadTools, setShowSquadTools] = useState(false);
  const [notice, setNotice] = useState("");
  const keyRef = useRef(null);

  const managed = data.connectors.filter((item) => item.managed);
  const builtin = data.connectors.find((item) => item.builtin);
  const added = data.connectors.filter((item) => !item.builtin && !item.managed);
  const byCatalogId = useMemo(() => {
    const map = new Map();
    for (const item of catalogue.items) { if (item.catalogId) map.set(item.catalogId, item); map.set(item.name, item); }
    return map;
  }, [catalogue.items]);
  // `?install=<catalogId or name>`: a member's Connectors page sends people
  // straight to one entry's install dialog (ADR-0265).
  const wanted = useRef(typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("install") || "");
  useEffect(() => {
    if (!wanted.current || !catalogue.items.length) return;
    const entry = byCatalogId.get(wanted.current);
    wanted.current = "";
    if (entry && !entry.installed) setInstalling(entry);
  }, [catalogue.items, byCatalogId]);
  const entryFor = (connector) => byCatalogId.get(connector.catalogId) || byCatalogId.get(connector.registry?.name) || (connector.kind === "google" ? byCatalogId.get({ gmail: "gmail", drive: "google-drive", calendar: "google-calendar" }[connector.google?.product]) : null);

  async function run(id, action, operation) {
    setBusy((current) => ({ ...current, [id]: { action } }));
    try {
      const result = await operation();
      setBusy((current) => ({ ...current, [id]: undefined }));
      return result;
    } catch (failure) {
      setBusy((current) => ({ ...current, [id]: { error: failure?.message || String(failure) } }));
      return null;
    }
  }

  const test = (id) => run(id, "test", async () => { const result = await api(path(id, "test"), { method: "POST" }); data.patch(result.connector); return result; });
  const toggle = (id, enabled) => run(id, "toggle", async () => data.patch(await api(path(id, enabled ? "enable" : "disable"), { method: "POST" })));

  async function act(connector, action) {
    switch (action.kind) {
      case "sign-in": signIn.dismiss(connector.id); return signIn.begin(connector.id);
      case "test": return test(connector.id);
      case "edit": return setCustom({ open: true, connector });
      case "google-client": return setGoogleDialog(true);
      case "add-key": return keyRef.current?.focus();
      case "install-runtime": return openExternal(RUNTIME_LINKS[action.runtime] || "https://nodejs.org/en/download");
      case "update": return run(connector.id, "update", async () => { const result = await api(path(connector.id, "update"), { method: "POST" }); data.patch(result.connector); setNotice(result.message); });
      case "sign-out": return run(connector.id, "sign-out", async () => data.patch((await api(path(connector.id, "sign-out"), { method: "POST" })).connector));
      default: return null;
    }
  }

  function menuFor(connector) {
    const items = [];
    if (connector.kind === "stdio" || connector.kind === "url") items.push({ kind: "edit", label: "Edit…" });
    if (connector.oauth?.status === "signed-in") items.push({ kind: "sign-out", label: "Sign out" });
    else if (connector.oauth) items.push({ kind: "sign-in", label: "Sign in" });
    if (connector.registry?.name && connector.kind === "stdio") items.push({ kind: "update", label: connector.health?.update ? `Update to ${connector.health.update.latest}` : "Check for update" });
    if (connector.kind === "google") items.push({ kind: "google-client", label: "Google sign-in…" });
    return items;
  }

  async function saveGoogleClient(client) {
    await api("/api/connectors/google-client", { method: "PUT", body: JSON.stringify(client) });
    await data.refresh();
  }

  return (
    <div className={cn("space-y-8", className)}>
      <section aria-labelledby="connectors-yours" className="space-y-1">
        <h4 id="connectors-yours" className="text-sm font-medium">Your connectors</h4>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">Members use added connectors only when their MCP connectors permission is Allow. Keys and sign-ins are sealed on this computer and never written into a member's files.</p>
        {data.error ? <p className="py-2 text-sm text-destructive" role="alert">{data.error}</p> : null}
        {notice ? <p className="py-1 text-xs text-muted-foreground" role="status">{notice}</p> : null}
        <div className="divide-y divide-border/65">
          {managed.map((connector) => (
            <div key={connector.id} data-testid="squad-managed-connector">
              <div className="flex items-start gap-3 py-3">
                <span aria-hidden="true" className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground"><TerminalSquare className="size-3.5" /></span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium">{connector.name}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{connector.description}</p>
                  <p className={cn("text-xs leading-5", connector.available ? "text-muted-foreground" : "text-destructive")}>{connector.available ? `Managed by Squad · ${connector.tools.length} tools` : "The built-in connection is unavailable. Restart Squad to try again."}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" aria-expanded={showSquadTools} aria-controls="squad-connector-tools" onClick={() => setShowSquadTools((value) => !value)}>{showSquadTools ? "Hide tools" : "View tools"}<ChevronDown className={cn("size-3.5 transition-transform", showSquadTools && "rotate-180")} aria-hidden="true" /></Button>
              </div>
              {showSquadTools ? <ToolList tools={connector.tools} id="squad-connector-tools" /> : null}
            </div>
          ))}
          {builtin ? (
            <WebResearchRows
              connector={builtin}
              busy={busy[builtin.id]}
              keyRef={keyRef}
              onSaveKey={async (apiKey) => { data.patch(await api(path(builtin.id), { method: "PUT", body: JSON.stringify({ apiKey }) })); await test(builtin.id); }}
              onTest={() => test(builtin.id)}
              onToggle={(enabled) => toggle(builtin.id, enabled)}
            />
          ) : null}
          {added.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              catalogEntry={entryFor(connector)}
              busy={busy[connector.id]}
              signIn={signIn}
              menu={menuFor(connector)}
              onAction={(action) => act(connector, action)}
              onToggle={(enabled) => toggle(connector.id, enabled)}
              onRename={async (name) => Boolean(await run(connector.id, "rename", async () => { data.patch(await api(path(connector.id, "rename"), { method: "POST", body: JSON.stringify({ name }) })); return true; }))}
              onRemove={() => run(connector.id, "remove", async () => { await api(path(connector.id), { method: "DELETE" }); data.drop(connector.id); void catalogue.reload(); })}
            />
          ))}
          {!data.loaded ? <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Spinner className="size-3" />Loading connectors…</p> : null}
        </div>
      </section>

      <section aria-labelledby="connectors-add" className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 id="connectors-add" className="text-sm font-medium">Add a connector</h4>
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">From the official MCP Registry, running on this computer or hosted by the service. Squad signs you in where the service asks.</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" aria-label="Search connectors" placeholder="Search the MCP Registry" value={catalogue.search} onChange={(event) => catalogue.setSearch(event.target.value)} className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <div className="divide-y divide-border/65">
          <div className="flex items-center gap-3 py-2.5" data-testid="custom-connector-row">
            <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"><Plus className="size-3.5" /></span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCustom({ open: true, connector: null })}>
              <span className="block text-sm font-medium">Custom connector</span>
              <span className="block truncate text-xs text-muted-foreground">Any MCP server: an address, a command, or a pasted config</span>
            </button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustom({ open: true, connector: null })} aria-label="Add a custom connector">Add</Button>
          </div>
          {catalogue.items.map((item) => <CatalogRow key={item.name} item={item} onOpen={() => setInstalling(item)} />)}
          {catalogue.loading ? <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status"><Spinner className="size-3" />{catalogue.search ? `Searching the MCP Registry for “${catalogue.search}”…` : "Loading the catalogue…"}</p> : null}
          {!catalogue.loading && !catalogue.items.length && !catalogue.error ? <p className="py-3 text-xs text-muted-foreground">Nothing in the MCP Registry matches “{catalogue.search}”. Add it as a custom connector instead.</p> : null}
        </div>
        {catalogue.source === "cache" || catalogue.source === "snapshot" || catalogue.source === "offline" ? (
          <p className="text-xs leading-5 text-muted-foreground" role="status">{catalogue.source === "offline" ? "The MCP Registry can't be reached, so search isn't available right now." : "The MCP Registry can't be reached right now; showing the connectors Squad saved earlier."} <button type="button" className="underline underline-offset-2" onClick={() => catalogue.reload()}>Try again</button></p>
        ) : null}
        {catalogue.error ? <p className="text-xs text-destructive" role="alert">{catalogue.error} <button type="button" className="underline underline-offset-2" onClick={() => catalogue.reload()}>Try again</button></p> : null}
        {catalogue.nextCursor && !catalogue.loading ? (
          <div className="pt-2"><Button type="button" size="sm" variant="ghost" className="-ml-2" disabled={catalogue.loadingMore} onClick={catalogue.more}>{catalogue.loadingMore ? <><Spinner className="size-3.5" />Loading…</> : "Show more from the MCP Registry"}</Button></div>
        ) : null}
        <p className="pt-2 text-xs leading-5 text-muted-foreground">
          Google sign-in: {data.googleClient ? <>using {data.googleClient.provided === "build" ? "the client that came with Squad" : <span className="font-mono">{data.googleClient.clientId.slice(0, 18)}…</span>}.</> : "not set up."}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => setGoogleDialog(true)}>{data.googleClient ? "Change" : "Set up"}</button>
        </p>
      </section>

      <InstallDialog
        api={api}
        entry={installing}
        open={Boolean(installing)}
        onOpenChange={(open) => { if (!open) { setInstalling(null); void data.refresh(); void catalogue.reload(); } }}
        onInstalled={(connector) => data.patch(connector)}
        googleClient={data.googleClient}
        onGoogleClient={saveGoogleClient}
        signIn={signIn}
      />
      <CustomConnectorDialog
        api={api}
        open={custom.open}
        connector={custom.connector}
        onOpenChange={(open) => setCustom((current) => ({ ...current, open }))}
        onSaved={(records) => { (records || []).forEach(data.patch); void data.refresh(); }}
        onNeedsSignIn={(connector) => signIn.begin(connector.id)}
      />
      <GoogleClientDialog
        open={googleDialog}
        onOpenChange={setGoogleDialog}
        current={data.googleClient}
        onSave={saveGoogleClient}
        onForget={async () => { await api("/api/connectors/google-client", { method: "DELETE" }); await data.refresh(); }}
      />
    </div>
  );
}
