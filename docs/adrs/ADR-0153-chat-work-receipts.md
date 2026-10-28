# ADR-0153: Show useful chat work, with diagnostics behind an explicit setting

Date: 2026-10-28
Status: Accepted

## Context and evidence

A greeting displayed a multi-step work trace containing peer-join and prompt
hooks, a thought and the same answer already shown above it. Expanding Work
details exposed a second Raw control and nested status groups. The general
activity normalizer was functioning as designed: it preserves diagnostics for
execution history. The chat presentation treated every normalized item as work.

`node scripts/check-chat-progress-browser.mjs` reproduced the real chat component
with an isolated greeting fixture and no model calls. Before the change it
failed "A reply without tool work must not display a multi-step work trace."
The captured user turn had no tool execution despite its work-step count.

## Decision

Project the complete activity stream into chat work receipts. Normal chat
includes tools, edits, commands, plans, approvals and failures. It excludes
transport statuses, model thoughts and assistant-message copies. A greeting
with none of that work has no Work details disclosure; its measured duration
remains beside the answer. Real work stays collapsed by default and counts
actual tool calls rather than internal protocol events. Explicit expanded and
hidden preferences continue to apply.

Raw event controls and the complete normalized diagnostic feed require the
existing explicit CLI-output setting. Keep the original events in storage and
leave the general execution/audit normalizer intact. Normalize each chat reply
once and pass its projected activity to the receipt instead of rebuilding the
same trace in the child component.

## Consequences and validation

- Routine transport events no longer provide a visible work count. A person
  investigating a protocol problem must enable diagnostics deliberately.
- This removes presentation noise; it does not reduce inference time. SDK
  reuse and its measured limits are recorded separately in ADR-0030.
- The browser regression verifies the real greeting, retained duration, a
  collapsed two-tool reply, readable expanded actions, no normal Raw control,
  and no duplicated answer. Existing activity normalization retains its full
  event-folding coverage. Chat timing, profile, team, vault, queue and work-plan
  checks run separately; a fixture model does not prove live-provider latency.

The existing timing test initially failed before reaching its diagnostic
assertions. Its implicit demo member no longer existed, and an explicitly
identified empty conversation then exposed a production regression: the
`initialMessages` helper still served first append and New chat, but its import
had been removed with the demo seed. Restoring that import preserves the
existing welcome/reset behavior. The timing fixture now names its member and
uses a permitted workspace instead of depending on demo data.
