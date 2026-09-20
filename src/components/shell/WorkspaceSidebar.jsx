import { useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Hash, Inbox, Lock, PanelLeftClose, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const DEFAULT_CHANNEL_SECTION = "Channels";

function sectionOf(channel) {
  const value = String(channel?.section || "").trim();
  return value || DEFAULT_CHANNEL_SECTION;
}

function UnreadCount({ count }) {
  if (!count) return null;
  return (
    <span
      className="grid min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-5 text-background"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function UnreadDot({ active }) {
  if (!active) return null;
  return <span className="size-1.5 rounded-full bg-foreground" aria-label="unread" />;
}

function NavRow({ active, unread, icon: Icon, label, onClick, trailing, avatar, bold = false, ariaLabel }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
        active ? "bg-muted/80 text-foreground" : "text-foreground/85 hover:bg-muted/55 hover:text-foreground",
        (unread || bold) && !active && "font-semibold text-foreground"
      )}
      onClick={onClick}
    >
      {avatar ? <span className="relative flex size-5 shrink-0 items-center justify-center">{avatar}</span> : null}
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function SectionHeader({ label, expanded, onToggle, action }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="mt-4 flex items-center gap-1 px-1">
      <button
        type="button"
        className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Chevron className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </button>
      {action}
    </div>
  );
}

/**
 * Buzz-style workspace sidebar: search, Inbox, Agents, grouped channel
 * sections, direct messages (members), account footer. Purely presentational;
 * all data and navigation come from props so App.jsx stays the source of truth.
 */
export function WorkspaceSidebar({
  brand,
  copy = {},
  agents = [],
  channels = [],
  active = { kind: "", id: "" },
  unreadChannelIds = new Set(),
  unreadCountByAgent = new Map(),
  inboxCount = 0,
  presenceFor,
  renderAvatar,
  onNavigate = {},
  footer,
  onCollapse,
  searchShortcutLabel = "⌘K",
}) {
  const visibleAgents = agents.filter((agent) => agent?.id && agent?.name);
  const sections = useMemo(() => {
    const groups = new Map();
    for (const channel of channels) {
      const name = sectionOf(channel);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(channel);
    }
    return Array.from(groups.entries());
  }, [channels]);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [dmsExpanded, setDmsExpanded] = useState(true);

  function toggleSection(name) {
    setCollapsedSections((current) => ({ ...current, [name]: !current[name] }));
  }

  return (
    <div className="flex h-full min-h-screen flex-col bg-card/70">
      <div className="flex h-14 items-center gap-2 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">{brand}</div>
        {onCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Collapse sidebar" aria-keyshortcuts="Meta+B Control+B">
                <PanelLeftClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="px-3">
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          onClick={onNavigate.search}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{copy.searchEverything || "Search everything"}</span>
          <kbd className="rounded border border-border/70 px-1 text-[10px] font-medium text-muted-foreground">{searchShortcutLabel}</kbd>
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 pb-3 pt-3">
        <nav className="flex flex-col gap-0.5" aria-label="Workspace">
          <NavRow
            icon={Inbox}
            label={copy.inbox || "Inbox"}
            active={active.kind === "inbox"}
            onClick={onNavigate.inbox}
            trailing={<UnreadCount count={inboxCount} />}
          />
          <NavRow
            icon={Bot}
            label={copy.agents || "Agents"}
            active={active.kind === "agents"}
            onClick={onNavigate.agents}
            trailing={<span className="text-xs text-muted-foreground">{visibleAgents.length}</span>}
          />
        </nav>

        {sections.length === 0 ? (
          <div>
            <SectionHeader
              label={copy.channels || DEFAULT_CHANNEL_SECTION}
              expanded
              onToggle={() => {}}
              action={
                <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createChannel || "Create channel"} onClick={onNavigate.createChannel}>
                  <Plus className="size-3.5" />
                </Button>
              }
            />
            <p className="px-2 py-1 text-xs text-muted-foreground">{copy.channelNoChannels || "No channels yet."}</p>
          </div>
        ) : (
          sections.map(([name, sectionChannels], index) => {
            const expanded = !collapsedSections[name];
            return (
              <div key={name}>
                <SectionHeader
                  label={name}
                  expanded={expanded}
                  onToggle={() => toggleSection(name)}
                  action={
                    index === sections.length - 1 ? (
                      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createChannel || "Create channel"} onClick={onNavigate.createChannel}>
                        <Plus className="size-3.5" />
                      </Button>
                    ) : null
                  }
                />
                {expanded ? (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {sectionChannels.map((channel) => {
                      const isActive = active.kind === "channel" && active.id === channel.id;
                      const unread = unreadChannelIds.has(channel.id);
                      return (
                        <NavRow
                          key={channel.id}
                          icon={channel.visibility === "private" ? Lock : Hash}
                          label={channel.name}
                          active={isActive}
                          unread={unread}
                          onClick={() => onNavigate.channel?.(channel.id)}
                          trailing={<UnreadDot active={unread && !isActive} />}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        <SectionHeader
          label={copy.directMessages || "Direct messages"}
          expanded={dmsExpanded}
          onToggle={() => setDmsExpanded((open) => !open)}
          action={
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createSquadMember || "Create member"} onClick={onNavigate.createMember}>
              <Plus className="size-3.5" />
            </Button>
          }
        />
        {dmsExpanded ? (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {visibleAgents.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">{copy.noMembersYet || "No members yet."}</p>
            ) : (
              visibleAgents.map((agent) => {
                const isActive = active.kind === "member" && active.id === agent.id;
                const unread = unreadCountByAgent.get(agent.id) || 0;
                const presence = presenceFor?.(agent);
                return (
                  <NavRow
                    key={agent.id}
                    label={agent.name}
                    active={isActive}
                    unread={unread > 0}
                    ariaLabel={presence ? `${agent.name}, ${presence.label}` : agent.name}
                    onClick={() => onNavigate.member?.(agent.id)}
                    avatar={
                      <>
                        {renderAvatar ? renderAvatar(agent, "size-5 rounded-md") : null}
                        {presence ? (
                          <span
                            className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card", presence.className)}
                            aria-hidden="true"
                          />
                        ) : null}
                      </>
                    }
                    trailing={<UnreadCount count={isActive ? 0 : unread} />}
                  />
                );
              })
            )}
          </div>
        ) : null}
      </ScrollArea>

      {footer}
    </div>
  );
}
