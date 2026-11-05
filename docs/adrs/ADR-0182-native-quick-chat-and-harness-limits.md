# ADR-0182: Native Quick Chat behavior and connected harness limits

Date: 2026-11-06

## Context and evidence

The Quick Chat screenshot showed reply paragraphs cut off at the panel edge.
A focused browser reproduction at 380x520 measured the reply paragraph at
5,591 pixels wide while the document itself remained 380 pixels wide. A wide
code/table row expanded Radix ScrollArea's internal `display: table` wrapper.
Changing only that wrapper to block layout reduced prose to 356 pixels.
Document-level overflow assertions alone had missed the clipped content.

The person also asked for configurable individual working-agent status items,
optional connected-harness limits, and a way to turn Quick Chat off. Existing
native menus reported only Autohand account usage. Claude's installed SDK
0.3.296 declares a structured usage control request; Codex exposes
`account/rateLimits/read` through its app-server. A read-only live probe returned
Claude weekly and model-scoped limits, including a genuine zero, and Codex
weekly limits with reset times, without submitting any agent prompt. The
local report records the observations; they are not fixed defaults.

## Decision

Keep the existing mounted conversation and durable queues, but use a 420x600
anchored panel with native macOS popover material, system typography, rounded
native material corners, compact toolbar and existing appearance colors.
The panel is still a Tauri WebviewWindow, not an NSPopover or a separate chat
implementation. Scope the ScrollArea wrapper correction to Quick Chat history;
wide code and tables scroll inside their own blocks while prose wraps.

Store three independent preferences in bridge-owned settings.json:
`quickChatEnabled` (true), `quickChatMenuBarMode` (single by default, or
active-agents), and `quickChatShowUsage` (true). Settings has a dedicated
Quick Chat section. Disabling hides the mounted panel and removes extra
status items, preserving drafts and ongoing agent work. The primary Squad
icon remains available and its ordinary native menu still works.

In active-agent mode, each currently working member gets its own stable status
item. Merely online members do not count. The existing 90-second snapshot
freshness rule prevents stale working icons. Clicks use the originating icon's
live rectangle and existing monitor-scale/clamping rules. Native status items
must be removed from Tauri's resource table and released on the main thread;
dropping a Rust map handle alone leaves Tauri's registered clone alive.
Portrait I/O and provider reads stay off the native event loop. Mutex guards
are released before synchronous native dispatch.

Use the existing clients' account controls for limits. Claude's experimental
usage method is feature-detected, requests skipBehaviors, disables tools and
project settings, and receives no prompts. Codex runs only initialization and
the account-rate-limit RPC. Child sessions have deadlines and are disposed.
Reads coalesce and cache for one minute. Explicit refresh can bypass the cache
after ten seconds, bounding repeated clicks and concurrent windows. Unknown values remain unknown; a
reported zero stays zero. Dynamic model bucket labels come from the harness.
Provider-only connections remain distinct from the Autohand account session.
Turning usage off suppresses future Claude/Codex probes and hides usage rows.

The native refresh command accepts no data, URLs or member IDs from web
content. It rereads saved preferences and requires the actual main window,
the active bridge origin, no URL credentials, and no pending reset. A
five-second native reconciliation loop is the fallback for settings changes.
Slow usage refresh is separately guarded to avoid overlapping reads. Its
manual recovery action remains enabled when usage is visible, even if the
first provider read failed; an empty cache is not proof that no harness is
connected. A removed or unreadable portrait replaces the old photo with the
shared fallback after a successful roster fetch.

## Validation

The focused browser reproduction, shared appearance/draft check, strict
settings round trips/restart check, usage normalization and zero-prompt client
control checks are maintained as runnable scripts. Native tests cover icon
selection, authorization, genuine zero versus unknown and Retina/negative
origin positioning. Rendered native evidence is recorded separately from
these checks and the live read-only usage probe. A separate ad-hoc-signed
preview booted with synthetic conversations and its own state directory;
the native main window rendered the four bird portraits. Cua reported
`screen_locked`, refused interaction, and returned no accessibility tree.
Consequently native menu clicks, individual status-item lifecycle and
popover material pixels remain unverified in this run. The installed Squad
app was not replaced. The full native unit suite
passed 29 tests. The browser check passed both dimensions and the actual
preference controls, persisted disable/re-enable, usage rows and draft
preservation. Repeated full navigations stalled browser fetches while direct
bridge reads remained healthy; disabling Chrome back-forward caching removed
the stall. This points to frozen pages retaining EventSource connections and
consuming the connection pool. The test opts out of back-forward caching;
it does not establish an app navigation or provider failure.

The first PR Web job stopped at the automatic-update check: its concurrent
write assertion compared the complete settings object with the two update
keys, so the three new default Quick Chat keys caused a strict-shape failure.
The expected shape now includes those defaults and still verifies both
concurrent update edits. This was a stale test expectation, not a lost write.

## Consequences

A webview retains the existing conversation, attachments, queues and drafts,
trading fully AppKit-authored controls for a shared chat implementation. System
type in Quick Chat is an intentional exception to inheriting a skin's font;
colors and avatars still follow appearance preferences. Individual status
items use more menu-bar space and are opt-in. Claude's usage API can change;
unsupported versions show unavailable rather than guessed limits. API-key
connections may have no subscription quota. Provider usage is a cached
snapshot and reset times can elapse before the next successful read.

## References

- [Codex app-server account rate limits](https://learn.chatgpt.com/docs/app-server).
- Installed `@anthropic-ai/claude-agent-sdk` 0.3.296, `sdk.d.ts`: `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`, `skipBehaviors` and `SDKControlGetUsageResponse`. The method remains experimental and feature-detected.
