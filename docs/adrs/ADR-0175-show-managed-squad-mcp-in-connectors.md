# ADR-0175: Show the managed Squad MCP connection in Connectors

Date: 2026-11-04
Status: Accepted

## Context and evidence

The Connectors screenshot showed only Web research and added servers. The route returned the external connector store, while the first-party team MCP service was supplied separately to Autohand, Codex and Claude. Its tools were available to members but invisible to the person. The page's blanket claim that all connectors use the external MCP permission was also inaccurate for managed first-party tools.

## Decision

Include a managed Autohand Squad record in discovery, using the live team service's tool definitions. The page shows its purpose, tool count and expandable tool list before external servers. Its state says Managed by Squad, not Tested or Running: discovery establishes that the bridge provides the tool set, not that every member's engine session has completed a handshake.

The managed record is outside the editable external connector store. Requests to remove, disable or edit it are rejected. Members retain their existing individual tool policies; exposing it does not add a second MCP process or weaken a permission. Update the page description to distinguish those policies from the external MCP connectors permission.

## Consequences

People can inspect the tools Squad supplies, including artifact publishing, without accidentally disconnecting core team functions. The row deliberately has no global enable toggle or generic third-party connection test. Session-level health still belongs to the member's engine; this change does not claim provider execution proof. The actual tools list and permission policy remain checked against each other by the team integration suite.

## Verification

`scripts/check-artifacts.mjs` reads discovery from the actual team service and verifies managed mutations are refused. Browser checks inspect the row and its tool list at desktop and phone sizes. Existing connector tests continue to exercise editable external servers and their permission gates separately.
