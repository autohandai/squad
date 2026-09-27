# ADR-0033: Something on screen before the app is ready

Date: 2026-09-28
Status: Accepted

## Context

`index.html` carried an empty `#root` and nothing else. Between the window
opening and React mounting, the app was a blank rectangle: no logo, no name,
no sign it was doing anything. On the desktop app the bridge also takes a few
seconds to start, so the wait is real and visible.

## Decision

**The first frame is inline.** The boot screen lives in `index.html` with its
own `<style>`, because anything imported arrives too late to help: a
stylesheet or a component can only paint after the very fetch the person is
waiting on. It shows the mark, the name, and one line. React removes it after
two frames, so it fades over the mounted app rather than over nothing, and a
timeout removes it anyway for a browser that skips the transition.

**Then the checks are real.** Until the bridge has answered once, the app
renders `BootChecks`: interface loaded, squad read with its count, bridge
starting. Each row reflects something that actually happened. No progress bar,
because a bar that is not measuring anything is a lie told smoothly.

Once the bridge answers, the boot screen goes, whether the answer was good or
bad. A bridge that is down is explained better by the shell itself than by a
splash that refuses to leave.

**The playful part is true.** Member avatars appear as the squad is read, each
settling in with a 220 ms fade and a 4px rise, staggered 70 ms apart and
capped at eight. It is charming because it is showing you your own squad
arriving, not because something is bouncing. Reduced motion drops the
animation and the breathing mark; the screen still says everything it said.

## Consequences

- The window is never blank, even on a cold start with an empty HTTP cache.
- The boot screen is duplicated knowledge: its colours are literal values in
  `index.html`, not design tokens, because tokens live in the stylesheet that
  has not loaded yet. It is deliberately two colours and one radius so the
  duplication stays trivial.
- The checks are coarse. They say the bridge is starting, not which of its
  parts is slow. Anything finer means the bridge reporting progress before it
  can answer requests, which it currently cannot.
