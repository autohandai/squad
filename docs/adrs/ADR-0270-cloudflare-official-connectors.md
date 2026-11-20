# ADR-0270: Cloudflare's official MCP servers in the connector catalogue

Status: accepted, 2026-11-20

## Context

"i need cloudflare official mcp as a connector so users can connect their
account there". The only Cloudflare connector anyone had added was
`https://docs.mcp.cloudflare.com/mcp`, the documentation server, which has
no access to an account (ADR-0269). The catalogue offered Squad's Google
connectors and the MCP Registry, and none of Cloudflare's account servers.

Probed on 20 Nov 2026:
- `mcp.cloudflare.com/mcp` and the `bindings`, `builds`, `observability`,
  `radar`, `dns-analytics`, `logs`, `auditlogs`, `ai-gateway`, `browser`,
  `graphql` and `containers` servers each answer `initialize` with 401 and
  `WWW-Authenticate: Bearer … resource_metadata=…`. The docs server answers
  200.
- The authorization servers for `mcp.cloudflare.com` and `observability`
  publish `registration_endpoint` (`/register`) and PKCE `S256`.

That is the MCP OAuth path Squad's connectors already speak (ADR-0244), so
no Cloudflare client id of our own is needed.

## Decision

- Seven curated entries, shown after Google's and before the registry
  (`CLOUDFLARE_ENTRIES`, `server/connectors/catalog.mjs`), all with
  Cloudflare's logo:
  - **Cloudflare**, the account-wide API server: Workers, DNS, zones, R2,
    D1, KV and more;
  - Observability, Workers Bindings, Workers Builds, DNS Analytics, Radar;
  - Docs, which says it needs no sign-in and has no account access.
- **Install** saves a remote (HTTP) connector at the official address,
  discovers that it needs sign-in, marks it for dynamic registration and
  starts the sign-in: the person signs in on Cloudflare's own page and
  picks the account and permissions there.
- An entry already added shows as Added, matched by address, including a
  docs server added by hand.

## What was run

`scripts/check-cloudflare-connectors.mjs` (new), against a real isolated
bridge and Cloudflare's live servers:
- the catalogue lists seven, with the account-wide server first;
- the sign-in labels are right;
- installing Cloudflare saves `https://mcp.cloudflare.com/mcp` with OAuth,
  registers a client with Cloudflare, and returns
  `https://mcp.cloudflare.com/authorize` with `code_challenge_method=S256`;
- the catalogue then shows it Added.

`check:connectors` and `check-member-controls-browser` pass.

## Consequences

- The new check talks to Cloudflare and registers a client each run, so it
  is not in CI. Run it by hand when the catalogue changes.
- `logs`, `auditlogs`, `ai-gateway`, `browser`, `graphql` and `containers`
  are not listed. They are narrower; any of them can still be added by
  address.
- A member still needs "Let … use connectors" (ADR-0269) before it uses
  any of them.
- Cloudflare can change these servers. The entries are addresses, not
  pinned versions.
