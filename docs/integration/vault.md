# Vault (lane L4, ADR-0104)

Logins, cards and personal details sealed with AES-256-GCM under a key the
OS keychain holds (file fallback outside the data folder). Members get four
managed MCP tools and never a value. Already wired in this change; the notes
below say where, so the next integrator can see the seams.

## Bridge

| Piece | File |
| --- | --- |
| Sealing, hints, field validation | `server/vault/crypto.mjs` |
| Key stores (keychain / DPAPI / secret-tool / 0600 file) | `server/vault/keychain.mjs` |
| Items on disk, `<squadStateDir>/vault/items.json` | `server/vault/store.mjs` |
| Pending requests and decisions, `<squadStateDir>/vault-requests.json` | `server/vault/requests.mjs` |
| Member sessions, tool definitions, MCP dispatch, next-turn text | `server/vault/service.mjs` |
| Managed stdio MCP server (both framings) | `server/vault/mcp-server.mjs` |
| Routes | `server/routes/vault.route.mjs` |

Routes (`{ success, data }` envelopes):

```
GET    /api/vault                         items (views), count, keySource, locked, error
POST   /api/vault/items                   { kind, label?, fields } → view
DELETE /api/vault/items/:id               → view
GET    /api/vault/requests?status=pending { requests }
POST   /api/vault/requests/:id/secret     { fields, label? } → resolved request (outcome: itemId, hint)
POST   /api/vault/requests/:id/dismiss    → resolved request
POST   /api/vault/requests/:id/payment    { decision: approve|self|decline, itemId? }
GET    /api/vault/events                  SSE "changed" on vault.request.pending / resolved
POST   /api/vault/mcp                     header x-squad-vault-token; MCP JSON-RPC (members only)
```

`server.mjs` wiring (done): builds `vault` beside `computerUse`, exposes it
as `ctx.vault`; `prepareVaultWork` runs after `prepareComputerWork` and
writes the managed server into `<agentHome>/vault-configs/member.json`
(or the Computer Use per-work config when one is active); Claude gets one
`--mcp-config` with every managed server, Codex one `-c` set per server;
`vaultInstructions(runtime)` joins the profile beside the Computer Use
text; `finishVaultWork` runs with `finishComputerWork`; `member.stopped`
invalidates the member's credential. A member whose policy blocks every
vault tool (`vaultToolsAllowed` in `src/lib/permission-policy.js`) gets
nothing injected.

Events: `vault.request.pending { requestId, memberId, runId, channelId,
type, title }` and `vault.request.resolved { requestId, memberId, type,
action }`. The notification policy treats the pending one as an approval
and routes it to the member's chat.

Environment: `AUTOHAND_SQUAD_VAULT_KEY_SOURCE=file` forces the file
fallback; `AUTOHAND_SQUAD_VAULT_KEY_FILE` moves the key file (checks only).

## Web app

| Component | Where | Props |
| --- | --- | --- |
| `VaultSettings` (`src/components/settings/VaultSettings.jsx`) | Settings section `vault`, after Notifications | `api`, `copy` |
| `VaultRequests` + `useVaultRequests` (`src/components/chat/VaultRequests.jsx`) | Above the main canvas beside `AgentChannelProposals` | `vault` (hook result), `members`, `copy` |
| `SecureRequestCard`, `PaymentApprovalCard` (`src/components/chat/`) | Rendered by `VaultRequests` | request, member, cards, handlers |
| `NeedsYouList` `vaultRequests` prop | From `vaultNeedsYouRows(requests, agents)` in `src/lib/vault.js` | `navigate.vault(item)` opens the member's chat |

`workAttentionCount` takes `vaultRequests`; the badge counts them.

## Checks

`bun run check:vault` (in the `ci` chain) runs a real bridge in a temporary
state directory with the file key in a temporary home. It never uses the
keychain.

## Manual keychain verification (macOS)

Not automated, because `security` may prompt and the real keychain must not
be touched by a check. Do this once on a Mac with the desktop app or
`bun run dev`:

1. With no `AUTOHAND_SQUAD_VAULT_KEY_SOURCE` set, open Settings → Vault and
   add a login. The Key row should read "Held by the macOS Keychain".
2. `security find-generic-password -s ai.autohand.squad.vault` lists one
   item whose account is the first 16 hex characters of the SHA-256 of the
   state directory path. Do not pass `-w` unless you want the key printed.
3. `ls ~/.autohand/squad-vault.key` should not exist.
4. Quit the app, delete the keychain item in Keychain Access, reopen: the
   Key row says the key is missing and Add is refused; the items file is
   untouched. Restore from Keychain Access's trash or remove the items to
   start over.

Windows (DPAPI) and Linux (`secret-tool`) follow the same four steps with
`%USERPROFILE%\.autohand\squad-vault.key.dpapi` and `secret-tool lookup
service ai.autohand.squad.vault account <id>`.
