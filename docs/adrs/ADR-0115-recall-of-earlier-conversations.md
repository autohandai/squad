# ADR-0115: Every direct-message turn recalls earlier conversations

Date: 2026-10-13
Status: Accepted

## Context and evidence

After New chat a member knew nothing of the chat it had just finished, and
nothing of what other members had been asked or what was said in channels
it belongs to. The person reported it plainly: "loses completely the notion
of previous chats in new chats … for any harness or previous chats in other
channels or with other bots too."

What the bridge held, read on 2026-10-13: a member's direct-message history
lived only in the browser (the control plane's `get_messages` says so);
channel messages live in `channels.json`; since ADR-0113 every chat turn is
a run with its prompt and reply, and chats put away with New chat are on
disk with their messages. Nothing joined these into the member's context.
The three profile sites (`autohandArgs`, `sdkRuntimeContext`,
`prepareExternalHarness`) all compose the same list of instruction blocks,
so one more block reaches every engine the same way.

## Decision

`server/chats/recall.mjs` builds one plain-text block, "Earlier
conversations", from four sources already on the bridge: the member's own
previous chats (title, turns, when, last reply), other members' previous
chats, other members' latest completed chat runs (asked / replied), and the
newest messages of channels the member belongs to. It is added to the
profile on every direct-message turn for Autohand, Claude Code and Codex;
channel turns are left alone because they already carry their thread. The
block is bounded (7,000 characters; 6 own chats, 5 other chats, 5 other
turns, 3 channels of 4 messages), secrets are redacted with the control
plane's patterns, goal turns show the goal rather than the bridge's
preamble, and nothing is written anywhere. The context manifest gains a
`recentConversations` layer so Work details records whether it was
included and why not. `GET /api/members/:id/recall` returns the exact
block so a person can read what the member will be told.

`ChatStore` now keeps `index.json` per member (summaries with a two-line
digest) so the list and recall never open the records; a missing index is
rebuilt from the files.

Codex receives the profile only on the first turn of a thread
(`buildArgs` prepends it when there is no resume id), so for Codex the
recall lands on a new chat's first message and the thread carries it
afterwards; Claude Code and Autohand get it on every turn.

## Evidence

`bun run check:chats`: pure checks for the builder (counts, redaction of
`api_key=…`, the member's own live turns excluded from "other members",
channels the member is not in excluded, the budget, the goal preamble), and
against a real bridge with a fake Claude Code: the turn after New chat
carries "Earlier conversations" with the put-away chat's title and last
reply in `--append-system-prompt`; `GET /api/members/alex/recall` counts
one previous chat; the run's manifest has `recentConversations.included =
true`; a second member's turn lists what Alex was asked, including the live
turn that never left the browser. `check:goal-bridge` found the first
side-effect: its fixture judged the whole Codex argument (profile
included), and a recalled goal turn made it answer as a goal; the fixture
now reads the user prompt only, and recall strips the preamble.
Queues, run-channel-actions, computer-use-bridge, connectors, vault,
harness-timeouts, control-plane pass.

## Consequences

- Every direct-message turn now carries up to 7,000 more characters of
  context; the budget is fixed, not tuned per model.
- Other members' live conversations are known only through their chat runs
  (prompt and reply); the browser's own message list is not read.
- Recall is text in the profile, not retrieval: a chat older than the
  limits is simply not mentioned. Search stays the person's tool for that.
- Channel recall is the newest messages, not threads; a long thread shows
  only its tail.
- Codex threads that were started before this change do not get the block
  until a new chat starts a new thread.
- A member is told what other members were asked. Nothing is hidden
  between members of one squad; private matters belong in the vault.
