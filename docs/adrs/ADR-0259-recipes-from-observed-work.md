# ADR-0259: Recipes come from the work this Squad does

Status: Accepted
Date: 2026-11-19

## Context

The owner, 19 November 2026: "i don't understand the launch recipe feature, we
should be more clever on that one and the recipes should be actually coming
from observations of the chief of staff based on the work being done and we
need to also organise this better."

What the feature was: a "Launch recipe" button on Needs you (now Inbox) and
"Browse recipes" in the composer's launch options, both opening "Run
recipes": five built-in engineering workflows from `src/data.js` (fix a
failing test, review a PR, …) with model, tools, permission level and done
criteria. Nothing in it came from what this Squad actually does; a growth or
support Squad saw a list for a developer.

Squad already keeps the last 200 runs with the member and the person's own
words (`personPrompt`), and the Chief of Staff reads the team's work through
the Squad MCP.

## Decision

- **Spotted in your work** (`src/lib/recipe-observations.js`): requests to the
  same member whose content words overlap by half or more (Jaccard ≥ 0.5,
  ignoring links, numbers, dates and stop words), made at least three times on
  at least two different days, are suggested with their evidence ("You asked
  Tatiana for this 3 times since 2026-11-14"). Channel, routine and team runs
  and runs started from a recipe are not counted. The person saves one with
  one click.
- **Saved by the Chief of Staff.** Members get `squad_save_recipe` and
  `squad_list_recipes`; the team instructions tell a member that notices the
  person asking for the same kind of work to save it once, with evidence. A
  recipe saved by a member whose role is Chief of Staff is marked so.
  Saved recipes live in `recipes.json` in the Squad's state (`/api/recipes`,
  at most 100; saving the same request for the same member updates it).
- **Organised as Saved, Spotted in your work, Starters.** The dialog is
  called Recipes; the Inbox button says Recipes; the five built-ins are
  Starters, collapsed at the bottom. Running a saved or spotted recipe opens
  the same launch dialog with its member and request filled in.

## Evidence

`scripts/check-recipes.mjs` (in `check:server`): three similar requests to
Tatiana on three days are spotted with the right count, name, newest wording
and evidence line; the same request to Eva, three identical requests on one
day, a recipe-started run and an already-saved request are not; the store
rejects a missing name, updates on a repeat save and removes. `check-team`
passes with the two tools and their permission rows.

## Consequences

- The spotter sees only the 200 runs Squad keeps, so a weekly habit needs a
  few weeks before it shows; it works on words, not meaning, so the same job
  phrased very differently is two patterns. The Chief of Staff is the path
  for those.
- Saved recipes run with the member's current settings; they do not carry
  the starters' model, permission level or done criteria.
- The Chief of Staff saves recipes only when it is working and notices; there
  is no scheduled review of run history by the Chief of Staff yet.
