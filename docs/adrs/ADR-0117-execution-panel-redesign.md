# ADR-0117: The Execution panel reads as part of the app

Date: 2026-10-14
Status: Accepted

## Context and evidence

The person opened the Execution panel beside a member's chat and said: "i'm
also not enjoying the look and feel of this design on the side here, i
honestly don't see how this is well integrated with the overall existing
app, feels like not well designed too."

What the panel actually did, read in `src/App.jsx` on 2026-10-14 and
photographed with `scripts/check-execution-panel-browser.mjs` before any
change (`.codex-artifacts/lanes/execution-panel/before/*.png`):

- The header was a count line of three figures, "2 parent tasks · 1 handoff
  · 0 blocked", bold numbers first. A member with nothing going on read as
  three zeroes.
- The "Now" strip listed up to three tasks of any status, so it showed
  completed tasks under the word NOW, each with a filled pill badge.
- The tabs were shadcn `TabsTrigger`s with a `border-b-2` class added on top.
  The primitive's own styles stayed underneath: `rounded-md border
  border-transparent`, `data-[state=active]:bg-background`, and in dark mode
  `data-[state=active]:border-input bg-input/30`. The result was three boxed,
  bordered buttons stretched across the sheet, which is what the person saw
  and what DESIGN.md already said not to do ("underlined text tabs").
- A run row was a large circled check or triangle icon, the raw prompt in
  bold, a meta line "Alex · execution-panel · Anthropic / opus · Claude Code
  · chat reply · linked task", a status pill, a handoff icon, and the output
  disclosure. Since ADR-0113 every reply is a run, so that row repeated for
  each chat turn and the meta line repeated the member's own engine on every
  one of them.
- Titles truncated mid-word, and in the headless screenshots the title ran
  past the sheet: the panel's lists sat in a Radix `ScrollArea`, whose
  viewport lays its content out as `display: table`, so a `truncate` child
  never shrank and the `scrollIntoView` for a `?panel=runs&run=<id>` link
  shifted the whole list sideways by the sheet's padding.
- The handoff block on a task was a bordered quote with icon buttons; a
  failure reason sat in a tinted destructive box. Automations were cards
  (`rounded-lg border bg-muted/25 p-4`) with a badge and a secondary button.
  Empty tabs were bordered `Empty` tiles with an icon.
- `MISSION_STATE_MATRIX`, `SQUAD_FILTERS`, `MissionMemberCell` and
  `missionStatusClass` were defined in `src/App.jsx` and referenced nowhere
  else (`grep -rn` over `src`, `scripts`, `server`: one hit each, the
  definition).

## Decision

**The panel is a plain sheet in the app's own grammar**, built from new
files under `src/components/execution/` and mounted from `src/App.jsx` with
the same props as before plus the app's avatar component, bridge client and
label helpers (`ExecutionPanel`, `RunList`, `TaskList`, `AutomationList`,
`HandoffDialog`, `bits`). Pure wording and grouping live in
`src/lib/execution-panel.js`; the four task-handoff lookups the chat
integrator also uses moved to `src/lib/handoffs.js`.

- **Title and one sentence.** "Execution", then only what is true now: "1
  running · 2 open tasks · 1 handoff waiting · 1 blocked", zero counts left
  out, "Nothing running right now." when all are zero. Blocked is the only
  coloured word.
- **Now** is a short divider list of open tasks (at most three) and renders
  nothing when none is open.
- **Tabs** are the same underlined text tabs as History and Needs you: plain
  `role="tab"` buttons with `border-b-2`, the active one in the foreground
  colour. No shadcn `Tabs`, so the primitive's box can not come back.
- **Runs** are grouped by day (Today, Yesterday, then the date) and each run
  is one line: a status dot in the presence vocabulary (accent and breathing
  while running, quiet grey when completed, destructive when failed, amber
  when stopped), the member's avatar and name, the person's question cut on
  a word with an ellipsis, and the time at the right ("6m" within the hour,
  the clock otherwise). The muted second line says "chat reply", "goal" or
  "launched", then the engine and the model only when they differ from what
  the member normally runs with, the duration, and "linked task". Failed and
  stopped runs carry the word in colour. Handoff is a hover-revealed icon,
  Stop is a text button on a live run (it posts to `/api/runs/:id/stop`,
  which ADR-0113 documented and nothing in the panel called). The output
  disclosure stays a text toggle feeding the shared activity feed.
- **Consecutive replies are not collapsed.** The question is the only thing
  that tells two replies apart, a collapsed row would hide exactly that, and
  a run record carries no conversation id to group by. The day headings and
  one-line rows carry the density instead.
- **Tasks** use the Needs-you row grammar: dot, title, dot-and-word status;
  owner, project, assignments and time in one muted line; the handoff as an
  indented block of text with small outline decisions; a failure reason as
  destructive text, not a box.
- **Automations** are divider rows: name, schedule and workspace, a text
  "Run now", the switch.
- **Empty tabs** are one sentence.
- The lists scroll in a plain `overflow-y-auto` column instead of the
  `ScrollArea` primitive, for the truncation and sideways-scroll reasons
  above.
- The Profile page's run list used the same `RunList` and now imports the
  new one, so a member's profile and the panel show runs the same way.
- The dead code named above was removed.

## Evidence

- `bun run build` passes; `node scripts/check-render.mjs` passes (dist/
  mounts in headless Chrome with no error boundary and no script errors).
- `scripts/check-execution-panel-browser.mjs` (`bun run
  check:execution-panel:browser`) seeds a bridge with seven finished runs
  across four days (chat replies, a goal, a failed launched run on another
  engine, a stopped reply), two tasks with a pending handoff and one
  automation, opens the member chat through `?panel=runs&run=<id>`, and
  asserts the panel is open on that run with its output disclosed, that the
  Tasks and Automations tabs render their rows, and that no exception was
  thrown, in light and dark. With `--shots` it writes the PNGs; the after
  set is `.codex-artifacts/lanes/execution-panel/after/*.png` (that folder
  is gitignored, so the pictures stay on the machine that made them).
- The before screenshots show the three boxed tabs, the pills, and the
  title running out of the sheet; the after screenshots show one-line rows
  under day headings with the time at the right in both themes.
- `bun run check:activity`, `check:work-attention` and `check:goal-bridge`
  were run after the change; see the lane report for their results.

## What was learnt at merge

On main the browser check failed twice at "the Tasks tab to be active"
while it passed in the lane: the press was dispatched at a rect read while
the sheet was still sliding in, landed on the overlay, and Radix closed the
sheet as an outside click (a diagnostic dump showed no sheet at all at that
moment). The check now waits until the tab has stopped moving before
pressing. Timing, not the panel, was the difference between the two
machines' states.

## Consequences

- Chat replies and launched runs still share one list with no filter
  between them; the kind word on each row is the only distinction.
- Engine and model are compared with the member's current harness setting.
  A member whose engine was changed after a run shows that run's engine as
  if it were an exception, which it was at the time.
- Only English copy was added (`src/locales.js`), with literal fallbacks in
  the components; the other locales show English for the new sentences.
- The "Now" list and the summary count a task as open by status; a task the
  bridge has already finished but still carries a pending handoff counts
  once as "handoff waiting" and not as open.
- Stop on a live run is new behaviour the old panel lacked; it is a text
  button with no confirmation, matching the chat header's Stop.
- `HandoffDialog` kept its form and its default texts; only the boxed
  source summary became a line of text. The role-based recommendation list
  is unchanged.
- The screenshot harness runs only where Chrome exists and is in the `ci`
  chain after `check:chats:browser`; on a machine without Chrome it warns
  and passes like the other browser checks.
- The two-line run row is about 60px tall with its disclosure, so a member
  with hundreds of replies still produces a long list; paging was not added.
