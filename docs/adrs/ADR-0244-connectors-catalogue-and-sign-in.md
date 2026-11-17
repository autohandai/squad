# ADR-0244: Connectors from the MCP Registry, with sign-in, sealed secrets and a supervised launcher

Status: Accepted
Date: 2026-11-17
Amends: ADR-0107 (connectors and Web research), ADR-0175 (managed Squad row)

## Context and evidence

The owner compared Settings › Connectors with Codync's connectors and found
ours "very very basic": Squad had the managed Autohand Squad row, the built-in
Web research row, and an Add connector form asking for a name, a kind, a
command, arguments one per line and `KEY=value` environment lines. Codync
shows "Connectors come from the official MCP Registry and install on
<computer>", a Custom connector row, and a catalogue of services with brand
marks and Add buttons (Composio, GitHub, Linear, Notion, Figma, Stripe,
Vercel, Supabase, Cloudflare, Atlassian). He asked for the same support,
"with logos, with the pre-made including access to Gmail, Google Drive
through the MCP that they have created", and for robustness.

Codync (`leepokai/Codync`, Apache-2.0, commit 9b47189 of 17 Nov 2026) was read
for behaviour, not copied: `host/src/market/{registry,install,oauth,
connector_keeper,updates,composio}.rs`, `host/src/market/oauth/{discovery,
registration,device}.rs`, `apps/desktop/src/renderer/views/marketplace/*`,
`docs/features/connector-credentials.md`,
`docs/guides/connector-verification.md`. What it actually does:

- **Catalogue.** It browses `registry.modelcontextprotocol.io/v0/servers`
  (`version=latest`, 60 per page, cursor paging, 45 s search timeout) with a
  hard-coded featured list looked up by registry name and shown first, keeps
  the unfiltered first page in memory for 10 minutes, reads past up to three
  pages with nothing installable, and offers only packages with a pinned
  version (npm via `npx -y`, PyPI via `uvx`, OCI via `docker run -i --rm`,
  NuGet via `dnx`) and `streamable-http`/`sse` remotes.
- **Logos.** Its catalogue marks come from Google's favicon service
  (`google.com/s2/favicons?domain=…`) with a letter tile underneath. The
  Gmail, Google Drive and Google Calendar PNGs in its assets are decoration on
  the sidebar's Extensions button, not connectors.
- **Google access is Composio, not an MCP server Codync wrote.** Gmail, Drive
  and Calendar reach Codync's bots through Composio (`composio.rs`): the
  person pastes a Composio Platform API key, Composio's hosted auth link does
  the Google consent (Composio owns the Google OAuth client and its
  verification), and the bot gets one built-in `composio` MCP server limited
  to the connected apps. Codync's error text also points people to Composio
  Connect, `https://connect.composio.dev/mcp`, an MCP server in the official
  registry. Probed on 17 Nov 2026: it answers 401 with
  `resource_metadata="https://connect.composio.dev/.well-known/oauth-protected-resource"`,
  and its authorization server advertises dynamic client registration and
  PKCE S256, so any MCP client can sign in to it with no client of its own.
  Google publishes no Gmail, Drive or Calendar MCP server: the registry's
  `com.googleapis.*` entries are Cloud products only, and
  `https://{gmail,drive,calendar}.googleapis.com/mcp` answer 404.
- **Sign-in.** MCP authorization: protected resource metadata from the
  `WWW-Authenticate` hint or well-known paths, RFC 8414 then OpenID
  discovery, dynamic registration with a loopback redirect, PKCE, a 15-minute
  pending state, single-flight refresh, and refresh outcomes classified as
  renewed / retry / revoked / unregistered. GitHub uses the device grant with
  Codync's own GitHub OAuth App (its client id is in the source).
- **Secrets** are sealed with XChaCha20-Poly1305 under a key in the OS
  keychain, and bots launch connectors through `codync-host mcp local|remote`
  proxies, so tokens are injected at launch rather than written into agent
  configuration.

Squad's seam was established before writing anything (ADR-0107): enabled
connectors were written into every allowed member's config (Autohand
`mcp.servers`, a Claude `--mcp-config` file, Codex `-c` overrides) **with
their secrets in clear**, and `connectors.json` held them in clear too. A URL
connector took static headers only; a server asking for sign-in failed as
"HTTP 401". A stdio server that crashed mid-session stayed dead until the
engine restarted.

## Decision

### Catalogue

`server/connectors/registry.mjs` is the registry client and
`server/connectors/catalog.mjs` the curated part.

- The official MCP Registry is the source. Featured entries (Composio,
  GitHub, Linear, Notion, Figma, Stripe, Vercel, Supabase, Cloudflare,
  Atlassian, Context7, Playwright) lead the first page with Squad's own plain
  descriptions; search and "Show more" page through the rest.
- Registry JSON is untrusted: `sanitizeServer` keeps a bounded subset, refuses
  non-https URLs (http only on loopback, for fixtures) and URLs with
  credentials, and is idempotent so a cached copy is checked the same way as a
  live one. Only pinned packages are offered; `latest`, `^1`, `~1`, `*` and
  untagged images never are.
- Install options follow Codync's rules and go further: registry argument
  `variables` (GitHub's `-e GITHUB_PERSONAL_ACCESS_TOKEN={token}`) become
  inputs, an optional part left empty drops the whole argument, and **a
  secret never lands in saved arguments**: Docker's `-e NAME=value` becomes
  `-e NAME` with NAME in the sealed environment, anything else a
  `{{secret:key}}` placeholder filled at launch. A bare token typed for an
  `Authorization` header without a template gains `Bearer `.
- Offline: the first page is cached in memory for 10 minutes, saved to
  `<state>/connector-catalog-cache.json`, and a snapshot of the featured
  entries ships in `server/connectors/catalog-snapshot.json`
  (`scripts/refresh-connector-catalog.mjs` regenerates it; the desktop and
  portable packagers require it). The page says when it shows a saved copy.
  Registry calls retry 5xx/429/network failures after 0.5 s and 1.5 s.
- Marks are bundled, not fetched: `src/lib/connector-logos.js` holds one
  24×24 path per brand from Simple Icons 16.36.0 (CC0-1.0; the marks remain
  their owners' trademarks, used only to identify the service), drawn in the
  brand colour or the text colour for near-black brands. Without a bundled
  mark the registry's own icon is shown (https only, no referrer), then a
  letter. Composio, Context7 and Playwright have no Simple Icons mark and use
  their registry icons.

### Gmail, Google Drive and Google Calendar

Two routes, both shown in the catalogue as Gmail, Google Drive and Google
Calendar:

1. **Squad connector** (`server/connectors/google-workspace-mcp.mjs`, one
   process per product): Squad's own MCP server calling Google's REST APIs.
   Gmail: `gmail_search`, `gmail_read`, `gmail_create_draft`, `gmail_send`.
   Drive: `drive_search`, `drive_recent`, `drive_read` (Docs, Sheets and Slides
   exported as text). Calendar: `calendar_list_events`,
   `calendar_create_event` (attendees not notified unless asked). It signs in
   to Google with a Google OAuth client **the person provides** in Settings
   (or a release build provides through `AUTOHAND_SQUAD_GOOGLE_CLIENT_ID` and
   `AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET`), loopback redirect, PKCE,
   `access_type=offline`, and per product only `openid email` plus
   `gmail.readonly gmail.compose`, `drive.readonly`, or `calendar.events`. The
   server never holds a refresh token: it asks the bridge for an access token
   and asks again with `stale` on a 401.
2. **Through Composio**: installs Composio Connect from the registry and signs
   in to it with MCP OAuth; Composio then connects the Google account. No
   Squad setup, but Composio holds the Google tokens.

We did not reuse Codync's credentials (its GitHub client id, or a Composio
key) and did not build on Composio's Platform API, which needs a per-person
API key and Composio's REST surface.

### Sign-in (`server/connectors/oauth.mjs`)

MCP authorization as above, with the bridge's loopback callback
`<bridge>/api/connectors/oauth/callback`. Additions to Codync's behaviour:
the sign-in scope comes from the `WWW-Authenticate` `scope` before
`scopes_supported`; a server whose metadata lacks S256 is refused; a client
registration is reused only for the same redirect URI and issuer; tokens
granted while the address was being edited are revoked, not just discarded;
a refresh retries once after a network failure or a busy server before
classifying the answer; sign-out and removal revoke at the provider
(RFC 7009, five-second cap); the device grant (RFC 8628) is generic and is
offered for GitHub only when a Squad GitHub OAuth App client id is set
(`AUTOHAND_SQUAD_GITHUB_CLIENT_ID`). The broker lets exactly two
context-less paths through: the callback (`GET` with a `state`, which the
worker checks) and the runtime endpoints (with a connector token).

**Corrected during the work:** the first version treated every 401 from a
server without our own `Authorization` header as "needs sign-in", as
Codync's `required` does. ADR-0107's fixture (a plain 401, no metadata)
showed the flaw: an API-key server then offered a sign-in that could only
fail. A 401 now means sign-in only when the server publishes resource or
authorization-server metadata; otherwise the row asks for a key.

### Secrets (`server/connectors/store.mjs`)

Environment values and headers marked secret, argument secrets, OAuth tokens
and client secrets, the Firecrawl key and the Google client secret are sealed
per connector with AES-256-GCM under the vault's data key (ADR-0104: macOS
Keychain, Windows DPAPI, Linux Secret Service, else a 0600 key file outside
the state directory), with the connector id as associated data. Files from
ADR-0107 are sealed on first read. The person marks a value secret with a
lock; names that look like keys lock themselves. A missing key is a plain
503, never an empty configuration; the list still shows. Names are unique;
a rename keeps the id and the member-facing server name.

### Launches (`server/connectors/runtime.mjs`, `runtime-proxy.mjs`)

Members' engines now get one entry per connector: `node runtime-proxy.mjs`
with the bridge's runtime address, a **per-member token** (in memory, stable
while the bridge runs so warm sessions keep their key) and the connector id.
The proxy fetches the real definition at start; the bridge refuses a token it
didn't issue, a connector not granted to that member, or one turned off since.
**No connector secret is written into a member's config any more**, for
Autohand, Claude or Codex. The proxy:

- runs a command connector as a supervised child: requests in flight when it
  dies get a plain error, it restarts after 0.25, 1, 3, 10, 10 s (at most five
  times in five minutes, then "keeps stopping"), and the engine's initialize
  handshake is replayed so the session continues without the engine noticing;
- bridges an address connector from stdio to Streamable HTTP or legacy SSE: a
  401 renews the sign-in once and retries, a 404 on an MCP session
  re-initializes and resends, connection failures retry after 0.5 and 1.5 s,
  then answer in words ("Can't reach mcp.notion.com…");
- resolves `npx`, `uvx`, `docker` through Squad's GUI-safe PATH, because the
  desktop app's engines may start with a short PATH;
- reports starts, crashes and errors back, so the row can say "Stopped twice
  in the last hour: …".

### Health and the page

`server/connectors/health.mjs` turns each record into one state (ready,
needs sign-in, needs setup, failing, unstable, untested), a sentence a person
can act on, and the single action that fixes it (Sign in, Test again, Edit,
How to install, Set up Google sign-in, Update to x.y.z). Errors are
translated: a missing `npx` says to install Node.js; a 401 says the key was
refused, or that the sign-in ended; a refused connection, an unknown host
and a timeout each say so.

Adding works without typing a command: choose the entry, choose how it runs
when there is a choice (Hosted or On this computer), fill only what the
registry asks for, and Squad installs it, opens the sign-in if the server
wants one, checks its tools and **turns it on when the check passes**. A
connector that fails stays off with its fix on the row; fixing it through
Edit turns it on. This replaces ADR-0107's "a new connector is saved off":
that rule existed because nothing had been checked, and now the check runs
first. A connector the person switched off while it worked stays off.

Custom connectors take an address (transport detected: Streamable HTTP, else
the older SSE; sign-in detected), a command, or a pasted `mcpServers`
config (also `servers`, `context_servers`, one server, or a bare map), with
Check before Add.

Registry packages are checked for newer versions when the catalogue opens,
at most every six hours. "Update to x.y.z" tests the new version on a copy
and saves it only if it starts, so an update cannot break a working
connector; a hand-edited connector is not changed.

### How the page differs from Codync's

Codync is a two-column grid of logo tiles in a marketplace sheet. Squad keeps
its settings page (DESIGN.md): two quiet sections, "Your connectors" and "Add
a connector", each a single divider list of rows with a small bordered mark,
a name, one line of description or status, and a ghost Add. No cards, no
grid. Status is a dot and a sentence with one fix button, not a badge. Install
and custom connectors open a shadcn Dialog; sign-in progress is one line with
Open sign-in page and Cancel; the remove confirmation is inline.

## Parity with Codync

| Capability | Codync | Squad |
| --- | --- | --- |
| Official MCP Registry browse, search, paging, featured first | Yes | Yes |
| Catalogue offline | First page kept in memory while running | Saved first page, then a bundled snapshot |
| Brand marks | Google favicon service | Bundled Simple Icons marks, then registry icons |
| Pinned packages only (npm, PyPI, OCI, NuGet), hosted remotes | Yes | Yes, plus argument variables and secret arguments kept out of args |
| Gmail, Drive, Calendar | Composio (Platform API key) | Squad's own Google connectors (person's Google client) or Composio Connect via MCP sign-in |
| MCP OAuth discovery, dynamic registration, PKCE, refresh | Yes | Yes, with revocation on sign-out, removal and address change |
| Device sign-in | GitHub with Codync's app | Generic; GitHub once Squad has a GitHub OAuth App |
| Sign-in from a phone (cloud bounce page) | Yes | No |
| Custom connector by command or address | Yes; its remote proxy falls back to SSE at run time | Yes; transport and sign-in detected by Check before saving, SSE fallback in the launcher too |
| Paste an `mcpServers` config | Yes | Yes |
| Secrets sealed with an OS-held key | Yes, no plaintext fallback | Yes, 0600 key-file fallback outside the state dir |
| Agents launch through a proxy, no secrets in agent config | Yes | Yes |
| Readiness check that lists tools | Yes | Yes |
| Crash recovery of command connectors | Restart on edit | Supervised restart with handshake replay |
| Update tracking | Every 6 h, applied before launch | Every 6 h, applied by the person after a trial run |
| Rename safety, removal cleanup | Yes | Yes |
| Per-connector status | Check result with a retry | One plain state, sentence and fix action per row, including crashes since the last check |
| Bots asking for a connection or a secret in chat | Yes | No (the vault's request_secret only) |
| 1Password references, website logins | Yes | No |

## What the owner must provide

- **Google, Squad connector route**: a Google Cloud project with the Gmail,
  Google Drive and Google Calendar APIs enabled, an OAuth consent screen, and
  an OAuth client of type **Desktop app**; its client ID and secret go in
  Settings › Connectors › Google sign-in (per computer), or into
  `AUTOHAND_SQUAD_GOOGLE_CLIENT_ID` / `AUTOHAND_SQUAD_GOOGLE_CLIENT_SECRET`
  for the bridge. `gmail.readonly`, `gmail.compose` and `drive.readonly` are
  **restricted** scopes and `calendar.events` is sensitive: an app published
  to external users needs Google's verification and, for restricted scopes,
  an annual third-party security assessment. Until then the consent screen
  stays in Testing (at most 100 listed test users, and Google expires their
  refresh tokens after 7 days, which the row reports as "The sign-in ended").
- **Google, Composio route**: nothing from Autohand. Each person needs their
  own Composio account; Composio stores their Google tokens.
- **GitHub device sign-in**: a GitHub OAuth App owned by Autohand with device
  flow enabled; its client id goes in `AUTOHAND_SQUAD_GITHUB_CLIENT_ID`.
  Without it, GitHub is added with a personal access token (Hosted) or the
  Docker package.

## Consequences and what was left undone

- Release builds don't yet pass `AUTOHAND_SQUAD_GOOGLE_CLIENT_*` or
  `AUTOHAND_SQUAD_GITHUB_CLIENT_ID` to the bridge; the desktop shell's
  environment wiring was out of scope (no native build in this lane).
- The key-file fallback means a computer without a usable keychain still
  works, at the cost Codync refuses to pay: the key sits beside the user's
  data, protected by file permissions only.
- The per-member token is a capability worth the secrets themselves: while
  the bridge runs, anything that can read a member's config (that member's
  own shell tool included) can ask the runtime endpoint for the definitions
  of the connectors granted to that member, keys and fresh access tokens
  included. What changed is that no secret rests in a member's files any
  more, and the token dies with a bridge restart, with the next turn after
  the member loses the MCP connectors permission (a warm session keeps it
  until then), and per connector as soon as that connector is turned off or
  removed. Single-use launch tokens would narrow this further; they were not
  built because a launcher also renews tokens mid-session.
- `{{secret:…}}` argument values are expanded into the child's argv, which
  `ps` shows to the same user. Registry entries that need a secret argument
  are rare; Docker's `-e NAME=value` already goes through the environment.
- Secrets are decrypted in the bridge and passed to child processes in their
  environment; this is not a sandbox against code running as the same user.
- No sign-in from the iPhone, no chat-driven connection requests, no
  1Password references, no Composio Platform API app list.
- The live MCP Registry, real Google, Notion and Composio sign-ins, and a real
  engine (Autohand CLI, Claude Code, Codex) connecting through the launcher
  were not exercised; fixtures prove the protocol and the configuration each
  engine receives, not the vendors.
- The Google connector's Test proves the server starts and the sign-in
  renews; it doesn't call a Google API, so an API left disabled in the Cloud
  project shows up on the first member call ("…isn't enabled for the Google
  Cloud project…").
- Update checks run only when the catalogue is opened or on request, not on a
  timer in the background.
- The legacy SSE reconnect and 401 renewal in the launcher are implemented
  but not covered by a check.

## Independent review

A read-only review of the server code (17 Nov 2026) found nine issues; all
were fixed in this change and each has a check:

- the legacy SSE launcher posted credentials to whatever address the server's
  `endpoint` event named: it now refuses another origin
  (`check-connector-runtime.mjs`, "SSE origin check");
- connection resets were retried, which could run a tool call twice: only
  failures before the request left (refused, unknown host, unreachable,
  connect timeout) are retried now;
- endpoints taken from OAuth metadata could point at loopback, private or
  link-local addresses: `safeEndpoint` refuses internal hosts unless the
  connector itself is on one (by literal address; a public name that resolves
  to a private address is not caught);
- a registry entry that forgot `isSecret` on `API_KEY` would have stored it
  in clear: key-like names are sealed regardless; header templates insert the
  token literally (a `$&` in a token was being expanded);
- registry input could put `-v /:/host`, `--privileged`, `--network host` and
  similar into a Docker command, and `github:…` or URL "versions" passed the
  pin check: such images are not offered (the dialog says why), versions must
  be versions, image names are checked, and the dialog shows the exact
  command before Add;
- the launcher exited 50 ms after SIGTERM, before the SIGKILL fallback, and
  ignored signals: it now waits up to 2 s for the child and handles SIGTERM,
  SIGINT and SIGHUP;
- `include_granted_scopes` let a Drive sign-in carry earlier Gmail scopes:
  removed, so each Google connector holds only its own;
- a refresh in flight during sign-out signed the person back in, and a late
  failed refresh could clear a newer sign-in: both now apply only to the same
  grant, and tokens from a lost race are revoked (`check-connector-oauth.mjs`,
  "refresh race").

The review also noted that the runtime token is worth the secrets, which this
ADR first understated; the consequence above now says so.

The registry also turned out to list Supabase's own flags (`--project-ref`,
`--read-only`) as runtime arguments, which npx would read as its own: a
runtime flag npx or uvx doesn't take now goes after the package.

## Evidence

All on 17 Nov 2026, macOS, Node 24.3.0, in the lane worktree, fixtures only:

- `node scripts/check-connectors.mjs`: passed. The ADR-0107 check now also
  proves the member config holds the launcher and no secret, `connectors.json`
  holds `sealed` and no secret, each launcher entry reaches its server through
  the broker in both framings (fixture command, Web research, Streamable HTTP
  with the sealed header), and a forged token or an ungranted connector is
  refused.
- `node scripts/check-connector-store.mjs`: passed (legacy file sealed on first
  read with hints, id-bound sealing, locked key → 503, explicit secret flags,
  unique names, argument secrets, in-place reinstall, address change signs
  out, removal returns tokens, Google client sealed).
- `node scripts/check-team-builder.mjs`, `check-artifacts.mjs`,
  `check-computer-use-portable.mjs`, `check-teams.mjs`,
  `check-permission-policy.mjs`, `check-member-introduction.mjs`: passed.
  The team builder check caught a store bug the new checks had missed: the
  sealing of old files ran on every read, so an empty `Authorization` header
  a template saves (and any plain value with a key-like name) was moved into
  the sealed part on reload and listed as configured. Migration now runs only
  on a version 1 file and skips empty values; `check-connector-store.mjs`
  reloads the store to prove it.
- `node scripts/check-connector-catalog.mjs`: passed (12 snapshot servers,
  offline cache and snapshot fallbacks). It found that Supabase's optional
  named arguments were emitted as bare flags (`npx -y --project-ref
  --read-only --features --api-url @supabase/mcp-server-supabase@0.17.0`,
  which makes npx read the package as `--api-url`'s value), and that
  `2.0.0-rc.1` compared newer than `2.0.0`; both fixed.
- `node scripts/check-connector-oauth.mjs`: passed (6 registrations, 14
  refreshes, 21 tokens issued, none in clear on disk).
- `node scripts/check-connector-runtime.mjs`: passed (stdio supervision with
  handshake replay, give-up after five restarts, Streamable HTTP 401 renewal
  and session re-initialization, a down server, legacy SSE, token scoping).
- `node scripts/check-google-workspace-mcp.mjs`: passed (69 tool calls across
  the three products in both framings, 6 fresh and 2 stale token requests).
- `node scripts/check-connectors-browser.mjs`: passed in headless Chrome
  against a real bridge: catalogue with the Google entries and marks, search,
  Notion-shaped hosted install signed in with no typing, SSE detected for a
  custom address, a pasted config, a wrong key → Edit → on, Gmail with a
  Google client showing `person@example.com`, no secret in the page, no
  horizontal scroll at 390 px. Its first runs failed because the check
  targeted the first `[role=dialog]`, which during an exit animation was the
  previous dialog; it now targets each dialog by test id.
- `node scripts/check-settings-browser.mjs`, `node scripts/check-jsx-imports.mjs`,
  `node scripts/check-runtime-source-staging.mjs` and `vite build`: passed.
