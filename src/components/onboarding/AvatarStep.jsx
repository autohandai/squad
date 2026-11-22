import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AVATAR_STYLES, birdFaceSvg } from "@/lib/bird-faces";
import { paintedAvatarSrc } from "@/lib/bird-cast";
import { cn } from "@/lib/utils";

// One bird from each country the cast comes from, plus the Chief of Staff's kea.
const PREVIEW_BIRDS = ["kiwi", "tucano", "baldeagle", "kea"];

/** A bird in a style: the painted picture when one is installed (ADR-0271), else the drawn face with the style's filter. */
function StyledBird({ bird, style, size = 256, className }) {
  const painted = paintedAvatarSrc(bird, style, size);
  if (painted) return <img src={painted} alt="" draggable={false} className={cn("shrink-0 rounded-full bg-muted object-cover", className)} />;
  return <span aria-hidden="true" className={cn("member-face inline-block shrink-0 overflow-hidden rounded-full bg-muted", className)} dangerouslySetInnerHTML={{ __html: birdFaceSvg(bird, { style }) }} />;
}

/** Onboarding: Flat, 3D or Clay for every member's picture. Saves at once to the store Settings › Appearance uses. */
export function AvatarStep({ avatarStyle = "flat", onChange, onBack, onContinue }) {
  const [peek, setPeek] = useState(null);
  const [status, setStatus] = useState("");
  const shown = peek || avatarStyle;
  function choose(next) {
    if (next === avatarStyle) return;
    onChange?.(next);
    setStatus(`Saved. Your squad shows ${AVATAR_STYLES.find(item => item.id === next).label} avatars now.`);
  }
  return <section aria-labelledby="avatar-style-heading" data-testid="onboarding-avatar-style">
    <h1 id="avatar-style-heading" tabIndex={-1} className="text-3xl font-semibold tracking-tight">Choose how your squad looks.</h1>
    <p className="mt-3 text-base text-muted-foreground">Every member is a bird from New Zealand, Brazil or the United States. Pick the style for all of them.</p>
    <div aria-hidden="true" data-testid="avatar-style-preview" data-style={shown} className="mt-8 flex items-center justify-center gap-5 py-6 sm:gap-8">
      {PREVIEW_BIRDS.map(bird => <StyledBird key={`${shown}-${bird}`} bird={bird} style={shown} size={512} className="size-16 onboarding-step-enter sm:size-24" />)}
    </div>
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold">Avatar style</legend>
      <div className="mt-2 divide-y divide-border/70" onMouseLeave={() => setPeek(null)}>
        {AVATAR_STYLES.map(item => {
          const checked = avatarStyle === item.id;
          return <label key={item.id} onMouseEnter={() => setPeek(item.id)} className="group flex cursor-pointer items-center gap-3 py-3.5 has-[:focus-visible]:rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            <input type="radio" name="squad-avatar-style" value={item.id} checked={checked} onChange={() => choose(item.id)} className="sr-only" aria-describedby={`avatar-style-${item.id}-detail`} />
            <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">{checked ? <Check className="size-4" /> : null}</span>
            <StyledBird bird="kiwi" style={item.id} className="size-8" />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", checked ? "font-semibold" : "text-foreground/85")}>{item.label}</span>
              <span id={`avatar-style-${item.id}-detail`} className="mt-0.5 block text-sm text-muted-foreground">{item.description}</span>
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
