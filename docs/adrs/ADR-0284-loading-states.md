# ADR-0284: Six loading patterns, chosen by what is known

Status: accepted, 2026-11-26

## Context

The owner asked for Squad's loading states to follow a loading-states cheat
sheet (x.com/AdheebHameed/status/2125590653354782863): six small patterns on
a calm canvas — a progress bar with its percentage, a "Saving" ring that
becomes "Saved" with a green check, a "Thinking…" text shimmer, a skeleton
card, an indeterminate bar along a card's top, and a "Reading files /
Searching / Writing" checklist moving from an empty circle to a ring to a
green check.

What Squad had, from a sweep of `src/` (Loader2, LoaderCircle, animate-spin,
Spinner, Skeleton, "Loading…", "is typing"):

- `ui/spinner` was lucide's `Loader2Icon` spinning, always announced as
  "Loading", even beside words that said the same; seven more places spun
  `Loader2`/`LoaderCircle` directly (artifact preview, memory "Updating…",
  reset, phone pairing, attachments, the menu bar step's "Saving…").
- `ui/skeleton` pulsed (`animate-pulse`); marketplace and Work used it.
- A member's reply in progress showed a spinner beside its stage
  ("Waiting for the first response…"), and channels said "Eva is typing…"
  in plain muted text.
- The member task checklist used lucide icons: a check, a spinning
  `LoaderCircle`, an empty `Circle`.
- History said "Loading…" in a line; the connectors catalogue a spinner line;
  the update download used the analytics `Progress` (a thick primary bar).

## Decision

One set of components (`src/components/ui/loading.jsx`, plus the rewritten
`spinner.jsx` and `skeleton.jsx`) and one set of motions in `styles.css`
(`.loading-ring`, `.loading-text-shimmer`, `.loading-skeleton`,
`.loading-indeterminate`), picked by what is known about the wait:

- a measured total → `LoadingProgress` (update download);
- a save → `SaveStatus` beside the button (memory settings, the menu bar
  step), keeping DESIGN.md's rule that spinners stay out of buttons;
- a member composing → `TextShimmer` (reply stage, channel "is typing…");
- a list's first load → `Skeleton` rows in the final layout (History now;
  marketplace and Work inherit the sweep);
- an unknown wait inside a panel → `IndeterminateBar` above the quiet line
  (connectors catalogue);
- reported steps → `StepGlyph` marks in `ProgressChecklist` and
  `AgentTaskChecklist`.

The ring replaces lucide's spinner everywhere through `Spinner`; it stays
announced by default (the old contract) and is `aria-hidden` where words
beside it already say what is happening. Under reduced motion the sweep and
slide stop and the words and bars still read.

Kept on purpose: completed member tasks stay crossed out
(`verify-goals-browser` pins it, and it is how a finished step reads in the
chat), and Settings keep their one quiet line rather than skeletons
(DESIGN.md, Settings motion). The analytics `Progress` meters are unchanged:
they are measures, not loading.

## Consequences

- Behaviour is unchanged; only presentation. The memory settings button now
  always says "Save changes" and the status beside it says Saving…/Saved.
- Not converted yet: buttons that still carry a spinner while busy (custom
  connector, onboarding folder steps, pairing), "Loading…" placeholders in
  the member history pager, marketplace listing detail and model picker, and
  the per-channel header spinner. They work; they are the next pass.
- The checklist pattern is used where steps are reported (a member's task
  progress); Squad does not invent steps from tool calls it cannot see.
- The gallery used by the check lives in `scripts/fixtures/loading-gallery`
  and is built with the app's own Vite config and stylesheet; its own layout
  is inline so Tailwind's source list stays the app's.

Evidence: `node scripts/check-loading-states-browser.mjs` (new,
`check:loading-states:browser`): roles and values (progressbar 18%, "Saving…"
→ "Saved" with its check, shimmer text, busy indeterminate bar, checklist
completed/in progress/pending, member tasks with a ring only on the live step
and completed still crossed), all four motions running in light and dark and
stopped under reduced motion, and a real chat whose reply never ends showing
its stage as shimmer with no spinner, in light and dark. Also run:
`check:render`, `check:chat-experience`, `check:connectors`,
`check:onboarding:browser`, `check:server`, `check:updates:playwright`, build.
`check-chat-timing-browser` and `check-memory-browser` fail identically on
origin/main 698ec7d (the first stops at onboarding because it seeds
unowned localStorage; the second needs the memory index daemon binary), so
they were not used as evidence here.
