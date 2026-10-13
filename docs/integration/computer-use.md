# Built-in Computer Use

The engine is a bundled component, not a skill. `server/computer-use.mjs` owns
the Squad MCP proxy, member grants and evidence. No platform fallback or download
occurs during an agent turn.

## Bridge wiring

Import `bundledComputerClient` and `createComputerUse`. Resolve the native client
from `rootDir/vendor/computer-use/BUILD_INFO.json`; if unavailable, retain an
unavailable service instead of an unverified PATH driver. Construct the service
with `{rootDir, stateDir:squadStateDir, bridgeUrl, nativeClient, emit}` and expose
it as `ctx.computerUse`. Shutdown calls `computerUse.close()`.

Before a member run/chat, call
`createSession({memberId,runId,nodePath:process.execPath})`. For Autohand,
merge its internal `mcpServer` into `agentRuntime.configPath` under
`mcp:{enabled:true,servers:[...existingServers,managedServer]}`, replacing only
the existing managed `autohand-computer-use` entry. Preserve user MCP entries.
The pinned CLI 0.9.7 reads `--mcp-config` only with `--bare` and otherwise
ignores it; SDK 1.0.5's declared `mcpServers` is also not forwarded by its RPC
transport. Keep normal member execution and inject the isolated member config.
Translate the same command, args and env to Codex/Claude MCP configuration.
Pinned CLI 0.9.7 starts Content-Length framing, which the proxy accepts;
the native engine uses newline framing. Never register the native host directly:
that bypasses Squad's per-call grant checks. Close the session on terminal run
states. A warm session must retain its matching proxy credential until reset.

`POST /api/computer-use/grant` requires **exact** `true` from
`ctx.authorizeComputerUseGrant(req,body)` after trusted native human confirmation
of `body.memberId` and `body.scope` (`none`, `observe`, `control`). This hook is
required; absence fails closed. Origin headers and an agent session token are
not human confirmation. Revocation uses `DELETE` on the same route. Do not
expose a public session-creation or credential-enumeration route.

The native approval secret must never be inherited by agent processes. Root
wiring must override `AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN` to an empty string in
every SDK, CLI and other harness child environment (SDK transport merges its
environment with the bridge's, so merely omitting the key is insufficient).
The native engine and proxy strip it. This is enforcement at Squad's managed
tool boundary; it does not sandbox an unrestricted same-user shell against
reading or launching other local programs.

`GET /api/computer-use/status?memberId=…` polls consent without requesting it.
The proxy checks native `check_permissions` with `prompt:false` before **each**
action; both Accessibility and Screen Recording must be explicitly true.
Native permission setup is a separate human action owned by the macOS host.
Unknown platform consent fields fail closed. The current contract is proven in
source for macOS; Linux/Windows readiness needs their platform adapter proof.

## Evidence and UI

The bridge emits `computer-use.action` and `computer-use.evidence`. Events contain
memberId/runId/sessionId/tool/outcome and file URLs, never input text or screen
content in telemetry. A chat stream forwards `computer-use` with
`{sessionId,runId,files}`, and its completed response includes the same
`computerUse` metadata. Persist that identity on the assistant message. The open
conversation polls `GET /api/computer-use/evidence?memberId=…` for durable
sessions, matching the message's exact session ID and merging files by URL;
an unrelated member/session must never be attached to the latest reply. No
global bridge SSE stream is assumed. Show evidence as ordinary DM image attachments; the
download handler serves only bounded PNG/JSON files with no-store/nosniff.
The first permitted desktop control automatically starts native recording.
Native `start_recording` records action before/after frames and annotated
`click.png`; Squad forces its directory under the work session and disables
optional video. `get_window_state` exports PNG into the same folder. Evidence
metadata persists across bridge restarts, but live credentials do not.

The member's Permissions page keeps separate macOS readiness and member scope.
Only the main native Squad window exposes Observe/Control confirmation and
Revoke commands. A cancelled native dialog does not grant access. An explicit
Set up macOS permissions button invokes `squad_setup_computer_use`; its
`opened:true` receipt means the permission host launched, not that macOS consent
or a member grant was obtained. Browser and Quick Chat cannot substitute a grant.
Missing or unconfirmed OS permission disables Observe/Control. Chat and Quick
Chat both render evidence; grants stay on the main member Permissions page.

## Staging and checks

Call `stageComputerUse({rootDir,runtimeDir})` during runtime staging **before**
app license/build metadata. Provide the pinned archive in
`vendor/computer-use`, optionally overridden by
`AUTOHAND_SQUAD_COMPUTER_USE_DIR`. On macOS also provide
`AUTOHAND_SQUAD_COMPUTER_USE_HOST` pointing at the verified/signed branded app
with bundle ID `ai.autohand.squad.computer-use`; the engine archive does not contain
this host. Set `AUTOHAND_SQUAD_COMPUTER_USE_HOST_COMMIT` to its exact source ref.
The helper verifies the immutable archive digest, signs/verifies extracted
macOS native components (the released arm64 driver signature is invalid),
records the actual staged engine/host/file digests, and includes the engine license.
Preserve these bytes during final app signing or refresh the final manifest.
Add the host's
Apache-2.0 notice to the app's legal metadata. The component `0.28.2` release is
a prerelease, independent of Squad's release version. Its exact source commit
is `fc92b70417cdae941ba8b104a6e7b3b5b52a07e2`; the sibling checkout at
`8ecd58c43f9e6bc88a2d8b2e98d002623da17b58` is newer and is not the archive's
source identity.

Add `check:computer-use` = `node scripts/check-computer-use.mjs` and include it
in the focused/CI checks. Its native/HTTP/OS interactions are mocked; it proves
grant rejection, OS denial, session isolation, framing, bounded evidence,
restart persistence and checksum refusal. It does not prove installed host
consent, rendered DM attachments, actual provider MCP discovery or native
interaction. Those need explicit installed verification before claiming the
feature usable.

`node scripts/check-computer-use-cli.mjs` additionally proves the real pinned
CLI can load the managed config and discover `get_window_state` through the
real proxy. It uses supported local mock authentication and a fake provider,
isolated state, mocked native tool discovery, and no actual account/provider
or Computer Use action. It requires a loopback listener.

`node scripts/check-computer-use-ui.mjs` checks the native-only command boundary
and exact-session media mapping. `node scripts/verify-work-profile-browser.mjs`
also verifies rendered setup/cancel/revoke controls, partial-stream evidence,
reload recovery and member isolation using mocked native commands and PNG bytes.
This is browser fixture proof, not installed macOS consent or real desktop capture.

## Runtime integration

The permission host is `Squad Computer Use.app`, identified as
`ai.autohand.squad.computer-use`; the executable remains `AutohandComputerUse`.
The engine environment and manifest checks require that exact Squad identity.
The pinned host source receives a minimal recorded branding patch in build
provenance. This isolates permission attribution from the shared Computer Use
product and requires fresh explicit user consent; the previous host's grants
are not copied or changed. It is not evidence that namespace collision caused
any separate native window-state failure.

The main bridge reads the native pairing key from `native-grant-token` in the
Squad state directory on each confirmation request. It requires an owned,
regular, single-link file with exact mode 0600 and 64 hex characters, opened
without following symlinks. It compares a valid hex header with constant-time
comparison, validates the exact request fields and an existing roster member.
The startup environment token is captured and deleted before agent children
start; agent and native engine processes never receive it. Re-reading permits a
CLI-first warm bridge to accept a later native main-window confirmation.

Granted turns create private temporary member configs, preserving user MCP
servers and adding `autohand-computer-use`; pinned Code RPC reads that actual
config. Granted SDK connections are discarded after the work, while ordinary
work retains warm connection reuse. Codex uses per-run `-c mcp_servers...`
overrides and Claude uses a private `--mcp-config` file. Work completion and
cancellation close the managed session and remove temporary configs. Final
chat/run responses carry `computerUse: {sessionId,runId,files}`; goals preserve
that metadata in `lastResult`. Durable listing returns public session records
with `id`, `memberId`, `runId`, `createdAt` and bounded `files`, with no credentials.

Status distinguishes `bundled` from `available` and exposes `readinessError`
when permission state cannot be confirmed. Computer Use requires macOS 13 or
later; Squad's macOS 12 support is unchanged.

`node scripts/check-computer-use-bridge.mjs` passed actual HTTP routing and
managed MCP proxy calls with fake Codex and a fake native host. It verifies
CLI-first key arrival, exact grant authorization, unsafe key-file denial,
observe/control execution, no inherited native secret, temporary config cleanup,
revoke and evidence persistence across restart. It performs no actual desktop
interaction, OS grant or provider request.
