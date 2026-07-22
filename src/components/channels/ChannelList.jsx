import { useState } from "react";
import { Globe, Hash, Lock, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const VISIBILITY_OPTIONS = [
  { id: "public", icon: Globe, labelKey: "channelPublic", detailKey: "channelPublicDetail" },
  { id: "private", icon: Lock, labelKey: "channelPrivate", detailKey: "channelPrivateDetail" },
];

function formatCount(template, count) {
  return String(template || "{count}").replace("{count}", String(count));
}

export function ChannelList({
  channels = [],
  agents = [],
  activeChannelId = "",
  threadCounts = {},
  copy,
  onSelectChannel,
  onCreateChannel,
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftVisibility, setDraftVisibility] = useState("public");
  const [draftMemberIds, setDraftMemberIds] = useState([]);
  const [draftAutoMode, setDraftAutoMode] = useState(false);

  function resetDraft() {
    setDraftName("");
    setDraftVisibility("public");
    setDraftMemberIds([]);
    setDraftAutoMode(false);
  }

  function toggleDraftMember(agentId) {
    setDraftMemberIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]
    );
  }

  function submitCreate(event) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    onCreateChannel?.({
      name,
      visibility: draftVisibility,
      memberIds: draftMemberIds,
      autoModeDefault: draftAutoMode === true,
    });
    resetDraft();
    setCreateOpen(false);
  }

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-sm font-medium text-muted-foreground">{copy.channels}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.createChannel}
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
        </Button>
      </div>

      {channels.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">{copy.channelNoChannels}</p>
      ) : (
        <div className="flex flex-col">
          {channels.map((channel) => {
            const isActive = channel.id === activeChannelId;
            const threadCount = threadCounts[channel.id] || 0;
            return (
              <button
                key={channel.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  isActive ? "bg-muted/80 text-foreground" : "text-foreground/85 hover:bg-muted/55"
                )}
                onClick={() => onSelectChannel?.(channel.id)}
              >
                {channel.visibility === "private" ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={copy.channelPrivate} />
                ) : (
                  <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={copy.channelPublic} />
                )}
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                {threadCount > 0 ? (
                  <Badge variant="secondary" className="rounded-md px-1.5">
                    {threadCount}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetDraft();
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <form onSubmit={submitCreate} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{copy.createChannel}</DialogTitle>
              <DialogDescription>{copy.channelsDescription}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-name">{copy.channelName}</Label>
              <Input
                id="channel-name"
                value={draftName}
                placeholder={copy.channelNamePlaceholder}
                autoFocus
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{copy.channelVisibility}</Label>
              <div className="flex flex-col gap-1">
                {VISIBILITY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = draftVisibility === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                        selected ? "bg-muted/80" : "hover:bg-muted/45"
                      )}
                      onClick={() => setDraftVisibility(option.id)}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{copy[option.labelKey]}</span>
                        <span className="block text-xs text-muted-foreground">{copy[option.detailKey]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{copy.channelMembers}</Label>
              <p className="text-xs text-muted-foreground">{copy.channelMembersDetail}</p>
              <div className="flex flex-wrap gap-1.5">
                {agents.map((agent) => {
                  const selected = draftMemberIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-sm transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                      )}
                      onClick={() => toggleDraftMember(agent.id)}
                    >
                      {agent.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="channel-auto-mode">{copy.channelAutoMode}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{copy.channelAutoModeDetail}</p>
              </div>
              <Switch
                id="channel-auto-mode"
                checked={draftAutoMode}
                onCheckedChange={(checked) => setDraftAutoMode(checked === true)}
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={!draftName.trim()}>
                {copy.createChannel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function channelMemberSummary(channel, copy) {
  return formatCount(copy.channelMemberCount, channel?.memberIds?.length || 0);
}
