# ADR-0231: fallbacks where the engine is chosen, and a header that names who answers

Status: accepted. Amends ADR-0222 (fallback rows and "Using X while Y").

## Context and evidence

On 2026-11-16 the owner's Chief of Staff (primary Autohand Code) replied
"fallback via Claude Code · claude-opus-5-5" after the Autohand quota ran out,
while the chat header still read "Autohand AI / auto · Autohand Code". The
owner had asked several times to choose fallback engines and models from the
connected engines, and could not find where.

What the code did:

- The header's engine label was `harnessLabel(harnessForAgent(agent).id)`:
  always the saved primary. The model label came from the primary assignment.
  The router's saved health (`GET /api/members/:id/model-routing`) already
  knew the primary was cooling down (`["autohand","","",""]` quota) and that
  Codex was too, so Claude Code answered.
- The header's engine popover offered only "Runs with" (the primary). The
  fallback editor existed (ADR-0222) but only on the member's Model page,
  behind each row's … → Change engine or model.
- `initialMemberExecution` saved every ready engine except the primary, in
  catalog order. On the owner's Mac that produced Codex, Claude Code,
  `autohand-acp` and `acp:autohand`: two more Autohand engines behind an
  Autohand primary, which share its quota and fail with it. Claude Code was
  saved with `model: ""` because its catalog reports no default model, even
  though it lists fable, opus, sonnet, haiku.

## Decision

1. **The header names the engine that answers now.** `engineInUse()` in
   `src/lib/model-routing.js` reads the router's health the same way the
   Model page does. While a fallback answers, the header shows
   "Claude Code · fallback" with the fallback's model and, as its title and
   accessible name, "Using Claude Code while Autohand Code has reached its
   usage limit". If nothing can answer it says so. It refreshes every 30 s,
   on focus and whenever the latest message's status or engine changes.
   The first version refreshed on message count only and missed the switch,
   because streamed replies update the last message in place; the browser
   check caught it.
2. **Fallbacks are chosen in the same popover as the engine.** Under
   "Runs with", "If Autohand Code can't answer" lists the ordered fallbacks,
   each with an engine picker and a model picker filled from that engine's
   reported models, an In use badge, Switch back, Add, and Move/Remove in a
   … menu. Each change saves at once. The Model page keeps the full editor.
3. **Better automatic defaults.** One fallback per company (vendor, with
   "Autohand" and "Autohand AI" treated as one), never the primary's own
   company, first-party CLIs before ACP adapters, and the engine's default
   model or else the first model it lists. Adding a fallback by hand picks a
   model the same way.

## Revision (same day, after the owner tried it)

The first compact rows stacked two full-size pickers per fallback with
different text sizes, a refresh button per row, and the model catalog's raw
error (`spawn …/autohand-acp EACCES`). They also had no reasoning effort and
let the same engine appear twice, including the primary as its own fallback.
Now each row is the engine picker, then model and reasoning effort side by
side (effort only when that engine reports levels: Codex minimal–xhigh,
Claude Code low–max on the owner's Mac), all at one small size. Refresh is an
item inside the model list, and an unavailable catalog reads "Couldn't list
models. It will use its default." with the detail as its tooltip. Engine
choices exclude the primary and engines other rows already use, and Add is
disabled when none remain.

## Consequences

- Existing members keep their saved fallbacks; defaults apply only at
  creation. The owner's Chief of Staff still has the two Autohand adapters
  until they are removed in the new popover.
- "First model it lists" depends on the engine's own ordering; for Claude
  Code today that is `fable`. A person can change it in one click, which is
  the point of putting the picker in the header.
- Company grouping relies on the catalog's `vendor` strings; an engine with
  no vendor is its own company.
- Verified: `node scripts/check-member-default-routing.mjs` (new
  one-per-company and engine-in-use assertions) and
  `node scripts/check-model-fallbacks-browser.mjs` (new header and popover
  assertions, screenshot `.codex-artifacts/model-fallbacks-20261029/header-engine-menu.png`)
  pass, as do `check:engine-model:browser` and
  `check:member-execution-defaults:browser`.
