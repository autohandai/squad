# ADR-0045: Squad is the roster, Work is the log

Date: 2026-09-29
Status: Accepted

## Context

The owner put our Squad page beside a competitor's Agents page and said "we
should bring a Staff level product designer to organise ours better." A staff
designer drove both pages before proposing anything. Measured at 1400x900 with
eight members:

| | Squad | Work |
| --- | --- | --- |
| first member row starts at | 502px | 145px |
| page height in viewports | 1.42 | 1.0 |
| members fully above the fold | 4 of 8 | 8 of 8 |
| page title size | 48px | 18px |

Squad spent 56% of the first screen before a single member appeared, to say
less than Work said in 145px. At 900px wide it was 2.82 viewports and one
member above the fold, because the row is a four-column grid above 1024px and
a vertical stack below it: one list, two layouts, the row growing from 88px to
242px for identical content. That is exactly the fault ADR-0037 removed from
Work, still present here.

The page also carried what DESIGN.md forbids: a bordered TEAM STATE box with a
pill-shaped segmented bar that rendered 87.5% one colour and encoded less than
the legend beneath it; a legend printing "Away 0 / Offline 0" permanently;
five outlined filter buttons of which three read zero; eight bordered
availability rectangles; a LIVE badge on a page that is always live; and a
sentence describing the page to itself.

And three names for one thing in one screenshot: the sidebar said Agents, the
heading said Squad, the button said Create Squad member.

## Decision

**Squad is the roster.** Who is on the team, and every control that changes
the team: add, set availability, open the profile, remove.

**Work is the log.** What the squad is doing, what is blocked, what to do
next.

The page takes Work's grammar exactly: an 896px column, an 18px title with one
sentence naming only what is true right now, one divider control row with text
toggles, then divider rows of people. The TEAM STATE block, the segmented bar,
the column header, the second layout and the LIVE badge are gone. The
availability control keeps its popover and loses its box, so it reads as a dot
and a word like every other status in the product and admits it is editable on
hover. Row actions appear on hover, as DESIGN.md already specifies for the
sidebar member row: sixteen permanent icon buttons become two on the row you
are pointing at.

**The three recent-task lines per member are removed.** They were Work's
content rendered a second time, ragged, and the largest thing on the row. One
line naming the current commitment stays, because "can I give this person
something" is the roster's question and cannot be answered without it.

**Work loses its "Everyone" lane.** ADR-0037 recorded that overlap and
deferred it: "the repetition is real and worth revisiting once the page has
been lived with." It has been. Once the roster carries the commitment, that
lane is the same people with the controls taken away. Work keeps its summary
sentence, which answers "how many are free" as a count; the roster answers it
by name.

**One word: Squad.** The sidebar row, the heading. The button becomes "New
member" so the word is not said three times in one view. The command palette
still matches "agents", the way it still matches "mission control" after that
rename.

## Consequences

Measured after, same viewport:

| | before | after |
| --- | --- | --- |
| first member row | 502px | 215px |
| page height at 1400px | 1.42 viewports | 1.0 |
| page height at 900px | 2.82 viewports | 1.07 |
| row height, 1400px / 900px | 88px / 242px | 89px / 89px |

- Density is lower. The old row showed three recent tasks with dates; the new
  one shows the current commitment. That is the trade for a roster that fits
  its screen and reads the same at every width.
- Search appears only past eight members. Below that it is a control for a
  list you can already see. Reversible in one line if it is missed.
- Not done, and flagged by the review: below 1024px the mobile top bar names
  the active member while you are looking at the whole team, because it always
  renders `activeAgent` regardless of route. A separate fault, a separate fix.
