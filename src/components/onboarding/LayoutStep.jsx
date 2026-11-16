import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LAYOUTS } from "@/lib/layouts";
import { cn } from "@/lib/utils";

const bar = "block h-1.5 rounded-full";

/**
 * A miniature of each layout, drawn from the page's own tokens so it follows
 * the skin and the mode. Decorative: the radio rows carry the meaning.
 * `small` is the glyph beside a choice; the large one leads the step.
 */
export function LayoutGlyph({ layout, className }) {
  const minified = layout === "minified";
  return <span aria-hidden="true" data-layout-glyph={layout} className={cn("relative flex h-8 w-12 shrink-0 overflow-hidden rounded-[5px] border border-border/80 bg-background", className)}>
    <span className={cn("flex h-full flex-col gap-[3px] border-r border-border/70 bg-muted/60 p-[3px]", minified ? "w-[42%]" : "w-[38%]")}>
      {minified ? <>
        <span className="grid grid-cols-2 gap-[2px]">{[0, 1, 2, 3].map(index => <span key={index} className="aspect-square rounded-[2px] bg-foreground/35" />)}</span>
        <span className="h-px bg-border" />
        <span className="h-[2px] w-full rounded-full bg-foreground/25" />
        <span className="h-[2px] w-4/5 rounded-full bg-foreground/20" />
      </> : <>
        <span className="h-[2px] w-full rounded-full bg-foreground/30" />
        <span className="h-[2px] w-3/4 rounded-full bg-foreground/20" />
        <span className="h-[2px] w-4/5 rounded-full bg-foreground/20" />
        <span className="h-[2px] w-2/3 rounded-full bg-foreground/20" />
        <span className="h-[2px] w-3/4 rounded-full bg-foreground/20" />
      </>}
    </span>
    <span className="flex flex-1 flex-col justify-end gap-[3px] p-[3px]">
      {minified ? <>
        <span className="h-[5px] w-3/5 rounded-[2px] bg-muted-foreground/30" />
        <span className="ml-auto h-[5px] w-1/2 rounded-[2px] bg-foreground/70" />
      </> : <>
        <span className="h-[2px] w-4/5 rounded-full bg-foreground/25" />
        <span className="h-[2px] w-3/5 rounded-full bg-foreground/20" />
        <span className="h-[2px] w-2/3 rounded-full bg-foreground/20" />
      </>}
    </span>
  </span>;
}

// Below 20px an initial is noise, so a member without a picture is a quiet tile.
function Face({ member, className }) {
  return <span className={cn("inline-flex shrink-0 overflow-hidden rounded-[var(--skin-avatar-radius,0.375rem)] bg-muted text-[0px] [&_*]:text-[0px]", className)}>{member?.avatar ? member.avatar(cn("size-full object-cover", className)) : null}</span>;
}

/**
 * The large picture for the step. Messages arrive one after another on a slow
 * loop; under reduced motion it is the finished frame.
 */
export function LayoutPreview({ layout, members = [] }) {
  const minified = layout === "minified";
  const [first, second, third] = [members[1] || members[0], members[0], members[2] || members[0]];
  return <div aria-hidden="true" data-testid="layout-preview" data-layout={layout} className="layout-preview relative h-56 select-none overflow-hidden rounded-lg bg-muted/55 px-6 pt-6">
    <div className="flex h-full overflow-hidden rounded-t-md border border-b-0 border-border/70 bg-background">
      <div className={cn("flex shrink-0 flex-col border-r border-border/60 bg-card px-2.5 py-3", minified ? "w-[36%]" : "w-[32%]")}>
        {minified ? <>
          <div className="flex items-center justify-between"><span className={cn(bar, "w-12 bg-foreground/30")} /><span className="flex gap-1"><span className="size-2 rounded-[2px] bg-foreground/20" /><span className="size-2 rounded-[2px] bg-foreground/20" /></span></div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {[first, second, third, members[3] || first].map((member, index) => <span key={index} className="flex flex-col items-center gap-1">
              <span className={cn("relative rounded-[calc(var(--skin-avatar-radius,0.375rem)+2px)]", index === 0 && "ring-[1.5px] ring-foreground/60 ring-offset-1 ring-offset-card")}><Face member={member} className="size-6" /></span>
              <span className={cn(bar, "h-1 w-5 bg-foreground/15")} />
            </span>)}
          </div>
          <div className="mt-3 border-t border-border/60 pt-2">
            {[first, third, second].map((member, index) => <div key={index} className={cn("flex items-center gap-2 rounded-[4px] px-1 py-1.5", index === 0 && "bg-muted")}>
              <Face member={member} className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col gap-1"><span className={cn(bar, "h-1 bg-foreground/35", index === 0 ? "w-3/5" : "w-1/2")} /><span className={cn(bar, "h-1 w-4/5 bg-foreground/12")} /></span>
            </div>)}
          </div>
        </> : <>
          <span className="h-3.5 rounded-[3px] border border-border/70 bg-background" />
          <div className="mt-2.5 space-y-1.5">{["w-3/5", "w-1/2", "w-2/5"].map(width => <div key={width} className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-foreground/20" /><span className={cn(bar, "h-1 bg-foreground/25", width)} /></div>)}</div>
          <span className={cn(bar, "mt-3 h-1 w-8 bg-foreground/15")} />
          <div className="mt-1.5 space-y-1.5">{["w-1/2", "w-2/5"].map(width => <div key={width} className="flex items-center gap-1.5"><span className="text-[8px] leading-none text-foreground/30">#</span><span className={cn(bar, "h-1 bg-foreground/20", width)} /></div>)}</div>
          <span className={cn(bar, "mt-3 h-1 w-10 bg-foreground/15")} />
          <div className="mt-1.5 space-y-1.5">{[first, second, third].map((member, index) => <div key={index} className={cn("flex items-center gap-1.5 rounded-[3px]", index === 0 && "bg-muted")}><Face member={member} className="size-2.5" /><span className={cn(bar, "h-1 bg-foreground/25", index === 1 ? "w-2/5" : "w-1/2")} /></div>)}</div>
        </>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {minified ? <div className="flex h-8 shrink-0 items-center justify-center gap-1.5 border-b border-border/60">
          <Face member={first} className="size-3.5" /><span className={cn(bar, "h-1 w-10 bg-foreground/35")} />
        </div> : <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
          <Face member={first} className="size-4" /><span className={cn(bar, "h-1 w-10 bg-foreground/35")} /><span className={cn(bar, "h-1 w-14 bg-foreground/12")} />
          <span className="ml-auto flex gap-1"><span className="h-2.5 w-7 rounded-[3px] border border-border/80" /><span className="size-2.5 rounded-[3px] bg-foreground/15" /></span>
        </div>}
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 px-4 pb-3">
          {minified ? <>
            <span className="layout-preview-msg ml-auto flex w-2/5 items-center rounded-[7px] bg-foreground/85 px-2 py-1.5" style={{ "--d": "0s" }}><span className={cn(bar, "h-1 w-full bg-background/45")} /></span>
            <span className="layout-preview-msg flex w-3/5 flex-col gap-1 rounded-[7px] bg-muted px-2 py-1.5" style={{ "--d": "0.9s" }}><span className={cn(bar, "h-1 w-full bg-foreground/25")} /><span className={cn(bar, "h-1 w-3/4 bg-foreground/20")} /></span>
            <span className="layout-preview-msg ml-auto flex w-1/4 items-center rounded-[7px] bg-foreground/85 px-2 py-1.5" style={{ "--d": "1.8s" }}><span className={cn(bar, "h-1 w-full bg-background/45")} /></span>
          </> : <>
            <span className="layout-preview-msg ml-auto h-4 w-2/5 rounded-[4px] bg-muted" style={{ "--d": "0s" }} />
            <span className="layout-preview-msg flex gap-2" style={{ "--d": "0.9s" }}><Face member={first} className="size-4" /><span className="flex flex-1 flex-col gap-1 pt-0.5"><span className={cn(bar, "h-1 w-1/4 bg-foreground/35")} /><span className={cn(bar, "h-1 w-full bg-foreground/20")} /><span className={cn(bar, "h-1 w-4/5 bg-foreground/20")} /><span className={cn(bar, "h-1 w-3/5 bg-foreground/20")} /></span></span>
          </>}
          <span className="mt-1 h-5 shrink-0 rounded-[5px] border border-border/80 bg-background" />
        </div>
      </div>
    </div>
  </div>;
}

/** Onboarding: Full or Minified. Saves at once to the store Settings › Appearance uses. */
export function LayoutStep({ layout = "full", onChange, members = [], onBack, onContinue }) {
  const [peek, setPeek] = useState(null);
  const [status, setStatus] = useState("");
  const shown = peek || layout;
  function choose(next) {
    if (next === layout) return;
    onChange?.(next);
    setStatus(`Saved. Squad uses the ${LAYOUTS.find(item => item.id === next).label} layout now.`);
  }
  return <section aria-labelledby="layout-heading" data-testid="onboarding-layout">
    <h1 id="layout-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Choose your layout.</h1>
    <p className="mt-3 text-base text-muted-foreground">Full puts everything Squad does in the sidebar. Minified is a calm, chat-first squad with your teammates one click away. Both work with every skin.</p>
    <div className="mt-8"><LayoutPreview key={shown} layout={shown} members={members} /></div>
    <fieldset className="mt-6">
      <legend className="text-sm font-semibold">Layout</legend>
      <div className="mt-2 divide-y divide-border/70" onMouseLeave={() => setPeek(null)}>
        {LAYOUTS.map(item => {
          const checked = layout === item.id;
          return <label key={item.id} onMouseEnter={() => setPeek(item.id)} className="group flex cursor-pointer items-center gap-3 py-3.5 has-[:focus-visible]:rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            <input type="radio" name="squad-layout" value={item.id} checked={checked} onChange={() => choose(item.id)} className="sr-only" aria-describedby={`layout-${item.id}-detail`} />
            <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">{checked ? <Check className="size-4" /> : null}</span>
            <LayoutGlyph layout={item.id} />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", checked ? "font-semibold" : "text-foreground/85")}>{item.label}</span>
              <span id={`layout-${item.id}-detail`} className="mt-0.5 block text-sm text-muted-foreground">{item.description}</span>
            </span>
          </label>;
        })}
      </div>
    </fieldset>
    <div className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{status}</div>
    <footer className="mt-8 flex flex-wrap items-center gap-2 border-t border-border/70 pt-6">
      <Button onClick={onContinue}>Continue</Button>
      {onBack ? <Button variant="ghost" onClick={onBack}>Back</Button> : null}
      <p className="basis-full pt-1 text-xs text-muted-foreground">Change this any time in Settings › Appearance.</p>
    </footer>
  </section>;
}
