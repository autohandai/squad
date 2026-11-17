import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { BIRDS, birdAvatarSrc, birdById, birdFromAvatar, searchBirds } from "@/lib/bird-cast";
import { birdFaceSvg } from "@/lib/bird-faces";
import { cn } from "@/lib/utils";

// The bird picker (ADR-0243): 300 birds, searchable by name, the current bird
// first, never grouped by country. One keyboard stop (roving focus: arrows,
// Home/End, Enter), fixed 48px cells so the grid never reflows while faces
// arrive, and faces drawn only once their cell scrolls near view.

const CELL = 48;
const GAP = 8;
const faces = new Map();
function faceMarkup(bird, style) {
  const key = `${bird}:${style}`;
  if (!faces.has(key)) faces.set(key, birdFaceSvg(bird, { style }));
  return faces.get(key);
}

function useLazyFaces(rootRef) {
  const [seen, setSeen] = useState(() => new Set());
  const observerRef = useRef(null);
  const pending = useRef(new Map());
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const shown = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target.dataset.bird);
      if (!shown.length) return;
      for (const entry of entries) if (entry.isIntersecting) observer.unobserve(entry.target);
      setSeen((current) => {
        if (shown.every((bird) => current.has(bird))) return current;
        const next = new Set(current);
        for (const bird of shown) next.add(bird);
        return next;
      });
    }, { root: rootRef.current, rootMargin: "240px 0px" });
    observerRef.current = observer;
    for (const element of pending.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [rootRef]);
  const observe = (bird) => (element) => {
    if (!element) return;
    pending.current.set(bird, element);
    observerRef.current?.observe(element);
  };
  // Without IntersectionObserver (old webviews, tests) every face is drawn.
  const visible = (bird) => typeof IntersectionObserver !== "function" || seen.has(bird);
  return { observe, visible };
}

export function BirdPicker({ value, onChange, onCommit, avatarStyle = "flat", label = "Bird avatars", autoFocus = false, className }) {
  const [query, setQuery] = useState("");
  const current = birdFromAvatar(value);
  // The bird the member had when the picker opened leads the grid. It is not
  // the live choice: a cell must not jump to the front when it is clicked.
  const [lead] = useState(() => birdFromAvatar(value));
  const scrollRef = useRef(null);
  const gridRef = useRef(null);
  const [columns, setColumns] = useState(6);
  const [active, setActive] = useState(0);
  const { observe, visible } = useLazyFaces(scrollRef);

  // The current bird leads, so the person sees what they have before what
  // they could have; a search keeps it first only when it matches.
  const birds = useMemo(() => {
    const found = searchBirds(query);
    if (!lead) return found;
    const index = found.findIndex((bird) => bird.id === lead);
    return index < 0 ? found : [found[index], ...found.slice(0, index), ...found.slice(index + 1)];
  }, [query, lead]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver !== "function") return undefined;
    const measure = () => setColumns(Math.max(1, Math.floor((grid.clientWidth + GAP) / (CELL + GAP))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setActive(0); }, [query]);

  function focusCell(index) {
    const next = Math.max(0, Math.min(birds.length - 1, index));
    setActive(next);
    const cell = gridRef.current?.querySelector(`[data-index="${next}"]`);
    cell?.focus({ preventScroll: false });
    cell?.scrollIntoView?.({ block: "nearest" });
  }

  function onKeyDown(event) {
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (event.key in moves) { event.preventDefault(); focusCell(active + moves[event.key]); return; }
    if (event.key === "Home") { event.preventDefault(); focusCell(0); return; }
    if (event.key === "End") { event.preventDefault(); focusCell(birds.length - 1); return; }
    if (event.key === "Enter" && onCommit) {
      event.preventDefault();
      const bird = birds[active];
      if (bird) { onChange?.(birdAvatarSrc(bird.id)); onCommit(birdAvatarSrc(bird.id)); }
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <InputGroup className="h-9">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && birds.length) { event.preventDefault(); focusCell(0); }
            if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
          }}
          placeholder={`Search ${BIRDS.length} birds`}
          aria-label="Search birds by name"
          autoFocus={autoFocus}
          data-testid="bird-search"
        />
        {query ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" variant="ghost" aria-label="Clear search" onClick={() => setQuery("")}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <div ref={scrollRef} className="h-72 overflow-y-auto overscroll-contain pr-1" data-testid="bird-grid-scroll">
        {birds.length ? (
          <div
            ref={gridRef}
            role="radiogroup"
            aria-label={label}
            className="grid"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CELL}px, 1fr))`, gap: GAP, gridAutoRows: CELL }}
            onKeyDown={onKeyDown}
          >
            {birds.map((bird, index) => {
              const selected = current === bird.id;
              return (
                <button
                  key={bird.id}
                  ref={observe(bird.id)}
                  type="button"
                  role="radio"
                  data-bird={bird.id}
                  data-index={index}
                  aria-checked={selected}
                  aria-label={bird.label}
                  title={bird.label}
                  tabIndex={index === active ? 0 : -1}
                  className="group relative grid size-12 place-items-center justify-self-center p-0 outline-none"
                  onFocus={() => setActive(index)}
                  onClick={() => { setActive(index); onChange?.(birdAvatarSrc(bird.id)); }}
                  onDoubleClick={() => onCommit?.(birdAvatarSrc(bird.id))}
                >
                  <span
                    data-slot="avatar"
                    // The ring sits on the tile, so it takes the skin's avatar corner.
                    className={cn(
                      "member-face size-full overflow-hidden rounded-full bg-muted transition-shadow",
                      "group-hover:shadow-[0_0_0_2px_var(--border)] group-focus-visible:shadow-[0_0_0_3px_var(--ring)]",
                      selected && "shadow-[0_0_0_2px_var(--primary)] group-hover:shadow-[0_0_0_2px_var(--primary)]"
                    )}
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={visible(bird.id) ? { __html: faceMarkup(bird.id, avatarStyle) } : undefined}
                  />
                  {selected ? (
                    <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border border-background bg-primary text-primary-foreground" aria-hidden="true">
                      <Check className="size-2.5" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">No bird is called “{query.trim()}”.</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {query.trim() ? `${birds.length} of ${BIRDS.length} birds` : `${BIRDS.length} birds`}
        {current ? ` · ${birdById(current)?.label || ""}` : ""}
      </p>
    </div>
  );
}

/**
 * Change a member's bird from wherever the member is shown (ADR-0243): the
 * profile card, the chat header's profile popover and the member menu. Saving
 * goes through the same updateAgent as Edit profile, so the sidebar, chats,
 * channels, Quick Chat, the menu bar and the phone follow.
 */
export function MemberAvatarDialog({ agent, open, onOpenChange, onSave, avatarStyle = "flat" }) {
  const [choice, setChoice] = useState(agent?.avatar || "");
  useEffect(() => { if (open) setChoice(agent?.avatar || ""); }, [open, agent?.id, agent?.avatar]);
  const bird = birdFromAvatar(choice);
  const changed = Boolean(bird) && choice !== agent?.avatar;
  const name = agent?.name || "this member";
  function save(next = choice) {
    if (!birdFromAvatar(next) || next === agent?.avatar) { onOpenChange?.(false); return; }
    onSave?.(next);
    onOpenChange?.(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="member-avatar-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {bird ? (
              <span
                data-slot="avatar"
                className="member-face size-12 shrink-0 overflow-hidden rounded-full bg-muted"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: faceMarkup(bird, avatarStyle) }}
              />
            ) : null}
            <div className="min-w-0">
              <DialogTitle>Change {name}’s avatar</DialogTitle>
              <DialogDescription>
                {bird ? `${birdById(bird)?.label}. ` : ""}It changes everywhere {name} appears.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <BirdPicker value={choice} onChange={setChoice} onCommit={save} avatarStyle={avatarStyle} label={`Avatars for ${name}`} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <Button onClick={() => save()} disabled={!changed} data-testid="member-avatar-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
