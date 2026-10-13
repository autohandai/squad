# ADR-0067: Explicit product events through PostHog

Date: 2026-10-01
Status: Accepted

## Context

The user asked to measure prebuilt member use, newly created members, features,
and signed-in users, following the sibling Dev app's PostHog integration.
Product events answer these questions; copying browser autocapture or session
replay would additionally collect information from a coding workspace.

## Decision

Send an explicit allowlist of sign-in, signed-in session, member creation/use,
and feature action events through the local bridge. Identify users from its
trusted runtime account, not caller-supplied account identifiers. Use the
sibling project's selected public PostHog host/key when staging; never bundle
its environment file. Known prebuilt roles and selected harnesses are bounded
properties; local member identifiers are hashed with the trusted account.

No prompt, response, file path, member name, arbitrary property, DOM capture,
or replay is sent. Honor DNT and Global Privacy Control. Deduplicate sessions,
bound concurrent capture and timeout, and keep failures outside the work path.
Unauthenticated sign-in starts use an ephemeral anonymous identity.

## Evidence and consequences

`check-product-telemetry.mjs` passed schema filtering, trusted identity,
session deduplication, DNT, selected-setting staging and failure isolation with
mock ingestion. It does not prove live dashboard receipt. Explicit events
provide narrower coverage than autocapture and need a maintained feature
allowlist. Signed-in account profile properties follow Dev's identity model;
these are account data even though workspace content is excluded. If the
project is unconfigured or a capture fails, work continues and events can be
lost; no persistent telemetry retry queue is introduced.

After installing the staged app, its runtime was signed in and a real updater
check succeeded. Capturing that actual `updates/check` action with the installed
PostHog configuration and trusted runtime identity returned
`ingestionAccepted: true`. This establishes live ingestion acceptance, not
dashboard indexing or every frontend event's delivery.
