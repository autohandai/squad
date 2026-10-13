# ADR-0121: Needs you is about decisions

Date: 2026-10-14
Status: Accepted

## Context and evidence

The person opened Needs you and said: "fix inbox layout and the composition
of what i actually have to do; right now is so confusing the contents there,
if there's something for me to make a decision, decisions pending, access
request, handoff requiring human input and so on. right now is subject to
not so good decisions."

What the page showed them (their screenshot, 2026-10-14): a header "5 to
review · 1 working · 4 blocked · 4 free", one "Handoffs waiting" row, then
"Work to review 4", where every one of the four rows was a failed chat reply
rendered as a run: the person's own message as the title ("changed go
ahead"), the raw command line `claude -p '<prompt>' --output-format
stream-json … --mcp-config '<squad-managed-mcp-config>'` printed twice (once
as the summary, once as "command:" evidence), "Failed · Alex · leads ·
5a19603…0e7a · Checks incomplete", an amber "Risk: Standalone run failed
before a parent task was linked.", Run / Workspace links and a filled
Replay button. The one real decision on the page, the handoff, was one row
among five, and the four rows that were not decisions took most of the
screen.

What the code actually did, read in `src/App.jsx` on 2026-10-14 and
reproduced with `scripts/check-inbox-browser.mjs --no-assert --shots`
before any change (`.codex-artifacts/lanes/inbox/before/*.png`):

- Since ADR-0113 every chat reply is a run, listed by `GET /api/runs` with
  `mode: "chat"`. `buildMissionRows` turned every run without a linked task
  into a row through `missionRowFromRun`, which did not look at the mode:
  `summary: run.command`, `evidence: { type: "command", label: run.command
  }`, `blocker: "Standalone run failed before a parent task was linked."`
  for any failed status, and `nextAction` Replay for any failed status. The
  sentence and the command line were written for launched runs when they
  were the only runs; a reply inherited them unchanged.
- `workRowsNeedingYou` put every blocked, failed or handoff-pending row into
  the "Work to review" table, which rendered them with `MissionControlTable`
  (title, summary, status pill, owner, repository, record id, evaluation
  badge, risk, evidence, links, action button). That grammar is right for a
  record you selected; for a list of what needs you it was the whole record
  repeated per row.
- The sections were ordered approvals, vault, folders, handoffs, work,
  memory, replies, channels, and sections with nothing in them vanished, so
  the page's shape changed with its contents and nothing said "no decisions
  are waiting".
- The sidebar badge counted the decisions, the unread conversations and the
  stopped-work rows. A failed reply is an unread agent message (its status
  is `error`, not `loading`), so it was counted once as a reply and again as
  a failed run. Member-opened channel proposals and routine proposals were
  added to the badge but had no row on the page at all; they are rendered
  above every page and in the member's chat.
- A handoff deep link (`/work?handoff=<id>`) found its row by the section
  heading text and the row index.

## Decision

**Three sections in a fixed order, each with a count and one sentence when
empty.** `NeedsYouList` renders Decisions, Unread, Work that stopped, in
that order, always. The composition is pure (`src/lib/work-attention.js`)
so it can be checked without a browser.

**Decisions**, grouped by kind under a small uppercase label, in the order
approvals, vault requests, folder access, handoffs, channel proposals,
routine proposals, memory proposals, newest first inside a kind
(`decisionRows`). A row is what is asked, one muted line with who asks and
the detail (a handoff now says "Noah → Iris"), and at the right the exact
action word over the time: Approve, Open secure form, Decide payment, Allow
or decline, Review handoff, Approve channel, Confirm routine, Review memory.
Channel and routine proposals get rows (`channelProposalRows`,
`routineProposalRows`) that open the channel list and the member's chat,
where their Approve / Confirm controls already live. Every other
navigation target is the one the page had.

**Unread**: replies and unread channels as one list, newest first, no
action word.

**Work that stopped**: one line per failed or blocked record, in the
Execution panel's grammar (ADR-0117): status dot, the member, the person's
question cut on a word, "failed · 8m ago". `stoppedWorkRows` tells a chat
reply from a goal from a launched run by the run's mode. A failed reply
carries "Retry in chat", which opens the conversation at the reply that
started with that run (matched by start time, since messages do not carry
the run id) where Retry already is; Replay stays on failed launched runs;
goals and tasks offer Open chat. The command line is never on this page;
Work details and the Execution panel keep it. The "standalone run" sentence
is gone for replies, and `missionRowFromRun` now says what came back (the
reply, or the last output line) instead of the command on the In progress
and All work tabs too; a failed reply's next action there is Open chat.

**The count is what the page lists.** The sidebar badge is the decision
rows plus the unread conversations (plus permission warnings, which the
page shows as its own block). Work that stopped is not in the badge. The
sentence under the title reads "6 decisions · 3 unread · 4 stopped · 1
working", zeroes left out.

The handoff deep link now finds its row by `data-decision-id`.

## Evidence

- `bun run check:work-attention`: decisions grouped by kind newest first
  with their action words, a channel proposal and a routine proposal as
  rows, unread as one list, a failed chat run as a one-line stopped row with
  the question cut on a word and no command text or standalone-run
  sentence, a run whose title is its command line reading as "chat reply",
  Retry in chat for replies and Replay only for launched runs, a pending
  handoff not duplicated as stopped work, the badge equal to the decision
  rows, the summary sentence.
- `bun run check:inbox:browser` (`scripts/check-inbox-browser.mjs`, in the
  ci chain after the Execution panel check): a real bridge in a temporary
  state dir seeded with `channel-workflows.json` (a run waiting for
  approval), `vault-requests.json` (a secret and a payment),
  `channels.json` (a proposed channel), `run-history.json` (a failed chat
  reply whose command is the Claude Code line above, a failed goal, a
  failed launched run), and browser storage (a pending handoff, a blocked
  task, a folder request, an unread reply and the failed reply). Headless
  Chrome opens `/work` in light and dark and the check proves: the three
  headings in order; six decision rows, three unread, four stopped; no
  `--output-format`, `claude -p` or `autohand run` on the page; no
  "Standalone run failed"; every action word present; one Retry in chat and
  one Replay; the sidebar count equal to decisions plus unread (9); Retry
  in chat opens Alex's conversation with "Could not answer" and Retry on
  screen. Screenshots: `.codex-artifacts/lanes/inbox/before/` and
  `.codex-artifacts/lanes/inbox/after/` (`light-needs-you.png`,
  `dark-needs-you.png`, `light-retry-in-chat.png`,
  `dark-retry-in-chat.png`).
- `bun run build`, `bun run check:render`, `bun run check:jsx`,
  `bun run check:attention-badge`, `bun run check:activity`,
  `bun run check:execution-panel:browser` pass on the rebuilt bundle.
- `scripts/verify-work-profile-browser.mjs` (not in the ci chain) had its
  Needs you assertions updated to the new headings and sentence and gets
  past them; it then times out on a Settings → Updates step, which it also
  does on `main` at 40409b9 before this change, at an earlier step.

Two fixture lessons from the browser check, kept in the script: the app
merges the demo memory seed back in as pending whenever the bridge answers
with an empty inbox, so the bridge's `memory-inbox.json` has to carry the
seed already decided; and the bridge posts the approval prompt into the
channel, so a seeded approval is also one legitimately unread channel.

## Consequences

- A failed launched run or goal no longer moves the sidebar badge; it is on
  the page under Work that stopped and in the header sentence. If a person
  relies on the badge to learn that a scheduled run failed at night, the
  notification feed is what tells them now.
- The vault forms and the channel-proposal block still render above every
  page, including this one, so a vault request appears twice on Needs you:
  as the form at the top and as a decision row. Moving those blocks is not
  this change; the row still opens the member's chat, where the form lives.
- "Retry in chat" matches the failed message by start time within two
  minutes because chat messages do not record the run id. Two replies that
  failed within two minutes of each other could land on the wrong one; the
  fallback is the latest failed reply, and the conversation shows all of
  them.
- The In progress and All work tabs keep `MissionControlTable`; only the
  run row's words changed (reply or last output line instead of the
  command, Open chat instead of Replay for a failed reply). Their rows are
  still the full record grammar, not the one-line grammar of Work that
  stopped.
- The "Risk: Standalone run failed before a parent task was linked." sentence
  remains for failed launched runs on the All work tab. It is still a poor
  sentence; it was left because nothing new was learnt about what a failed
  launched run without a task should say.
- `workAttentionCount` no longer takes `rows`; the sidebar and the Dock
  badge (which share it) drop by the number of stopped-work rows the moment
  this ships.
- Copy keys for the new labels exist in English only; the other seven
  languages fall back to the English defaults in the component until they
  are translated.
