import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRightLeft, Bot, Clock, Hash, ListChecks, MessageSquareText, PenLine, Play, Workflow } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { SEARCH_TYPE_ORDER, flattenGroups, moveSelection, relativeTime, snippetSegments, typeLabel } from "@/lib/search-results";

const TYPE_ICONS = {
  message: MessageSquareText,
  channel: Hash,
  member: Bot,
  run: Play,
  task: ListChecks,
  handoff: ArrowRightLeft,
  canvas: PenLine,
  workflow: Workflow,
};

function Marked({ text }) {
  const segments = useMemo(() => snippetSegments(text), [text]);
  return segments.map((segment, index) =>
    segment.hit ? (
      <mark key={index} className="bg-transparent font-semibold text-foreground">
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  );
}

function ResultRow({ id, item, active, onHover, onSelect, timeLabel }) {
  const Icon = TYPE_ICONS[item.type] || MessageSquareText;
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      data-active={active ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
        active ? "bg-muted/60" : "hover:bg-muted/40"
      )}
      onMouseMove={onHover}
      onClick={() => onSelect?.(item)}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <Marked text={item.title} />
        </span>
        {item.snippet && item.snippet !== item.title ? (
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            <Marked text={item.snippet} />
          </span>
        ) : null}
      </span>
      {item.at ? <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{timeLabel(item.at)}</span> : null}
    </button>
  );
}

function RecentRow({ id, query, active, onHover, onSelect }) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      data-active={active ? "true" : undefined}
      className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors", active ? "bg-muted/60" : "hover:bg-muted/40")}
      onMouseMove={onHover}
      onClick={() => onSelect?.(query)}
    >
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{query}</span>
    </button>
  );
}

/**
 * Grouped search results for the ⌘K palette: a type-filter row, one calm
 * divider-separated list per type, ↑/↓/Enter navigation, and the recent
 * searches when the query is empty.
 *
 * `groups` comes from `groupResults()` in src/lib/search-results.js. `counts`
 * (optional) is `typeCounts()` over the unfiltered results so the filter row
 * keeps every type visible while one is active.
 */
export function SearchResults({
  query = "",
  groups = [],
  activeType = "",
  onTypeChange,
  onSelect,
  recent = [],
  onRecentSelect,
  copy = {},
  counts,
  loading = false,
  keyboard = true,
  now,
}) {
  const baseId = useId();
  const trimmed = String(query || "").trim();
  const searching = trimmed.length > 0;
  const items = useMemo(() => flattenGroups(groups), [groups]);
  const entries = searching ? items : recent;
  const [active, setActive] = useState(0);
  const timeLabel = (at) => relativeTime(at, now);
  // Reset the cursor when the list itself changes, not when the parent merely re-renders.
  const signature = searching ? items.map((item) => item.id).join("\n") : recent.join("\n");

  useEffect(() => {
    setActive(0);
  }, [trimmed, activeType, signature]);

  useEffect(() => {
    if (!keyboard || !entries.length) return undefined;
    function onKeyDown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActive((index) => moveSelection(index, event.key === "ArrowDown" ? 1 : -1, entries.length));
        return;
      }
      if (event.key === "Enter") {
        const entry = entries[active];
        if (entry === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (searching) onSelect?.(entry);
        else onRecentSelect?.(entry);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [keyboard, entries, active, searching, onSelect, onRecentSelect]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.getElementById(`${baseId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, baseId]);

  const filterTypes = useMemo(() => {
    const source = counts || Object.fromEntries(groups.map((group) => [group.type, group.count ?? group.items.length]));
    const list = SEARCH_TYPE_ORDER.filter((type) => source[type]);
    if (activeType && !list.includes(activeType)) list.push(activeType);
    return list.map((type) => ({ type, count: source[type] || 0 }));
  }, [counts, groups, activeType]);

  const activeId = entries.length ? `${baseId}-${active}` : undefined;

  if (!searching) {
    return (
      <div role="listbox" aria-activedescendant={activeId} aria-label={copy.searchRecent || "Recent searches"} className="flex flex-col px-2 py-2">
        {recent.length ? (
          <>
            <div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{copy.searchRecent || "Recent searches"}</div>
            {recent.map((entry, index) => (
              <RecentRow key={entry} id={`${baseId}-${index}`} query={entry} active={index === active} onHover={() => setActive(index)} onSelect={onRecentSelect} />
            ))}
          </>
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">{copy.searchHint || "Search messages, channels, members, runs, tasks, and handoffs."}</p>
        )}
      </div>
    );
  }

  let offset = 0;
  return (
    <div className="flex flex-col">
      {filterTypes.length ? (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border/70 px-3 py-2">
          <ToggleGroup type="single" size="sm" value={activeType || "all"} onValueChange={(value) => onTypeChange?.(value && value !== "all" ? value : "")} aria-label={copy.searchFilterTypes || "Filter by type"}>
            <ToggleGroupItem value="all" className="h-7 gap-1 rounded-md px-2 text-xs font-normal data-[state=on]:font-medium">
              {copy.searchAllTypes || "All"}
            </ToggleGroupItem>
            {filterTypes.map(({ type, count }) => (
              <ToggleGroupItem key={type} value={type} className="h-7 gap-1 rounded-md px-2 text-xs font-normal data-[state=on]:font-medium">
                {typeLabel(type, copy)}
                {count ? <span className="text-muted-foreground">{count}</span> : null}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      {groups.length ? (
        <div role="listbox" aria-activedescendant={activeId} aria-label={copy.searchResults || "Search results"} className="flex flex-col px-2 pb-2">
          {groups.map((group, groupIndex) => {
            const start = offset;
            offset += group.items.length;
            return (
              <div key={group.type} className={cn("flex flex-col", groupIndex > 0 && "mt-1 border-t border-border/70")}>
                <div className="flex items-baseline gap-2 px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                  <span>{typeLabel(group.type, copy)}</span>
                  {group.count > group.items.length ? (
                    <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => onTypeChange?.(group.type)}>
                      {(copy.searchShowAll || "Show all {count}").replace("{count}", String(group.count))}
                    </button>
                  ) : null}
                </div>
                {group.items.map((item, index) => {
                  const position = start + index;
                  return (
                    <ResultRow
                      key={item.id}
                      id={`${baseId}-${position}`}
                      item={item}
                      active={position === active}
                      onHover={() => setActive(position)}
                      onSelect={onSelect}
                      timeLabel={timeLabel}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          {loading ? copy.searchSearching || "Searching…" : (copy.searchNoResultsFor || "No results for “{query}”.").replace("{query}", trimmed)}
        </p>
      )}
    </div>
  );
}
