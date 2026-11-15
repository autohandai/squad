# ADR-0224: Resolve Quick Chat APIs independently of the open page

## Context and evidence

An isolated ad-hoc native preview opened at `/settings/quick-chat`. Its Settings
page rendered with Agent avatars, Apple glass and usage enabled. The bridge's
canonical snapshot contained two available members, but invoking Window → Quick
chat produced no panel. This is separate from Cua's earlier stale transport and
the old preview's single-instance lock; neither establishes a product fix.

The picker and portrait loader appended `/api/...` to `shell.app_url`, which is
the page returned by desktop bootstrap, not necessarily an origin. Harness
usage did the same. A launch URL with a route therefore requested
`/settings/quick-chat/api/status/snapshot`. Its response was not the roster.
With a query or fragment, string concatenation can put the API path into those
components instead. The existing `quick_chat_url` already replaced the page
route correctly when constructing the conversation itself.

The focused native regression failed with the old construction, reporting
`http://127.0.0.1:19821/settings/quick-chat?from=menu#old/api/status/snapshot`
instead of the root API URL. This establishes the URL defect, not the cause of
every missing status item or a successful native material interaction.

## Decision

Use one URL resolver for the picker snapshot, break state, portraits and harness
usage. Resolve absolute `/api/` paths on the bootstrap page's origin, retaining
its scheme/host/port and the endpoint's own query. Reject credential-bearing or
non-HTTP URLs and paths outside `/api/`, including network-relative URLs.
Keep the existing ownership-generation headers, deadlines and scope checks.

## Verification and consequences

After correction, the locked serial native suite passed all 39 tests on macOS
ARM with Rust 1.90.0. The regression covers all three API endpoints, a page URL
with query and fragment, and rejected credentials, schemes and foreign routes.
It does not launch a webview or submit provider prompts. Native preview clicks,
status-item lifecycle, draft retention and Liquid Glass appearance require
separate rendered evidence; a passing URL test is not that evidence.

This deliberately treats the launch path as navigation rather than an API
mount prefix, matching the root routes already used by Squad's client. A reverse
proxy that relocates the entire API under a subpath is not introduced here.
There is no UI layout or standing design-contract change.
