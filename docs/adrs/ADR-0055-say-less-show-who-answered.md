# ADR-0055: Members say less, and your message shows who answered it

Date: 2026-09-29
Status: Accepted

## Context

Three complaints from the same screenshot of a channel.

"agents should respond in short sentences at most only if their role or
personality or memory or task required more context but this is too long."
What the screenshot showed was a member answering "are you guys around?" with a
wave emoji, its own name and role, an unrequested report on which files were
modified on which branch, and a closing menu of four things it could do instead.
Nothing in `buildAgentProfile` said anything about length, so every reply was as
long as the model felt like.

"also want to be able to configure how to render this in the chat log" —
pointing at Work details, expanded, repeating the same line and stacking status
updates under a two-sentence answer.

"my message should have the little avatars of the agents replied as in a thread
or depending on the objective in the channel, given the autonomy we give to
them." A message you send to a channel is answered by whoever decides to answer
it. Your own message showed nothing, so who had picked it up was only knowable
by reading down.

## Decision

**The member prompt asks for brevity and says when to spend more.** One to three
short sentences is the default; more only when the role, the brain card, the
member's memory or the task calls for it — a review that has to list findings, a
plan that has to name steps, an answer that would be wrong if it were shorter.
Length is a cost to justify, not a default.

Four things are named as habits to drop, because they are what the screenshot
showed: the greeting and the self-introduction (the channel already shows both),
narrating what is about to happen, the closing menu of alternatives, and
unrequested repository status.

The rules are constant strings, so the warm session pool still keys on an
unchanged system prompt (ADR-0025) and none of this costs a cold start.

**Work details is a setting, not a fixed behaviour.** `chat.workDetails` is
**Summary** (default) — one line you can open; **Always open** — the disclosure
starts open; or **Hidden** — the reply stands on its own. The old behaviour,
opening itself while the member worked, is now only what "Always open" does.

**Your message carries a facepile of who replied.** Every member who posted
after your message and before your next one, deduplicated, as small avatars and
a sentence: "Eva and Noah replied". That window is what "replied to me" means in
a channel where members answer on their own initiative rather than in a thread.

## Consequences

- `check-prompt-stability.mjs` asserts the five reply-length rules are still in
  `buildAgentProfile` and still constant, not interpolated. They are one edit
  from vanishing in a file this size, and nothing else asks for short answers.
- Measured in a browser: Summary renders the disclosure closed, Always open
  renders it open, Hidden renders no disclosure and the words "Work details"
  appear nowhere. No console errors.
- Measured in a browser for the facepile: "are you guys around?" carries "Eva
  and Noah replied" with Eva counted once across two messages, "who can review
  the PR?" carries "Iris replied", and a message nobody answered carries
  nothing.
- The facepile needs a member avatar, and `renderAvatar` in ChannelStream takes
  a message rather than a member, so `renderMemberAvatar` is a separate prop
  with the `(agent, className)` signature the rest of the app already uses.
