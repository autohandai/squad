# ADR-0035: One question, then its answer

Date: 2026-09-28
Status: Accepted

## Context

The owner called the new-member screen unacceptable, and a product designer
and a motion designer both drove it headless before proposing anything. What
they found:

- A one-line input for a two-sentence thought, in a 1120px column, so a long
  description scrolled sideways inside a 924px field.
- Enter fired the request, cutting people off mid-sentence.
- A spinner inside the button for up to twenty seconds, with no sense of how
  long, whether it would end, or what would happen if it did not.
- Twenty-two role cards with toggles and "Off" labels, competing with the one
  sentence that is the point of the page.
- On arrival, the page scrolled **989px**, measured, because the effect that
  focuses a role's name field fires on every template change. The line saying
  whether a model or the description produced the member ended up above the
  fold. The honesty ADR-0031 was written for was never delivered.
- The member arrived as a grey silhouette beside a wall of fifty-four
  portraits.

## Decision

**The page is one question and its answer, not two competing sections.**
Describing what you need is the primary path; picking a ready-made role is a
disclosure for when you already know the title, as divider rows with a check
on the selected one rather than a card grid with toggles. The column drops to
720px, because a 924px line of input is about twice a comfortable measure and
the width is what made the overflow feel violent.

**The ask is a textarea.** Three rows, growing with the text, never scrolling
sideways. Enter writes a newline; ⌘ or Ctrl with Enter designs, hinted beside
the button.

**The wait says the two things that are actually known.** How long it has
been, and when it will stop. A line appears where the answer will land and is
replaced in place by its own result. It carries the app's existing breathing
dots and elapsed counter rather than inventing a second dialect for "a model
is thinking". At twelve seconds it says that nothing arriving by twenty means
the page fills itself in from the description instead.

That sentence is the most valuable thing here and has no motion at all. It
turns an unbounded wait into a bounded one, and makes the fallback land as a
promise kept rather than a failure. A 240ms gate means a draft that returns
in 200ms never flashes a wait state at all.

The spinner leaves the button. A spinner inside a control says that control
is busy; the control is not busy, a request is.

**The page does not move.** A designed role no longer pulls focus, so the
explanation stays in view. Measured: 989px of movement with the explanation
off-screen before, zero after.

**The member arrives looking like a member.** A designed role takes a
portrait chosen deterministically from its own role and name, and the
fifty-four-portrait picker waits behind "Choose another portrait".

## Consequences

- The empty screen fits one viewport, measured at 913px against a 1000px
  window, so the question is the whole page rather than a preamble above a
  wall.
- Nothing staggers on arrival. A dozen fields that came back in one JSON
  object appearing one by one would be performing an arrival that did not
  happen, which is the boot screen's rejected progress bar in a different
  hat, and it would be performed below the fold.
- The name moved out of the role card and into a member header, where it
  reads as text and shows its edge on focus. Without that, picking a
  ready-made role would have left no way to name the member and Save
  permanently disabled.
- Not done: the review state the product designer specified in full, with
  every field as a labelled divider row and the brain card behind a
  disclosure. The detail form below the member header is still the old
  layout. The screen's thesis is delivered; its lower half is not yet.
