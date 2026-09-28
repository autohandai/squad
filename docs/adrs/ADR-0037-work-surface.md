# ADR-0037: Mission Control becomes Work

Date: 2026-09-28
Status: Accepted

## Context

The owner asked more than once for this page to be redesigned "or call
something entirely different". Driving it showed why.

**It rendered white inside a dark app.** The page frame set
`bg-[#fafafa] text-[#2f2f2f] dark:bg-[#fafafa] dark:text-[#2f2f2f]`, which
forces the light palette in dark mode on purpose. Below it the components
carried 127 more hard-coded hex values. The page was a parallel design system
that did not know the rest of the product existed.

**It was the layout DESIGN.md forbids.** A 5.5rem display headline, a
sentence describing the page to itself, four metric tiles in a bordered box,
and a "Squad Board" of bordered cards in a four-column grid. Then a
five-column table above 1280px with a stack of cards below it, so one list had
two layouts and neither fitted the column. Then a permanent glossary of what
each status means, taking half the page.

**The name promised something else.** "Mission Control" is a NASA metaphor
for a command centre. The page is a roster of who is on what.

## Decision

**It is called Work.** Short, literal, and it says what the page answers.
The route is unchanged, since a desktop app never shows it.

**One sentence instead of four tiles.** "2 working · 3 blocked" names only
what is true right now, so a quiet squad reads as quiet rather than as four
zeroes. Four numbers in a bordered box is a dashboard telling you it has
numbers.

**One row grammar, everywhere.** Members and work records are divider rows in
one column: what it is, one line of detail, then a dot-and-word status with
the workspace and any marks beside it. The table and the cards are both gone,
and with them the question of which one a given width gets.

**A status is a dot and a word.** The tinted container it used to draw put a
coloured rectangle on every row of every list, saying the state as loudly as
the work.

**A selected record is marked, not filled**, with a quiet left border. A
tinted block on one row of a divider list is the only thing on the page that
reads as a card.

**Filters are text toggles**, underlined when active. They were outlined
buttons, which read as five things to press rather than one choice with five
values.

**The status glossary is gone.** It is documentation, and it was standing in
an operating view.

## Correction, same day: it had no way in

Renaming it surfaced a second fault the rename made worse. Work has no row in
the sidebar and never did. The only ways to it were the command palette, the
account menu, a Settings row, and links out of Inbox handoffs. Changing the
name changed the word someone would look for, on a page they already could not
find, which is why the owner asked where it had gone.

It now sits in the sidebar beside Inbox and Agents, with a count of tracked
tasks, and the command palette still matches "mission control" so the old
name keeps working as a search term.

## Consequences

- The page renders correctly in both themes, which it did not before. Every
  colour now comes from a token, so a future theme change reaches it.
- Density is lower. The five-column table showed repository, run id, blocker,
  evidence and next action side by side; the row shows the same fields
  stacked. That is the trade for a layout that fits its column and reads the
  same at every width.
- "Everyone" and "Active and recent" still overlap: a member working on
  something appears in both. The first answers who is free, which the second
  cannot, so both earn their place, but the repetition is real and worth
  revisiting once the page has been lived with.
- Only the user-visible name changed. The route, the components and the row
  builder are still called mission control internally, which is honest about
  what was renamed and what was not.
