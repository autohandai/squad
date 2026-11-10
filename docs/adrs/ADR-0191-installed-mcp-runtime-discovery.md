# ADR-0191: Locate the installed MCP runtime independently of the launch folder

## Context

Autohand Desktop 0.10.1 reported Squad offline although the local bridge was healthy. A diagnostic launched inside the Squad checkout loaded the roster; the same command launched from the user's home directory failed with `server.mjs was not found`. The release stores this file under `Contents/Resources/runtime/`, but the native command only considered `Contents/Resources/server.mjs` and source-tree fallbacks.

The first diagnosis identified a separate QA launch profile targeting an empty bridge. Restoring the normal profile preserved the user's 28 Desktop threads, but did not resolve this installed-runtime defect. Tests run under `Developer/autohand/` accidentally found the source checkout through ancestor discovery and masked it. Once the actual installed runtime was located, its older MCP tool set correctly reported an incompatible Squad version rather than an offline bridge.

## Decision

Include the packaged `runtime/server.mjs` location beside Windows executables and beneath macOS `Contents/Resources`. Preserve the existing precedence of installed resources over mutable user state and development checkouts. Ship the current direct-messaging MCP tools with the corrected runtime discovery, rather than substituting development files into an installed signed app.

## Evidence and verification

- Installed Squad 0.1.21's command failed from `/Users/igorcosta` with its normal home and no Squad overrides, while `/api/health` on port 19821 returned the Squad service identity.
- The same command found development sources beneath `Developer/autohand/`, explaining the earlier false-positive tests.
- Candidate coverage now includes both actual packaged layouts. Verification must additionally run the packaged command from a directory outside the checkout with a fresh home, perform MCP initialization and verify the required direct-message tools. A roster-only source test is insufficient.

## Consequences

Installed MCP clients no longer depend on a source checkout or working-directory override. Existing explicit runtime overrides and legacy layouts remain supported. This change does not upgrade an already installed 0.1.21 runtime: that build must be updated to obtain the direct-messaging tools Desktop requires. No member messages are sent as part of connection verification.
