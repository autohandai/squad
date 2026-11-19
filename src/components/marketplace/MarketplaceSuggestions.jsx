import { useEffect, useState } from "react";
import { BirdFace, TeamFaces } from "@/components/marketplace/MarketplaceDialog";

/**
 * "From the marketplace" under New member and New team (ADR-0261): up to four
 * listings that match what the person typed (the featured ones while it is
 * empty). Choosing one opens it on the Marketplace page, where Add works as
 * everywhere else. A marketplace that is unreachable or not live yet shows
 * nothing here; this is a suggestion, never a blocker.
 */
export function MarketplaceSuggestions({ api, query = "", kind = "agent", avatarStyle, onOpen, title, showClosed = false, onBrowse }) {
  const [items, setItems] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let live = true;
    const text = query.trim();
    const timer = setTimeout(async () => {
      try {
        let listings;
        if (text.length >= 3) {
          const params = new URLSearchParams({ limit: "4", kind, q: text.slice(0, 120) });
          listings = (await api(`/api/marketplace/agents?${params}`))?.agents || [];
        } else {
          const home = await api("/api/marketplace/home");
          listings = (kind === "team" ? home?.teams : home?.featured?.filter((item) => item.kind !== "team")) || [];
        }
        if (live) { setItems(listings.slice(0, 4)); setClosed(false); }
      } catch (error) {
        if (live) { setItems([]); setClosed(/isn't open yet/i.test(String(error?.message || ""))); }
      }
    }, text.length >= 3 ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [api, query, kind]);
  // Say plainly that the marketplace is not open yet instead of showing
  // nothing (ADR-0261; New message and New team too since ADR-0264).
  if (!items?.length) {
    if (!showClosed || !closed) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid={`marketplace-suggestions-${kind}-closed`}>
        {kind === "team" ? "Teams" : "Agents"} from the marketplace show here once it opens.{onBrowse ? <> <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={onBrowse}>Marketplace</button></> : null}
      </p>
    );
  }
  return (
    <section aria-labelledby={`marketplace-suggestions-${kind}`} data-testid={`marketplace-suggestions-${kind}`} className="space-y-1">
      <h3 id={`marketplace-suggestions-${kind}`} className="text-xs font-medium text-muted-foreground">
        {title || (query.trim().length >= 3 ? "From the marketplace" : kind === "team" ? "Ready-made teams" : "Featured in the marketplace")}
      </h3>
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen?.(item)} className="flex w-full items-center gap-3 py-2 text-left outline-none hover:bg-muted/30 focus-visible:bg-muted/40" data-testid="marketplace-suggestion">
              {item.kind === "team" ? <TeamFaces faces={item.faces?.length ? item.faces : [item.bird]} style={avatarStyle} size="size-6" max={3} /> : <BirdFace bird={item.bird} style={avatarStyle} size="size-8" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}{item.kind === "team" ? <span className="font-normal text-muted-foreground"> · {item.members} members</span> : item.role ? <span className="font-normal text-muted-foreground"> · {item.role}</span> : null}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.tagline}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">View</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
