import { useEffect, useRef, useState } from "react";
import { RotateCcw, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Reasoning effort as one sliding control (ADR-0114, second revision).
 * Stops are "Engine default" then each level the engine accepts, left to
 * right. The thumb and the filled range slide, the level name fades up when
 * it changes, the bolt pulses once, and a quiet reset returns to the default.
 *
 *   levels        the engine's levels in order (e.g. low … max)
 *   value         "" for the engine default, else one of levels
 *   defaultLabel  what "" means, e.g. "Engine default (xhigh)"
 *   onChange      (value) => void
 */
export function EffortSlider({ levels = [], value = "", defaultLabel = "Engine default", onChange, disabled = false, id = "effort", label = "Reasoning effort", className = "" }) {
  const stops = ["", ...levels];
  const index = Math.max(0, stops.indexOf(value));
  const [pulse, setPulse] = useState(0);
  const [labelKey, setLabelKey] = useState(0);
  const previous = useRef(index);

  useEffect(() => {
    if (previous.current === index) return;
    previous.current = index;
    setPulse((count) => count + 1);
    setLabelKey((count) => count + 1);
  }, [index]);

  if (!levels.length) return null;
  const current = stops[index];
  const name = current ? current : defaultLabel;

  return (
    <div className={cn("effort-slider flex flex-col gap-2", className)} data-testid="effort-slider">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Zap key={pulse} className={cn("size-4 text-muted-foreground", pulse ? "effort-bolt" : "")} aria-hidden="true" />
          <span id={`${id}-label`}>{label}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <span key={labelKey} className={cn("truncate text-sm", current ? "effort-level text-primary" : "text-muted-foreground")} aria-live="polite">
            {name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-6 text-muted-foreground transition-opacity", current ? "opacity-100" : "pointer-events-none opacity-0")}
            aria-label="Reset to engine default"
            tabIndex={current ? 0 : -1}
            onClick={() => onChange?.("")}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </span>
      </div>
      <div className="relative px-1">
        <Slider
          id={id}
          aria-labelledby={`${id}-label`}
          aria-valuetext={name}
          min={0}
          max={stops.length - 1}
          step={1}
          value={[index]}
          disabled={disabled}
          onValueChange={([next]) => onChange?.(stops[Math.max(0, Math.min(stops.length - 1, Number(next) || 0))])}
        />
        <div className="pointer-events-none absolute inset-x-1 top-1/2 flex -translate-y-1/2 justify-between" aria-hidden="true">
          {stops.map((stop, stopIndex) => (
            <span
              key={stop || "default"}
              className={cn("effort-stop size-1.5 rounded-full", stopIndex <= index ? "bg-primary-foreground/70" : "bg-muted-foreground/40", stopIndex === index && "effort-stop-active")}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>Default</span>
        <span>{levels[levels.length - 1]}</span>
      </div>
    </div>
  );
}
