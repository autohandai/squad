import { useEffect, useMemo, useState } from "react";
import { Bot, Hash, Inbox, LayoutGrid, Lock, MessageSquareText, Settings } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

function excerpt(text, query, size = 90) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const index = body.toLowerCase().indexOf(query.toLowerCase());
  if (index <= 24) return body.slice(0, size);
  return `…${body.slice(index - 24, index - 24 + size)}`;
}

/**
 * ⌘K palette across members, channels, pages, and recent messages.
 * `onOpenChange` is controlled by the shell so the sidebar button and the
 * keyboard shortcut share one state.
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
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
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

  const messageHits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const hits = [];
    for (const [channelId, list] of Object.entries(messagesByChannel)) {
      const channel = channels.find((item) => item.id === channelId);
      for (const message of Array.isArray(list) ? list : []) {
        if (String(message?.body || "").toLowerCase().includes(needle)) {
          hits.push({ id: `c-${message.id}`, kind: "channel", channelId, label: channel ? `#${channel.name}` : "channel", body: message.body });
        }
      }
    }
    for (const [agentId, list] of Object.entries(messagesByAgent)) {
      const agent = agents.find((item) => item.id === agentId);
      for (const message of Array.isArray(list) ? list : []) {
        if (String(message?.body || "").toLowerCase().includes(needle)) {
          hits.push({ id: `m-${message.id}`, kind: "member", agentId, label: agent?.name || "member", body: message.body });
        }
      }
    }
    return hits.slice(0, 8);
  }, [query, messagesByChannel, messagesByAgent, channels, agents]);

  function go(action) {
    onOpenChange?.(false);
    action?.();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={copy.searchEverything || "Search everything"} description="Jump to members, channels, pages, or messages">
      <CommandInput placeholder={copy.searchEverything || "Search everything"} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{copy.searchNoResults || "No results."}</CommandEmpty>
        <CommandGroup heading={copy.pages || "Pages"}>
          <CommandItem value="page inbox" onSelect={() => go(onNavigate.inbox)}>
            <Inbox />
            {copy.inbox || "Inbox"}
          </CommandItem>
          <CommandItem value="page agents squad directory" onSelect={() => go(onNavigate.agents)}>
            <Bot />
            {copy.agents || "Agents"}
          </CommandItem>
          <CommandItem value="page mission control" onSelect={() => go(onNavigate.missionControl)}>
            <LayoutGrid />
            Mission Control
          </CommandItem>
          <CommandItem value="page settings" onSelect={() => go(onNavigate.settings)}>
            <Settings />
            {copy.settings || "Settings"}
          </CommandItem>
        </CommandGroup>
        {channels.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={copy.channels || "Channels"}>
              {channels.map((channel) => (
                <CommandItem key={channel.id} value={`channel ${channel.name}`} onSelect={() => go(() => onNavigate.channel?.(channel.id))}>
                  {channel.visibility === "private" ? <Lock /> : <Hash />}
                  {channel.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {agents.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={copy.directMessages || "Direct messages"}>
              {agents.map((agent) => (
                <CommandItem key={agent.id} value={`member ${agent.name} ${agent.role || ""}`} onSelect={() => go(() => onNavigate.member?.(agent.id))}>
                  <Bot />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  {agent.role ? <span className="text-xs text-muted-foreground">{agent.role}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {messageHits.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={copy.messages || "Messages"}>
              {messageHits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`message ${hit.id} ${hit.body}`}
                  onSelect={() => go(() => (hit.kind === "channel" ? onNavigate.channel?.(hit.channelId) : onNavigate.member?.(hit.agentId)))}
                >
                  <MessageSquareText />
                  <span className="min-w-0 flex-1 truncate">{excerpt(hit.body, query)}</span>
                  <span className="text-xs text-muted-foreground">{hit.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
