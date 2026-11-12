# ADR-0202: Connected execution defaults for new members

Status: Accepted

## Context and evidence

The owner requires automatic primary/failover assignment for MCP-created
members and all other creation paths. MCP creation stored only an engine ID;
the managed adapter copied the acting engine and the app created no routing
chain. A real owned bridge/MCP-client regression failed with “new MCP members
automatically get another ready engine”. This is a configuration gap, separate
from the already functioning runtime fallback router.

## Decision

One shared creation-only helper chooses the reported-ready default engine,
then the first connected ready engine when the default is unavailable. An
explicit primary remains the person's choice. Save its current default model
and reasoning and up to four other reported-ready, already installed engines
as ordered fallbacks. Installed ACP connections are eligible; merely fetchable
registry entries are not. No new executable path or credentials are granted.

App and both MCP surfaces use this same selection policy. Creation receipts
and profile reads expose the saved assignment and fallback chain. Do not
recompute routing at runtime, when replaying an already saved creation, after
a discovery change for an existing member, or for older members. An unfinished
automatic app draft may refresh discovery before it is first saved. An
explicitly saved empty fallback list is respected. The
existing Model settings is the editor; no second routing editor is introduced.
Agent-managed routing stays off by default, permissions are preserved and no
work, installation or routine starts during configuration.

Untouched app drafts explicitly record automatic selection instead of treating
their initial Autohand display value as a user choice. Selecting/editing an
engine changes that draft to explicit selection. Existing drafts without the
new marker preserve their saved assignment, as do imported member assignments.
Generated trusted teams and blank chats use automatic selection. The initial
review found that merely adding a shared helper was insufficient: every old
app draft already contained `harness.id`, bypassing its automatic branch.

## Evidence

`node scripts/check-member-default-routing.mjs` uses a real owned HTTP bridge
and operator MCP client with recording native engine executables. It verifies
explicit/default primary choices, per-engine model/reasoning, saved fallback
configuration, service restart and idempotent replay. Public shared-policy
checks cover an unavailable default, installed ACP, excluded fetch-on-use
entries, explicit empty routing and no connected alternatives. These fixtures
are not proof of live provider authentication or successful model execution.

`node scripts/check-member-default-routing-browser.mjs` first failed with the
actual chooser text `Autohand CodeDefaultSetup required`. It now verifies the
rendered chooser and submitted request choose ready Codex, while an explicit
Autohand selection remains preserved. The HTTP catalog and preparation refusal
are controlled at the browser boundary; no member engine executes in this test.
`node scripts/check-member-management-browser.mjs` verifies the automatically
saved chain appears in the normal Model editor and survives service/browser
restart alongside profile edits and memories.

## Consequences

New agents are resilient without a separate setup step and users retain one
existing editor. Catalog order is deterministic, not a performance ranking;
models/reasoning are snapshots of reported defaults and may later need editing.
Readiness is the adapter's reported state, not a paid prompt or a guarantee of
remaining quota. Native and ACP routes can share provider quota. With no
alternative connected, the chain is empty and the receipt tells the client to
connect one; creation cannot manufacture credentials or useful failover. Old
agents are deliberately not migrated and routing is not continually rewritten.
