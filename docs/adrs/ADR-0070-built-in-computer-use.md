# ADR-0070: Bundle Computer Use behind Squad's member grant boundary

Date: 2026-10-02

## Context and observations

The user asked for agents to operate apps, capture screenshots, annotate what
they verified and attach the evidence to their work. A skill or instructions
alone cannot provide these capabilities. The source CLI tree has a Computer
Use integration, but Squad pins Autohand Code **0.9.7**, whose release source
has no `src/computer/*` runtime. Using the sibling CLI checkout would bundle
substantial unrelated development work.

The independently published `autohandai/computer-use` component release
`computer-use-v0.28.2` has checksum-pinned engine archives for macOS, Linux
and Windows. It is a prerelease. Its source ref is
`fc92b70417cdae941ba8b104a6e7b3b5b52a07e2`; the newer clean sibling checkout
`8ecd58c43f9e6bc88a2d8b2e98d002623da17b58` must not be labelled as that
archive's source. The archive contains the engine, helpers, bindings and Cua
license, but not the separate branded macOS host. The host owns macOS
permission identity `ai.autohand.squad.computer-use` and requires its own provenance,
signature and Apache-2.0 notice.

Two initial integration assumptions were wrong and were corrected before
shipping. SDK 1.0.5 declares `mcpServers`, but its RPC transport does not
forward that field. Its `mcpConfig` does become `--mcp-config`, but the pinned
CLI 0.9.7 only reads that flag in bare mode. Normal member execution therefore
needs a managed entry in the isolated member config's `mcp.servers`, preserving
the member's other MCP entries. Also, the pinned CLI starts Content-Length
MCP framing with protocol `2024-11-05`; the native engine uses newline framing
and supports legacy initialization `2025-06-18`. A newline-only proxy would
silently fail the first connection.

The canonical capture tool is `get_window_state` with explicit process/window
targets, not an invented `screenshot` tool. Engine recording produces local
before/after images and state, action/evidence JSON and `click.png` with a red
click point. Recording can supply annotation proof without a separate image
editor or optional video dependency.

## Decision

Use the Squad-specific permission host `Squad Computer Use.app` and bundle
identity `ai.autohand.squad.computer-use`. The first build reused the shared
driver host identity, which made TCC attribution ambiguous when both products
were installed. Namespace isolation prevents Squad setup from sharing that
other product's permission identity. This observation does not establish that
the collision caused the separately observed native window-state failure.
The host is built from the pinned source with a minimal recorded branding
patch; that patch and the resulting hashes belong in build provenance.
Changing identity requires fresh human Accessibility and Screen Recording
consent. No existing global host, process or OS permission is changed.

Bundle the verified native component and signed branded host in Squad's
runtime. Keep Computer Use independent of a member's personality, skill and
harness choice. Autohand, Codex and Claude should register the same Squad-owned
stdio proxy command, adapted to their MCP configuration format. Native host
launches are server-owned; agents never receive a direct native MCP entry.

Prepare the pinned native component on each native release/CI packaging
runner before staging it. The architecture-neutral web input does not fetch
a cross-platform engine. Portable downloads stage the same component beside
the pinned Code CLI before creating the archive and its checksum. macOS
desktop jobs prepare the signing identity before building the branded host
and staging nested code, so the component manifest records the intended
signed bytes. These are build prerequisites, not agent-time downloads.

Persist member grants (`none`, `observe`, `control`) in private bridge state.
The native Squad window confirms the exact member/scope through a human
Yes/Cancel dialog and a private bridge approval credential. Origin headers
and agent credentials do not authorize grants. The bridge checks the grant on
every tool call. The private native approval credential must be removed from
every agent and helper child environment; the SDK merges its child environment
with `process.env`, so simply omitting the secret is insufficient.

Native `check_permissions` is called with `prompt:false` and
`probe_direct_capture:false`. Both explicit Accessibility and Screen Recording
booleans are required before desktop observation/control. Native OS consent is
a separate human action; model calls cannot request or bypass it. Unknown
tools, configuration/session escalation, clipboard access, eval/browser tools
and process killing are outside this initial bounded tool set.

Sessions use random member-scoped credentials and forced native session
identity. Strip private transport metadata from agent arguments. Screenshot
and recording paths are forced into each work session's evidence directory.
Before the first permitted desktop control, start verification recording with
`record_video:false`; revoke stops recording immediately. Closed credentials
expire while completed evidence remains readable across bridge restarts.
Evidence events contain file attachment URLs, member/run/session identity
and action outcome, without recording typed text or screen contents in
product telemetry. PNG/JSON evidence routes exclude MCP config, metadata,
symlinks, oversized files and paths outside the session.

## Evidence and proof boundaries

`node scripts/check-computer-use.mjs` passed **37 focused checks** during
implementation. All native actions, OS checks and HTTP requests were mocked.
These exercise native-grant refusal, per-member isolation, live revocation,
OS denial, strict consent booleans, secret-free status, protocol/framing,
automatic recording, bounded evidence, restart persistence and checksum
refusal. `node --check` passed for the service, route and staging helper.

`node scripts/check-computer-use-cli.mjs` passed with the real pinned CLI and
real proxy, local mocked bridge/engine and isolated fake provider config. The
first attempted RPC check stopped at the CLI's mandatory startup account gate
(`authentication_required`). Inspection found its supported
`AUTOHAND_AUTH_API_URL` override; the final check points normal startup auth at
a local mock `/v1/auth/me` with a fake token, retaining normal non-bare mode.
The CLI successfully loaded the managed server and discovered
`get_window_state` through the actual stdio proxy. All engine requests were
`tools/list`; no real account state, live authentication requests, provider
prompts or desktop actions were used. Do not substitute SDK process spawning
for this successful MCP handshake.

The raw macOS driver in the checksum-matching component archive has an invalid
arm64 code signature. Packaging inspection observed `codesign --verify` fail
while the archive digest still matched its immutable pin. Staging signs the
extracted driver, cursor helper, native SDK dylib and Node binding using the
selected build identity (ad hoc locally), verifies the resulting signatures,
then hashes those actual staged bytes. The immutable archive digest and staged
executable digest describe different artifacts. Later app signing must not
alter nested code after its manifest is recorded.

A real helper staging run at
`/private/tmp/squad-computer-stage-proof-QPUjdQ` verified the immutable archive,
staged **13 manifest files**, verified native code signatures, and successfully resolved the bundled
native host/engine through `bundledComputerClient` without starting an MCP
session or interacting with the desktop. Staged driver SHA-256 is
`163fb0327bf84a3bc7400db0c3d2830f717f35ef50671a3e75dd964a11fe4bc3`;
host SHA-256 is
`10c5f7e696729e384da867a382aaf691be3e36d76008d76bab20bb79b5a164f9`.
The host was compiled from the exact release source with explicit
`arm64-apple-macos13.0`, correcting the release script's newer SDK default
minimum, and its sealed resources include license, notice and build provenance.
After adding provenance and requested-architecture validation, the final helper
was rerun successfully at `/private/tmp/squad-computer-stage-final-Dn37tN`
with the same 13-file count and engine/host digests. An initial `lipo`
validation command put the filename after its architecture list; the real
staging run caught that invocation error, corrected the argument order, and
the final run passed. This is separate from installed GUI/tool execution.

Installed host consent, real MCP discovery after account startup, real
screenshots/action recording, rendered DM evidence, and platform-specific
Linux/Windows consent/readiness remain separate acceptance requirements.
The focused checks do not establish those claims. No provider prompt or
Computer Use desktop interaction was performed by these tests.

`node scripts/check-computer-use-portable.mjs` passed the actual portable
package pipeline with synthetic engine/host/CLI files: the resulting archive
contains the engine, licenses, macOS host when required, component manifest
and pinned Code CLI, and every recorded component/archive byte hash matches.
Its macOS fixture also verifies the Squad-specific bundle path/identity and
recorded branding metadata. Substituting the shared host identity in provenance
is rejected before replacing a valid archive, as is corrupt native input. Native
signature/provenance commands are mocked in this composition fixture; it is
not proof of a downloaded vendor engine or installed operating-system tools.
`node scripts/check-release-workflows.mjs` passed with that fixture and native
job preparation-order checks. `actionlint` passed both modified CI/release
workflows. Those workflow checks do not establish a completed remote release
matrix, Linux/Windows execution, Developer ID notarization or Gatekeeper
acceptance.

## Consequences and tradeoffs

Squad owns the tool permission and evidence boundary without adopting an
unreleased CLI checkout. The additional native payload, host signing and legal
metadata become build prerequisites. Missing/corrupt components fail closed;
there is no PATH fallback or automatic download during a member turn.
Cold native builds additionally depend on checksum-pinned component/source
downloads and, on macOS, a Swift compiler and host build. A missing or changed
input now stops portable packaging too. Users receive the prepared payload;
they are not expected to install build tooling, but still need the explicit
member grant and operating-system consent. Engine inclusion alone does not
establish platform-specific capture/control readiness.

The grant is enforcement at the managed Computer Use bridge, not an OS
sandbox around an unrestricted same-user shell. Such a shell can run other
local programs and has a broader trust boundary. Restricting those abilities
is a separate harness policy decision. Consent preflight booleans also do not
prove a live capture succeeds; native capture/action errors must remain visible.

Optional video, clipboard, browser/eval, destructive process operations and
arbitrary engine configuration are deliberately excluded. Evidence persistence
adds local disk usage and privacy-sensitive screenshots; retention/export
controls need a subsequent product decision. Granted work receives a private
temporary config preserving the member's existing MCP servers and adding the
managed bridge. Its SDK connection is discarded when the work finishes so a
later turn cannot inherit an expired credential. This trades warm SDK reuse
for a consistent grant/session boundary only for granted members; other work
retains the existing warm session behavior. Codex and Claude receive the same
managed proxy through their native MCP configuration flags. Completion,
cancellation, shutdown and sign-out close sessions and remove temporary configs;
screenshots remain in local session history for review.

The branded host requires macOS 13, although Squad itself still supports macOS
12. On older systems the bundled capability reports that requirement before
launching a native process. A bundled host with unconfirmed permission state
reports a readiness error instead of suggesting an absent installation.

`node scripts/check-computer-use-bridge.mjs` passed the real Squad HTTP server
and real MCP proxy with fake Codex/native host processes. It exercised the
CLI-first bridge receiving its private native key after startup, exact roster
member and request-body authorization, unsafe key-file rejection, observe and
control calls, child secret exclusion, per-work config removal, revocation and
durable evidence after restart. `node scripts/check-computer-use.mjs` passed
40 checks including durable member listing, unsupported-host readiness and
rejection of the shared host identity in favor of Squad's permission identity.
These tests do not establish real OS consent, provider behavior or desktop actions.

## Squad owns a separate macOS permission identity

An installed read-only comparison found two concurrently running hosts with
the same `ai.autohand.computer-use` bundle ID: Squad's nested host was ad hoc
signed with designated CDHash `d99105884292bf82006f0ae7bf3ff2d22f61c2ce`,
while the user's existing `~/Applications/Autohand Computer Use.app` used
Apple Development team `VDQ8LHVVTY` and an identifier/certificate designated
requirement. A bounded TCC log query showed the shared ID resolving to
Squad's nested bundle path in an Accessibility client listing. Thirty-minute
debug logs did not establish a host-specific denial or permission invalidation.
The contemporaneous global CUA `cgWindowNotFound` failure therefore remains
unattributed; the identity correction is not evidence that it repaired CUA.
Apple's [code-signing requirements guidance](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
explains that designated requirements identify code, so a shared label is not
proof that these differently signed hosts are interchangeable.

Squad now owns `ai.autohand.squad.computer-use` and the visible name
**Squad Computer Use**. It keeps the upstream `AutohandComputerUse` executable
name to avoid an unrelated transport change. The checked-in branding patch
changes the Swift fallback identity and build-script bundle metadata/consent
wording, without changing observation or input behavior. Its SHA-256 is
`1beed4288409b5f2a6143453aa9c645aece207f5ec97ceefd32531a0377e784f`.
The build first verifies the original immutable archive and source hashes,
applies that exact patch only inside disposable build scratch, then verifies
patched Swift SHA-256
`ab65142131d73ccfc69e315c48359dd63f0c8d0bfd80681fa909052cb7d62491`
and patched build-script SHA-256
`9332214d3d81dade74a500b722e84596f2b331f0c1ef4941a726ee5070079882`.
The reused Squad app icon is separately pinned and included in sealed
provenance. Staging rejects the old shared identity and unverified branding;
native setup checks the exact new bundle path, identity, patch and staged
executable digest before offering human permission setup. Reused staging
directories remove only their obsolete nested host, never the user's global app.

This deliberately requires fresh human Accessibility and Screen Recording
consent for Squad. No existing permission row is reset, migrated or reused.
Local ad hoc signatures still vary when executable bytes change; a unique
namespace does not replace stable release signing or notarization. We accept
the small maintained branding patch and separate permission entry in return
for clear ownership. Installed grant, real capture/control, and restoration
of global CUA remain separate runtime proof requirements.

The fresh local vendor build used the pinned source archive, verified/applied
the branding patch, built arm64 and x86_64 slices with explicit macOS 13.0,
and passed a subsequent two-target `fetch-computer-use.mjs --check`. A real
scratch staging run at `squad-namespace-stage-Y5y7ed` verified signatures and
produced 13 manifest files with host SHA-256
`c49d9f9764c600a82165202ac2c05779deabb59921047dd701798cade8a15acb`.
It checked the new identity/path/patch fields and confirmed an obsolete
shared-identity host seeded only into that scratch runtime was removed.
The native suite passed 17 tests, including rejection of the old identity
and an unverified patch; `cargo fmt --check` passed. These checks compiled,
signed and staged native bytes without launching the host, granting OS
permissions, changing a global app/process or performing desktop actions.
