# ADR 0069: Squad identity follows the device authorization contract

Date: 2026-10-01

## Context and evidence

Squad initiated sign-in with `clientType: "desktop"`. The account confirmation
page therefore correctly named Desktop rather than Squad. Changing the page's
label or adding a product name to the URL would conceal the caller error and
bypass the existing authoritative identity contract.

The API, Pages proxy, signed legacy continuation parser, JSON schemas and
database CHECK constraint accepted five exact client identities. Squad needed
one additional value across that contract. The wire-protocol `clientId` remains
`autohand-cli`; it is independent of the requesting product's identity.

Production migration inventory showed only
`082_cli_device_auth_squad_client_type.sql` pending. The existing v2 code mapping
has an `ON DELETE CASCADE` foreign key to the authorization table. Dropping the
parent while rebuilding its CHECK constraint would delete those mappings.

An isolated SQLite test with foreign keys enabled verifies preservation of every
authorization field, all five statuses and prior identities, v2 mappings and
indexes. It also verifies rejected identities, both foreign-key deletion
behaviors, and rollback of a failed containing transaction. The integrated API
tests pass 29 cases, typecheck passes, and its production packaging dry run passes.
The integrated website tests pass 20 cases and its full build and Pages function,
CORS and return-URL checks pass.

A clean website HEAD build was initially considered as the deployment candidate.
That diagnosis was incomplete: production source metadata named the same commit,
but live `CodeUsers-CoBZDc-2.js` contained the uncommitted admin work. A HEAD build
would remove Plan in each system, Fix billing tier, Fix CRM, Start trial and other
already published controls. Rebuilding an isolated snapshot of the prior source
changes reproduced that live bundle exactly: SHA-256
`d3ab0a19e86cef4d8d0577f2150edf01352791b002d0fbc6a61c44efe410c9c1`.

## Decision

Add the exact lowercase `squad` identity to API and site allowlists, schemas,
golden examples, presentation and runbooks. V2 confirmation still resolves the
stored identity through the authenticated same-origin proxy. Its URL contains
only `user_code`; query labels cannot override identity. Existing products and
legacy absent-client-type CLI behavior remain compatible.

Migration 082 parks the v2 child mappings before rebuilding the parent, then
restores the child table and all indexes within the migration transaction. Keep
foreign keys enabled and preserve every authorization column.

Roll out the widened database and API support before the site and native caller.
Publish the site from an isolated reconstruction of the already deployed source
and artifact, preserving existing files. The reviewed candidate replaces only
`signin.html`, adds its new JavaScript and CSS, retains 2,265 existing files
byte-for-byte and removes none. Keep the old assets and published-only docs/media.
Do not use the original dirty checkout or the umbrella deployment script, which
also deploys unrelated workers.

## Recorded production evidence

Migration 082 applied successfully in 14 statements. Immediately before and after,
the database contained 787 authorization rows and 150 v2 mappings. Both focused
foreign-key checks were empty; all four named indexes existed and the staging
backup table was gone.

API base commit: `cc4ab4f48146b79f41cab8010f9d0bdbbc546082`.
The applied identity patch SHA-256 is
`eb73a8a0efa04ec29eea8ec87bb918f5f646682e86cf97edb47e29d4f088a1d3`.
API production version: `d32b4457-9049-4881-a021-9bbc3e0cc9b4`, tagged
`squad-signin`. Direct public API initiation accepts Squad v2 and returns the
exact code-only confirmation URL. Verification challenges were cancelled without
authorizing an account or receiving a credential.

Previous API version: `725e9ec3-6c78-4d5b-98d7-9599cd7c269d`.
Previous Pages production deployment: `c2087e56-3fd7-46d2-9f2b-e0184cf4b63e`.
Website base commit: `5f47f45e9c52dd0dcad6a9b8fec503a7708217cc`, with its
already published source changes. The identity patch SHA-256 is
`f692c7fb64ae7fbcc4190cf0a9b3d4436141f6c6b6ce4a00c6e82171ffb67ac4`.
Before publication, all 626 prior files under `/assets` were downloaded from
the production origin and matched their retained SHA-256 values exactly.
The initial check against the immutable Pages hostname returned redirect bodies;
that result was not an artifact mismatch and was corrected by checking the
production origin. The complete retained artifact comparison changes only
`signin.html`, adds two sign-in assets and removes no files.

Pages production deployment:
`8cd74e5f-b331-45f5-9bb8-2c9c8027b532`, branch `main`. The upload reused 2,250
existing static assets and uploaded exactly three new/changed files. Its source
metadata names the base commit with `commit-dirty=true`; it is an isolated
reconstruction with the documented identity patch, not a newly committed release.
The public site proxy accepts Squad v2 initiation and its test challenge was
cancelled. Live sign-in JavaScript matches the candidate SHA-256
`bca6302c85ebf33656af8a888786789453b39f64e1905c17b1ad238753608157` and includes
the Autohand Squad / Squad / return-to-Squad presentation map. The live admin
bundle still has exactly its pre-rollout SHA-256 recorded above.

## Consequences and recovery

The native caller must wait for the public site proxy to accept Squad before
switching its identity. A successful API deployment alone does not prove the
site confirmation or installed app flow. Public browser confirmation and native
sign-in are separate proof boundaries; test challenge cancellation does not
establish a completed account sign-in.

The artifact-preserving deployment retains the prior site's published-only
files, including legacy files unrelated to this change. Direct comparison of
compiled production Pages function bytes is unavailable: source reconstruction,
exact frontend artifact matches, and existing route checks establish the chosen
baseline, rather than a claim of downloaded production server source.

Prefer reverting API and Pages code while retaining the backward-compatible
widened constraint. The recorded pre-migration D1 bookmark is
`00004334-00007c08-000050f7-26990d4ba3bb14da64f38c36d26c7f98`.
Restoring it would overwrite the entire database, discard later writes and cancel
in-flight queries; it is an emergency recovery action requiring explicit restore
authorization, never an automatic code rollback.

The local rollout plan is `/private/tmp/squad-signin-rollout-plan.md`. The complete
asset, preservation, deployment and live contract proofs are copied into
`.codex-artifacts/signin/`, with the combined status in `report.json`. Cloudflare's
[Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/)
describes the whole-database recovery boundary; the
[Pages rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/)
describes reverting a recorded production deployment.
