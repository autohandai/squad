# ADR-0256: The marketplace on a paired phone

Status: Accepted
Date: 2026-11-19

## Context

The owner asked for the marketplace on Squad for iPhone after the website's
Squad page gained one. The phone reaches this computer only through the
encrypted mobile host (ADR-0228, ADR-0252) and holds no Autohand credential.
This computer already reads the marketplace through `server/marketplace`
(ADR-0246) with a cache and a last-good copy, and adds a listing in the Squad
window: the window downloads the template through `/api/marketplace/fetch`
(validated and re-hashed), runs the same `addTeam` import as Import team with
every member untrusted, and records a receipt (ADR-0253). Members are only
ever created in the window (ADR-0077). A team proposal decided on the phone is
already carried out by the window, which polls `/api/mobile/team-decisions`
on the `mobile.decisions` event (ADR-0252).

## Decision

Host contract 0.5 adds capability `marketplace`, advertised by every host
with this code (`server/mobile/marketplace.mjs`):

- `marketplace.home`, `marketplace.list`, `marketplace.listing` read the
  existing `/api/marketplace/*` routes and shape rows for the phone. Template
  documents, hashes and instructions do not travel; the detail carries the
  template's own brain-card words for what the agent may use and what it asks
  first, its skills and, for a team, its members' names, roles and birds.
- `marketplace.add` (receipt-protected) records a decision in the existing
  mobile card store as an entry of kind `marketplace`, emits
  `mobile.decisions.changed`, and returns `requested`. It refuses before
  recording anything when the Squad is read-only for the account.
- The window handles `marketplace` entries next to team decisions:
  `GET /api/mobile/marketplace-requests`, claim (one window, two minutes),
  then the desktop's own fetch and `addFromMarketplace`, then settle with
  `done` ("Added Abner to your Squad.") or `failed` with the reason.
- `marketplace.requests` lets the phone follow its add.
- The receipt and Squad's funnel event carry `via`/source `phone`. The
  marketplace API does not accept `phone` as an install source yet (squad-api
  `EVENT_SOURCES`), so the anonymous install count sends `in-app` for now.
- A cloud failure becomes a calm sentence for the phone ("The marketplace
  can't be reached from your computer right now."), never an account code;
  the browser-side rule from the ADR-0246 amendment holds on this path too.

The person's consent is the tap on the phone after reading the detail; the Mac
does not show a second dialog, the same rule as team cards (ADR-0252).

## Evidence

- `scripts/check-mobile-marketplace.mjs` (in `check:mobile`): shaping, a
  category count of 38 matching its list, search and category parameters
  validated before they reach the bridge, detail with "May use" and "Asks you
  first", read-only refusal with nothing recorded, add as a decision with
  claim, second-window refusal and settle, a settled add keeping its outcome,
  persistence with source `phone`, calm unavailable error, browse-only when
  the card store is absent, and the commands routed and receipt-protected.
- `bun run check:mobile`, `check:server`, `check:marketplace:codes`,
  `check:product-telemetry`, `check:jsx`: pass.
- The phone side (squad-mobile ADR-0009) passed its UI flow against the
  fixture host in light and dark.

## Consequences

- An add from the phone needs the Squad window open on this computer; until
  then it waits and the phone says so.
- The window's handler has no browser check of its own: it reuses the
  desktop's fetch and import, which `check:marketplace` covers, but the
  phone-to-window path end to end has only been run with the fixture standing
  in for the window.
- Installs from phones are counted as `in-app` by the marketplace API until
  it learns `phone` and is deployed (production change, not made).
- Publishing, reporting and updating an installed listing stay on the Mac.
