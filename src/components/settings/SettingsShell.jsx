import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { settingsPath } from "@/lib/settings-navigation";

/**
 * The Settings shell (ADR-0119): the app sidebar is gone, a Back control and
 * the page title sit in the header, a slim list of sections sits on the left
 * and exactly one section's content on the right. The list stays put; the
 * selected row's indicator slides to the new row and the content fades up.
 *
 * Props:
 *   sections   [{ id, label }] in display order
 *   activeId   the section whose content is rendered
 *   onSelect   (id) => void, called for pointer and keyboard selection
 *   onBack     the ADR-0088 return
 *   title      the page title ("Settings")
 *   backLabel  accessible name of the Back control
 *   status     one quiet line under the list (runtime state), optional
 *   children   the active section's content
 *
 * Keyboard: Tab or Up/Down move through the list (Home/End jump), Enter or
 * Space select, Escape anywhere on the page goes Back unless focus is in a
 * text field or an open menu, select or dialog, which own Escape themselves.
 *
 * Below the md breakpoint the list becomes one horizontally scrolling row of
 * the same rows with an underline, the simplest shape that keeps every
 * section one tap away without a second control.
 */
export function SettingsShell({ sections = [], activeId = "", onSelect, onBack, title = "Settings", backLabel = "Back from Settings", status = null, children }) {
  const navRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [indicator, setIndicator] = useState(null);
  const [indicatorLive, setIndicatorLive] = useState(false);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const row = rowRefs.current.get(activeId);
    if (!nav || !row) { setIndicator(null); return; }
    // When the list is a row (narrow widths) the open section may sit past
    // the edge, so it is brought into view on every measurement, resizes
    // included; "nearest" leaves the page's own scroll position alone.
    row.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    const navRect = nav.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    setIndicator({
      top: rect.top - navRect.top + nav.scrollTop,
      height: rect.height,
      left: rect.left - navRect.left + nav.scrollLeft,
      width: rect.width,
    });
  }, [activeId]);

  // The indicator follows the selected row; the first measurement lands
  // without a transition so the page does not open with a bar sliding in
  // from the top-left corner.
  useLayoutEffect(() => {
    measure();
    if (indicatorLive) return undefined;
    const frame = window.requestAnimationFrame(() => setIndicatorLive(true));
    return () => window.cancelAnimationFrame(frame);
  }, [measure, activeId, indicatorLive, sections.length]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  function select(event, id) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    if (id !== activeId) onSelect?.(id);
  }

  function onListKeyDown(event) {
    const ids = sections.map((section) => section.id);
    const current = ids.indexOf(event.target?.dataset?.section || "");
    let next = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = current < 0 ? 0 : Math.min(ids.length - 1, current + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = current < 0 ? ids.length - 1 : Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else if (event.key === " " && current >= 0) { select(event, ids[current]); return; }
    if (next < 0) return;
    event.preventDefault();
    rowRefs.current.get(ids[next])?.focus();
  }

  function onShellKeyDown(event) {
    if (event.key !== "Escape" || event.defaultPrevented || !onBack) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-state='open']")) return;
    event.preventDefault();
    onBack();
  }

  const indicatorStyle = indicator
    ? { "--settings-indicator-top": `${indicator.top}px`, "--settings-indicator-height": `${indicator.height}px`, "--settings-indicator-left": `${indicator.left}px`, "--settings-indicator-width": `${indicator.width}px` }
    : undefined;

  return (
    <div className="settings-shell min-h-screen bg-background" data-testid="settings-shell" onKeyDown={onShellKeyDown}>
      <div className="flex h-14 items-center gap-3 border-b border-border/75 bg-background/92 px-5 backdrop-blur-xl sm:px-6">
        <Button variant="ghost" size="icon-sm" aria-label={backLabel} title={backLabel} onClick={onBack}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6 md:grid md:grid-cols-[208px_minmax(0,1fr)] md:gap-12 md:pt-8 lg:px-10 lg:gap-16">
        <aside className="min-w-0 md:sticky md:top-8 md:self-start">
          <nav
            ref={navRef}
            aria-label={`${title} sections`}
            data-testid="settings-sections"
            className={cn(
              "settings-nav relative -mx-1 flex gap-0.5 overflow-x-auto border-b border-border/70 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:border-b-0",
              indicatorLive && indicator && "settings-nav-live"
            )}
            style={indicatorStyle}
            onKeyDown={onListKeyDown}
          >
            {indicator ? <span aria-hidden="true" className="settings-nav-indicator" /> : null}
            {sections.map((section) => {
              const active = section.id === activeId;
              return (
                <a
                  key={section.id}
                  ref={(node) => { if (node) rowRefs.current.set(section.id, node); else rowRefs.current.delete(section.id); }}
                  href={settingsPath(section.id)}
                  data-section={section.id}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => select(event, section.id)}
                  className={cn(
                    "settings-nav-row shrink-0 whitespace-nowrap px-3 py-2 text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:whitespace-normal md:rounded-sm md:py-1.5",
                    active ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span className="block truncate">{section.label}</span>
                </a>
              );
            })}
          </nav>
          {status ? <div className="mt-6 hidden md:block">{status}</div> : null}
        </aside>
        <div className="mt-6 min-w-0 max-w-3xl md:mt-0">
          <div key={activeId} className="settings-section-enter" data-testid="settings-section" data-section={activeId}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsSectionHeader({ title, description }) {
  return (
    <div className="mb-6 min-w-0">
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}
