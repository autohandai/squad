# Desktop and Multi-Harness Design

Status: proposed implementation contract  
Date: 2026-08-01  
Sequence: `goals/13-*` through `goals/19-*`

## Product outcome

Autohand Squad becomes a real installable desktop application and a local
control plane for mixed coding-agent teams. A squad member keeps one stable
identity and brain card while the user independently chooses which execution
harness runs that member:

- Autohand Code
- Codex
- Claude Code

The desktop product installs from a macOS DMG or Windows setup EXE, opens in its
own native application window, owns one tray/menu-bar process, and does not
require users to install Node.js. Codex and Claude Code remain user-managed
external harnesses; Squad detects them, reports readiness, and never installs,
updates, authenticates, or substitutes one silently.

## Current baseline

The repository is not starting from zero:

- `scripts/package-squad-installers.mjs` and `.github/workflows/release.yml`
  already build macOS DMG and Windows NSIS artifacts around the Rust and Node
  runtime.
- The current native controller is a tray/browser launcher. It opens the local
  web URL rather than hosting the product inside a native app window.
- The current release runbook says the DMG is not signed/notarized and the
  Windows installer is not code-signed.
- Member personality already exists as a structured brain card and generated
  Markdown profile.
- Runtime execution is hard-wired to Autohand through `autohandArgs()`,
  `AutohandSDK`, and an Autohand CLI fallback in `server.mjs`.
- The app pins `@autohandai/agent-sdk` 1.0.4. The current npm `latest` tag is
  1.0.5, whose bundled CLI adds concurrent-session awareness and transport
  reliability without an intentional breaking public API change.

The work should therefore migrate and harden proven seams rather than create a
second installer, member model, permission system, or run store beside them.

## Product model

Personality, harness, model, and permissions are related but independent
assignments.

```text
SquadMember
|- identity: name, role, description
|- brainCard: purpose, workflow, escalation, definition of done, memory policy
|- harnessAssignment: harness id, executable source, harness-native settings
|- modelAssignment: existing Autohand provider/model selection
|- permissions: Squad autonomy and tool policy
|- projects: allowed workspaces
`- runtimeState: readiness, active session, current run, last error
```

The initial persisted harness contract is deliberately small and versioned:

```json
{
  "schemaVersion": 1,
  "harnessId": "autohand",
  "executableSource": "managed",
  "executablePath": "",
  "model": "",
  "settings": {}
}
```

Rules:

1. Existing members migrate to `autohand` without changing their behavior.
2. `brainCard` is the member's durable personality regardless of harness.
3. `modelAssignment` remains the current Autohand provider/model contract.
   Codex and Claude Code may use the optional harness-native `model` value.
4. Secrets, tokens, and copied auth files never live in the member record.
5. A selected harness is sticky. Readiness failure blocks launch and does not
   trigger an automatic fallback to Autohand or another harness.

## Harness architecture

### Adapter boundary

Move execution-specific behavior out of the general server flow behind one
adapter interface. The registry owns discovery and selection; each adapter owns
only its vendor/runtime translation.

```ts
interface HarnessAdapter {
  definition(): HarnessDefinition
  detect(context): Promise<HarnessReadiness>
  provision(member, context): Promise<HarnessRuntime>
  startSession(request, sink): Promise<HarnessSession>
  send(session, request, sink): Promise<HarnessResult>
  interrupt(session): Promise<void>
  close(session): Promise<void>
}
```

`HarnessDefinition` publishes a capability matrix instead of pretending all
harnesses behave the same. Initial capabilities include streaming text, tool
events, permission requests, resume, interrupt, images, model override,
structured output, and concurrent-session awareness.

The app consumes one normalized event envelope:

```ts
type HarnessEvent = {
  id: string
  harnessId: "autohand" | "codex" | "claude-code"
  memberId: string
  runId: string
  sessionId?: string
  at: string
  type:
    | "session.started"
    | "message.delta"
    | "message.completed"
    | "tool.started"
    | "tool.updated"
    | "tool.completed"
    | "permission.requested"
    | "permission.resolved"
    | "usage"
    | "run.completed"
    | "run.failed"
  data: Record<string, unknown>
  rawRef?: string
}
```

Normalized events feed the existing run log, evidence timeline, usage view,
channels, and handoffs. Vendor-native output remains available as a redacted raw
trace referenced by `rawRef`; it is not flattened away.

### Autohand adapter

The first adapter is a behavior-preserving extraction of the current path. It
uses `@autohandai/agent-sdk` for prompt sessions and its bundled CLI for
supported CLI modes. Version 1.0.5 becomes the authoritative SDK/CLI pair.

The app should prefer the CLI bundled in the pinned SDK and expose its package
version, source commit, platform binary, and readiness in diagnostics. A system
CLI remains an explicit development override only. The adapter depends on the
public SDK contract, not on an assumed ACP version. If a lower protocol layer
changes, the SDK/CLI handshake and compatibility check must fail clearly.

Set a unique client identity per member and use the SDK's session-awareness
surface for peer visibility. Squad still owns cross-harness workspace leases,
because Codex and Claude Code cannot be assumed to participate in Autohand's
peer protocol.

### Codex adapter

Use `codex app-server` over stdio JSON-RPC as the primary rich-client seam. The
official Codex manual identifies app-server as the interface for embedded
clients needing authentication, conversation history, approvals, and streamed
agent events. Generate or validate schemas against the installed Codex version
instead of hand-maintaining an unversioned event parser.

Use `codex exec --json` only for detection/smoke checks or a deliberately
limited noninteractive path. It is not the primary chat transport because the
native product needs long-lived thread and approval semantics.

Codex state is user-managed. Squad may set an isolated `CODEX_HOME` only after
the user chooses that policy; it must never copy `auth.json` into another member
home or display its contents. Sandbox and approval settings are translated from
the Squad permission ladder using the least-permissive supported mapping.

### Claude Code adapter

Use the documented noninteractive Claude Code interface with streaming JSON:

```text
claude -p --input-format stream-json --output-format stream-json --verbose
```

Capture and persist the returned session ID for documented `--resume` support.
Translate model, allowed/disallowed tools, permission mode, additional project
directories, and appended system context only when the installed CLI advertises
the relevant flag. Permission parity must be explicit: if a Squad permission
state cannot be represented safely without a permission-prompt MCP bridge, the
adapter reports that capability as unavailable and blocks the unsafe launch.

Claude authentication and updates remain owned by the user's Claude Code
installation. Squad detects and explains readiness but does not run `claude
update` automatically.

### Discovery and readiness

`GET /api/harnesses` returns public, secret-free diagnostics:

- installed / missing / unsupported
- resolved executable source and redacted path
- version
- authentication readiness when it can be checked without exposing credentials
- capability matrix
- actionable setup message

The Tauri app must account for GUI applications not inheriting the user's shell
`PATH`, especially on macOS. Resolution order is:

1. managed bundled executable (Autohand only)
2. explicit user-selected executable path
3. safely discovered system executable

Do not execute arbitrary shell strings to probe a harness. Spawn an executable
with an argument array and a short timeout.

## Mixed-team orchestration

The existing run ID remains the Squad source of truth. Each run adds
`harnessId`, `harnessVersion`, `sessionId`, `capabilities`, and normalized event
metadata. A handoff creates a new run owned by the target member and its selected
harness; it transfers a bounded context pack, not the source vendor's private
session object.

Workspace concurrency is enforced above the adapters:

- multiple read-only runs may share a workspace
- only one write-capable run holds the workspace lease by default
- a queued member displays who owns the lease and why it is waiting
- explicit user override is recorded as an approval event
- interrupt/quit releases the lease only after the child process is confirmed
  stopped or marked orphaned

This provides a common safety rule even when the three harnesses expose
different collaboration primitives.

## Member experience

### Creation

The member-creation flow adds a simple **Runs with** field after role/personality
and before model/permissions. It is a restrained list or select, not three large
vendor cards. Each option shows one readiness line:

- Ready
- Setup required
- Not detected
- Unsupported version

The user may save a member whose harness still needs setup. Launch remains
blocked until preflight passes, with one direct action to Harness Settings.

### Member profile

Add a dedicated Harness section adjacent to Model and Permissions. It shows:

- assigned harness and version
- executable source
- readiness and last check
- native model override when supported
- capabilities that differ from the Squad ideal
- Change harness and Test harness actions

The profile header and directory use at most a quiet text label or small vendor
mark. Harness identity must not become another row of boxed metrics.

### Launch and run views

Before launch, show the chosen member, harness, workspace, permission level, and
effective model in one concise preflight line. During work, the activity stream
uses normalized event labels but makes the harness visible. Raw vendor details
remain opt-in. A blocked harness never converts the run to another harness.

## Tauri 2 desktop shell

### Shape

Add a `src-tauri/` application that owns the desktop window, single-instance
behavior, tray/menu, deep links, launch-at-login integration, and updater UI.
The existing React/Vite app remains the product UI. The existing Rust daemon,
analytics process, `squad` launcher, bundled Node runtime, `server.mjs`, and web
assets are staged as Tauri sidecars/resources.

Production startup:

```text
Autohand Squad.app / Autohand Squad.exe
  -> Tauri single-instance + tray
  -> start service-only Squad sidecars on 127.0.0.1
  -> wait for authenticated local health handshake
  -> load local app URL in the native webview
  -> focus existing main window for later launches/deep links
```

Tauri replaces the browser-opening desktop controller as the primary GUI. Keep
the current `squad` CLI and browser mode as headless/developer fallback paths.
Do not run both Tauri's tray and `autohand-squad-tray` in the normal desktop
launch.

### Local bridge security

Binding to loopback is necessary but not sufficient. The desktop launch creates
a high-entropy session token held by the Tauri process and local bridge. The
webview presents it through a controlled bootstrap/IPC path; state-changing API
requests reject missing or invalid tokens and untrusted origins. Logs and error
screens must redact the token.

### Packaging

Tauri 2 can embed external binaries and emit macOS DMG and Windows NSIS setup
EXE bundles. Reuse the existing release names, channel/version rules, checksums,
portable archives, and immutable tag verification. Replace the current
CrabNebula installer lane only after Tauri packages pass equivalent payload and
smoke checks.

The installer bundles Autohand, Node, the Squad services, and web assets. It does
not bundle Codex or Claude Code in the first release. Harness Settings explains
their separate installation and sign-in requirements.

### Signing and updates

Release readiness requires two independent trust layers:

- operating-system trust: Developer ID signing plus notarization/stapling on
  macOS; Authenticode signing on Windows
- update trust: Tauri updater signature and channel manifest validation

The updater preserves stable/beta/canary channels, never silently crosses a
channel, verifies the signed artifact before install, and offers rollback or a
clear manual recovery path. No stable release is published merely because an
unsigned local bundle builds.

## Failure and recovery rules

- Harness missing/auth expired: block only that member and retain the rest of
  the squad.
- Harness crashes: persist the exit/error event, release or quarantine its
  workspace lease, and offer resume only if the adapter supports it.
- Local bridge fails: native shell shows a recovery screen with Restart Service
  and Open Logs; it does not open a blank browser page.
- Sidecar survives app quit: mark it orphaned, attempt bounded cleanup, and show
  the exact process in diagnostics on next launch.
- Update fails verification: keep the installed version and report the failed
  channel/artifact without executing it.
- Unsupported capability: block the unsafe action or require an explicit
  recorded approval; never pretend semantic parity.

## Explicit non-goals for the first release

- Bundling or licensing Codex and Claude Code inside the installer
- Automatic installation, login, or update of external harnesses
- Cloud-hosted execution or cross-user federation
- Migrating the Node bridge to Rust solely for aesthetic architecture reasons
- Replacing existing brain cards, permissions, evidence, channels, or handoffs
- Silent harness fallback
- Claiming signed, notarized, or verified-publisher status from unsigned CI
  artifacts

## Source notes

- Tauri 2 documents external binaries as sidecars and supports platform-targeted
  binary names: <https://v2.tauri.app/develop/sidecar/>
- Tauri distribution supports macOS DMG and Windows NSIS setup EXE bundles, with
  platform signing as a separate release concern:
  <https://v2.tauri.app/distribute/>
- Codex app-server is the documented deep-integration surface; `codex exec
  --json` is the documented noninteractive JSONL surface:
  <https://developers.openai.com/codex/>
- Claude Code documents streaming JSON, permission flags, and session resume in
  its CLI reference:
  <https://docs.anthropic.com/en/docs/claude-code/cli-usage>
- Autohand Agent SDK TypeScript documentation:
  <https://docs.autohand.ai/agent-sdk/typescript.html>

