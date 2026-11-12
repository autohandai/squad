import { ownedLocalStorage } from "@/lib/owned-storage";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Bot, Brain, CheckCheck, ChevronDown, ChevronRight, Hash, Inbox, Lock, PanelLeft, Pencil, Pin, Plus, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateMenu } from "@/components/teams/CreateMenu";
import { cn } from "@/lib/utils";
import { isGroupChat } from "@/lib/group-chats";
import { channelNotificationPreference } from "@/lib/channel-notifications";
import { ChannelActions } from "@/components/channels/ChannelActions";
import { conversationPreview } from "@/lib/conversation-preview";

export const DEFAULT_CHANNEL_SECTION = "Channels";

const FOLDS_KEY = "autohandSquad.v1.sidebarFolds";
function readFolds() {
  try { return JSON.parse(ownedLocalStorage.getItem(FOLDS_KEY) || "{}") || {}; } catch { return {}; }
}

function sectionOf(channel) {
  const value = String(channel?.section || "").trim();
  return value || DEFAULT_CHANNEL_SECTION;
}

function UnreadCount({ count, testId }) {
  if (!count) return null;
  return (
    <span
      data-testid={testId}
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
function NavRow({ active, unread, icon: Icon, label, onClick, trailing, avatar, bold = false, ariaLabel, menu, tooltip, preview, pinned = false }) {
  const button = (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
        preview && "grid h-auto min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 rounded-lg py-3",
        active ? "bg-muted/80 text-foreground" : "text-foreground/85 hover:bg-muted/55 hover:text-foreground",
        (unread || bold) && !active && "font-semibold text-foreground"
      )}
      onClick={onClick}
    >
      {avatar ? <span className={cn("relative flex shrink-0 items-center justify-center", preview ? "size-10" : "size-5")}>{avatar}</span> : null}
      {Icon ? <span className={cn("shrink-0 text-muted-foreground", preview && "grid size-10 place-items-center rounded-full bg-muted")}><Icon className={preview ? "size-5" : "size-4"} aria-hidden="true" /></span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex w-full min-w-0 items-baseline gap-2"><span className="flex min-w-0 flex-1 items-center gap-1"><span className="truncate">{label}</span>{pinned ? <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}</span>{preview?.time ? <time dateTime={preview.dateTime} className={cn("shrink-0 text-[11px] font-normal text-muted-foreground", menu && "group-hover/navrow:opacity-0 group-focus-within/navrow:opacity-0")}>{preview.time}</time> : null}</span>
        {preview ? <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{preview.text}</span> : null}
      </span>
      {preview ? <span className={cn("flex items-center gap-1 empty:hidden", menu && "group-hover/navrow:opacity-0 group-focus-within/navrow:opacity-0")}>{trailing}</span> : trailing}
    </button>
  );
  // The tooltip belongs to the row's button only: on the whole row it stayed
  // open over the row's own menu and covered its last item.
  const row = tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
  if (!menu) return row;
  return (
    <div className="group/navrow relative flex min-w-0 items-center">
      {row}
      <span className="absolute right-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/navrow:opacity-100 has-[[data-state=open]]:opacity-100">
        {menu}
      </span>
    </div>
  );
}

function SectionHeader({ label, expanded, onToggle, action, hiddenUnread = 0 }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="group/section mt-4 flex items-center gap-1 px-1">
      <button
        type="button"
        className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Chevron className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {/* A collapsed section still says something is waiting inside it. */}
        {!expanded && hiddenUnread ? <span className="ml-1 shrink-0 font-semibold text-foreground">{hiddenUnread} unread</span> : null}
      </button>
      {action}
    </div>
  );
}

/**
 * Workspace sidebar: search, Needs you, Squad, grouped channel
 * sections, direct messages (members), account footer. Purely presentational;
 * all data and navigation come from props so App.jsx stays the source of truth.
 */
export function WorkspaceSidebar({
  brand,
  copy = {},
  agents = [],
  channels = [],
  notificationSettings = {},
  onUpdateChannel,
  onDeleteChannel,
  onChannelNotificationChange,
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
  searchTrailing = null,
  workspaceSwitcher = null,
  renderMemberMenu = null,
  draftAgentIds = new Set(),
  conversationLayout = false,
  messagesByAgent = {},
  messagesByChannel = {},
  locale = 'en',
  inDrawer = false,
}) {
  const visibleAgents = useMemo(() => agents.filter((agent) => agent?.id && agent?.name), [agents]);
  // Compute each retained preview once per source change, shared by ordering
  // and rendering rather than rescanning history for both.
  const memberPreviews = useMemo(() => conversationLayout ? new Map(visibleAgents.map(agent => [agent.id,
    conversationPreview(messagesByAgent[agent.id], { fallback: agent.role || 'No messages yet', locale, you: copy.you })])) : new Map(), [conversationLayout, visibleAgents, messagesByAgent, locale, copy.you]);
  const channelPreviews = useMemo(() => conversationLayout ? new Map(channels.map(channel => [channel.id,
    conversationPreview(messagesByChannel[channel.id], { fallback: channel.purpose || (isGroupChat(channel) ? 'Group chat' : 'Channel'), locale, you: copy.you })])) : new Map(), [conversationLayout, channels, messagesByChannel, locale, copy.you]);
  const sections = useMemo(() => {
    const groups = new Map();
    for (const channel of channels) {
      if (isGroupChat(channel) || channelNotificationPreference(notificationSettings, channel.id).hidden) continue;
      const name = sectionOf(channel);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(channel);
    }
    return Array.from(groups.entries());
  }, [channels, notificationSettings]);
  const groupChats = channels.filter(channel => isGroupChat(channel) && !channelNotificationPreference(notificationSettings, channel.id).hidden);
  const hiddenChannels = channels.filter(channel => channelNotificationPreference(notificationSettings, channel.id).hidden);
  // Which sections are folded is remembered: it reset on every reload.
  const [collapsedSections, setCollapsedSections] = useState(() => readFolds().sections || {});
  const [dmsExpanded, setDmsExpanded] = useState(() => readFolds().dms !== false);
  useEffect(() => {
    try { ownedLocalStorage.setItem(FOLDS_KEY, JSON.stringify({ sections: collapsedSections, dms: dmsExpanded })); } catch { /* storage may be off */ }
  }, [collapsedSections, dmsExpanded]);

  function toggleSection(name) {
    setCollapsedSections((current) => ({ ...current, [name]: !current[name] }));
  }

  function conversationRow(channel) {
    const group = isGroupChat(channel);
    const isActive = active.kind === "channel" && active.id === channel.id;
    const unread = unreadChannelIds.has(channel.id);
    const members = group ? visibleAgents.filter(agent => channel.memberIds.includes(agent.id)).slice(0, 2) : [];
    const preview = channelPreviews.get(channel.id);
    const row = (menu, mutedIcon) => <NavRow label={channel.name} ariaLabel={group ? `Group chat: ${channel.name}` : undefined} active={isActive} unread={unread}
      icon={group ? members.length && renderAvatar ? null : Users : channel.visibility === "private" ? Lock : Hash}
      avatar={members.length && renderAvatar ? <span className="flex -space-x-2">{members.map(agent => <span key={agent.id}>{renderAvatar(agent, conversationLayout ? "size-6 rounded-full ring-2 ring-card" : "size-4 rounded-sm ring-1 ring-card")}</span>)}</span> : null}
      preview={preview}
      onClick={() => onNavigate.channel?.(channel.id)} menu={menu} trailing={<>{mutedIcon}<UnreadDot active={unread && !isActive} /></>} />;
    return onUpdateChannel && onDeleteChannel && onChannelNotificationChange
      ? <ChannelActions key={channel.id} channel={channel} settings={notificationSettings} onRename={onUpdateChannel} onDelete={onDeleteChannel} onPreference={onChannelNotificationChange} renderRow={row} />
      : <div key={channel.id}>{row(null, null)}</div>;
  }

  function memberRow(agent) {
    const isActive = active.kind === 'member' && active.id === agent.id;
    const unread = unreadCountByAgent.get(agent.id) || 0, presence = presenceFor?.(agent);
    const retainedPreview = memberPreviews.get(agent.id);
    const preview = retainedPreview && presence?.working ? { ...retainedPreview, text: 'Working…' } : retainedPreview;
    return <NavRow key={agent.id} label={agent.name} pinned={agent.pinned === true} active={isActive} unread={unread > 0}
      ariaLabel={presence ? `${agent.name}, ${presence.label}` : agent.name} onClick={() => onNavigate.member?.(agent.id)} preview={preview}
      avatar={<>{renderAvatar?.(agent, conversationLayout ? 'size-10 rounded-full' : 'size-5 rounded-md')}{presence ? <span className={cn('absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card', conversationLayout ? 'size-2.5' : 'size-2', presence.className)} aria-hidden="true" /> : null}</>}
      trailing={!isActive && !unread && draftAgentIds.has(agent.id) ? <Pencil className="size-3 text-muted-foreground" aria-label="Unsent draft" /> : <UnreadCount count={isActive ? 0 : unread} />}
      menu={renderMemberMenu?.(agent)} tooltip={memberTooltip(agent, presence)} />;
  }
  const rows = useMemo(() => conversationLayout ? [
    ...visibleAgents.map(agent => ({ id: agent.id, kind: 'member', value: agent, pinned: agent.pinned === true, at: memberPreviews.get(agent.id).at })),
    ...channels.filter(channel => !channelNotificationPreference(notificationSettings, channel.id).hidden).map(channel => ({ id: channel.id, kind: 'channel', value: channel, at: channelPreviews.get(channel.id).at })),
  ].sort((a, b) => Boolean(b.pinned) - Boolean(a.pinned) || (a.pinned && b.pinned ? 0 : b.at - a.at)) : [], [conversationLayout, visibleAgents, channels, notificationSettings, memberPreviews, channelPreviews]);

  const hiddenSection = hiddenChannels.length ? <section aria-label="Hidden channels">
          <SectionHeader label={`Hidden channels · ${hiddenChannels.length}`} expanded={collapsedSections.__hiddenChannels === false} onToggle={() => setCollapsedSections(current => ({ ...current, __hiddenChannels: current.__hiddenChannels === false }))} />
          {collapsedSections.__hiddenChannels === false ? <div className="mt-0.5 flex flex-col gap-0.5">{hiddenChannels.map(conversationRow)}</div> : null}
        </section> : null;

  return (
    <div className="app-sidebar flex h-full min-h-screen flex-col bg-card/70" data-sidebar-layout={conversationLayout ? 'conversations' : 'workspace'}>
      {/* "deep" drags from anywhere in this row, not only a direct hit on the
        row itself, which is why the bare attribute used to work on the
        padding slivers alone. Buttons inside still block the drag and behave
        normally (tauri drag.js: a clickable element without the attribute
        returns false before the walk reaches this one). */}
    <div className={cn("flex h-14 items-center gap-2 px-3", inDrawer && "pr-12")} data-tauri-drag-region="deep">
        <div className="flex min-w-0 flex-1 items-center gap-2">{brand}</div>
        {conversationLayout && onNavigate.newMessage ? <Button variant="ghost" size="icon-sm" aria-label="New message" onClick={onNavigate.newMessage}><Plus /></Button> : null}
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
        {conversationLayout ? <>
          <nav className="mb-3 flex items-center gap-1" aria-label="Workspace">
            {[[Inbox, copy.needsYou || 'Needs you', onNavigate.inbox], [Bot, copy.squad || 'Squad', onNavigate.agents], [Brain, 'Memory', onNavigate.memory], [Hash, copy.createChannel || 'Create channel', onNavigate.createChannel]].map(([Icon, label, onClick]) => <Tooltip key={label}><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}><Icon />{Icon === Inbox && inboxCount ? <span className="size-1.5 rounded-full bg-foreground" aria-label={`${inboxCount} unread`} /> : null}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>)}
          </nav>
          <nav className="flex flex-col gap-1" aria-label="Conversations">
            {rows.map(row => <Fragment key={`${row.kind}:${row.id}`}>{row.kind === 'member' ? memberRow(row.value) : conversationRow(row.value)}</Fragment>)}
            {!rows.length ? <p className="px-2 py-4 text-sm text-muted-foreground">No conversations yet. Choose New message to begin.</p> : null}
          </nav>
          {hiddenSection}
        </> : <>
        <nav className="flex flex-col gap-0.5" aria-label="Workspace">
          <NavRow
            icon={Inbox}
            label={copy.needsYou || "Needs you"}
            active={active.kind === "work"}
            onClick={onNavigate.inbox}
            trailing={<UnreadCount count={inboxCount} testId="needs-you-count" />}
          />
          <NavRow
            icon={Bot}
            label={copy.squad || "Squad"}
            active={active.kind === "agents"}
            onClick={onNavigate.agents}
            trailing={<span className="text-xs text-muted-foreground">{visibleAgents.length}</span>}
          />
          <NavRow icon={Brain} label="Memory" active={active.kind === "memory"} onClick={onNavigate.memory} />
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
            <p className="px-2 py-1 text-xs text-muted-foreground">{hiddenChannels.length ? "Channels are hidden. Open Hidden channels below to show them." : copy.channelNoChannels || "No channels yet."}</p>
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
                  hiddenUnread={sectionChannels.filter((channel) => unreadChannelIds.has(channel.id)).length}
                  action={
                    <>
                      {/* Mark the whole section read, without opening each channel. */}
                      {onNavigate.markChannelsRead && sectionChannels.some((channel) => unreadChannelIds.has(channel.id)) ? (
                        <Button variant="ghost" size="icon-sm" className="size-6 opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100" aria-label={`Mark ${name} read`} title={`Mark ${name} read`} onClick={() => onNavigate.markChannelsRead(sectionChannels.map((channel) => channel.id))}>
                          <CheckCheck className="size-3.5" />
                        </Button>
                      ) : null}
                      {index === sections.length - 1 ? (
                        <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createChannel || "Create channel"} onClick={onNavigate.createChannel}>
                          <Plus className="size-3.5" />
                        </Button>
                      ) : null}
                    </>
                  }
                />
                {expanded ? (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {sectionChannels.map(conversationRow)}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        {hiddenSection}

        <SectionHeader
          label={copy.directMessages || "Direct messages"}
          expanded={dmsExpanded}
          onToggle={() => setDmsExpanded((open) => !open)}
          hiddenUnread={visibleAgents.filter((agent) => (unreadCountByAgent.get(agent.id) || 0) > 0).length}
          action={
            onNavigate.newMessage ? <Button variant="ghost" size="icon-sm" className="size-6" aria-label="New message" onClick={onNavigate.newMessage}><Plus className="size-3.5" /></Button> : onNavigate.createTeam || onNavigate.templates ? (
              // The same plus, now a short menu: Chat with a new member (ADR-0126),
              // New member, New team…, Templates… (ADR-0118).
              <CreateMenu
                copy={copy}
                onChatNewMember={onNavigate.chatNewMember}
                onNewMember={onNavigate.createMember}
                onNewTeam={onNavigate.createTeam}
                onTemplates={onNavigate.templates}
                trigger={
                  <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.addMemberLabel || "Add a member or team"}>
                    <Plus className="size-3.5" />
                  </Button>
                }
              />
            ) : (
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label={copy.createSquadMember || "Create member"} onClick={onNavigate.createMember}>
                <Plus className="size-3.5" />
              </Button>
            )
          }
        />
        {dmsExpanded ? (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {groupChats.map(conversationRow)}
            {visibleAgents.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">{copy.noMembersYet || "No members yet."}</p>
            ) : (
              visibleAgents.map(memberRow)
            )}
          </div>
        ) : null}
        </>}
      </ScrollArea>

      {footer}
    </div>
  );
}
