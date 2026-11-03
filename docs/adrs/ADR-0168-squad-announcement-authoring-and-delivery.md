# ADR-0168: Use the shared announcements service for Squad

Date: 2026-11-03. Status: Accepted.

## Context and evidence

The user could not select Squad under Announcements in the website admin.
Inspection of the authoritative sibling `dark-web-cli` found Website, Desktop,
CLI, Code Web, Web Dev and Assembly, with no Squad. Squad itself had no feed
consumer. Adding only a client selector would not deliver anything.

The shared API already owns publication/scheduling, priority, platform/version
and plan targeting, authenticated delivery, reading progress and per-user
dismissal. Its schema accepted arbitrary client names, but required media for
non-web clients and restricted text/link/notice formats to the web clients.
Untargeted legacy announcements were eligible for any ordinary new client.

## Decision

Extend that existing contract for the exact `squad` audience. The existing
permission-gated admin editor adds Squad with text-only notices, modal content
and optional media steps; mixed Squad/other-client targeting is rejected.
Squad delivery accepts explicit Squad-only targeting, excluding older untargeted
Desktop broadcasts. Existing database columns suffice; no migration is needed.
The transport's `sidebar` format is called Notice for Squad and appears in the
main shell so it remains usable with a hidden sidebar or a phone.

The local bridge calls the main identity API's `/v1/announcements` using the
existing signed-in credential, fixed `clientType=squad`, running version and
platform. It never returns the token to the webview. Authenticated actions use
the existing seen/dismiss endpoints, including their actual `lastStep` field.
The bridge refuses redirects, bounds content, strips unsafe media/action URLs,
and discards results when the account changes during a request.

The shared shadcn dialog renders plain text, images/video, optional links and
ordered Next/Previous steps. Modal delivery waits until the window is visible,
onboarding is finished, members are not working, and no form/dialog is active.
Every item is also reachable through a compact From Autohand notice. Dismiss
waits for server acknowledgement; a failed dismissal stays visible for retry.
Read receipts do not authorize software installation or tool permissions.

## Consequences and evidence boundaries

- Reuses the existing admin permissions, authentication, scheduling and
  account-scoped persistence instead of a second announcement store.
- Delivery needs the coordinated API, website and Squad changes. Older clients
  do not gain a feed automatically, and local source is not deployment proof.
- Background network failures do not block work. Updates can show a retryable
  news error; other pages stay usable. Media can fail independently of text.
- Notices use the main shell rather than a literal sidebar card. Multiple
  items are offered one at a time in service priority order. Per-user dismissal
  is durable; auto-open suppression within a window is only in memory.
- API `tests/announcements-dev.test.ts` exercises real D1 authoring, exact
  audience isolation, legacy-broadcast exclusion, seen step writes and
  dismissal across users/reloads. The API's focused suites and typecheck pass.
- `check:announcements` uses the real bridge with an upstream fixture for
  auth, targeting, URL sanitization, account change, sign-out, redirect refusal
  and failed-dismiss retry. Playwright covers the rendered notice, steps and
  acknowledged dismissal; the website's dedicated Playwright test covers
  Squad authoring at desktop and phone sizes. These tests do not publish news.
- No production announcement is created by this change. Sending a real
  announcement is a separate authored communication, not an implicit test.
