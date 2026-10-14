# ADR-0128: Manage Claude turns through Anthropic's Agent SDK

Date: 2026-10-14

## Context

The user reported an extra process in the Dock and an uneven Claude integration,
and asked why Squad did not use Anthropic's SDK. Inspection found a shared
external-engine runner spawning `claude -p` and translating JSONL itself. It
already used pipes and `windowsHide`, so that inspection did not establish
which process owned the screenshot's transient `exec` icon. No recorded
SDK-specific reason for the direct-CLI choice was found.

Anthropic's [official Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) describes the library as embedding the
Claude Code binary with its tools, sessions, permissions and hooks. The
registry's SDK 0.3.296 reports CLI version 2.1.296. The local selected CLI also
reported 2.1.296. The SDK does still run a child process; adopting it is not
evidence that an operating-system Dock symptom has disappeared.

## Decision

Pin `@anthropic-ai/claude-agent-sdk` 0.3.296. Compatible Claude turns use its
`query()` protocol and supported-model inventory. Keep the user's selected
executable and existing authentication. Map member instructions, folders,
access, effort, resume ID and managed MCP servers to SDK options. Project
observation retains its no-tool/no-settings isolation.

The app's SDK spawn callback creates a hidden piped child without an independent
process session. The SDK owns control messages and graceful shutdown. Squad
keeps its existing parsed-activity silence window, startup watchdog, overall
deadline and Stop semantics. Every query closes on success, failure and Stop.
Claude CLIs older than 2.1.296 retain the existing JSONL compatibility path.

Stage the SDK library and licence in native, portable and installer runtimes.
Do not replace the selected installed CLI with the SDK's optional native CLI.
Record actual-model and runtime-transport metadata on replies and launched runs.

## Evidence

- `bun run check:claude-sdk`: option mapping, isolated no-tool observation,
  model-limit policy, cancellation, silence/overall deadlines, query closure
  and import of the copied SDK from an isolated temporary runtime passed.
- `bun run check:claude-recovery`: a real isolated bridge used the actual SDK
  control protocol against a local executable fixture; recovery and persisted
  cooldown passed. `--browser` verified answer delivery, actual model metadata,
  the switch in work details and reopening without browser errors.
- The live tool-free SDK probe used the installed CLI, encountered the user's
  Fable refusal, continued to `claude-opus-5-5`, and returned `SDK_OK`. Its owned
  children exited with codes 1 and 0; no tool calls ran. The receipt is under
  `.codex-artifacts/claude-sdk-review/live-receipt.json`.
- The pre-existing 300 ms subprocess-ceiling fixture twice lost to its 220 ms
  startup-silence window. A separate probe recorded a cold child with no events
  at 227 ms, then starts at 131 ms and 29 ms. The ceiling case now has a 600 ms
  ceiling, a longer inactivity window, and asserts that activity actually
  began; the separate silence/startup checks remain. The focused check passed.

## Consequences

- Claude protocol/lifecycle handling follows the vendor SDK while existing
  Squad reply and trace consumers remain shared with other engines.
- This adds a pinned dependency and a protocol-version compatibility boundary;
  older CLIs do not gain SDK recovery. A future SDK upgrade must recheck the
  installed-CLI contract and packaged import.
- Sessions resume between turns; this change does not add a warm persistent
  Claude process pool or replace the Autohand SDK pool.
- Browser fixtures, a live CLI request and package verification are different
  evidence. The transient Dock icon could not be reproduced during the initial
  probe, and a Dock accessibility inspection timed out; its removal is not
  claimed from SDK adoption alone.

## Local installation evidence

The installed 0.1.6 build was staged at `2026-10-13T22:24:13.813Z` from
`b1988d7f23405778489080993479b87b0a73c68c` plus the working changes. Strict
whole-bundle signature verification and 454 runtime file comparisons,
including the SDK library, passed. The running receipt matches executable
SHA-256 `d709171c28695f75d6d9f335a3cc8cbc20067d7e47f9c41fbcded4b200000b72`.
Repeating the live probe through the SDK and harness modules inside
`/Applications/Autohand Squad.app` recovered the Fable refusal to
`claude-opus-5-5`, returned `SDK_OK`, and ran no tools.

The first native launch remained on the inline “Waking the squad” screen
although its bridge and current JS asset answered HTTP requests. The same JS
asset existed in the previous package, so a missing newly named asset was not
the explanation. An idle quit/stop/reopen cleared it; accessibility then
confirmed the rendered Squad directory and all nine members. No cache,
preference or saved history was cleared, and the transient cause is unproven.
The saved member configurations and 84 member-message IDs, eight channels,
24 threads and 99 channel messages were preserved. This is a local ad-hoc
signed candidate; publication and notarization were not performed.
