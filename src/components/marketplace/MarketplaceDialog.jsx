import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ExternalLink, Flag, Link2, RotateCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { birdFaceSvg } from "@/lib/bird-faces";
import { AUTOHAND_CREATOR_NAME, CATEGORIES, REPORT_REASONS, addedDate } from "@/lib/marketplace";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "explore", label: "Explore" },
  { id: "link", label: "From a link" },
  { id: "published", label: "Published" },
];
const WEB_BASE = "https://autohand.ai/squad/marketplace/";

export function BirdFace({ bird, size = "size-8", style, title = "" }) {
  return <span className={cn("member-face inline-block shrink-0 overflow-hidden rounded-full bg-muted", size)} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : "true"} dangerouslySetInnerHTML={{ __html: birdFaceSvg(bird || "kiwi", { style }) }} />;
}

function errorText(error, fallback) {
  return error?.message || fallback;
}

function timeOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The marketplace (ADR-0246): Explore lists published agents by category and
 * search; From a link opens a marketplace, Squad or Grok Bot link; Published
 * lists the person's own listings. A row opens the agent; nothing is added
 * until Add to squad. `request` is a deep link's `{ id, version, sha256 }`,
 * which opens straight on that agent.
 */
export function MarketplaceDialog({ open, onOpenChange, api, agents = [], copy = {}, avatarStyle, request = null, onAdd, onUpdate, onOpenMember }) {
  const [tab, setTab] = useState("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [categories, setCategories] = useState(null);
  const [list, setList] = useState({ agents: [], total: 0, nextCursor: null, offline: false, fetchedAt: "" });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const listRequest = useRef(0);

  const load = useCallback(async ({ append = false, cursor = "" } = {}) => {
    const ticket = ++listRequest.current;
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ limit: "24" });
    if (query.trim()) params.set("q", query.trim());
    if (category === "autohand") params.set("creator", "autohand");
    else if (category !== "all") params.set("category", category);
    if (cursor) params.set("cursor", cursor);
    // Counts and the list come from the same moment, so a pill never says 200 above a list of 201.
    if (!append) api("/api/marketplace/categories").then((data) => { if (ticket === listRequest.current) setCategories(data); }).catch(() => {});
    try {
      const data = await api(`/api/marketplace/agents?${params}`);
      if (ticket !== listRequest.current) return;
      setList((current) => ({ ...data, agents: append ? [...current.agents, ...data.agents] : data.agents }));
    } catch (error) {
      if (ticket !== listRequest.current) return;
      setListError(errorText(error, "The marketplace could not be reached."));
      if (!append) setList({ agents: [], total: 0, nextCursor: null, offline: false, fetchedAt: "" });
    } finally {
      if (ticket === listRequest.current) setLoading(false);
    }
  }, [api, query, category]);

  useEffect(() => {
    if (!open) return;
    setTab("explore");
    setSelected(request ? { kind: "marketplace", id: request.id, version: request.version, sha256: request.sha256 } : null);
  }, [open, request]);

  // What this squad already has from the marketplace, read whenever the list
  // is in view so a row says Added or Update available as it is now.
  useEffect(() => {
    if (!open || selected) return;
    api("/api/marketplace/imports").then((data) => setReceipts(data.imports || [])).catch(() => setReceipts([]));
  }, [open, selected, api, agents]);
  const stateById = useMemo(() => {
    const live = new Set(agents.map((agent) => agent.id));
    const out = new Map();
    for (const receipt of receipts) if (receipt.listingId && live.has(receipt.memberId)) out.set(receipt.listingId, receipt);
    return out;
  }, [receipts, agents]);

  useEffect(() => {
    if (!open || tab !== "explore") return undefined;
    const timer = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, tab, load, query]);

  const pills = useMemo(() => [
    { id: "all", label: copy.marketplaceAll || "All", count: categories?.total },
    { id: "autohand", label: copy.marketplaceFromAutohand || "From Autohand", count: categories?.autohand },
    ...CATEGORIES.map((item) => ({ ...item, count: categories?.categories?.find((entry) => entry.id === item.id)?.count })),
  ], [categories, copy]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-2xl" data-testid="marketplace-dialog">
        {selected ? (
          <AgentDetail
            key={`${selected.kind}:${selected.id || selected.url}`}
            entry={selected}
            api={api}
            agents={agents}
            copy={copy}
            avatarStyle={avatarStyle}
            onBack={() => setSelected(null)}
            onDone={() => onOpenChange?.(false)}
            onAdd={onAdd}
            onUpdate={onUpdate}
            onOpenMember={(id) => { onOpenChange?.(false); onOpenMember?.(id); }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{copy.marketplaceTitle || "Marketplace"}</DialogTitle>
              <DialogDescription>{copy.marketplaceDescription || "Agents published by people and teams. Add one to your squad, or bring one in from a link."}</DialogDescription>
            </DialogHeader>
            <div className="flex min-w-0 flex-col text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 pb-2 text-xs" role="tablist">
                {TABS.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
                    className={cn("underline-offset-4 transition-colors hover:text-foreground", tab === item.id ? "font-medium text-foreground underline" : "text-muted-foreground")}>
                    {copy[`marketplaceTab_${item.id}`] || item.label}
                  </button>
                ))}
              </div>

              {tab === "explore" ? (
                <>
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.marketplaceSearch || "Search by agent or creator"} aria-label={copy.marketplaceSearch || "Search by agent or creator"} className="h-8 pl-8 text-sm" />
                  </div>
                  <div className="-mx-1 mt-2 flex gap-x-3 gap-y-1 overflow-x-auto px-1 pb-1 text-xs [scrollbar-width:none] sm:flex-wrap" role="tablist" aria-label={copy.marketplaceCategories || "Categories"}>
                    {pills.map((item) => (
                      <button key={item.id} type="button" role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}
                        className={cn("shrink-0 whitespace-nowrap underline-offset-4 transition-colors hover:text-foreground", category === item.id ? "text-foreground underline" : "text-muted-foreground")}>
                        {item.label}{Number.isInteger(item.count) ? <span className="ml-1 tabular-nums text-muted-foreground/70">{item.count}</span> : null}
                      </button>
                    ))}
                  </div>
                  {list.offline ? (
                    <p className="flex items-center gap-2 pt-3 text-xs text-muted-foreground" role="status" data-testid="marketplace-offline">
                      {(copy.marketplaceOffline || "Offline · showing the list from {time}.").replace("{time}", timeOf(list.fetchedAt))}
                      <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => void load()}>{copy.retry || "Retry"}</button>
                    </p>
                  ) : null}
                  {listError ? (
                    <p className="flex items-center gap-2 pt-3 text-xs text-muted-foreground" role="alert">
                      {listError}
                      <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => void load()}>{copy.retry || "Retry"}</button>
                    </p>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3 pt-4 pb-1.5">
                    <h3 className="text-sm font-semibold">{pills.find((item) => item.id === category)?.label}</h3>
                    {!listError ? <span className="text-xs tabular-nums text-muted-foreground">{list.total}</span> : null}
                  </div>
                  {list.agents.length ? (
                    <ul className="flex flex-col border-t border-border/60" data-testid="marketplace-list">
                      {list.agents.map((agent) => (
                        <AgentRow key={agent.id} agent={agent} copy={copy} avatarStyle={avatarStyle} receipt={stateById.get(agent.id)} onOpen={() => setSelected({ kind: "marketplace", id: agent.id, listing: agent })} />
                      ))}
                    </ul>
                  ) : !loading && !listError ? (
                    <p className="border-y border-border/60 py-2 text-xs text-muted-foreground">{copy.marketplaceNoMatch || "No agent matches. Try another word or category."}</p>
                  ) : null}
                  {loading ? <p className="py-3 text-xs text-muted-foreground" role="status">{copy.loading || "Loading…"}</p> : null}
                  {list.nextCursor && !loading ? (
                    <Button variant="ghost" size="sm" className="mt-2 self-start text-xs" onClick={() => void load({ append: true, cursor: list.nextCursor })}>{copy.loadMore || "Load more"}</Button>
                  ) : null}
                </>
              ) : null}

              {tab === "link" ? <FromLink api={api} copy={copy} onOpen={setSelected} /> : null}
              {tab === "published" ? <Published api={api} copy={copy} avatarStyle={avatarStyle} /> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange?.(false)}>{copy.close || "Close"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentRow({ agent, copy, avatarStyle, receipt, onOpen }) {
  const state = !receipt ? "" : receipt.contentHash && receipt.contentHash !== agent.contentHash ? "update" : "added";
  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-2.5" data-state={state || "new"}>
      <BirdFace bird={agent.bird} style={avatarStyle} size="size-8 mt-0.5" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block max-w-full truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline">
          <span className="font-medium">{agent.name}</span>
          <span className="text-muted-foreground"> {copy.by || "by"} {agent.creator?.name}</span>
        </button>
        <p className="truncate text-xs text-muted-foreground">{agent.tagline}</p>
        <p className="text-xs text-muted-foreground/80">{agent.role} · {agent.categoryLabel} · {(copy.addedOn || "Added {date}").replace("{date}", addedDate(agent.createdAt))}</p>
        {state ? (
          <p className={cn("flex min-w-0 items-center gap-1 pt-0.5 text-xs", state === "update" ? "text-foreground" : "text-muted-foreground")} data-testid="marketplace-row-state">
            {state === "update" ? <RotateCw className="size-3 shrink-0" aria-hidden="true" /> : <Check className="size-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">{state === "update" ? copy.updateAvailable || "Update available" : (copy.inYourSquad || "Added as {name}").replace("{name}", receipt.memberName || "")}</span>
          </p>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={onOpen} aria-label={`${copy.view || "View"} ${agent.name}`}>
        {copy.view || "View"}
      </Button>
    </li>
  );
}

function FromLink({ api, copy, onOpen }) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const target = await api("/api/marketplace/resolve", { method: "POST", body: JSON.stringify({ link }) });
      if (target.kind === "invalid") setError(target.error);
      else onOpen(target);
    } catch (failure) {
      setError(errorText(failure, "That link could not be opened."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flex flex-col gap-3 pt-3" onSubmit={submit}>
      <p className="text-xs text-muted-foreground">{copy.marketplaceLinkDetail || "Paste a marketplace page, a squad:// link, or a Grok Bot link (x.ai/bot/…). You see the agent before anything is added."}</p>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://autohand.ai/squad/marketplace/…" aria-label={copy.marketplaceLink || "Link"} className="h-8 pl-8 text-sm" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={!link.trim() || busy}>{copy.open || "Open"}</Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

function Published({ api, copy, avatarStyle }) {
  const [state, setState] = useState({ loading: true, agents: [], error: "", signedIn: true });
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const context = await api("/api/marketplace/publish/context");
      if (!context.signedIn) { setState({ loading: false, agents: [], error: "", signedIn: false }); return; }
      const data = await api("/api/marketplace/mine");
      setState({ loading: false, agents: data.agents || [], error: "", signedIn: true });
    } catch (error) {
      setState({ loading: false, agents: [], error: errorText(error, "Your published agents could not be loaded."), signedIn: true });
    }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function unpublish(agent) {
    try {
      await api(`/api/marketplace/agents/${agent.id}`, { method: "DELETE" });
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorText(error, "It could not be unpublished.") }));
    }
  }
  if (state.loading) return <p className="pt-3 text-xs text-muted-foreground" role="status">{copy.loading || "Loading…"}</p>;
  if (!state.signedIn) return <p className="pt-3 text-xs text-muted-foreground">{copy.marketplaceSignIn || "Sign in to Autohand to publish agents and see the ones you published."}</p>;
  return (
    <div className="flex flex-col pt-3">
      <p className="text-xs text-muted-foreground">{copy.marketplacePublishHow || "Publish a member from its menu: Publish to marketplace…. A new version replaces what people add; earlier versions stay listed."}</p>
      {state.error ? <p role="alert" className="pt-3 text-xs text-destructive">{state.error}</p> : null}
      {state.agents.length ? (
        <ul className="mt-3 flex flex-col border-t border-border/60" data-testid="marketplace-published">
          {state.agents.map((agent) => (
            <li key={agent.id} className="flex items-start gap-3 border-b border-border/60 py-2.5">
              <BirdFace bird={agent.bird} style={avatarStyle} size="size-8 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate"><span className="font-medium">{agent.name}</span><span className="text-muted-foreground"> {copy.by || "by"} {agent.creator?.name}</span></p>
                <p className={cn("text-xs", agent.status === "hidden" ? "text-destructive" : "text-muted-foreground")}>
                  {agent.status === "published" ? `${copy.published || "Published"} · ${copy.version || "version"} ${agent.version}` : agent.status === "hidden" ? `${copy.hiddenByModerator || "Hidden by a moderator"}: ${agent.moderationReason || ""}` : copy.unpublished || "Unpublished"}
                </p>
              </div>
              {agent.status === "published" ? (
                <>
                  <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground">
                    <a href={`${WEB_BASE}${agent.id}/`} target="_blank" rel="noreferrer"><ExternalLink data-icon="inline-start" />{copy.onTheWeb || "Web"}</a>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => void unpublish(agent)}>{copy.unpublish || "Unpublish"}</Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !state.error ? <p className="mt-3 border-y border-border/60 py-2 text-xs text-muted-foreground">{copy.marketplaceNothingPublished || "Nothing published yet."}</p> : null}
    </div>
  );
}

function AgentDetail({ entry, api, agents, copy, avatarStyle, onBack, onDone, onAdd, onUpdate, onOpenMember }) {
  const grok = entry.kind === "grok";
  const [detail, setDetail] = useState(null);
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportState, setReportState] = useState("");

  const fetchTemplate = useCallback(async (pasted = "") => {
    setError("");
    if (grok) {
      const data = await api("/api/marketplace/grok/preview", { method: "POST", body: JSON.stringify({ url: entry.url, instructions: pasted }) });
      setTemplate(data);
      return data;
    }
    const data = await api("/api/marketplace/fetch", { method: "POST", body: JSON.stringify({ id: entry.id, version: entry.version, sha256: entry.sha256 }) });
    setTemplate(data);
    return data;
  }, [api, entry, grok]);

  const [receipts, setReceipts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (grok) await fetchTemplate();
        else {
          const [data, imports] = await Promise.all([
            api(`/api/marketplace/agents/${entry.id}`),
            api("/api/marketplace/imports").catch(() => ({ imports: [] })),
          ]);
          if (cancelled) return;
          setDetail(data);
          setReceipts((imports.imports || []).filter((receipt) => receipt.listingId === entry.id));
          if (entry.sha256 && !entry.version && data.agent?.contentHash !== entry.sha256) {
            setError(copy.marketplaceStaleLink || "This link was made for a different version of the agent, so adding it from the link is refused. Go back and open the agent from the marketplace to add the current version.");
          }
        }
      } catch (failure) {
        if (!cancelled) setError(errorText(failure, "This agent could not be opened."));
      }
    })();
    return () => { cancelled = true; };
  }, [api, entry, grok, fetchTemplate, copy]);

  const listing = grok ? null : detail?.agent || entry.listing || null;
  const member = template?.document?.members?.[0];
  const name = grok ? template?.bot?.name : listing?.name;
  const existing = (grok ? template?.existing || [] : receipts).map((receipt) => ({ ...receipt, member: agents.find((agent) => agent.id === receipt.memberId) })).filter((receipt) => receipt.member);
  const latest = existing.at(-1);
  const upToDate = latest && latest.contentHash && latest.contentHash === (grok ? template?.contentHash : listing?.contentHash);
  const staleLink = Boolean(!grok && entry.sha256 && !entry.version && listing && listing.contentHash !== entry.sha256);

  async function add(mode = "add") {
    setBusy(mode);
    setError("");
    try {
      // The template is downloaded and verified only now: opening an agent
      // neither counts as an add nor uses the download allowance.
      const fresh = await fetchTemplate(grok ? instructions : "");
      const receipt = {
        source: grok ? "grok" : "marketplace",
        listingId: grok ? "" : entry.id,
        grokId: grok ? fresh.bot.id : "",
        version: grok ? 0 : fresh.version,
        contentHash: fresh.contentHash,
        creator: grok ? fresh.creator : fresh.agent?.creator?.name || "",
      };
      if (mode === "update" && latest) await onUpdate?.({ document: fresh.document, receipt: { ...receipt, memberId: latest.memberId, action: "update" } });
      else await onAdd?.({ document: fresh.document, receipt });
      onDone();
    } catch (failure) {
      setError(errorText(failure, "Nothing was added."));
    } finally {
      setBusy("");
    }
  }

  async function report(reason) {
    setReportState("sending");
    try {
      await api(`/api/marketplace/agents/${entry.id}/report`, { method: "POST", body: JSON.stringify({ reason }) });
      setReportState("sent");
    } catch {
      setReportState("failed");
    }
  }

  const preview = grok ? member : detail?.preview;
  const skills = grok ? [] : detail?.preview?.skills || [];
  const thirdParty = grok || (listing && listing.creator?.kind !== "autohand");

  return (
    <>
      <DialogHeader>
        <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          {copy.marketplaceTitle || "Marketplace"}
        </button>
        <div className="flex items-center gap-3 pt-1">
          <BirdFace bird={grok ? "kea" : listing?.bird} style={avatarStyle} size="size-11" />
          <div className="min-w-0">
            <DialogTitle className="truncate">{name || (error ? copy.marketplaceUnavailable || "Agent unavailable" : copy.loading || "Loading…")}</DialogTitle>
            <DialogDescription className="truncate">
              {grok
                ? template ? `${copy.grokTemplateBy || "Grok Bot template by"} ${template.creator}` : ""
                : listing ? `${listing.role} · ${copy.by || "by"} ${listing.creator?.name}` : ""}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="flex min-w-0 flex-col text-sm" data-testid="marketplace-detail">
        {listing ? (
          <p className="border-b border-border/60 pb-2 text-xs text-muted-foreground">
            {listing.categoryLabel} · {(copy.addedOn || "Added {date}").replace("{date}", addedDate(listing.createdAt))} · {copy.version || "version"} {listing.version}
            {listing.skills ? ` · ${listing.skills} ${listing.skills === 1 ? "skill" : "skills"}` : ""}
          </p>
        ) : null}
        {grok && template ? (
          <p className="border-b border-border/60 pb-2 text-xs text-muted-foreground">
            <a href={template.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">{template.sourceUrl.replace("https://", "")}</a>
          </p>
        ) : null}

        {listing?.tagline ? <p className="pt-3">{listing.tagline}</p> : null}
        {listing?.description ? <p className="pt-2 text-muted-foreground">{listing.description}</p> : null}
        {grok && template?.bot?.description ? <p className="pt-3">{template.bot.description}</p> : null}

        {preview?.instructions ? (
          <>
            <h3 className="pt-5 pb-1.5 text-sm font-semibold">{grok ? copy.startsWith || "Starts with these instructions" : copy.instructions || "Instructions"}</h3>
            <div className="max-h-48 overflow-y-auto border-t border-border/60 pt-2 text-xs whitespace-pre-wrap text-muted-foreground">{preview.instructions}</div>
          </>
        ) : null}

        {skills.length ? (
          <>
            <h3 className="pt-5 pb-1.5 text-sm font-semibold">{copy.skills || "Skills"}</h3>
            <ul className="flex flex-col border-t border-border/60">
              {skills.map((skill) => (
                <li key={skill.name} className="border-b border-border/60 py-2">
                  <span className="block font-mono text-xs">{skill.name}</span>
                  {skill.description ? <span className="block text-xs text-muted-foreground">{skill.description}</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {grok && template ? (
          <div className="flex flex-col gap-2 pt-5">
            <p className="text-xs text-muted-foreground">{copy.grokExplain || "Grok shares a bot's name and description publicly, not its instructions. Squad starts it from the description. If you have the bot's instructions, paste them and they replace the starter text."}</p>
            <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} placeholder={copy.grokPaste || "Paste the bot's instructions (optional)"} aria-label={copy.grokPaste || "Paste the bot's instructions (optional)"} className="text-sm" />
          </div>
        ) : null}

        {detail?.preview?.hasMemory ? <p className="pt-4 text-xs text-muted-foreground">{copy.marketplaceHasMemory || "Comes with starter memory, written to its MEMORY.md."}</p> : null}
        <p className="pt-4 text-xs text-muted-foreground">{copy.marketplaceArrives || "It joins as a new member on the Ask level with its skills switched off. Nothing runs until you message it."}</p>
        {thirdParty ? (
          <p className="pt-2 text-xs text-muted-foreground" data-testid="marketplace-third-party">
            {(grok ? copy.grokThirdParty || "Made by {creator} on Grok Bot, not by Autohand. Read its instructions before you add it." : copy.marketplaceThirdParty || "Published by {creator}, not by Autohand. Read its instructions before you add it.").replace("{creator}", grok ? template?.creator || "" : listing?.creator?.name || "")}
          </p>
        ) : listing?.creator?.name === AUTOHAND_CREATOR_NAME ? (
          <p className="pt-2 text-xs text-muted-foreground">{copy.marketplaceByAutohand || "Written and checked by the Autohand Squad team."}</p>
        ) : null}

        {latest ? (
          <p className="pt-4 text-xs" role="status" data-testid="marketplace-existing">
            {(upToDate ? copy.marketplaceAlreadyCurrent || "Already in your squad as {name}, at this version." : copy.marketplaceAlready || "Already in your squad as {name}. Update it to this version, or add another copy.").replace("{name}", latest.member.name)}
            {" "}<button type="button" className="underline underline-offset-4" onClick={() => onOpenMember(latest.memberId)}>{(copy.openMember || "Open {name}").replace("{name}", latest.member.name)}</button>
          </p>
        ) : null}
        {error ? <p role="alert" className="pt-4 text-xs text-destructive" data-testid="marketplace-error">{error}</p> : null}

        {!grok && listing ? (
          <div className="pt-4 text-xs text-muted-foreground">
            {reportState === "sent" ? <span role="status">{copy.reportThanks || "Thanks. A moderator will look at it."}</span> : reporting ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{copy.reportWhy || "What is wrong?"}</span>
                {REPORT_REASONS.map((reason) => (
                  <button key={reason.id} type="button" disabled={reportState === "sending"} className="underline underline-offset-4 hover:text-foreground" onClick={() => void report(reason.id)}>{reason.label}</button>
                ))}
                {reportState === "failed" ? <span className="text-destructive">{copy.reportFailed || "The report could not be sent."}</span> : null}
              </span>
            ) : (
              <button type="button" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline" onClick={() => setReporting(true)}>
                <Flag className="size-3" aria-hidden="true" />{copy.report || "Report"}
              </button>
            )}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack}>{copy.back || "Back"}</Button>
        {latest && !upToDate ? <Button variant="outline" disabled={Boolean(busy) || (!listing && !grok) || staleLink} onClick={() => void add("update")} data-testid="marketplace-update">{busy === "update" ? copy.updating || "Updating…" : (copy.updateMember || "Update {name}").replace("{name}", latest.member.name)}</Button> : null}
        <Button disabled={Boolean(busy) || (!listing && !(grok && template)) || staleLink} onClick={() => void add("add")} data-testid="marketplace-add">
          {busy === "add" ? <><RotateCw data-icon="inline-start" className="animate-spin" />{copy.adding || "Adding…"}</> : latest ? copy.addAnother || "Add another" : copy.addToSquad || "Add to squad"}
        </Button>
      </DialogFooter>
    </>
  );
}
