# ADR-0042: The permission policy is code you can run

Date: 2026-09-28
Status: Accepted

## Context

ADR-0041 fixed two permission faults and left one thing unfinished, recorded
there in its own consequences: the ladder grant was guarded by a regular
expression over `src/App.jsx`, because the policy lived in a file Node cannot
import. That guard asserts the source says something, not that the program
does something. It would pass on a policy that says the right words and
computes the wrong answer.

That mattered here more than usual. Both faults ADR-0041 fixed were silent:
nothing errored, no test failed, members simply could not use skills and a
permission you set went back to blocked. A test of the text would not have
caught either.

## Decision

**The policy moves to `src/lib/permission-policy.js`.** It carries the tool
groups, the default mode of every tool, the set of tools that keep auto-merge
off, and the function that computes a policy for a rung of the ladder. It is
pure: no React, no DOM, no icons.

**The ladder function takes a rank, not a level id.** That is the one change
of shape, and it is what lets the module stand alone: the ladder's labels,
summaries and icons are presentation and stay in the app, while only the
policy comes out. The single call site passes `autonomyLadderRank(level.id)`.

**`scripts/check-permission-policy.mjs` runs it.** It asserts every rung
answers for every known tool with a real mode, that a nonsense rank still
produces a complete policy rather than throwing, that the ladder never gets
more restrictive as it climbs, that the lowest rung is a conversation and not
a shell, that merging and deleting are blocked at every rung, and that a
member can use its own skills at every rung. Removing the skills grant makes
it fail with "rank 1 lets a member use its own skills".

The regular expression in `scripts/check-permissions.mjs` is gone. That file
keeps what only it can do: start a real bridge and prove an agent-less request
cannot erase a member's permissions.

## Consequences

- The policy can be read and exercised without the app. That is the point:
  the two faults it now guards were both invisible from inside the product.
- `src/App.jsx` is about 190 lines smaller, and the tool list has one home.
- The ladder's presentation is still in the monolith. Splitting policy from
  presentation is the right line, and moving the labels and icons too would
  have meant pulling lucide into a module the bridge may one day import.
- `check-bridge-imports` covers this module the moment anything under
  `server/` imports it. Nothing does today, and the desktop app ships
  `src/lib`, so it would work if something did.
