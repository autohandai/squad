import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Inbox, LayoutGrid, Settings } from "lucide-react";

import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SearchResults } from "@/components/search/SearchResults";
import { groupResults, mergeResults, pushRecentSearch, readRecentSearches, typeCounts } from "@/lib/search-results";

const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 60;
const LOCAL_MESSAGE_HITS = 8;

function memberChatRoute(memberId) {
  return `/conversations/new?member=${encodeURIComponent(memberId)}`;
}

function channelRoute(channelId) {
  return `/channels/${encodeURIComponent(channelId)}`;
}

/** Snippet around the first hit, with the hit wrapped in <mark> for `snippetSegments()`. */
function excerpt(text, needle, size = 120) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const index = body.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return body.slice(0, size);
  const start = index <= 24 ? 0 : index - 24;
  const window = body.slice(start, start + size);
  const local = index - start;
  const marked = `${window.slice(0, local)}<mark>${window.slice(local, local + needle.length)}</mark>${window.slice(local + needle.length)}`;
  return `${start > 0 ? "…" : ""}${marked}${start + size < body.length ? "…" : ""}`;
}

/** Wrap the matched part of a label in <mark>, or return it untouched. */
function markLabel(label, needle) {
  const text = String(label || "");
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0 || !needle) return text;
  return `${text.slice(0, index)}<mark>${text.slice(index, index + needle.length)}</mark>${text.slice(index + needle.length)}`;
}

/**
 * ⌘K palette across members, channels, pages, and every record the bridge
 * indexes (messages, runs, tasks, handoffs, canvases). In-memory matches
 * (members, channels, browser-held messages) merge with the bridge results;
 * `SearchResults` renders the grouped list and owns ↑/↓/Enter while a query
 * is typed. `onOpenChange` is controlled by the shell so the sidebar button
 * and the keyboard shortcut share one state.
 */
export function SearchCommand({
  open,
  onOpenChange,
  agents = [],
  channels = [],
  messagesByChannel = {},
  messagesByAgent = {},
  copy = {},
  onNavigate = {},
  api,
}) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState("");
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState([]);
  const requestRef = useRef(0);

  useEffect(() => {
    if (open) {
      setRecent(readRecentSearches());
      return;
    }
    setQuery("");
    setActiveType("");
    setRemote([]);
    setLoading(false);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      onOpenChange?.(!open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  // Bridge search: debounced, minimum two characters, latest response wins.
  useEffect(() => {
    if (!open || typeof api !== "function" || trimmed.length < SEARCH_MIN_CHARS) {
      requestRef.current += 1;
      setRemote([]);
      setLoading(false);
      return undefined;
    }
    const request = ++requestRef.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(trimmed)}${activeType ? `&types=${encodeURIComponent(activeType)}` : ""}&limit=${SEARCH_LIMIT}`);
        if (request !== requestRef.current) return;
        setRemote(Array.isArray(data?.results) ? data.results : []);
      } catch {
        if (request !== requestRef.current) return;
        setRemote([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, api, trimmed, activeType]);

  const local = useMemo(() => {
    if (!searching) return [];
    const needle = trimmed.toLowerCase();
    const docs = [];
    for (const channel of channels) {
      if (!channel?.id || !String(channel.name || "").toLowerCase().includes(needle)) continue;
      docs.push({ id: `channel:${channel.id}`, type: "channel", title: markLabel(`#${channel.name}`, needle), channelId: channel.id, route: channelRoute(channel.id), at: channel.updatedAt });
    }
    for (const agent of agents) {
      const haystack = `${agent?.name || ""} ${agent?.role || ""}`.toLowerCase();
      if (!agent?.id || !haystack.includes(needle)) continue;
      docs.push({ id: `member:${agent.id}`, type: "member", title: markLabel(agent.name, needle), snippet: markLabel(agent.role || "", needle), memberId: agent.id, route: memberChatRoute(agent.id), at: agent.updatedAt });
    }
    if (needle.length >= SEARCH_MIN_CHARS) {
      let hits = 0;
      for (const [channelId, list] of Object.entries(messagesByChannel)) {
        const channel = channels.find((item) => item.id === channelId);
        for (const message of Array.isArray(list) ? list : []) {
          if (hits >= LOCAL_MESSAGE_HITS) break;
          if (!message?.id || message.status === "loading" || !String(message.body || "").toLowerCase().includes(needle)) continue;
          hits += 1;
          docs.push({
            id: `message:${message.id}`,
            type: "message",
            title: channel ? `#${channel.name}` : copy.channels || "Channel",
            snippet: excerpt(message.body, trimmed),
            channelId,
            route: `${channelRoute(channelId)}?message=${encodeURIComponent(message.id)}`,
            at: message.createdAt || message.completedAt,
          });
        }
      }
      for (const [agentId, list] of Object.entries(messagesByAgent)) {
        const agent = agents.find((item) => item.id === agentId);
        for (const message of Array.isArray(list) ? list : []) {
          if (hits >= LOCAL_MESSAGE_HITS) break;
          if (!message?.id || message.id === "m1" || message.status === "loading" || !String(message.body || "").toLowerCase().includes(needle)) continue;
          hits += 1;
          docs.push({
            id: `message:${message.id}`,
            type: "message",
            title: agent?.name || copy.directMessages || "Direct message",
            snippet: excerpt(message.body, trimmed),
            memberId: agentId,
            route: `${memberChatRoute(agentId)}&message=${encodeURIComponent(message.id)}`,
            at: message.createdAt || message.completedAt,
          });
        }
      }
    }
    return docs;
  }, [searching, trimmed, channels, agents, messagesByChannel, messagesByAgent, copy]);

  const results = useMemo(() => mergeResults(remote, local), [remote, local]);
  const groups = useMemo(() => groupResults(results, { activeType, perType: 6 }), [results, activeType]);
  const counts = useMemo(() => typeCounts(results), [results]);

  const pages = [
    { id: "inbox", label: copy.inbox || "Inbox", icon: Inbox, value: "page inbox", go: onNavigate.inbox },
    { id: "agents", label: copy.agents || "Agents", icon: Bot, value: "page agents squad directory", go: onNavigate.agents },
    { id: "mission-control", label: "Mission Control", icon: LayoutGrid, value: "page mission control", go: onNavigate.missionControl },
    { id: "settings", label: copy.settings || "Settings", icon: Settings, value: "page settings", go: onNavigate.settings },
  ];
  const pageMatches = searching ? pages.filter((page) => page.label.toLowerCase().includes(trimmed.toLowerCase())) : pages;

  function go(action) {
    onOpenChange?.(false);
    action?.();
  }

  function selectResult(item) {
    if (!item?.route) return;
    setRecent(pushRecentSearch(trimmed));
    onOpenChange?.(false);
    if (typeof onNavigate.route === "function") onNavigate.route(item.route);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.searchEverything || "Search everything"}
      description={copy.searchHint || "Search messages, channels, members, runs, tasks, and handoffs."}
    >
      <CommandInput placeholder={copy.searchEverything || "Search everything"} value={query} onValueChange={setQuery} />
      {pageMatches.length ? (
        <CommandList className={searching ? "max-h-40 border-b border-border/70" : "max-h-60"}>
          <CommandGroup heading={copy.pages || "Pages"}>
            {pageMatches.map((page) => (
              <CommandItem key={page.id} value={page.value} onSelect={() => go(page.go)}>
                <page.icon />
                {page.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      ) : null}
      {/* With an empty query cmdk owns ↑/↓/Enter for the pages, so the recent rows are mouse-only and carry no cursor fill. */}
      <div className={searching ? "max-h-[360px] overflow-y-auto overflow-x-hidden" : "max-h-[360px] overflow-y-auto overflow-x-hidden [&_[role=option][data-active=true]]:bg-transparent [&_[role=option][data-active=true]]:hover:bg-muted/40"}>
        <SearchResults
          query={query}
          groups={groups}
          counts={counts}
          activeType={activeType}
          onTypeChange={setActiveType}
          loading={loading}
          recent={recent}
          onRecentSelect={(value) => setQuery(value)}
          onSelect={selectResult}
          keyboard={searching}
          copy={copy}
        />
      </div>
    </CommandDialog>
  );
}
