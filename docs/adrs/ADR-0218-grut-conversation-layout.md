# ADR-0218: Give Grut a conversation layout

## Context and evidence

The owner asked for an alternative to the Slack-like workspace arrangement,
showing Grut's larger avatar rows, last-message previews and quiet chat bubbles.
The existing Grut skin changed palettes, radii and blob portraits but still used
the same channel/Direct Messages sections and answer composition as other skins.
Changing colours alone did not implement that request.

## Decision

Use the existing Appearance skin choice. Grut declares a conversation layout in
the skin registry; other skins keep workspace navigation. Share the same data,
member/group/channel routes, row actions, unread/draft states and owner-scoped
preferences. Do not introduce a second conversation store or duplicate dispatch.
Members, private groups and visible channels share one list ordered by retained
message timestamps after pinned members, which preserve their existing pin
order and indicator. Larger current avatars identify members; groups use their
members' faces. Previews are bounded plain text from retained messages, or an
explicit role/purpose/attachment fallback. Missing dates remain unknown rather
than being inferred from a profile edit. Keep hidden conversations recoverable.
Inbox, Squad, Memory, channel creation and new-message navigation stay reachable.

Grut answers in direct, group and channel conversations, including expanded
thread replies, use a quiet bubble, with work details, failures and approval
controls outside it. The inverse user bubble supplies local text/code surface tokens;
shared Markdown typography still works in both modes. Keep the regular composer,
shared profile pages and native Quick Chat contracts. The phone drawer reserves
space for its close control, so New message has its own hit target.

## What changed during verification

The first dark screenshot showed an empty-looking user bubble. Its text existed,
but Markdown's explicit foreground token overrode the inherited inverse text
colour. A local inverse token surface fixes ordinary text, links and code rather
than overriding every descendant indiscriminately. The rendered check measures
composited text/background contrast instead of only asserting that text exists.

A timestamp was also present in the DOM while clipped out of the row. Rich rows
now allocate avatar, bounded text and trailing state as grid columns; the browser
check requires the recorded time to be in the viewport.

The phone test initially appeared to stall after opening a group menu. I
suspected nested modal focus behavior, but the completed action log showed the
drawer Close icon intercepting the later New message click. The menu had opened
correctly. Its modal behavior stays unchanged; explicit drawer-header space
fixes the real overlap. Captures finish CSS transitions before taking a frame,
and touch controls are exercised with taps.

Review found that sorting every row by recency discarded the existing pin
priority, and selecting the last array item could show recovered older history
instead of a newer reply. Previews now select the newest valid recorded date
independently of insertion order and are computed once per source change for
both ordering and rendering. A focused chronology assertion failed on the old
selection. The browser fixture now includes an older pinned member and older
records appended after newer replies, as well as a populated group thread;
the earlier empty group check had not exercised its answer composition.

## Consequences and proof limits

Grut's layout is coupled to its existing skin choice. Mixing this layout with
another skin's colours is not added here. Sorting older messages without a
recorded date retains their stable order and their provided clock label. A
preview is not a model-generated summary, and no missing conversation is filled
with sample content. Profile, work and Settings pages keep their shared layouts;
this change concentrates on conversation navigation and replies.

Production-bundle browser checks cover the Appearance control, reload
persistence, actual owned conversation previews, recovered chronology, pin and
recency order, timestamp visibility, group actions and expanded thread bubbles,
hide/show recovery, inline New message navigation,
switching back to workspace navigation, readable bubbles and
viewport containment. Desktop light/dark screenshots and a phone drawer/chat
capture are reviewed separately from native, installed-app and release proof.
