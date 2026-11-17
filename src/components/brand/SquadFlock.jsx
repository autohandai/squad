import { useMemo, useState } from "react";

import { birdFaceSvg } from "@/lib/bird-faces";
import { FLOCK_LEAD, pickFlock } from "@/lib/flock";
import { cn } from "@/lib/utils";

/**
 * The perch (ADR-0245): a few of the squad's birds sitting on one hairline.
 * It is the animated character of the sign-in and update screens.
 *
 *   idle      birds land one after another, then each glances or hops on its
 *             own slow clock, never together
 *   waiting   a hop passes along the perch: something is happening elsewhere
 *   progress  the perch is the progress bar; the kiwi walks it to the others,
 *             who wait at the far end. Only given a measured `progress`.
 *   error     everyone stops and settles
 *   asleep    dimmed and still: the bridge is not answering
 *
 * Decorative only: the screen around it states every fact in words, and
 * under reduced motion the birds sit still in the same places.
 */
export function SquadFlock({ mood = "idle", progress = null, count = 5, seed, size = 40, gap = 14, track = 0, className }) {
  // One cast per mount: a screen does not reshuffle its birds while open.
  const [birds] = useState(() => pickFlock(count, { seed }));
  // `track` widens the perch (the progress bar wants room to walk); the
  // birds' row never needs more than its own width.
  const width = Math.max(track, birds.length * size + Math.max(0, birds.length - 1) * gap);
  const measured = mood === "progress" && Number.isFinite(progress);
  const fraction = measured ? Math.min(1, Math.max(0, progress / 100)) : 0;

  const seats = useMemo(() => {
    const others = birds.filter(bird => bird !== FLOCK_LEAD);
    if (measured) {
      // The others wait at the far end, side by side; the kiwi walks from
      // the start of the perch to just short of them.
      const step = size + 4;
      const cluster = others.map((bird, index) => ({ bird, x: width - size - (others.length - 1 - index) * step }));
      const end = (cluster[0]?.x ?? width) - size - 6;
      return [{ bird: FLOCK_LEAD, x: Math.round(end * fraction), lead: true }, ...cluster];
    }
    const middle = Math.floor(others.length / 2);
    const row = [...others.slice(0, middle), FLOCK_LEAD, ...others.slice(middle)].filter(bird => birds.includes(bird));
    const offset = Math.round((width - (row.length * size + Math.max(0, row.length - 1) * gap)) / 2);
    return row.map((bird, index) => ({ bird, x: offset + index * (size + gap), lead: bird === FLOCK_LEAD }));
  }, [birds, measured, fraction, size, gap, width]);

  const faces = useMemo(() => Object.fromEntries(birds.map(bird => [bird, birdFaceSvg(bird)])), [birds]);
  const fill = measured ? (seats[0].x + size / 2) / width : 0;

  return (
    <div
      aria-hidden="true"
      data-flock={birds.join(" ")}
      data-mood={mood}
      className={cn("squad-flock relative mx-auto", className)}
      style={{ width, height: size + 10, "--flock-size": `${size}px` }}
    >
      <span className="squad-flock-perch" />
      {measured ? <span className="squad-flock-fill" style={{ transform: `scaleX(${fill})` }} /> : null}
      {seats.map((seat, index) => (
        <span
          key={seat.bird}
          className="squad-flock-seat"
          data-lead={seat.lead ? "true" : undefined}
          style={{ transform: `translateX(${seat.x}px)`, "--i": index, "--n": seats.length }}
        >
          <span className="squad-flock-land">
            {/* The face on its own tile, exactly as a member avatar (ADR-0240):
                the skin's surface and corner, eyes cut through to the tile. */}
            <span className="squad-flock-body member-face bg-muted" data-slot="avatar" data-variant={index % 3} dangerouslySetInnerHTML={{ __html: faces[seat.bird] }} />
          </span>
        </span>
      ))}
    </div>
  );
}
