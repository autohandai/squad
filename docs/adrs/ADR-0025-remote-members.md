# ADR-0025: Remote members and shared compute

Date: 2026-09-26 · Status: accepted

## Context

Members only ran as local processes behind the bridge on 127.0.0.1. A
squad that spans two machines (a laptop and a studio Mac with the GPU,
or a colleague's box) had no way to route a channel mention to a member
that lives elsewhere and get the run trace back in the same UI. Issue #36
asks for exactly that, without a relay network or multi-user accounts.

## Decision

- **Bridge-to-bridge, nothing new in the middle.** A remote member is a
  member whose chat, stream, and run requests are forwarded to another
  Autohand Squad bridge (`<url>/api/chat`, `/api/chat/stream`, `/api/runs`)
  with `Authorization: Bearer <token>` and `x-autohand-transport: remote`.
  The remote runs the same code path it runs for its own browser. SSE is
  piped through byte for byte; the proxy only prepends one `remote` event
  and stamps JSON replies with `transport: "remote"` and `remote: { label, url }`.
- **Registry** (`server/remote/registry.mjs`): `<squadStateDir>/remotes.json`
  at mode 0600, `{ [memberId]: { url, token, label, addedAt }, _served: [...] }`.
  Public shapes never include a token. Tokens this machine hands out are
  stored only as SHA-256 hashes under `_served`, so a minted token is shown
  once. Member ids may not start with `_`.
- **Serving side** (`server/remote/auth.mjs`): `mintToken()` produces
  `ahs_` + 32 random bytes; `bearerTokenAllowed(req, tokens)` compares
  hashes in constant time. A token-authenticated request bypasses the
  same-origin guard (it has no browser Origin) and is limited to the
  chat/run/runtime/presence routes. The bridge still listens on
  127.0.0.1 by default; sharing a machine is an explicit `--host` or a
  tunnel.
- **Failures name the remote and invite a retry.** Every proxy error is a
  `RemoteError` whose message starts with the remote's label ("Studio:
  refused the connection", "Studio: rejected the token", "Studio: did not
  answer within 10 s") with an HTTP status (401/502/504) and `retryable`.
  The 10 s connect timeout covers headers only; an open stream is not
  bounded by it.
- **No loops.** `resolveRemote(ctx, memberId, { req })` returns null for a
  request that already carries `x-autohand-transport: remote`, so two
  bridges pointing at each other cannot bounce a prompt.
- **UI** (`RunsOnSettings`): two divider rows, This machine / Remote
  bridge, with a check mark on the chosen one; URL, name, token; Test
  gives one sentence from `GET /api/runtime` on the remote; `PUT` probes
  before saving so a bad URL or token is refused with the reason. "Share
  this machine" is a text disclosure that mints a token and shows it once
  with a copy button.

## Consequences

- A member on a second machine answers a channel mention with its own
  run trace, and the reply is marked `transport: remote`.
- Tokens are bearer secrets: `remotes.json` is owner-only, served tokens
  are hashed, and revoking one is a `DELETE`. Transport security between
  machines is the network's job (LAN, VPN, or HTTPS tunnel); the bridge
  does not terminate TLS.
- Workspaces are paths on the machine that runs the member. The
  integrator drops the local `workspace` from forwarded payloads unless
  the remote record pins one.
- Members remain browser state; the remote bridge learns about a member
  only from the payload of each request, exactly as it does for its own
  browser today.
- Not covered: discovery, a relay through the internet, sharing one
  member with several people, or forwarding routes beyond chat and runs.
