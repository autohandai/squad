# ADR-0051: The member picker recommends, it does not just list

Date: 2026-09-29
Status: Accepted

## Context

The owner, pointing at Slack's "Add agents" dialog: "Do we have like when we add
a new project to it in a channel we recommend a team of agents suggested or want
to join? like this."

Half of it existed. ADR-0015 already profiles a channel's folders and proposes
the member who covers a need nobody in the channel covers — that is the "wants
to join" card at the bottom of the conversation. It is a nudge: it arrives
unasked, it shows at most two people, and dismissing it keeps it dismissed until
the folder's signature changes.

The other half was the panel behind the members count in the channel header.
That was a wrap of bordered, tinted chips reading `Name · Join` or `Name · Leave`.
No roles, no recommendation, no reason to add anyone. It also broke the house
style twice over: every chip framed in its own border and the joined ones filled
with a tint, which is the card-heavy surface `DESIGN.md` rules out.

So the knowledge of who a project needs existed, and the one screen where you go
to act on it did not use it.

## Decision

**The picker is divider rows, not chips.** One row per member: avatar, name,
role, and a check mark when they are in. A hover tint and a bottom hairline are
the whole treatment. No borders around each person, no fills, no panel colour.

**It recommends, using the same engine as the nudge.** `proposeMembers` is
called again for the picker, with `limit: agents.length` instead of the nudge's
two, so every uncovered need names someone. Each row that is a recommendation
carries a second line: `Suggested · can help with the Dockerfile and CI`. Because
the engine awards each need to exactly one candidate, no two rows offer the same
help.

**Recommendations sort first.** Suggested, then joined, then alphabetical, so the
answer to "who should I add" is at the top and the answer to "who is already
here" is below it.

**A dismissal does not reach here, and neither does the setting.** The nudge is
unsolicited, so it can be switched off and waved away. The picker is a list you
opened on purpose. Turning off "Squad suggestions" now suppresses the card but
still loads the folder profiles the picker reads, because a panel you opened
yourself going quiet is a bug, not a preference.

## Consequences

- The two surfaces stay honestly different: the nudge interrupts and shows two;
  the picker waits to be opened and shows everyone, ranked.
- `proposeMembers` mutates `needs` as it awards them, and the picker depends on
  that. `check-squad-recruiting.mjs` now pins it: unbounded, it returns more
  than the nudge's two, each need is claimed once, a full channel proposes
  nobody, an unbound channel proposes nobody, and an offline member is never
  suggested — no promising work to someone who cannot take it.
- Measured in a headless browser against a channel with a Rust service and a
  React app bound to it and only the frontend member in it, the picker read:
  Eva — the test suite, Iris — the service code, Kai — the Dockerfile and CI,
  then Noah, checked. With "Squad suggestions" switched off, identical.
- The separator in that line is a literal `·`. Written as `·` it would have
  shipped those six characters to the screen, because JSX text is not a string
  literal. Caught before commit; the repo's other 41 middots are all literal.
