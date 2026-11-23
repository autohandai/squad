import { Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MemberQuickSettings } from "@/components/members/MemberQuickSettings";
import { cn } from "@/lib/utils";

// How the member acts, in the person's words (ADR-0274). Same modes as
// profile › Permissions; the full page keeps per-workspace overrides.
export const QUICK_PERMISSION_MODES = [
  { id: "interactive", label: "Ask me first", detail: "Asks before anything risky or unfamiliar.", policy: "ask" },
  { id: "restricted", label: "Play it safe", detail: "Asks before acting and never runs dangerous commands.", policy: "restricted" },
  { id: "unrestricted", label: "Act on its own", detail: "Goes ahead with anything not on the blocked list.", policy: "yes" },
];

/** The shield beside a member's menu: its permissions in one quick menu. */
export function MemberPermissionsMenu({ agent, api, updateAgent, navigate }) {
  const mode = QUICK_PERMISSION_MODES.some((item) => item.id === agent.permissions?.permissionMode) ? agent.permissions.permissionMode : "interactive";
  function choose(item) {
    if (!updateAgent || item.id === mode) return;
    updateAgent(agent.id, {
      launch: { ...agent.launch, policy: item.policy },
      permissions: { ...agent.permissions, permissionMode: item.id },
      updatedAt: new Date().toISOString(),
    });
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Permissions for ${agent.name}`} data-testid="member-permissions-menu">
              <ShieldCheck />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Permissions</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0" data-testid="member-permissions-popover">
        <div className="px-4 pb-1 pt-3">
          <p className="text-sm font-semibold">{agent.name}’s permissions</p>
        </div>
        <div role="radiogroup" aria-label={`How ${agent.name} acts`} className="px-1.5 pb-1">
          {QUICK_PERMISSION_MODES.map((item) => {
            const checked = item.id === mode;
            return (
              <button key={item.id} type="button" role="radio" aria-checked={checked} disabled={!updateAgent} onClick={() => choose(item)}
                className="flex w-full items-start gap-2.5 rounded-sm px-2.5 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden="true">{checked ? <Check className="size-4" /> : null}</span>
                <span className="min-w-0">
                  <span className={cn("block text-sm", checked ? "font-medium" : "text-foreground/85")}>{item.label}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">{item.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-4 pb-1 [&_[data-testid=member-quick-settings]]:border-b-0">
          <MemberQuickSettings agent={agent} api={api} updateAgent={updateAgent} navigate={navigate} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
