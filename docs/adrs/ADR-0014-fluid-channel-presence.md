# ADR-0014: Fluid channel presence

Date: 2026-09-24 · Status: accepted

## Context

A channel message fans out to every member. Each member immediately produced a
placeholder row ("Iris is typing…", spinner) and a fixed "Iris: Working ●"
footer entry. With four members the stream showed four identical empty rows
until whole replies landed, which read as a queue rather than people
responding.

## Decision

- Placeholder rows are not rendered. A reply enters the stream when its first
  text arrives and streams from there; the loading record still exists in
  state so ordering, stop, and retry keep working.
- One presence line under the composer (`PresenceLine`) replaces the per-member
  footer. It groups active members by state derived from the loading message:
  **thinking** (no body yet), **typing** (body streaming), **running tools**
  (the last activity label names a tool). Copy follows natural-language
  grouping: "Iris is thinking…", "Iris and Noah are typing…", "Iris, Noah and
  2 others are thinking…". Stacked avatars precede the text; three dots
  animate with a 1.2 s cycle.
- The line renders nothing when nobody is active and reserves no height, so
  it never shifts layout when it appears.

## Consequences

- `ChannelStream` skips `status: "loading"` messages without a body. Everything
  else about message rendering is unchanged.
- `AgentStatusBar` is retired in channels; member chats keep their own header
  status.
- Member state is inferred from message fields, not from a new event stream;
  richer states (waiting for permission, blocked) can be added by extending
  the same derivation.
