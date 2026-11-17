import { useEffect, useState } from "react";
import { Check, ChevronDown, Plug, Smartphone } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { currentWorkspace } from "@/lib/workspaces";
import { phonePresence } from "@/components/settings/PairedPhones";

function StatusDot({ workspace }) {
  // A transparent placeholder rather than nothing, so every row's name
  // starts at the same x.
  if (workspace.kind === "local") return <span className="size-1.5 shrink-0" aria-hidden="true" />;
  const tone = !workspace.enabled ? "bg-muted-foreground/40" : workspace.connected ? "bg-emerald-500" : "bg-amber-500";
  return <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" />;
}

/**
 * Quiet workspace switcher for the sidebar header: the current workspace
 * name with a chevron, and a popover listing the local workspace plus the
 * relay workspace when one is configured. Purely presentational; the list
 * comes from `buildWorkspaceList` in src/lib/workspaces.js.
 */
export function WorkspaceSwitcher({ workspaces = [], selectedId, onSelect, onConnectRelay, onPairPhone, loadPhones, copy = {}, className }) {
  const [open, setOpen] = useState(false);
  // The phones that reach this computer, read each time the menu opens so
  // presence is current. A failed read leaves the last list in place.
  const [phones, setPhones] = useState([]);
  useEffect(() => {
    if (!open || !loadPhones) return undefined;
    let active = true;
    loadPhones().then((devices) => { if (active && Array.isArray(devices)) setPhones(devices); }, () => {});
    return () => { active = false; };
  }, [open, loadPhones]);
  const current = currentWorkspace(workspaces, selectedId);
  if (!current) return null;
  const relayConfigured = workspaces.some((item) => item.kind === "relay");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground",
            className
          )}
          aria-label={copy.switchWorkspace || "Switch workspace"}
        >
          <StatusDot workspace={current} />
          <span className="min-w-0 truncate">{current.name}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.workspaces || "Workspaces"}</p>
        <ul className="flex flex-col" role="listbox" aria-label={copy.workspaces || "Workspaces"}>
          {workspaces.map((workspace) => {
            const selected = workspace.id === current.id;
            return (
              <li key={workspace.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/55",
                    selected ? "text-foreground" : "text-foreground/85"
                  )}
                  onClick={() => {
                    onSelect?.(workspace.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("flex items-center gap-1.5 truncate", selected && "font-medium")}>
                      <StatusDot workspace={workspace} />
                      <span className="truncate">{workspace.name}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{workspace.detail}</span>
                  </span>
                  {selected ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {phones.length ? (
          <>
            <div className="my-1 border-t border-border/65" />
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.pairedPhones || "Phones"}</p>
            <ul className="flex flex-col" aria-label={copy.pairedPhones || "Phones"} data-testid="switcher-phones">
              {[...phones].sort((a, b) => String(b.pairedAt || "").localeCompare(String(a.pairedAt || ""))).map((device) => {
                const presence = phonePresence(device);
                return (
                  <li key={device.id} className="flex items-start gap-2 px-2 py-1.5 text-sm">
                    <span className="relative mt-0.5 inline-flex shrink-0">
                      <Smartphone className="size-4 text-muted-foreground" aria-hidden="true" />
                      {presence.active ? <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-popover bg-emerald-500" aria-hidden="true" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-foreground/85">{device.name || "iPhone"}</span>
                      <span className="truncate text-xs text-muted-foreground">{presence.text}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {onPairPhone || onConnectRelay ? <div className="my-1 border-t border-border/65" /> : null}
        {/* Pairing a phone is a way to reach this computer, so it sits with
            the other connections, one click from anywhere in the app. */}
        {onPairPhone ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-muted/55 hover:text-foreground"
            onClick={() => {
              onPairPhone();
              setOpen(false);
            }}
          >
            <Smartphone className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{copy.pairIphone || "Pair iPhone…"}</span>
          </button>
        ) : null}
        {onConnectRelay ? (
          <>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-muted/55 hover:text-foreground"
              onClick={() => {
                onConnectRelay();
                setOpen(false);
              }}
            >
              <Plug className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{relayConfigured ? copy.relaySettings || "Relay settings…" : copy.connectRelay || "Connect a relay…"}</span>
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
