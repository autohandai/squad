# ADR-0104: An encrypted vault members can ask for but never read

Date: 2026-10-13. Lane L4 of the parity lanes
(`docs/superpowers/specs/2026-10-13-parity-lanes-design.md`).

## Context

Members already operate apps through Computer Use and will get their own
workstation browsers in lane L3. The next thing they need is a login, a card
or an address, and today the only way to give one is to paste it into the
chat, where it lands in the conversation history, the harness transcript and
every model call. xiryn solved this with a vault whose values are typed by
the product rather than handed to the agent, and with a payment approval
that the person answers in the app or on Telegram. That behaviour was read
for its edge cases; none of its code was ported (it is a Next.js + SQLite +
Drizzle + zod app; Squad has none of those).

What was observed in Squad before building:

- The managed MCP seam from ADR-0070 is the only place where every harness
  receives a Squad-owned server: Autohand through the isolated member
  config's `mcp.servers`, Claude through `--mcp-config`, Codex through `-c
  mcp_servers.*`. The Autohand CLI speaks Content-Length framing and
  protocol `2024-11-05`; the proxy must accept both framings.
- The warm SDK pool (ADR-0030) keys a session on the launch config path and
  the profile text. Computer Use writes a per-work config with a per-work
  credential, which is why its lease is never kept healthy. A vault that is
  on for most members by default cannot pay that cost on every turn.
- There is no "end turn" primitive in any harness. Channel proposals
  (ADR-0075) end a turn by returning a result and persisting a record that
  a person decides later; the member learns the decision when the channel
  prompt runs again.
- The lowest rungs of the permission ladder are "a conversation, not a
  shell" (`scripts/check-permission-policy.mjs`). A policy module that
  blocks every vault tool should mean the server is not injected at all.
- The notification policy only knows five event names; a pending payment
  must notify like a handoff without a new setting kind.

## Decision

**Sealing.** `server/vault/crypto.mjs` seals each item's fields with
AES-256-GCM under a 32-byte data key, with `"<id>:<kind>"` bound as
associated data, stored as `iv | tag | ciphertext` in base64. Items live in
`<squadStateDir>/vault/items.json` (0600) with label, kind, site and a
masked hint beside the sealed value. Every route and tool returns `view()`:
label, kind, site, hint, timestamps. There is no "show value" anywhere; the
one path to a value, `store.open(id, field)`, is server-side for the L3 fill
path and the tamper check.

**Key.** `server/vault/keychain.mjs` keeps the key in the OS keychain
(macOS `security` under service `ai.autohand.squad.vault` with an account
derived from the state directory, Windows DPAPI through PowerShell with the
protected blob beside the key file, Linux `secret-tool`), falling back to
`<home>/.autohand/squad-vault.key` (0600, outside the data folder). The key
is created once, when the first item is saved, and never recreated while
items exist: a missing key with items present reports "locked" with an
explanation and refuses adds with 503, instead of silently starting an
empty vault beside unreadable leftovers. Checks force the file store with
`AUTOHAND_SQUAD_VAULT_KEY_SOURCE=file` and point the file into a temporary
home with `AUTOHAND_SQUAD_VAULT_KEY_FILE`, so no automated run touches a
real keychain.

**Member tools.** `server/vault/mcp-server.mjs` is a stdio proxy (both
framings) to `POST /api/vault/mcp` with a per-member credential. The
bridge answers `tools/list` with exactly four tools: `vault_list` (hints),
`request_secret` and `request_payment_approval` (create a pending request
and return `waiting_for_person`), and `vault_fill`, which on this Mac
returns a refusal naming the reason: filling types a value only inside a
member workstation browser after checking the page's site, and lane L3 is
not built. The fill path is deliberately left for L3.

**Ending the turn.** No harness has a clean end-turn primitive, so a request
tool returns a result that says the turn ends here and that the member must
stop and say it is waiting. The request is persisted by the bridge
(`<squadStateDir>/vault-requests.json`), survives a restart, and is
resolved only by a browser route. The outcome reaches the member as text
appended to its system prompt on its next turn, carrying the item's id and
hint only, and is marked delivered when that turn's session opens. This is
the same shape as channel proposals and is recorded here as the chosen
trade-off rather than a harness feature.

**Credential and warm sessions.** The credential is per member for the life
of the bridge process, not per work. The managed config is written to a
stable path (`<agentHome>/vault-configs/member.json`), so a warm SDK
session keeps its key and only the turn that delivers an outcome changes
the profile text and starts fresh. When Computer Use is active for the same
work, the vault entry is added to that work's per-work config instead and
removed with it. `member.stopped` invalidates the member's credential.

**Policy.** `src/lib/permission-policy.js` gains a `vault` group
(`vault_list` allow, the rest ask) granted from rank 3, the rung that lets a
member act in the world. `vaultToolsAllowed(permissions)` is false only when
every vault tool is blocked; the bridge then injects no server and adds no
instructions. A member saved before this group existed has no vault keys in
its policy and gets the group defaults.

**Events and attention.** `vault.request.pending` and
`vault.request.resolved` go through `emitBridgeEvent`. The notification
policy maps the pending event to the existing `approvalPending` setting and
routes it to the member's chat. The web app reconciles pending requests
from `GET /api/vault/requests?status=pending` and an SSE stream, renders
them above the main canvas like channel proposals (a secure form with
password inputs, or a decision row: Approve with a saved card / I'll pay
myself / Decline), and lists them in Needs you under "Vault requests",
counted in the badge.

## Evidence

`node scripts/check-vault.mjs` passed against a real bridge in a temporary
state directory with the file key forced into a temporary home. It added a
login and a Visa, grepped every response, the items file and every member
prompt for the seeded password, username, card number and CVV (none
present), verified 0600 on the items file and the key file and that the
key file is outside the state directory, opened a value through the store,
flipped one ciphertext byte and swapped two items' ciphertexts (both fail
with the "changed outside Squad" error), removed the key while items
existed and restarted (reported locked, add refused with 503, no new key
written), restored the key, then ran a fake Codex member that received
`mcp_servers.autohand-vault` through `-c`, spoke newline framing to the
real proxy and saw exactly `vault_list, request_secret,
request_payment_approval, vault_fill`; the check itself spoke Content-Length
to the same proxy with the member's credential (four tools) and with a
forged credential ("expired"). The secret request survived a restart, was
completed from the browser route with the value never returned, and the
member's next turn was told "it is in the vault as item vlt_… (ev••• ·
github.com)". Three payment requests were approved (card id + hint),
self-paid and declined; a login as payment method was refused; a second
decision got 409. Outcomes were delivered on one turn and not the next. A
member with every vault tool blocked got no server, no instructions and no
config file. SSE `changed` events were observed for pending and resolved.

Also run after the change: `check:computer-use-bridge` (the shared
managed-server wiring for Codex still passes with both servers through one
`-c` list), `check:computer-use`, `check:jsx`, `check:bridge-imports`,
`check:notifications`, `check:permission-policy`, `check:work-attention`,
`node --check server.mjs`. `bun run build` was not run: the disk had
1.0 GiB free against the 1.5 GiB rule.

The real keychain was not exercised by any automated step. Verified after
the checks: `security find-generic-password -s ai.autohand.squad.vault`
finds nothing and `~/.autohand/squad-vault.key` does not exist. The manual
keychain verification is in `docs/integration/vault.md`.

## Consequences

- **Fill is deferred to L3.** `vault_fill` exists so the tool surface is
  final, but it refuses on this Mac. Nothing in this change types a value
  anywhere; an approved payment ends with the member reporting that it is
  waiting for a workstation.
- **UPI is out**, as the lane scope says. Kinds are login, card and personal
  details. One-time codes are also out; they belong with the L2 bot reply
  path.
- **The keychain path is verified only by hand.** The file fallback is what
  the check proves. macOS `security` could prompt or fail in CI, so the
  store order is trusted from reading, and the manual steps are documented.
- **Codex resumed sessions do not re-send operating instructions**
  (`server/harness/codex.mjs` only prepends them without a resume id), so an
  outcome delivered on a resumed Codex turn is marked delivered but not seen
  by the model. Profile changes already have this gap. Delivering outcomes
  in the user prompt would fix it for every harness and is left undone.
- **Outcomes are marked delivered when the session opens**, before the turn
  succeeds. A turn that fails before the model reads the prompt loses the
  outcome text; the request record still shows the decision in the app.
- **A member with shell access can read another member's config file** and
  with it that member's vault credential, which only grants that member's
  view: hints and the ability to create requests. Provider keys and Computer
  Use tokens share this exposure; per-member OS users are not in scope.
- **The managed MCP seam in `server.mjs` grew** by a vault twin of the
  Computer Use preparation (about forty lines) and the external-harness
  injection now handles a list of managed servers. The contract still says
  modules do not edit the monolith; this is integrator wiring, done in the
  lane because the lane owns the integrator role.
- The notification uses the existing "Approvals" switch rather than a new
  kind, so a person who turned approvals off also silences payment requests.
