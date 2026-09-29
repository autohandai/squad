# ADR-0057: One memory shape, and every reader knows it

Date: 2026-09-29
Status: Accepted

## Context

ADR-0048 made a member's memory a list of `{ id, text, at, source }` so a lesson
could be recorded once and stop being repeated. `normalizeAgentCopy` was updated
and the repetition stopped.

Six other places still read memory as plain strings, and none of them failed in
a way that said so:

- The member profile's Home section did `agent.memory.map(item => item.split(":")[0])`.
  On a member with any memory, that threw `split is not a function` and the
  error boundary replaced the entire page with "Autohand Squad could not
  render". `/squad-members/<id>` — the bare profile URL — was unreachable.
- The Memory page rendered each entry as a React child: error #31, "objects are
  not valid as a React child", the whole page gone again.
- Three prompt builders interpolated entries into strings, producing
  `- [object Object]` in a member's own context — the same failure ADR-0048 was
  written about, in three places it had not looked.
- Accepting a memory-inbox item appended a raw string into an array of objects
  and deduplicated with a `Set`, which cannot compare objects by value, so
  accepted memories entered in the wrong shape and never deduplicated.

The profile crash was reported by a teammate session as an aside. Verifying it
is what turned up the rest.

## Decision

Every reader goes through `normalizeMemoryEntries`, which already accepts both
shapes and returns the current one. Renderers use `entry.text` and `entry.source`
and key on `entry.id`; prompt builders map to `entry.text` first; the accept path
appends a real entry and deduplicates with `memoryKey`, the helper that already
knows how to compare either shape.

The Home section also stopped claiming every memory was learnt "3 days ago" — a
hardcoded count sitting next to a real `at` timestamp — and now formats `at`.

## Consequences

- `check-chief-of-staff.mjs` now reads `src/App.jsx` and fails on any line that
  reads `agent.memory` or `owner.memory` without naming `normalizeMemoryEntries`,
  `memoryKey` or `memoryLabel`. An `Array.isArray` guard is explicitly not an
  exemption: it is how both crashes were written. Verified by reintroducing the
  Memory page bug and confirming the check fails, then restoring it and
  confirming it passes.
- Measured with a member holding memory in both shapes at once — one object and
  one legacy plain string — `/squad-members/<id>` and `/squad-members/<id>/memory`
  both render.
- A shape change is only done when every reader has been found. Updating the one
  reader that prompted the change and stopping there is what produced this.
