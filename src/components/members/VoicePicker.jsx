import { useEffect, useState } from "react";
import { Check, Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { KALE_VOICES } from "@/lib/member-voice";
import { getPageReader } from "@/lib/read-aloud";
import { cn } from "@/lib/utils";

const GROUPS = [["female", "Women"], ["male", "Men"]];

/**
 * A member's reading voice (ADR-0276): the ten kale-tts-1 voices in two
 * columns, women and men, each with a sample read in that voice. `value` is a
 * voice id; `onChange(id)` saves it. Rows are radio buttons; the speaker plays
 * a sample without choosing.
 */
export function VoicePicker({ value = "", onChange, memberName = "", className }) {
  const reader = getPageReader();
  const [state, setState] = useState(() => reader.snapshot());
  useEffect(() => reader.subscribe(setState), [reader]);
  const sample = (voice) => `Hi, I'm ${memberName || voice.name}. This is how I'll sound when I read my replies to you.`;

  function play(voice) {
    const id = `voice-sample-${voice.id}`;
    if (state.id === id) { reader.stop(); return; }
    reader.speak({ id, text: sample(voice), voice: voice.id });
  }

  return (
    <div className={cn("grid gap-x-6 gap-y-1 sm:grid-cols-2", className)} role="radiogroup" aria-label={`${memberName || "Member"}'s voice`} data-testid="voice-picker">
      {GROUPS.map(([gender, label]) => (
        <div key={gender} className="min-w-0">
          <p className="pb-1 text-xs font-medium text-muted-foreground">{label}</p>
          <div className="divide-y divide-border/60">
            {KALE_VOICES.filter((voice) => voice.gender === gender).map((voice) => {
              const checked = voice.id === value;
              const playing = state.id === `voice-sample-${voice.id}` && state.status !== "idle";
              return (
                <div key={voice.id} className="flex items-center gap-1">
                  <button type="button" role="radio" aria-checked={checked} onClick={() => onChange?.(voice.id)} data-voice={voice.id}
                    className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm py-2 pr-1 text-left focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden="true">{checked ? <Check className="size-4" /> : null}</span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm", checked ? "font-semibold" : "text-foreground/85")}>{voice.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{voice.description}{voice.accent === "British" ? " · British" : ""}</span>
                    </span>
                  </button>
                  <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={playing ? `Stop ${voice.name}'s sample` : `Hear ${voice.name}`} title={playing ? "Stop" : `Hear ${voice.name}`}
                    onClick={() => play(voice)} data-voice-sample={voice.id}>
                    {playing ? <Square className="size-2.5 fill-current" /> : <Volume2 className="size-3.5" />}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
