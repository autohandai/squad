# ADR-0257: Long member instructions are split, not refused

Status: Accepted
Date: 2026-11-19

## Context

On 18 November 2026 the owner asked the Chief of Staff to "create a new agent
called Thiago". It called `squad_create_member` with about 3,400 characters
of instructions. The tool's input schema (`instructions: maxLength 1200`,
PROFILE_LIMITS.instructions) refused it before any handler ran:
"arguments.instructions is longer than 1200 characters". The agent sent the
same text again, got the same refusal, and the run ended Failed; it showed in
Inbox as "Work that stopped". The owner asked that the Chief of Staff know
the limits and break the instructions into blocks that fit.

The schema never told the model the limit (only `maxLength` in JSON Schema,
which models rarely honour while drafting), and a refusal leaves the model to
shorten prose it was asked to write in full. Each member already has up to
100 profile memories of 500 characters, which reach the member on every turn.

## Decision

`create_member` and `update_member_profile` (the Squad MCP tools, also
`squad_create_member` for members) accept instructions up to 20,000
characters and fit them themselves (`server/control-plane/instruction-blocks.mjs`):

- The first part, up to 1,200 characters, cut at the last paragraph, line,
  sentence or word boundary past the first third, is saved as the
  instructions.
- The rest is saved, in order, as profile memories of up to 500 characters,
  each labelled "Operating instructions, continued (n/m): ".
- The reply carries `instructionsSplit` with the counts and a one-line note
  telling the agent to tell the person.
- On an update, earlier continuation blocks are replaced and every other
  memory is kept; shortening the instructions removes the old blocks.
- The split is deterministic, so a create retried with the same request_id
  still matches its earlier request.
- The tool description now lists every limit (name 60, role 80, description
  600, instructions 1200 with the split, personality 600, memory 500, 100
  memories), and the instructions field says to put the essentials first.

## Evidence

`scripts/check-instruction-blocks.mjs` (in `check:server`): a 3,461-character
brief becomes 1,078 characters of instructions and 6 labelled memories, the
text survives in order, the kept part passes `validateProfileAction` (the
route's own check), a single unbroken run still splits, the memory budget is
enforced, and the tool layer posts the split, replaces only earlier blocks on
update and leaves memories alone when instructions are not changed.
`check-control-plane` and `check-team` pass.

## Consequences

- Text past 1,200 characters lives in memories, which a member reads as
  context rather than as its operating instructions; the most important
  guidance must come first, and the tool says so.
- A member editing its own profile (`squad_set_profile`) still has the 1,200
  limit from the browser's profile shaping; this change covers the
  management tools the Chief of Staff uses.
- The profile editor in the app does not show the continuation memories as
  instructions; they appear in the member's memories.
