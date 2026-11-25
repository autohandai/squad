# ADR-0282: Computers: where members run, and the Squad relay by name

Status: accepted, 2026-11-26

## Context

The owner asked to "refine the relay connection", to "support our agents to
run on anything", and that "by default is our squad relay by autohand". They
showed two screens from another product: a Computers page with Over SSH, a
cloud-provider picker, Cloud computers and "Other computers in your account";
and a computer card with "Reach from anywhere … through <relay>
(encrypted)", "Relay address" and "Skip the 6-digit check".

What Squad already had, read before deciding:

- **Members on another machine** (ADR-0025): a member's Runs on points at
  another Squad bridge's URL with a token minted there ("Share this
  machine"). Chat, streams and runs are proxied bridge to bridge. This is the
  only remote execution Squad has. There was no SSH support of any kind
  (`grep -ri ssh server` found only git remotes).
- **Phones** (ADR-0212, 0228, 0255): Settings › Computers was entirely about
  phones: Same Wi-Fi, "From anywhere" (the outbound relay on the Squad API at
  squad.autohand.ai, hard-wired through `squadApiUrl()`), My secure tunnel
  and Through iCloud. The relay's status was only "Connected" or
  "Connecting…".
- **Approval:** every phone is approved here with a 6-digit code
  (`service.approve` requires it). Only the iPhone fixture host has an
  automatic mode. There is no "skip the check" in the real host.
- **Account computers:** the Squad API's `mobile_relay_routes` table already
  had one row per computer that connected through the relay, by account,
  with no name.
- A separate Settings page called "Relay" is the self-hosted *team* relay for
  shared channels (ADR-0026), unrelated to the phone relay.

## Decision

**One Computers page, members first.** Settings › Computers is now "Where
your members run, and how your phone reaches them": This computer (and how
many members run here), Over SSH, Cloud computers (Beta), Other Squads
(addresses members already use), Other computers in your account, then the
phone settings under a Phones heading.

**SSH reaches another Squad; it does not replace it.** A member on another
computer still runs on that computer's Squad through the ADR-0025 runner; SSH
is how this computer gets to it. Saving an SSH computer (`server/computers/
ssh.mjs`) keeps one `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<19821>` forward
open per computer (BatchMode, a key from `~/.ssh` or the agent, never a
password; host keys accepted on first use; reconnects with backoff; restored
at boot; killed with the bridge). The forward's local address is offered as
one click in each member's Runs on, with the token from that computer. We
chose this over running the Autohand CLI over a raw SSH shell because the
remote runner already carries streaming, presence, stop, permissions and
the conversation; a shell runner would have duplicated all of it. Test signs
in, then opens a forward and asks Squad's bridge there for `/api/runtime`:
any HTTP answer means Squad is running (it asks for its token), and each
failure is one sentence (key refused, unknown host, port closed, host key
changed, Squad not running). Host and user are validated so ssh can never
read them as options; the destination always follows `--`.

**Cloud computers are steps, not provisioning.** The provider dialog lists
Hetzner Cloud, DigitalOcean, Amazon Lightsail, Fly.io and "Your own server"
(`src/lib/cloud-computers.js`), each with the same steps: create a server
there, install and start Squad (`squad serve` without a screen), mint a token
there, add it Over SSH. No prices are shown, so nothing can go stale or
mislead, and the section says plainly that Squad doesn't create them yet.

**The relay by name.** The phone route is "Reach from anywhere", "Through
Squad relay by Autohand". Its row shows the relay address, "Connected · 38
ms" (heartbeat round trip) or "Reconnecting · last answered 2 min ago".
"Use a different relay" saves `relayUrl` in the phone config: an HTTPS
origin, no path, no credentials; loopback http for development. Empty, or
Autohand's own address, means Squad relay by Autohand. A config PUT that
doesn't mention `relayUrl` keeps the chosen one, so older callers can't
silently reset it.

**Other computers in your account** come from the relay: the computer names
itself after registering (`PUT /v1/mobile-relays/<room>/name`, a 404 from an
older relay is ignored), and `GET /v1/mobile-relays` lists the account's
computers by name and last connection, never a room id or route. Migration
0007 adds the name column.

**Not added: "Skip the 6-digit check".** The real host has no such mode, and
a skip would let anyone holding a QR in its ten minutes pair without the
person. Adding it would be new security semantics, which the brief ruled out.

**The team relay page is renamed "Team relay"**, so "relay" on the
Computers page means one thing.

## Consequences

- A member can run on any Mac or Linux computer that runs Squad and that
  this computer can SSH into, without opening a port there: the forward is
  loopback on both ends. It cannot run on a bare server without Squad; there
  is no agentless SSH runner.
- The token is still minted on the other computer and pasted here; Squad
  does not fetch it over SSH. Pairing over SSH (mint and fill in one step)
  is left for later.
- A custom relay receives this computer's Autohand sign-in to verify it
  (`/v1/auth/exchange`, `x-autohand-identity`), exactly as Autohand's relay
  does. The UI says to use only a relay you or your team run. Phones paired
  earlier learn the new relay address through their encrypted snapshot the
  next time they reach this computer another way (ADR-0228); a phone that can
  only reach the old relay has to wait for Wi-Fi.
- "Other computers in your account" needs the relay on, and names appear
  only after migration 0007 and this Worker are deployed and each computer
  reconnects. Until then the list explains why it is empty.
- Latency appears after the first heartbeat (20 s).
- Cloud providers are links: no account linking, no create/sleep/wake, no
  billing view. That needs provider APIs and credentials per provider.
- SSH computers are per computer, not synced to the account.

Evidence: `node scripts/check-computers.mjs` (a fake `ssh` that records its
arguments, refuses one host and implements `-L` as a real TCP forward:
validation refuses option-looking hosts and users and keys outside
`~/.ssh`; test sentences for signed in + Squad, refused key, unknown host, no
Squad; saved 0600 without key material; the forward reaches the other Squad,
comes back after its ssh is killed and after a restart, and closes on remove;
relay address rules; providers without prices; the route).
`node scripts/check-computers-browser.mjs` (the built page against a real
bridge, the system ssh failing on `squad-check.invalid` with a sentence, an
option-looking host refused, provider steps leading to the SSH form, "Through
Squad relay by Autohand", a non-HTTPS relay refused next to the field and not
saved; it also caught a nested `<form>` that saved the routes instead).
`services/squad-api` `npm test` 53 passed, 0 failed (the account list:
named, no room id, only the account's own). `check:mobile-host`,
`check:mobile:browser`, `check:remote`, `check:team`, `check:server` and
the build pass.
