# ADR-0162: Squad uses Autohand Computer Use

Date: 2026-11-02
Status: Accepted. Revises the host-identity decision of ADR-0070.

## Context and evidence

ADR-0070 gave Squad its own Computer Use host, `Squad Computer Use.app` with
the identity `ai.autohand.squad.computer-use`, built from the pinned
`autohandai/computer-use` 0.28.2 release with a branding patch, because an
early build had shared another product's permission identity and TCC
attribution became ambiguous. Since then Autohand Code ships Autohand
Computer Use itself: `autohand computer install` puts the same 0.28.2
`cua-driver` in `~/.local/bin`, installs `Autohand Computer Use.app`
(identity `ai.autohand.computer-use`) in `~/Applications`, opens the
Accessibility and Screen Recording prompts, and registers the driver as the
managed `autohand-computer-use` MCP server for every CLI session
(`src/computer/*.ts`, `docs/computer-control.md` at v0.9.9). The Autohand
installers run that step, so the component "comes bundled in the install".

On this machine `autohand computer status --json` reports the driver ready
at `~/.local/bin/cua-driver` and the app is in `~/Applications`. The person
asked that Squad (and Autohand Desktop) use that component rather than a
Squad-branded copy: one engine, one host, one macOS grant shared with the
CLI, instead of two entries in System Settings for the same thing.

## Decision

The bridge resolves Autohand Computer Use the way the CLI does
(`resolveAutohandComputerUse`): the driver from `AUTOHAND_CUA_DRIVER_PATH`,
`PATH` or `~/.local/bin`; on macOS the host from
`AUTOHAND_COMPUTER_USE_APP_PATH`, an `autohand-computer-use` launcher on
`PATH`, `~/Applications` or `/Applications`; cursor themes from
`$AUTOHAND_HOME/computer-use/cursor-themes`. When both are present the native
client launches that host with `mcp --driver-path <driver>` and the identity
`ai.autohand.computer-use`, exactly as the CLI's managed MCP entry does.
Squad's grants, evidence, member scopes and the stdio proxy are unchanged;
only the process behind them differs.

Squad's bundled copy remains a fallback for a machine where the CLI's
component is absent, and `AUTOHAND_SQUAD_COMPUTER_USE=bundled` pins it for
the bridge checks. Amended 2026-11-03: that copy is no longer a Squad-branded
build. The person asked that the CLI, Squad and Autohand Desktop all use
`autohandai/computer-use` itself, so the reviewed branding patch of ADR-0070
is gone: `scripts/fetch-computer-use.mjs` builds the pinned upstream source
as it is, the bundle is `Autohand Computer Use.app` with
`ai.autohand.computer-use`, the upstream consent text and icon, and its
provenance records `patched: false`. The bridge refuses a bundled host that
still carries the old `ai.autohand.squad.computer-use` identity. One
component, one identity, one macOS grant, whichever copy starts. The Permissions page says which host is in use and offers
"Install Autohand Computer Use", which runs `autohand computer install`
through the bundled CLI (`POST /api/computer-use/install`); the native
"Set up macOS permissions" button belongs to the bundled host only.

The host is probed at bridge start (one `tools/list`) before it is trusted.
On this machine the installed `Autohand Computer Use.app` (29 October) was
built for macOS 26 and exits at dyld on macOS 15.5 ("Library not loaded:
libswift_DarwinFoundation1.dylib … built for macOS 26.0 which is newer than
running OS"), so Squad falls back to its bundled host and the Permissions
page says: "Using Squad's bundled Computer Use host: Autohand Computer Use is
installed but did not start … Run `autohand computer doctor`." That is the
CLI's bug to fix in its component build; Squad reports it instead of
showing "readiness could not be confirmed".

## Consequences and validation

- A person who already granted Autohand Computer Use for the CLI grants
  nothing new for Squad; a person who had granted Squad Computer Use grants
  Autohand Computer Use once (the install opens the prompts). Two System
  Settings rows can coexist during that transition.
- `check-computer-use` covers the resolution order and the launch
  arguments with fixture files; `check-computer-use-bridge` keeps running
  the bundled path under the pin variable.
- The CLI adds its own `autohand-computer-use` server to every session
  unless `AUTOHAND_DISABLE_COMPUTER_USE` is set. On the 0.1.16 demo run a
  QA Engineer with no Computer Use grant reached for it to check the phone
  layout; with the macOS permissions not given yet, the CLI failed the whole
  reply with "Autohand Computer Use could not verify its desktop
  permissions". Member engines now run with that variable set, so the only
  Computer Use a member has is Squad's proxy, which applies its grant.
  `check-thread-warmth` asserts the variable on the engine launch.
- A person who granted Squad Computer Use before this amendment grants
  Autohand Computer Use once; the Squad Computer Use row in System Settings
  is dead and can be removed by hand.
- Left undone: the bundled copy still ships, so the runtime carries the host
  even on a machine where the CLI installed one; dropping it is a follow-up
  once a release has run on the shared component. Autohand Desktop is a
  separate codebase and is not changed here.
