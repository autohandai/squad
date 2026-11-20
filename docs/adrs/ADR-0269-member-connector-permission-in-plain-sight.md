# ADR-0269: Whether a member may use connectors is said, and set, where connectors are shown

Status: accepted, 2026-11-20

## Context

"i added a connector to thiago cloudflare mcp and didn't work". Thiago
answered that he could not reach Cloudflare and had no network tools.

What the bridge showed:

- The connector `Cloudflare` (`cn-ab82853d`) was enabled, at
  `https://docs.mcp.cloudflare.com/mcp`. That is Cloudflare's documentation
  server: it can search the docs, but it has no access to anyone's account.
- Connectors reach a member's engine only when its `mcp.connectors` mode is
  `allow` (ADR-0107; `connectorsAllowed` in `server/connectors/inject.mjs`).
  "ask" cannot be honoured because the pinned engines have no per-call
  approval for MCP tools.
- Every member on this Mac had `ask` or `block`: Chief of Staff, Tatiana and
  both New members `ask`, Thiago and Haggle Bot `block`. So no connector
  reached anyone.
- The member Connectors page added in ADR-0265 said "Connectors you add are
  shared: every member can use them" and marked Cloudflare "Connected" on
  Thiago's page. That was wrong: the rule was buried on the Built-in Tools
  tab, and our own page contradicted it.

## Decision

- A member's Connectors page:
  - says whether that member may use connectors, with a "Let Thiago use
    connectors" switch beside it. On sets `mcp.connectors` to `allow`, off
    to `ask`, in the base rules and every folder override (`withConnectors`,
    `usesConnectors`);
  - lists each connector with its address, so a documentation-only server is
    recognisable;
  - says per row "Thiago can use it" or "Off for Thiago".
- The Execution panel's quick settings carry the same switch on the
  Connectors row. When it is off, the row says so instead of "Can use
  Cloudflare".

## What was run

`check-member-controls-browser` now asserts:
- the page says the member cannot use connectors yet;
- the switch saves `mcp.connectors = allow` in the bridge's copy of the
  member, and the page then says it can;
- switching off saves `ask`.

`check:connectors` (injection only for `allow`) and `check:permission-policy`
pass.

## Consequences

- Connectors stay off by default for each member, as ADR-0107 decided: an
  MCP server can read and act on outside accounts. The difference is that
  the page now says so and offers the switch.
- Cloudflare account access needs Cloudflare's account MCP servers (with
  their own sign-in), not the documentation server. Squad's catalogue does
  not list them yet.
