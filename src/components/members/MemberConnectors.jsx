import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConnectorLogo } from "@/components/settings/connectors/ConnectorLogo";

/**
 * A member's Connectors (ADR-0265). Connectors in Squad are shared: whatever
 * is added in Settings › Connectors every member can use. So the page says
 * what this member can already use, then offers the connectors Squad
 * supports with Connect, which opens Settings › Connectors on that entry.
 * An empty page used to say only "has no connector tools of their own".
 */
export function MemberConnectors({ agent, api, navigate, ownTools = [] }) {
  const [state, setState] = useState({ connected: [], suggestions: [], loaded: false, error: "" });

  useEffect(() => {
    let live = true;
    Promise.all([api("/api/connectors"), api("/api/connectors/catalog").catch(() => ({ items: [] }))])
      .then(([list, catalog]) => {
        if (!live) return;
        const connected = (list?.connectors || []).filter((item) => item.enabled && !item.managed);
        const suggestions = (catalog?.items || []).filter((item) => !item.installed).slice(0, 8);
        setState({ connected, suggestions, loaded: true, error: "" });
      })
      .catch((error) => { if (live) setState((current) => ({ ...current, loaded: true, error: error?.message || String(error) })); });
    return () => { live = false; };
  }, [api]);

  const open = (item) => navigate?.(`/settings/connectors?install=${encodeURIComponent(item.catalogId || item.name)}`);

  return (
    <div className="flex flex-col gap-8" data-testid="member-connectors">
      <section>
        <h2 className="text-sm font-semibold">What {agent.name} can use</h2>
        <p className="mt-1 text-sm text-muted-foreground">Connectors you add are shared: every member can use them.</p>
        <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
          {ownTools.map((tool) => (
            <div key={tool.label} className="flex items-baseline gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{tool.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{tool.value}</span>
            </div>
          ))}
          {state.connected.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
              <ConnectorLogo logo={item.logo} icon={item.icon} iconDark={item.iconDark} name={item.name} size={24} />
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" aria-hidden="true" />Connected</span>
            </div>
          ))}
          {state.loaded && !ownTools.length && !state.connected.length ? (
            <p className="py-2.5 text-sm text-muted-foreground">Nothing connected yet. Connect one below and {agent.name} can use it in the next reply.</p>
          ) : null}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Connect more</h2>
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => navigate?.("/settings/connectors")}>
            All connectors<ArrowRight data-icon="inline-end" />
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Give {agent.name} your mail, calendar, code and docs, so they can do the work instead of asking you for it.</p>
        <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
          {state.suggestions.map((item) => (
            <div key={item.name} className="flex items-center gap-3 py-2.5" data-testid="member-connector-suggestion">
              <ConnectorLogo logo={item.logo} icon={item.icon} iconDark={item.iconDark} name={item.title} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description || item.name}</span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => open(item)} aria-label={`Connect ${item.title}`}>Connect</Button>
            </div>
          ))}
          {!state.loaded ? <p className="py-2.5 text-sm text-muted-foreground">Loading connectors…</p> : null}
          {state.loaded && !state.suggestions.length ? (
            <p className="py-2.5 text-sm text-muted-foreground">{state.error || "The connector list couldn’t load. Open All connectors to add one."}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
