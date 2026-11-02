# ADR-0159: Bind optional decision models to the actual execution provider

Status: Accepted · 3 November 2026

## Context and evidence

The user explicitly requires zero Weka calls for users whose active provider is not Autohand AI Cloud. Valid Autohand login and `AUTOHAND_TYPE_AHEAD_MODEL=weka` must not bypass this rule. The CLI already uses Weka internally for compaction, so guarding only new skill-routing callers would leave a gap. Squad can fall back between execution engines under ADR-0155.

## Decision

One shared transport-boundary policy authorizes decision dispatch and retries. Weka requires a canonical actual Autohand AI Cloud execution route, valid eligible account, network availability, and the relevant feature/background settings. Unknown external-engine provider identity is ineligible. Other providers use local selection or an explicitly configured compatible model on their chosen provider.

Invalidate pending work with a policy epoch on provider, engine fallback, account, workspace/scope, or consent changes. Check again at dispatch and every retry, and reject stale results. Model names and display labels never grant authority. Cover typeahead, selection, learning, and compaction.

## Tradeoffs and deliberate limits

Strict isolation can disable an otherwise available selector, including for signed-in users, but preserves the requested provider boundary. Already-dispatched work cannot be recalled; its cost and discarded status remain observable. Do not fail over silently to another cloud.

Local previews remain default. Remote processing of an unsubmitted draft requires explicit preview enablement, and submission never waits for a preview. Decision models are not main coding-model choices. Public Weka wording and existing internal compaction use need reconciliation before release; no live quality or entitlement claim is made here.

Details: [design](../superpowers/specs/2026-11-02-adaptive-skills-design.md), [evaluation](../superpowers/specs/2026-11-02-adaptive-skills-evaluation.md).

## Implementation boundary (3 November 2026)

The CLI selection, preview and compaction adapters now share dispatch policy, cancellation, deadlines, retry checks and policy epochs. Local selection and abstention need no decision-model request. Remote decisions and remote previews require independent explicit settings; an environment model selection does not enable them. Weka is never sent through the chat-completion path and cannot run on an alternative execution provider. Mock transport and real terminal request captures establish these local contracts; no live eligibility, provider billing or quality result is claimed.
