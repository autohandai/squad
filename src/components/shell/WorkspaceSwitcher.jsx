import { useState } from "react";
import { Check, ChevronDown, Plug } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { currentWorkspace } from "@/lib/workspaces";

function StatusDot({ workspace }) {
  if (workspace.kind === "local") return null;
  const tone = !workspace.enabled ? "bg-muted-foreground/40" : workspace.connected ? "bg-emerald-500" : "bg-amber-500";
  return <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-hidden="true" />;
}

/**
 * Quiet workspace switcher for the sidebar header: the current workspace
 * name with a chevron, and a popover listing the local workspace plus the
 * relay workspace when one is configured. Purely presentational; the list
 * comes from `buildWorkspaceList` in src/lib/workspaces.js.
 */
export function WorkspaceSwitcher({ workspaces = [], selectedId, onSelect, onConnectRelay, copy = {}, className }) {
  const [open, setOpen] = useState(false);
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
        {onConnectRelay ? (
          <>
            <div className="my-1 border-t border-border/65" />
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
