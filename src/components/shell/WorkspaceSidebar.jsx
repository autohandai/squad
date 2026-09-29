import { useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Hash, Inbox, Lock, Monitor, PanelLeft, Plus, Search } from "lucide-react";

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

// What a member does, and what it is doing. The role is the part a person
// cannot get from the row itself, so it leads; presence only follows when it
// says something beyond "online".
function memberTooltip(agent, presence) {
  const role = String(agent?.role || "").trim();
  const state = String(presence?.label || "").trim();
  if (!role) return state;
  return state && state.toLowerCase() !== "online" ? `${role} · ${state}` : role;
}

// `menu` renders beside the row rather than inside it: a row is a button, and
// a button cannot contain another button.
function NavRow({ active, unread, icon: Icon, label, onClick, trailing, avatar, bold = false, ariaLabel, menu, tooltip }) {
  const row = (
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
  const withMenu = menu ? (
    <div className="group/navrow relative flex min-w-0 items-center">
      {row}
      <span className="absolute right-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/navrow:opacity-100">
        {menu}
      </span>
    </div>
  ) : (
    row
  );
  if (!tooltip) return withMenu;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{withMenu}</TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
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
  workCount = 0,
  presenceFor,
  renderAvatar,
  onNavigate = {},
  footer,
  onCollapse,
  searchShortcutLabel = "⌘K",
  searchTrailing = null,
  workspaceSwitcher = null,
  renderMemberMenu = null,
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
    <div className="app-sidebar flex h-full min-h-screen flex-col bg-card/70">
      {/* "deep" drags from anywhere in this row, not only a direct hit on the
        row itself, which is why the bare attribute used to work on the
        padding slivers alone. Buttons inside still block the drag and behave
        normally (tauri drag.js: a clickable element without the attribute
        returns false before the walk reaches this one). */}
    <div className="flex h-14 items-center gap-2 px-3" data-tauri-drag-region="deep">
        <div className="flex min-w-0 flex-1 items-center gap-2">{brand}</div>
        {onCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Collapse sidebar" aria-keyshortcuts="Meta+B Control+B">
                <PanelLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse sidebar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {workspaceSwitcher ? <div className="flex min-w-0 items-center px-3 pb-2">{workspaceSwitcher}</div> : null}

      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          onClick={onNavigate.search}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{copy.searchEverything || "Search everything"}</span>
          <kbd className="rounded border border-border/70 px-1 text-[10px] font-medium text-muted-foreground">{searchShortcutLabel}</kbd>
        </button>
        {searchTrailing}
      </div>

      {/* No bottom padding: it sat outside the scroll viewport, so it stopped
          the list short of the divider and left a band of nothing above the
          account row. Without it a clipped row reads as "there is more below". */}
      <ScrollArea className="min-h-0 flex-1 px-3 pt-3">
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
            label={copy.squad || "Squad"}
            active={active.kind === "agents"}
            onClick={onNavigate.agents}
            trailing={<span className="text-xs text-muted-foreground">{visibleAgents.length}</span>}
          />
          {/* Work lists what the whole squad is doing and had no row here at
              all, so the only ways in were the command palette, the account
              menu and a link out of the Inbox. A primary surface needs a
              permanent place to stand. */}
          <NavRow
            icon={Monitor}
            label={copy.work || "Work"}
            active={active.kind === "work"}
            onClick={onNavigate.missionControl}
            trailing={workCount ? <span className="text-xs text-muted-foreground">{workCount}</span> : null}
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
                    menu={renderMemberMenu ? renderMemberMenu(agent) : null}
                    tooltip={memberTooltip(agent, presence)}
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
