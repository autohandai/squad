# ADR-0152: Connect cloud memory explicitly to one workspace

Date: 2026-10-27
Status: Accepted

## Context

ADR-0151 gives Squad a tenant-scoped API. Every local member and its MCP tools
still use `team.json`. Last-write-wins file copying would lose concurrent edits,
mistake a missing local file for intentional deletion and expose local paths.
Automatic enrollment would upload existing data without a workspace choice.

## Decision

Settings → Cloud sync signs in with the current identity, discovers or creates
a tenant, and selects a writable workspace. Discovery uploads no memories;
Enable sync is the enrollment/upload decision. Tokens, revision receipts,
cursor and conflicts live in a private bridge file, never browser state or
agent prompts. A different signed-in account cannot reuse the connection.
Local onboarding needs no cloud enrollment.

Initially sync shared team memories. Project/member memories keep local behavior
until profiles and project IDs have portable mapping contracts. The API keeps
those scopes, including on tombstones; the desktop never guesses a remote
project path or invents a member mapping.

Save each accepted revision/hash and advance an ordered pull cursor. Requests
have stable idempotency keys. A mismatch preserves both versions and offers
Keep local / Use cloud. Equal content can adopt its revision after reconnecting.
Choosing a winner still uses CAS, so another concurrent edit cannot be silently
overwritten.

Only explicit forget records a local deletion tombstone. Missing files and
retention evictions never mean cloud deletion. Enabled connections synchronize
serially in the background. Errors retain local data. Disconnect cancels work,
revokes its session when reachable and keeps local memories; normal bridge
shutdown cancels requests and drains persistence.

## Consequences and evidence

- Local operation survives cloud unavailability. Conflicts need a person's
  choice rather than an unattended merge of short facts.
- Memory and sync receipts are separate atomic files. Idempotency and content
  comparison recover repeated receipts; there is no cross-file transaction.
  Explicit local tombstones stay retained for devices that were offline.
- A full local memory store reports capacity and keeps pending remote history.
  Automatic eviction, cloud retention, profile/channel/message sync and hosted
  agent execution are deliberately excluded from this enrollment.
- The workerd contract uses two temporary desktop stores. It verifies no traffic
  while disabled, no upload during discovery, transfer, concurrent edit
  preservation/resolution, explicit deletion, non-deletion for local absence,
  account affinity and private file permissions. Identity is a fixture; live
  deployment/provider evidence is separate. Browser checks exercise the actual
  Settings controls.
