import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ExternalLink, Flag, Link2, RotateCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { birdFaceSvg } from "@/lib/bird-faces";
import { AUTOHAND_CREATOR_NAME, CATEGORIES, REPORT_REASONS, addedDate } from "@/lib/marketplace";
import { recordMarketplaceEvent } from "@/lib/product-telemetry";
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

/** A failure message as one of the telemetry reasons; never the text itself. */
function failureReason(message = "") {
  const text = String(message).toLowerCase();
  if (text.includes("checksum")) return "checksum";
  if (text.includes("too many") || text.includes("wait a minute")) return "rate_limited";
  if (text.includes("not in the marketplace") || text.includes("does not exist")) return "not_found";
  if (text.includes("could not be reached") || text.includes("online")) return "offline";
  if (text.includes("refused")) return "invalid";
  if (text.includes("isn't available")) return "unavailable";
  return "failed";
}

const teamLine = (listing, copy) => (copy.marketplaceTeamOf || "Team · {n} members").replace("{n}", String(listing?.members || 0));
const subtitle = (listing, copy) => (listing?.kind === "team" ? teamLine(listing, copy) : listing?.role || "");

/**
 * The marketplace (ADR-0246, ADR-0248): Explore opens on a curated first
 * screen (Featured, Teams, then each category's first agents with View all);
 * a search, a category or Teams turns it into one paged list. From a link
 * opens a marketplace, Squad or Grok Bot link; Published lists the person's
 * own listings. A row opens the agent or team; nothing is added until Add.
 * `request` is a deep link's `{ listing, id, version, sha256, attribution }`,
 * which opens straight on that listing. `entry` says where the dialog was
 * opened from, for product telemetry only.
 */
export function MarketplaceDialog({ open, onOpenChange, api, agents = [], copy = {}, avatarStyle, request = null, entry = "directory", onAdd, onUpdate, onOpenMember }) {
  const [tab, setTab] = useState("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [categories, setCategories] = useState(null);
  const [home, setHome] = useState(null);
  const [homeError, setHomeError] = useState("");
  const [list, setList] = useState({ agents: [], total: 0, nextCursor: null, offline: false, fetchedAt: "" });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const listRequest = useRef(0);
  const homeMode = !query.trim() && category === "all";

  const loadHome = useCallback(async () => {
    setHomeError("");
    try {
      const data = await api("/api/marketplace/home");
      setHome(data);
    } catch (error) {
      setHomeError(errorText(error, "The marketplace could not be reached."));
    }
  }, [api]);

  const load = useCallback(async ({ append = false, cursor = "" } = {}) => {
    const ticket = ++listRequest.current;
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ limit: "24" });
    if (query.trim()) params.set("q", query.trim());
    if (category === "autohand") params.set("creator", "autohand");
    else if (category === "teams") params.set("kind", "team");
    else if (category !== "all") params.set("category", category);
    if (category !== "teams" && query.trim()) params.set("kind", "all");
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
    setSelected(request ? { kind: "marketplace", listingKind: request.listing === "team" ? "team" : "agent", id: request.id, version: request.version, sha256: request.sha256, attribution: request.attribution, via: request.attribution ? "website-link" : "link" } : null);
    recordMarketplaceEvent("marketplace_opened", { entry: request ? "link" : entry });
  }, [open, request, entry]);

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

  // The first screen loads once per opening; a list reloads only when its
  // query or category changes (never because the counts arrived).
  const homeRequested = useRef(false);
  useEffect(() => {
    if (!open) { homeRequested.current = false; return; }
    if (tab !== "explore" || !homeMode || homeRequested.current) return;
    homeRequested.current = true;
    void loadHome();
    api("/api/marketplace/categories").then(setCategories).catch(() => {});
  }, [open, tab, homeMode, loadHome, api]);
  useEffect(() => {
    if (!open || tab !== "explore" || homeMode) return undefined;
    const timer = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, tab, load, query, homeMode]);

  const pills = useMemo(() => [
    { id: "all", label: copy.marketplaceAll || "All", count: categories ? categories.total + (categories.teams || 0) : undefined },
    { id: "teams", label: copy.marketplaceTeams || "Teams", count: categories?.teams },
    { id: "autohand", label: copy.marketplaceFromAutohand || "From Autohand", count: categories?.autohand },
    ...CATEGORIES.map((item) => ({ ...item, count: categories?.categories?.find((entry) => entry.id === item.id)?.count })),
  ], [categories, copy]);

  const openListing = (listing, placement) => setSelected({ kind: "marketplace", listingKind: listing.kind === "team" ? "team" : "agent", id: listing.id, listing, via: "in-app", placement });
  const viewAll = (id) => { setQuery(""); setCategory(id); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-3xl" data-testid="marketplace-dialog">
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
              <DialogTitle className="text-xl">{copy.marketplaceTitle || "Marketplace"}</DialogTitle>
              <DialogDescription>{copy.marketplaceDescriptionV2 || "Agents and whole teams, published by people and the Autohand Squad team. Read one, then add it to your squad."}</DialogDescription>
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
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.marketplaceSearchV2 || "Search agents, teams and creators"} aria-label={copy.marketplaceSearchV2 || "Search agents, teams and creators"} className="h-10 pl-9 text-sm" data-testid="marketplace-search" />
                  </div>
                  <div className="-mx-1 mt-3 flex gap-x-3 gap-y-1 overflow-x-auto px-1 pb-1 text-xs [scrollbar-width:none] sm:flex-wrap" role="tablist" aria-label={copy.marketplaceCategories || "Categories"}>
                    {pills.map((item) => (
                      <button key={item.id} type="button" role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}
                        className={cn("shrink-0 whitespace-nowrap underline-offset-4 transition-colors hover:text-foreground", category === item.id ? "text-foreground underline" : "text-muted-foreground")}>
                        {item.label}{Number.isInteger(item.count) ? <span className="ml-1 tabular-nums text-muted-foreground/70">{item.count}</span> : null}
                      </button>
                    ))}
                  </div>

                  {homeMode ? (
                    <Home home={home} error={homeError} copy={copy} avatarStyle={avatarStyle} stateById={stateById} onRetry={() => { setHome(null); void loadHome(); }} onOpen={openListing} onViewAll={viewAll} />
                  ) : (
                    <>
                      {list.offline ? <OfflineNote copy={copy} fetchedAt={list.fetchedAt} onRetry={() => void load()} /> : null}
                      {listError ? (
                        <p className="flex items-center gap-2 pt-4 text-xs text-muted-foreground" role="alert">
                          {listError}
                          <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => void load()}>{copy.retry || "Retry"}</button>
                        </p>
                      ) : null}
                      <div className="flex items-baseline justify-between gap-3 pt-5 pb-2">
                        <h3 className="text-base font-semibold">{query.trim() ? (copy.marketplaceResults || "Results") : pills.find((item) => item.id === category)?.label}</h3>
                        {!listError ? <span className="text-xs tabular-nums text-muted-foreground">{list.total}</span> : null}
                      </div>
                      {list.agents.length ? (
                        <ul className={cn("grid gap-x-8 sm:grid-cols-2", loading && "opacity-60 transition-opacity")} data-testid="marketplace-list">
                          {list.agents.map((agent) => (
                            <ListingRow key={agent.id} agent={agent} copy={copy} avatarStyle={avatarStyle} receipt={stateById.get(agent.id)} onOpen={() => openListing(agent, "list")} />
                          ))}
                        </ul>
                      ) : loading ? <SkeletonRows /> : !listError ? (
                        <p className="py-6 text-sm text-muted-foreground" data-testid="marketplace-empty">
                          {query.trim() ? (copy.marketplaceNoMatchQuery || "Nothing matches “{q}”. Try a role, a skill or a creator.").replace("{q}", query.trim()) : copy.marketplaceNoMatch || "Nothing here yet."}
                        </p>
                      ) : null}
                      {list.nextCursor && !loading ? (
                        <Button variant="ghost" size="sm" className="mt-2 self-start text-xs" onClick={() => void load({ append: true, cursor: list.nextCursor })}>{copy.loadMore || "Load more"}</Button>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}

              {tab === "link" ? <FromLink api={api} copy={copy} onOpen={(target) => setSelected({ ...target, listing: null, listingKind: target.listing === "team" ? "team" : "agent", via: target.kind === "grok" ? "grok" : "link" })} /> : null}
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

function OfflineNote({ copy, fetchedAt, onRetry }) {
  return (
    <p className="flex items-center gap-2 pt-4 text-xs text-muted-foreground" role="status" data-testid="marketplace-offline">
      {(copy.marketplaceOffline || "Offline · showing the list from {time}.").replace("{time}", timeOf(fetchedAt))}
      <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={onRetry}>{copy.retry || "Retry"}</button>
    </p>
  );
}

function SkeletonRows({ count = 6 }) {
  return (
    <ul className="grid gap-x-8 sm:grid-cols-2" aria-hidden="true" data-testid="marketplace-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex items-start gap-3 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5 pt-0.5"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-1/3" /></div>
        </li>
      ))}
    </ul>
  );
}

/** A team's faces, lead first, overlapping a little. */
function TeamFaces({ faces = [], style, size = "size-7", max = 4 }) {
  const shown = faces.slice(0, max);
  return (
    <span className="flex shrink-0 -space-x-2" aria-hidden="true">
      {shown.map((bird, index) => <BirdFace key={`${bird}-${index}`} bird={bird} style={style} size={cn(size, "ring-2 ring-background")} />)}
    </span>
  );
}

function ListingFace({ listing, style, size = "size-9" }) {
  if (listing?.kind === "team") return <TeamFaces faces={listing.faces?.length ? listing.faces : [listing.bird]} style={style} size={size === "size-9" ? "size-6" : size} max={2} />;
  return <BirdFace bird={listing?.bird} style={style} size={size} />;
}

/**
 * The first screen: Featured (the admins' order, agents and teams), Teams,
 * then each category's first agents with View all. Typographic sections
 * with whitespace between them; no cards, no tinted panels.
 */
function Home({ home, error, copy, avatarStyle, stateById, onRetry, onOpen, onViewAll }) {
  if (!home) {
    return error ? (
      <p className="flex items-center gap-2 pt-6 text-sm text-muted-foreground" role="alert" data-testid="marketplace-home-error">
        {error}
        <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={onRetry}>{copy.retry || "Retry"}</button>
      </p>
    ) : (
      <div className="pt-6" data-testid="marketplace-home-loading">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="flex flex-col gap-2"><Skeleton className="size-14 rounded-full" /><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-4/5" /></div>)}
        </div>
        <SkeletonRows count={4} />
      </div>
    );
  }
  return (
    <div className="flex flex-col" data-testid="marketplace-home">
      {home.offline ? <OfflineNote copy={copy} fetchedAt={home.fetchedAt} onRetry={onRetry} /> : null}
      {home.featured?.length ? (
        <section className="pt-6" aria-labelledby="marketplace-featured">
          <h3 id="marketplace-featured" className="pb-3 text-base font-semibold">{copy.marketplaceFeatured || "Featured"}</h3>
          <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible" data-testid="marketplace-featured">
            {home.featured.slice(0, 8).map((listing) => (
              <li key={listing.id} className="w-40 shrink-0 snap-start sm:w-auto">
                <button type="button" onClick={() => onOpen(listing, "featured")} className="group flex h-full w-full flex-col items-start gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
                  {listing.kind === "team"
                    ? <span className="flex h-14 items-center"><TeamFaces faces={listing.faces?.length ? listing.faces : [listing.bird]} style={avatarStyle} size="size-10" max={4} /></span>
                    : <BirdFace bird={listing.bird} style={avatarStyle} size="size-14" />}
                  <span className="w-full min-w-0">
                    <span className="block truncate font-medium">{listing.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{subtitle(listing, copy)}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground/90">{listing.tagline}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {home.teams?.length ? (
        <HomeSection id="teams" label={copy.marketplaceTeams || "Teams"} count={home.teamsTotal} note={copy.marketplaceTeamsNote || "Several members set up to work together, with their skills and a shared channel."} copy={copy} onViewAll={onViewAll}>
          {home.teams.slice(0, 4).map((listing) => <ListingRow key={listing.id} agent={listing} copy={copy} avatarStyle={avatarStyle} receipt={stateById.get(listing.id)} onOpen={() => onOpen(listing, "section")} />)}
        </HomeSection>
      ) : null}

      {(home.sections || []).filter((section) => section.agents?.length).map((section) => (
        <HomeSection key={section.id} id={section.id} label={section.label} count={section.count} copy={copy} onViewAll={onViewAll}>
          {section.agents.slice(0, 4).map((listing) => <ListingRow key={listing.id} agent={listing} copy={copy} avatarStyle={avatarStyle} receipt={stateById.get(listing.id)} onOpen={() => onOpen(listing, "section")} />)}
        </HomeSection>
      ))}
    </div>
  );
}

function HomeSection({ id, label, count, note = "", copy, onViewAll, children }) {
  return (
    <section className="pt-8" aria-labelledby={`marketplace-section-${id}`} data-testid={`marketplace-section-${id}`}>
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h3 id={`marketplace-section-${id}`} className="text-base font-semibold">{label}<span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{count}</span></h3>
        <button type="button" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => onViewAll(id)} data-testid={`marketplace-view-all-${id}`}>
          {(copy.marketplaceViewAll || "View all {n}").replace("{n}", String(count ?? ""))}
        </button>
      </div>
      {note ? <p className="pb-1 text-xs text-muted-foreground">{note}</p> : null}
      <ul className="grid gap-x-8 sm:grid-cols-2">{children}</ul>
    </section>
  );
}

function ListingRow({ agent, copy, avatarStyle, receipt, onOpen }) {
  const state = !receipt ? "" : receipt.contentHash && receipt.contentHash !== agent.contentHash ? "update" : "added";
  const meta = [subtitle(agent, copy), agent.categoryLabel, (copy.addedOn || "Added {date}").replace("{date}", addedDate(agent.createdAt)), agent.installsLabel ? (copy.marketplaceInstalls || "{n} installs").replace("{n}", agent.installsLabel) : ""].filter(Boolean).join(" · ");
  return (
    <li className="min-w-0" data-state={state || "new"} data-kind={agent.kind || "agent"}>
      <button type="button" onClick={onOpen} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none" aria-label={`${copy.view || "View"} ${agent.name}`}>
        <span className="flex w-10 shrink-0 justify-start pt-0.5"><ListingFace listing={agent} style={avatarStyle} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate"><span className="font-medium">{agent.name}</span><span className="text-muted-foreground"> {copy.by || "by"} {agent.creator?.name}</span></span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{agent.tagline}</span>
          <span className="block truncate pt-0.5 text-xs text-muted-foreground/80">{meta}</span>
          {state ? (
            <span className={cn("flex min-w-0 items-center gap-1 pt-0.5 text-xs", state === "update" ? "text-foreground" : "text-muted-foreground")} data-testid="marketplace-row-state">
              {state === "update" ? <RotateCw className="size-3 shrink-0" aria-hidden="true" /> : <Check className="size-3 shrink-0" aria-hidden="true" />}
              <span className="truncate">{state === "update" ? copy.updateAvailable || "Update available" : (copy.inYourSquad || "Added as {name}").replace("{name}", receipt.memberName || "")}</span>
            </span>
          ) : null}
        </span>
      </button>
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
          recordMarketplaceEvent("marketplace_listing_viewed", { listing_id: entry.id, listing_kind: data.agent?.kind, version: data.agent?.version, source: entry.via });
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

  const listing = grok ? null : detail?.agent || (entry.listing && typeof entry.listing === "object" ? entry.listing : null);
  const team = !grok && (listing?.kind === "team" || entry.listingKind === "team");
  const member = template?.document?.members?.[0];
  const name = grok ? template?.bot?.name : listing?.name;
  const existing = (grok ? template?.existing || [] : receipts).map((receipt) => ({ ...receipt, member: agents.find((agent) => agent.id === receipt.memberId) })).filter((receipt) => receipt.member);
  const latest = existing.at(-1);
  const upToDate = latest && latest.contentHash && latest.contentHash === (grok ? template?.contentHash : listing?.contentHash);
  const staleLink = Boolean(!grok && entry.sha256 && !entry.version && listing && listing.contentHash !== entry.sha256);

  async function add(mode = "add") {
    setBusy(mode);
    setError("");
    const funnel = { listing_id: grok ? undefined : entry.id, listing_kind: team ? "team" : "agent", version: listing?.version, source: entry.via || (grok ? "grok" : "in-app"), attribution_id: entry.attribution };
    recordMarketplaceEvent("marketplace_add_started", funnel);
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
        kind: team ? "team" : "agent",
        via: grok ? "link" : entry.via || "in-app",
        ...(entry.attribution ? { attribution: entry.attribution } : {}),
      };
      let added = null;
      if (mode === "update" && latest) await onUpdate?.({ document: fresh.document, receipt: { ...receipt, memberId: latest.memberId, action: "update" } });
      else added = await onAdd?.({ document: fresh.document, receipt });
      recordMarketplaceEvent("marketplace_add_succeeded", { ...funnel, version: fresh.version || funnel.version, action: mode === "update" ? "update" : latest ? "another" : "add", members: added?.members || fresh.document?.members?.length || 1 });
      onDone();
    } catch (failure) {
      const message = errorText(failure, "Nothing was added.");
      recordMarketplaceEvent("marketplace_add_failed", { ...funnel, reason: failureReason(message) });
      setError(message);
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
          {team && listing ? <TeamFaces faces={listing.faces?.length ? listing.faces : [listing.bird]} style={avatarStyle} size="size-9" max={5} /> : <BirdFace bird={grok ? "kea" : listing?.bird} style={avatarStyle} size="size-11" />}
          <div className="min-w-0">
            <DialogTitle className="truncate">{name || (error ? copy.marketplaceUnavailable || "Agent unavailable" : copy.loading || "Loading…")}</DialogTitle>
            <DialogDescription className="truncate">
              {grok
                ? template ? `${copy.grokTemplateBy || "Grok Bot template by"} ${template.creator}` : ""
                : listing ? `${subtitle(listing, copy)} · ${copy.by || "by"} ${listing.creator?.name}` : ""}
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

        {team && detail?.preview?.members?.length ? (
          <>
            <h3 className="pt-5 pb-1.5 text-sm font-semibold">{copy.marketplaceMembers || "Members"}<span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{detail.preview.members.length}</span></h3>
            <ul className="grid gap-x-8 sm:grid-cols-2" data-testid="marketplace-team-members">
              {detail.preview.members.map((teammate) => (
                <li key={teammate.name} className="flex items-start gap-3 py-2">
                  <BirdFace bird={teammate.bird} style={avatarStyle} size="size-8 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block truncate"><span className="font-medium">{teammate.name}</span>{teammate.lead ? <span className="ml-1.5 text-xs text-muted-foreground">{copy.marketplaceLead || "Lead"}</span> : null}</span>
                    <span className="block truncate text-xs text-muted-foreground">{teammate.role}</span>
                    {teammate.skills?.length ? <span className="block truncate font-mono text-[11px] text-muted-foreground/80">{teammate.skills.join(", ")}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {detail.preview.channels?.length ? (
              <p className="pt-3 text-xs text-muted-foreground">
                {(copy.marketplaceChannels || "Channels: {list}").replace("{list}", detail.preview.channels.map((channel) => `#${channel.name} (${channel.members})`).join(", "))}
              </p>
            ) : null}
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
        <p className="pt-4 text-xs text-muted-foreground">
          {team
            ? copy.marketplaceTeamArrives || "Every member joins on the Ask level with skills switched off, and the team's channels are created among them. No routines or connectors come with it, and nothing runs until you message someone."
            : copy.marketplaceArrives || "It joins as a new member on the Ask level with its skills switched off. Nothing runs until you message it."}
        </p>
        {thirdParty ? (
          <p className="pt-2 text-xs text-muted-foreground" data-testid="marketplace-third-party">
            {(grok ? copy.grokThirdParty || "Made by {creator} on Grok Bot, not by Autohand. Read its instructions before you add it." : copy.marketplaceThirdParty || "Published by {creator}, not by Autohand. Read its instructions before you add it.").replace("{creator}", grok ? template?.creator || "" : listing?.creator?.name || "")}
          </p>
        ) : listing?.creator?.name === AUTOHAND_CREATOR_NAME ? (
          <p className="pt-2 text-xs text-muted-foreground">{copy.marketplaceByAutohand || "Written and checked by the Autohand Squad team."}</p>
        ) : null}

        {latest ? (
          <p className="pt-4 text-xs" role="status" data-testid="marketplace-existing">
            {(team ? copy.marketplaceTeamAlready || "This team is already in your squad, led by {name}. Adding it again adds a second copy with numbered names." : upToDate ? copy.marketplaceAlreadyCurrent || "Already in your squad as {name}, at this version." : copy.marketplaceAlready || "Already in your squad as {name}. Update it to this version, or add another copy.").replace("{name}", latest.member.name)}
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
        {latest && !upToDate && !team ? <Button variant="outline" disabled={Boolean(busy) || (!listing && !grok) || staleLink} onClick={() => void add("update")} data-testid="marketplace-update">{busy === "update" ? copy.updating || "Updating…" : (copy.updateMember || "Update {name}").replace("{name}", latest.member.name)}</Button> : null}
        <Button disabled={Boolean(busy) || (!listing && !(grok && template)) || staleLink} onClick={() => void add("add")} data-testid="marketplace-add">
          {busy === "add" ? <><RotateCw data-icon="inline-start" className="animate-spin" />{copy.adding || "Adding…"}</> : latest ? copy.addAnother || "Add another" : team ? copy.addTeamToSquad || "Add team to squad" : copy.addToSquad || "Add to squad"}
        </Button>
      </DialogFooter>
    </>
  );
}
