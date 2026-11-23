import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MemberConnectors } from "@/components/members/MemberConnectors";

/**
 * A member's connectors in a side sheet, like the Execution panel and channel
 * settings (ADR-0274): what it can use, and what to connect next, without
 * leaving the conversation or the profile.
 */
export function MemberConnectorsSheet({ agent, api, navigate, updateAgent, open, onOpenChange, ownTools = [] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto border-border/80 p-0 sm:max-w-lg" data-testid="member-connectors-sheet">
        <SheetHeader className="border-b border-border/60 px-5 py-4 pr-12">
          <SheetTitle>Connectors</SheetTitle>
          <SheetDescription>What {agent.name} can use, and what to connect next.</SheetDescription>
        </SheetHeader>
        <div className="px-5 py-4">
          {open ? <MemberConnectors agent={agent} api={api} navigate={(path) => { onOpenChange?.(false); navigate?.(path); }} updateAgent={updateAgent} ownTools={ownTools} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
