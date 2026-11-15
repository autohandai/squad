# ADR-0222: Fallbacks say which engine is answering, in Codync's shape

Status: Accepted
Date: 2026-11-16

## Context

The owner asked for "individual failover similar to Codync for the harness
associated with an agent", with screenshots of Codync's Agent settings: a
line "Using Codex while Claude Code can't answer" with **Switch back**; compact
numbered fallback rows (engine icon, "Codex · Default", a status line, an
**In use** badge, a "…" menu); a **+** to add; the explanation behind an (i)
popover; and "Let the bot change its fallbacks".

Squad already had the engine side (ADR-0155, ADR-0202): an ordered chain of
up to four fallbacks per member, a router that switches on usage, sign-in,
overload and startup failures, a five-minute cooldown in persisted health
state, attribution on the reply and Retry primary now. What it lacked was the
experience: the Model page never said which engine was answering, every row
was a fully expanded editor with arrow and trash buttons, the rules were two
paragraphs of body text, and edits waited for a separate Save fallbacks.

## Decision

`MemberFallbacks` keeps the routing model and API and changes the surface:

- A status line appears only while the primary is cooling down: "Using
  {fallback} while {primary} {reason}", or "{primary} {reason} and no
  fallback can answer. Tries again at {time}." **Switch back** clears the
  member's routing health (the existing reset endpoint). It is derived from
  the router's own `health` (route key → `blockedUntil`, `reason`) and the
  same primary/route keys the router uses, refreshed every 30 s and on focus.
- Rows are compact: number, a neutral engine glyph (Squad shows no vendor
  logos), "{Engine} · {model or Default}", and a status line only when true:
  "{reason} · tries again at {time}" or the engine's own not-ready detail.
  The first non-cooling, ready fallback after a cooling primary is **In use**.
  We do not show "usage resets at": Squad knows its retry time, not the
  provider's reset.
- **+** adds a row and opens its editor; the "…" menu offers Change engine or
  model, Move up, Move down and Remove. Reorder, remove and the member
  permission save immediately; an editor saves with Done. A failed save
  keeps the edit visible with Retry and Discard, as the old form did.
- The rules (what triggers a switch, cooldown, permissions, API-key billing)
  move to an (i) popover; one sentence stays visible.

## Evidence

`node scripts/check-model-fallbacks-browser.mjs` (ported to the new
interactions) passes: catalog choices, a refused save kept with Retry, two
fallbacks added and reordered through the menu with immediate persistence,
reload, the member permission, a real failover answer attributed to Codex,
then the Model page showing "Using Codex while Autohand Code has reached its
usage limit" with **In use** on the Codex row, and Switch back clearing both.
`node scripts/check-member-management-browser.mjs` passes with automatically
assigned fallbacks visible in the collapsed rows.

## Consequences

- One save button is gone; edits persist as made. An accidental Move or
  Remove saves at once (there is no undo; re-adding is two taps).
- The status is as fresh as the last health read (≤ 30 s, or on focus), not
  pushed live from the router.
- No vendor logos; the glyph is the same for every engine.
- The phone app does not yet show which engine is answering.
